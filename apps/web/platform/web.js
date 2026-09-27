/* ===== Plataforma web: implementa window.claude.use() sobre la API del Worker =====
   La app está escrita contra las capacidades del artifact de Claude (mcp, db, sample).
   Aquí se ofrecen las mismas interfaces fuera de Claude:
     mcp    → /api/mcp   (el Worker llama al conector de Garmin con tu sesión OAuth)
     db     → /api/mcp   (herramientas app_leer / app_guardar: el mismo almacén que usa tu Claude)
     sample → no hay     (sin pago por uso no hay IA en la web; el chat se hace en tu Claude) */
(() => {
  const api = async (path, body) => {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.message || j.code || 'error'); e.code = j.code || (r.status === 401 ? 'needs_reauth' : 'server_unavailable'); throw e; }
    return j;
  };
  const tool = (name, input, refresh) => api('/api/mcp', { tool: name, input, refresh: !!refresh }).then(j => j.payload);
  const doc = path => ({
    get: () => tool('app_leer', { doc: path }),
    set: datos => tool('app_guardar', { doc: path, datos }),
  });
  let me = null;
  const sesion = () => me || (me = api('/api/me').catch(() => ({ conectado: false })));
  // El panel de prototipo (flujos y notas de validación) solo con ?proto en la URL
  if (!/[?&]proto\b/.test(location.search)) { const st = document.createElement('style'); st.textContent = '#proto-fab,#task{display:none!important}'; document.head.append(st); }
  window.PLATFORM = {
    name: 'web',
    login: () => { location.href = '/api/login'; },
    logout: () => api('/api/logout', {}).finally(() => location.reload()),
  };
  window.claude = {
    use: async name => {
      const s = await sesion();
      if (!s.conectado) return null;
      if (name === 'mcp') return { callTool: (server, t, input, opts = {}) => tool(t, input, opts.cache && opts.cache.refresh).then(payload => ({ payload })) };
      if (name === 'db') return { doc, collection: c => ({ add: datos => tool('app_guardar', { doc: c, datos, anadir: true }) }) };
      return null;
    },
  };
})();
