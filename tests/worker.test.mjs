// Flujo completo del Worker contra un conector de Garmin simulado: login → callback → mcp.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../apps/worker/src/index.js';

const kv = () => { const m = new Map(); return { get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } }; };
const env = { GARMIN_URL: 'https://garmin.test', SESIONES: kv(), ASSETS: { fetch: async () => new Response('html') } };
const llamadas = [];
globalThis.fetch = async (url, init = {}) => {
  llamadas.push(url);
  if (url.endsWith('/oauth/register')) return Response.json({ client_id: 'client_x', client_secret: 's' }, { status: 201 });
  if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'tok', refresh_token: 'ref', expires_in: 3600 });
  if (url.endsWith('/mcp')) {
    assert.equal(init.headers.Authorization, 'Bearer tok');
    const { params } = JSON.parse(init.body);
    return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ tool: params.name, ok: true }) }] } });
  }
  if (url.includes('/cuenta')) {
    assert.equal(init.headers.Authorization, 'Bearer tok');
    return Response.json({ ruta: new URL(url).pathname, metodo: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
  }
  throw new Error('fetch inesperado ' + url);
};
const req = (path, init = {}) => worker.fetch(new Request('https://mycoach.test' + path, init), env);

test('sin sesión: no conectado y /api/mcp pide conectar', async () => {
  assert.deepEqual(await (await req('/api/me')).json(), { conectado: false });
  const r = await req('/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"tool":"garmin_activities"}' });
  assert.equal(r.status, 401);
});

test('login con PKCE, callback con cookie y llamada a una herramienta', async () => {
  const login = await req('/api/login');
  assert.equal(login.status, 302);
  const loc = new URL(login.headers.get('Location'));
  assert.equal(loc.origin + loc.pathname, 'https://garmin.test/oauth/authorize');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://mycoach.test/api/callback');
  const cb = await req(`/api/callback?code=c1&state=${loc.searchParams.get('state')}`);
  assert.equal(cb.status, 302);
  const cookie = cb.headers.get('Set-Cookie').split(';')[0];
  assert.match(cb.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const me = await req('/api/me', { headers: { Cookie: cookie } });
  assert.deepEqual(await me.json(), { conectado: true, calendario: false });
  assert.match(me.headers.get('Set-Cookie'), new RegExp(`^${cookie}; .*Max-Age=${60 * 60 * 24 * 60}`), 'la sesión se renueva al abrir');
  const r = await req('/api/mcp', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'garmin_activities', input: { limit: 5 } }) });
  assert.deepEqual(await r.json(), { payload: { tool: 'garmin_activities', ok: true } });
  const coach = await req('/api/mcp', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'coach_hoy', input: {} }) });
  assert.deepEqual(await coach.json(), { payload: { tool: 'coach_hoy', ok: true } }, 'la web puede pedir el semáforo al conector');
  const no = await req('/api/mcp', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'garmin_save_course' }) });
  assert.equal(no.status, 403);
  const csrf = await req('/api/mcp', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'text/plain' }, body: '{"tool":"app_guardar"}' });
  assert.equal(csrf.status, 415);
});

test('un state desconocido no abre sesión', async () => {
  assert.equal((await req('/api/callback?code=c&state=otro')).status, 400);
});

test('lo que no es /api va a los estáticos', async () => {
  assert.equal(await (await req('/')).text(), 'html');
});

test('con service binding, las llamadas al conector van por él y no por internet', async () => {
  const vistos = [];
  const env2 = { ...env, SESIONES: kv(), GARMIN_SVC: { fetch: async r => { vistos.push(new URL(r.url).pathname); return globalThis.fetch(r.url, { method: r.method, headers: Object.fromEntries(r.headers), body: await r.text() }); } } };
  const login = await worker.fetch(new Request('https://mycoach.test/api/login'), env2);
  assert.equal(login.status, 302);
  assert.deepEqual(vistos, ['/oauth/register']);
});

test('calendario: guardar el enlace, leer bloques ocupados y quitarlo', async () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', 'SUMMARY:Trabajo', 'DTSTART;TZID=Europe/Madrid:20260901T090000', 'DTEND;TZID=Europe/Madrid:20260901T180000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const prev = globalThis.fetch;
  globalThis.fetch = async (u, init) => String(u).startsWith('https://cal.test/') ? new Response(String(u).endsWith('ok.ics') ? ics : '<html>', { status: 200 }) : prev(u, init);
  try {
    const login = await req('/api/login'); const st = new URL(login.headers.get('Location')).searchParams.get('state');
    const cookie = (await req(`/api/callback?code=c2&state=${st}`)).headers.get('Set-Cookie').split(';')[0];
    const post = u => req('/api/calendario', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: u }) });
    assert.equal((await post('http://cal.test/ok.ics')).status, 400, 'solo https/webcal');
    assert.equal((await post('https://cal.test/no.ics')).status, 400, 'tiene que ser un .ics');
    assert.equal((await post('webcal://cal.test/ok.ics')).status, 200);
    assert.equal((await (await req('/api/me', { headers: { Cookie: cookie } })).json()).calendario, true);
    const r = await (await req('/api/calendario?desde=2026-09-28&dias=7', { headers: { Cookie: cookie } })).json();
    assert.equal(r.eventos.length, 5);
    assert.deepEqual(r.eventos[0], { f: '2026-09-28', de: '09:00', a: '18:00', t: 'Trabajo' });
    await req('/api/calendario', { method: 'DELETE', headers: { Cookie: cookie } });
    assert.deepEqual(await (await req('/api/calendario', { headers: { Cookie: cookie } })).json(), { configurado: false, eventos: [] });
  } finally { globalThis.fetch = prev; }
});

test('la cuenta pasa al conector con el token de la sesión, y solo con JSON', async () => {
  const login = await req('/api/login');
  const state = new URL(login.headers.get('Location')).searchParams.get('state');
  const cookie = (await req(`/api/callback?code=c2&state=${state}`)).headers.get('Set-Cookie').split(';')[0];
  assert.equal((await req('/api/cuenta')).status, 401, 'sin sesión no hay cuenta');
  assert.deepEqual(await (await req('/api/cuenta', { headers: { Cookie: cookie } })).json(), { ruta: '/cuenta', metodo: 'GET', body: null });
  const g = await req('/api/cuenta/garmin', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"email":"a@b.c","password":"x"}' });
  assert.deepEqual(await g.json(), { ruta: '/cuenta/garmin', metodo: 'POST', body: { email: 'a@b.c', password: 'x' } });
  const csrf = await req('/api/cuenta/contrasena', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'nueva=x' });
  assert.equal(csrf.status, 415, 'un formulario de otra web no puede cambiar la contraseña');
});
