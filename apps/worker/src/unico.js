/* Un solo Worker para todo myCoach: la web, su API y el conector MCP (apps/conector).
   Misma URL para la web y para tu Claude (…/mcp). Las piezas se hablan en el mismo
   proceso: la API llama al conector y el conector pide la vista de la app a la web
   sin salir a internet. */
import web from './index.js';
import conector from '../../conector/worker.js';

/** Lo que contesta el conector: MCP, OAuth, cuenta, panel, plan compartido y GPX. El resto es la web. */
export function esDelConector(pathname, method) {
  return pathname === '/mcp' || pathname === '/mcp/' || (pathname === '/' && method === 'POST')
    || pathname.startsWith('/.well-known/') || pathname.startsWith('/oauth/')
    || pathname === '/cuenta' || pathname.startsWith('/cuenta/')
    || pathname === '/panel' || pathname.startsWith('/panel/')
    || pathname === '/compartido/plan'
    || (pathname.startsWith('/route/') && pathname.endsWith('.gpx'));
}

/** El entorno de cada petición: la URL pública es la propia, y cada parte llama a la otra en proceso. */
function entorno(env, ctx, origin) {
  const e = { ...env, GARMIN_URL: origin, MYCOACH_URL: origin };
  e.GARMIN_SVC = { fetch: (input, init) => conector.fetch(new Request(input, init), e, ctx) };
  e.MYCOACH = { fetch: (input, init) => web.fetch(new Request(input, init), e, ctx) };
  return e;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const e = entorno(env, ctx, url.origin);
    return esDelConector(url.pathname, request.method) ? conector.fetch(request, e, ctx) : web.fetch(request, e, ctx);
  },
  // Descarga diaria de Garmin para el panel de progreso (cron)
  scheduled(event, env, ctx) {
    return conector.scheduled(event, entorno(env, ctx, env.MYCOACH_URL || 'https://mycoach.albertbecervas.workers.dev'), ctx);
  },
};
