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
  assert.deepEqual(await (await req('/api/me', { headers: { Cookie: cookie } })).json(), { conectado: true });
  const r = await req('/api/mcp', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'garmin_activities', input: { limit: 5 } }) });
  assert.deepEqual(await r.json(), { payload: { tool: 'garmin_activities', ok: true } });
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
