// El Worker único reparte cada petición: el conector (MCP, OAuth, cuenta, panel, GPX) o la web.
import test from 'node:test';
import assert from 'node:assert/strict';
import unico, { esDelConector } from '../apps/worker/src/unico.js';

test('rutas del conector', () => {
  for (const p of ['/mcp', '/mcp/', '/.well-known/oauth-authorization-server', '/oauth/authorize', '/oauth/token', '/cuenta', '/cuenta/garmin', '/panel', '/route/abc.gpx', '/avisos/0123456789abcdef0123456789abcdef'])
    assert.equal(esDelConector(p, 'GET'), true, p);
  assert.equal(esDelConector('/', 'POST'), true, 'POST a la raíz es MCP');
});

test('rutas de la web', () => {
  for (const p of ['/', '/api/me', '/api/mcp', '/api/login', '/mcp-app', '/mcp-app.js', '/manifest.webmanifest', '/sw.js', '/route/abc'])
    assert.equal(esDelConector(p, 'GET'), false, p);
});

test('la web habla con el conector en proceso y con su propia URL', async () => {
  const kv = new Map();
  const KV = { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); }, list: async () => ({ keys: [] }) };
  const env = { GARMIN: KV, SESIONES: KV, SIGNING_KEY: 'prueba', ASSETS: { fetch: async () => new Response('<!doctype html>web') } };
  const ctx = { waitUntil() {} };
  const meta = await unico.fetch(new Request('https://ejemplo.dev/.well-known/oauth-authorization-server'), env, ctx);
  assert.equal((await meta.json()).issuer, 'https://ejemplo.dev');
  const login = await unico.fetch(new Request('https://ejemplo.dev/api/login'), env, ctx);
  assert.equal(login.status, 302);
  assert.match(login.headers.get('Location'), /^https:\/\/ejemplo\.dev\/oauth\/authorize\?/);
  const home = await unico.fetch(new Request('https://ejemplo.dev/'), env, ctx);
  assert.match(await home.text(), /web/);
});

test('si cambia SIGNING_KEY, la web vuelve a registrarse y la pantalla de entrar abre', async () => {
  const kv = new Map();
  const KV = { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); }, list: async () => ({ keys: [] }) };
  const ctx = { waitUntil() {} };
  const base = { GARMIN: KV, SESIONES: KV, ASSETS: { fetch: async () => new Response('web') } };
  const entrar = async env => {
    const login = await unico.fetch(new Request('https://ejemplo.dev/api/login'), env, ctx);
    return (await unico.fetch(new Request(login.headers.get('Location')), env, ctx)).status;
  };
  assert.equal(await entrar({ ...base, SIGNING_KEY: 'vieja' }), 200);
  assert.equal(await entrar({ ...base, SIGNING_KEY: 'nueva' }), 200, 'con la clave nueva no reutiliza el registro firmado con la vieja');
});
