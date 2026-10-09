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
//   /api/cuenta[/contrasena|/garmin] → tu cuenta de myCoach en el conector (contraseña, vincular Garmin)
//
// El calendario ya no vive aquí: lo guarda el conector (agenda_calendario) para que tu Claude
// también lo vea. Si una sesión trae un enlace de antes, se pasa al conector al abrir la app.

const COOKIE = 'mc_s';
const SESSION_TTL = 60 * 60 * 24 * 60;
// Solo lo que usa la app. Nada de guardar rutas en Garmin desde la web.
export const TOOLS = new Set([
  'garmin_status', 'garmin_activities', 'garmin_activity_detail', 'garmin_activity_route',
  // Garmin: el día (sueño, VFC, readiness…) y la forma (carga, Load Focus, VO2máx, umbrales).
  'garmin_dia', 'garmin_forma',
  'app_leer', 'app_guardar',
  // El entrenador: el semáforo y las reglas del plan viven en el conector,
  // así la web y tu Claude deciden con el mismo método.
  'coach_hoy', 'coach_semana', 'coach_perfil', 'coach_perfil_guardar', 'coach_proponer', 'coach_anotar', 'coach_progreso',
  // Intervals.icu: la clave se manda una vez al conector, que la guarda cifrada.
  'intervals_estado', 'intervals_conectar', 'intervals_desconectar',
  'intervals_actividades', 'intervals_actividad', 'intervals_bienestar', 'intervals_curvas',
  // Fuerza: el entreno del día, su histórico y mandarlo al reloj (con confirmación en la app).
  'fuerza_dia', 'fuerza_historial',
  // La librería de entrenos: verlos, editarlos y añadir ejercicios del catálogo de Garmin.
  'entrenos', 'fuerza_entreno_guardar', 'fuerza_ejercicios_garmin', 'entreno_enviar_garmin', 'peso_historico', 'peso_registrar', 'medidas', 'medidas_registrar', 'avisos', 'avisos_guardar',
  // Solo lectura: tus rutas guardadas en Garmin (Plan) y las comidas que registra tu Claude (Comer).
  'garmin_courses', 'comidas',
  // El plan de comidas de la semana (lo propone tu Claude; la web lo enseña y saca la lista de la compra).
  'comida_plan',
  // Tu agenda: lo que te ocupa (compromisos y calendario), anotar algo y conectar el calendario.
  'agenda', 'agenda_anotar', 'agenda_calendario',
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

/* El registro de la web como cliente del conector va firmado con SIGNING_KEY: si la clave cambia,
   el guardado ya no vale. La clave de la caché lleva una huella de la clave para que se renueve solo. */
async function huellaClave(env) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.SIGNING_KEY || ''}|cliente`));
  return [...new Uint8Array(d)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function cliente(env, origin) {
  const redirect = `${origin}/api/callback`;
  const key = `mc:cliente:${await huellaClave(env)}:${redirect}`;
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

/** Token del conector vigente, renovándolo si hace falta. null: hay que volver a entrar. */
async function acceso(env, origin, sid, s) {
  if (s.exp > Date.now()) return s.access;
  const nuevo = s.refresh && await token(env, await cliente(env, origin), { grant_type: 'refresh_token', refresh_token: s.refresh });
  if (!nuevo) return null;
  Object.assign(s, nuevo);
  await env.SESIONES.put(`mc:s:${sid}`, JSON.stringify(s), { expirationTtl: SESSION_TTL });
  return s.access;
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
    // El enlace del calendario que se guardaba en la sesión pasa al conector, una vez y sin pedir nada.
    if (sesion.cal) {
      const r = await llamar(env, origin, sid, sesion, 'agenda_calendario', { url: sesion.cal }).catch(() => null);
      if (r && r.ok) { delete sesion.cal; await env.SESIONES.delete(`mc:ics:${sid}`); }
    }
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
    if (!verifier || !code) {
      // Un segundo envío del login (doble toque, volver atrás) trae un enlace ya usado:
      // si la sesión ya está hecha, a la app; si no, una página con el botón para reintentar.
      if (sesion && !url.searchParams.get('error')) return new Response(null, { status: 302, headers: { Location: '/' } });
      const cancelado = url.searchParams.get('error') === 'access_denied';
      return paginaAviso(cancelado ? 'Has cancelado la entrada' : 'Este enlace ya no vale',
        cancelado ? 'No se ha conectado nada. Puedes volver a intentarlo cuando quieras.' : 'Los enlaces para entrar solo sirven una vez y durante 10 minutos. Vuelve a intentarlo: es un momento.');
    }
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

  // La cuenta va aparte de las herramientas: las contraseñas no pasan por el chat.
  if (pathname === '/api/cuenta' || pathname === '/api/cuenta/contrasena' || pathname === '/api/cuenta/garmin') {
    if (!sesion) return json({ code: 'needs_reauth', message: 'Entra en myCoach' }, 401);
    const metodo = request.method;
    if (!['GET', 'POST', 'DELETE'].includes(metodo)) return json({ code: 'bad_request' }, 405);
    if (metodo !== 'GET' && !(request.headers.get('Content-Type') || '').startsWith('application/json')) return json({ code: 'bad_request' }, 415);
    const access = await acceso(env, origin, sid, sesion);
    if (!access) return json({ code: 'needs_reauth', message: 'Vuelve a entrar en myCoach' }, 401);
    const r = await garmin(env, pathname.slice(4), {
      method: metodo,
      headers: { Authorization: `Bearer ${access}`, ...(metodo === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(metodo === 'POST' ? { body: await request.text() } : {}),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) return json({ code: r.status === 401 && !datos.error ? 'needs_reauth' : 'tool_error', message: datos.error || `Conector ${r.status}` }, r.status === 401 ? 401 : r.status >= 500 ? 502 : r.status);
    return json(datos);
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
    // La app dentro de Claude: el HTML pequeño con la dirección de esta web para cargar el código.
    if (pathname === '/mcp-app') {
      const r = await env.ASSETS.fetch(new Request(new URL('/mcp-app', request.url)));
      if (!r.ok) return r;
      const html = (await r.text()).replaceAll('__ORIGEN__', new URL(request.url).origin);
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (pathname.startsWith('/api/')) {
      try { return await handleApi(request, env); }
      catch (e) { return json({ code: 'server_unavailable', message: String(e.message || e) }, 502); }
    }
    return env.ASSETS.fetch(request);
  },
};

/** Página mínima para avisos del login, con el botón para reintentar. */
function paginaAviso(titulo, texto) {
  const e = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(titulo)} · myCoach</title>
<style>:root{color-scheme:light dark}body{margin:0;font:17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#F2F2F7;color:#000}main{max-width:420px;margin:0 auto;padding:48px 16px}
h1{font-size:26px;margin:0 0 8px}p{color:#5F5F66;margin:0 0 24px}a{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:999px;background:#1D4FA0;color:#fff;font-weight:600;text-decoration:none}
a.sec{background:none;color:#1D4FA0;margin-top:8px}a:focus-visible{outline:2px solid #1D4FA0;outline-offset:3px}
@media (prefers-color-scheme:dark){body{background:#000;color:#fff}p{color:#AEAEB2}a{background:#8DB3F7;color:#0B1B36}a.sec{background:none;color:#8DB3F7}}</style></head>
<body><main><h1>${e(titulo)}</h1><p>${e(texto)}</p><a href="/api/login">Volver a entrar</a><a class="sec" href="/">Ir a myCoach</a></main></body></html>`,
    { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" } });
}
