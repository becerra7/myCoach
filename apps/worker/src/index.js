// Worker de myCoach: sirve la web y hace de puente con el conector de Garmin.
//
// La web no guarda contraseñas ni habla con Garmin directamente: es un cliente
// OAuth más del conector (el mismo servidor MCP que usa Claude). Así la web y
// tu Claude leen y escriben los mismos datos, y el chat "fuera de la app" es
// simplemente tu Claude con el conector.
//
//   GET  /api/login     → registra la web como cliente (una vez) y redirige a autorizar
//   GET  /api/callback  → canjea el código (PKCE) y abre sesión con cookie HttpOnly
//   GET  /api/me        → { conectado }
//   POST /api/mcp       → { tool, input } → llama a la herramienta del conector
//   POST /api/logout

const COOKIE = 'mc_s';
const SESSION_TTL = 60 * 60 * 24 * 60;
// Solo lo que usa la app. Nada de guardar rutas en Garmin desde la web.
export const TOOLS = new Set([
  'garmin_status', 'garmin_activities', 'garmin_activity_detail', 'garmin_activity_route',
  'garmin_training_readiness', 'garmin_sleep', 'garmin_hrv', 'garmin_body_battery', 'garmin_daily_summary',
  'app_leer', 'app_guardar',
]);

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const cookieOf = req => (req.headers.get('Cookie') || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === COOKIE)?.[1] || null;
const setCookie = (v, maxAge) => `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Llamadas servidor a servidor al conector. Cloudflare no deja que un Worker
// llame a otro de la misma cuenta por su URL workers.dev (da 404), así que va
// por service binding (GARMIN_SVC). El navegador sí usa la URL pública.
const garmin = (env, path, init) =>
  env.GARMIN_SVC ? env.GARMIN_SVC.fetch(new Request(`${env.GARMIN_URL}${path}`, init)) : fetch(`${env.GARMIN_URL}${path}`, init);

async function cliente(env, origin) {
  const redirect = `${origin}/api/callback`;
  const key = `mc:cliente:${redirect}`;
  const cached = await env.SESIONES.get(key, 'json');
  if (cached) return cached;
  const r = await garmin(env, '/oauth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'myCoach', redirect_uris: [redirect] }),
  });
  if (!r.ok) throw new Error(`register ${r.status}`);
  const c = await r.json();
  const out = { client_id: c.client_id, client_secret: c.client_secret, redirect };
  await env.SESIONES.put(key, JSON.stringify(out));
  return out;
}

async function token(env, c, params) {
  const r = await garmin(env, '/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, ...params }),
  });
  if (!r.ok) return null;
  const t = await r.json();
  return { access: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in || 3600) * 1000 - 60e3 };
}

async function llamar(env, origin, sid, s, name, input) {
  const rpc = access => garmin(env, '/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${access}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input || {} } }),
  });
  let r = s.exp > Date.now() ? await rpc(s.access) : null;
  if (!r || r.status === 401) {
    const nuevo = s.refresh && await token(env, await cliente(env, origin), { grant_type: 'refresh_token', refresh_token: s.refresh });
    if (!nuevo) return json({ code: 'needs_reauth', message: 'Vuelve a conectar tu Garmin' }, 401);
    Object.assign(s, nuevo);
    await env.SESIONES.put(`mc:s:${sid}`, JSON.stringify(s), { expirationTtl: SESSION_TTL });
    r = await rpc(s.access);
  }
  if (!r.ok) return json({ code: 'server_unavailable', message: `Conector ${r.status}` }, 502);
  const body = await r.json();
  const res = body.result;
  if (!res) return json({ code: 'tool_error', message: body.error?.message || 'Error' }, 502);
  const text = res.content?.[0]?.text ?? 'null';
  if (res.isError) return json({ code: 'tool_error', message: text }, 502);
  let payload; try { payload = JSON.parse(text); } catch { payload = text; }
  return json({ payload });
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const { pathname, origin } = url;
  const sid = cookieOf(request);
  const sesion = sid ? await env.SESIONES.get(`mc:s:${sid}`, 'json') : null;

  // Sesión deslizante: cada vez que abres la app se renuevan los 60 días (cookie y KV).
  if (pathname === '/api/me') {
    if (!sesion) return json({ conectado: false });
    await env.SESIONES.put(`mc:s:${sid}`, JSON.stringify(sesion), { expirationTtl: SESSION_TTL });
    return json({ conectado: true }, 200, { 'Set-Cookie': setCookie(sid, SESSION_TTL) });
  }

  if (pathname === '/api/login') {
    const c = await cliente(env, origin);
    const state = random(), verifier = random(48);
    await env.SESIONES.put(`mc:pkce:${state}`, verifier, { expirationTtl: 600 });
    const q = new URLSearchParams({
      response_type: 'code', client_id: c.client_id, redirect_uri: c.redirect, state,
      code_challenge: await sha256(verifier), code_challenge_method: 'S256',
    });
    return Response.redirect(`${env.GARMIN_URL}/oauth/authorize?${q}`, 302);
  }

  if (pathname === '/api/callback') {
    const state = url.searchParams.get('state'), code = url.searchParams.get('code');
    const verifier = state && await env.SESIONES.get(`mc:pkce:${state}`);
    if (!verifier || !code) return new Response('Enlace caducado. Vuelve a intentarlo desde la app.', { status: 400 });
    await env.SESIONES.delete(`mc:pkce:${state}`);
    const c = await cliente(env, origin);
    const t = await token(env, c, { grant_type: 'authorization_code', code, redirect_uri: c.redirect, code_verifier: verifier });
    if (!t) return new Response('No se pudo conectar con Garmin.', { status: 502 });
    const nuevo = random();
    await env.SESIONES.put(`mc:s:${nuevo}`, JSON.stringify(t), { expirationTtl: SESSION_TTL });
    return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': setCookie(nuevo, SESSION_TTL) } });
  }

  if (pathname === '/api/logout' && request.method === 'POST') {
    if (sid) await env.SESIONES.delete(`mc:s:${sid}`);
    return json({ ok: true }, 200, { 'Set-Cookie': setCookie('', 0) });
  }

  if (pathname === '/api/mcp' && request.method === 'POST') {
    if (!sesion) return json({ code: 'needs_reauth', message: 'Conecta tu Garmin' }, 401);
    // Misma origen: la cookie es SameSite=Lax, y además se exige JSON (no se puede enviar desde un formulario).
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return json({ code: 'bad_request' }, 415);
    const { tool, input } = await request.json().catch(() => ({}));
    if (!TOOLS.has(tool)) return json({ code: 'not_in_manifest', message: 'Herramienta no permitida' }, 403);
    return llamar(env, origin, sid, sesion, tool, input);
  }

  return json({ code: 'not_found' }, 404);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      try { return await handleApi(request, env); }
      catch (e) { return json({ code: 'server_unavailable', message: String(e.message || e) }, 502); }
    }
    return env.ASSETS.fetch(request);
  },
};
