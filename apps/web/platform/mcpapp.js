/* ===== Plataforma "dentro de Claude" (MCP Apps) =====
   La app se abre dentro de la conversación como una vista del conector de Garmin
   (recurso ui://mycoach/app, herramienta mycoach_abrir). Aquí no hay servidor propio
   ni login: la vista habla con Claude por postMessage (JSON-RPC, especificación
   MCP Apps 2026-01-26) y Claude llama a las herramientas del conector en su nombre.
     mcp    → tools/call a garmin_* y coach_*
     db     → tools/call a app_leer / app_guardar (el mismo estado que la web y tu Claude)
     sample → no hay. Aquí se habla en la conversación de Claude, no en la app: el chat de la app y
     los botones "Hablarlo con Claude" no se enseñan (mandar texto a la conversación lo deja en la
     caja de Claude con un aviso de seguridad). Lo que sí se hace es contarle a Claude qué pantalla
     tienes delante (ui/update-model-context), para que la entienda sin explicársela. */
(() => {
  let n = 0; const pendientes = new Map();
  const aClaude = m => parent.postMessage({ jsonrpc: '2.0', ...m }, '*');
  const pedir = (method, params) => new Promise((ok, ko) => { const id = ++n; pendientes.set(id, { ok, ko }); aClaude({ id, method, params }); });
  const avisar = (method, params) => aClaude({ method, params });
  let contexto = {}, entrada = null;

  // En Claude se habla en la conversación: fuera el botón del chat y los atajos que escribían en ella.
  const st = document.createElement('style');
  st.textContent = '#claude-btn,[data-a="claude"],[data-a="claude-ext"],[data-a="coach-claude"],[data-a="meal-claude"]{display:none!important}';
  document.head.append(st);

  // Si ya usas myCoach, la app lo sabe por tu estado en el conector (sin onboarding); aquí solo se quita el marco de móvil.
  try { const s = JSON.parse(localStorage.getItem('trazo-v3') || 'null'); if (!s) localStorage.setItem('trazo-v3', JSON.stringify({ v: 6, framed: false })); } catch (e) { }

  const tema = t => { if (t !== 'light' && t !== 'dark') return; document.documentElement.dataset.theme = t; if (typeof S !== 'undefined') { S.theme = t; if (typeof render === 'function') render(); } };
  const alto = () => {
    const d = contexto.containerDimensions || {};
    if (d.height) { document.documentElement.style.height = '100vh'; return; }
    // En línea, el alto lo pone la vista: el de un móvil, sin pasarse del máximo que da Claude.
    const h = Math.min(d.maxHeight || 780, 780);
    document.documentElement.style.height = document.body.style.height = h + 'px';
    avisar('ui/notifications/size-changed', { width: document.documentElement.clientWidth, height: h });
  };
  const PANTALLAS = { hoy: 'hoy', plan: 'plan', forma: 'forma', pueblos: 'pueblos' };
  const irA = args => {
    const p = args && args.pantalla; if (!p || typeof go !== 'function') return;
    if (PANTALLAS[p]) go(PANTALLAS[p]); else if (p === 'ajustes' && typeof push === 'function') push({ s: 'ajustes' });
  };

  window.addEventListener('message', e => {
    const m = e.data; if (!m || m.jsonrpc !== '2.0') return;
    if (m.id != null && !m.method && pendientes.has(m.id)) {
      const p = pendientes.get(m.id); pendientes.delete(m.id);
      if (m.error) p.ko(Object.assign(new Error(m.error.message || 'Claude no ha podido hacerlo'), { code: m.error.code === -32000 ? 'denied' : 'server_unavailable' })); else p.ok(m.result);
      return;
    }
    if (m.method === 'ui/notifications/tool-input') { entrada = (m.params && m.params.arguments) || {}; irA(entrada); }
    else if (m.method === 'ui/notifications/host-context-changed') { contexto = { ...contexto, ...(m.params || {}) }; if (m.params && m.params.theme) tema(m.params.theme); if (m.params && m.params.containerDimensions) alto(); }
    else if (m.method === 'ui/resource-teardown' || m.method === 'ping') { if (m.id != null) aClaude({ id: m.id, result: {} }); }
  });

  const listo = pedir('ui/initialize', {
    protocolVersion: '2026-01-26',
    appInfo: { name: 'myCoach', version: APP_VERSION.commit }, clientInfo: { name: 'myCoach', version: APP_VERSION.commit },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
  }).then(r => {
    contexto = (r && r.hostContext) || {};
    tema(contexto.theme); alto();
    avisar('ui/notifications/initialized', {});
    // Si Claude deja verla a pantalla completa, un botón arriba a la derecha.
    const barra = document.querySelector('#topbar .tb-r');
    if (barra && window.PLATFORM.puedePantallaCompleta()) {
      const b = document.createElement('button'); b.className = 'iconbtn'; b.type = 'button'; b.setAttribute('aria-label', 'Ver a pantalla completa');
      b.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
      b.addEventListener('click', () => window.PLATFORM.pantallaCompleta().then(() => b.remove()).catch(() => { }));
      barra.prepend(b);
    }
    return r;
  });

  // Claude sabe qué pantalla tienes delante: "¿y esto qué significa?" se entiende sin explicarlo.
  let ultimoContexto = '', espera = 0;
  const contarPantalla = () => {
    const scr = document.getElementById('scroller'); if (!scr || typeof S === 'undefined') return;
    const pantalla = S.stack && S.stack.length ? S.stack[S.stack.length - 1].s : S.tab;
    const texto = scr.innerText.replace(/\n{2,}/g, '\n').trim().slice(0, 2000);
    if (!texto || pantalla + texto === ultimoContexto) return; ultimoContexto = pantalla + texto;
    pedir('ui/update-model-context', { content: [{ type: 'text', text: `El usuario tiene abierta la pantalla "${pantalla}" de myCoach. Lo que ve:\n${texto}` }] }).catch(() => { });
  };
  listo.then(() => {
    new MutationObserver(() => { clearTimeout(espera); espera = setTimeout(contarPantalla, 1200); }).observe(document.body, { subtree: true, childList: true, characterData: true });
    espera = setTimeout(contarPantalla, 1200);
  });

  const herramienta = async (name, args) => {
    await listo;
    const r = await pedir('tools/call', { name, arguments: args || {} });
    const texto = r && Array.isArray(r.content) ? (r.content.find(c => c.type === 'text') || {}).text : null;
    if (r && r.isError) throw Object.assign(new Error(texto || 'Error del conector'), { code: 'tool_error' });
    try { return JSON.parse(texto); } catch (e) { return r && r.structuredContent !== undefined ? r.structuredContent : texto; }
  };
  const doc = path => ({
    get: () => herramienta('app_leer', { doc: path }),
    set: (datos, opts = {}) => herramienta('app_guardar', { doc: path, datos, ...(typeof opts.version === 'number' ? { version: opts.version } : {}) }),
  });

  window.PLATFORM = {
    name: 'claude-app',
    abrirEnlace: url => pedir('ui/open-link', { url }),
    pantallaCompleta: () => pedir('ui/request-display-mode', { mode: 'fullscreen' }).then(r => { contexto.displayMode = r && r.mode; return r; }),
    puedePantallaCompleta: () => (contexto.availableDisplayModes || []).includes('fullscreen') && contexto.displayMode !== 'fullscreen',
  };
  window.claude = {
    use: async name => {
      await listo;
      if (name === 'mcp') return { callTool: (server, t, input) => herramienta(t, input).then(payload => ({ payload })) };
      if (name === 'db') return { doc, collection: c => ({ add: datos => herramienta('app_guardar', { doc: c, datos, anadir: true }) }) };
      return null;
    },
  };
})();
