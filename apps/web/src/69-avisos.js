/* ===== Avisos (notificaciones push) e instalar la app =====
   Solo en la web (en Claude la app vive dentro de la conversación y no puede avisar).
   El conector guarda los dispositivos y manda los avisos desde sus crons: cada mañana el semáforo
   y el domingo por la tarde si la semana que viene no tiene plan o menús. No pregunta nada más a Garmin. */
const AV = { cfg: undefined, sub: undefined, ocupado: false, error: '' };
let instalarEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalarEvt = e; if (S.stack.some(x => x.s === 'ajustes')) render(); });
window.addEventListener('appinstalled', () => { instalarEvt = null; toast('myCoach instalada'); render(); });
const pushPosible = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !(window.PLATFORM && PLATFORM.name === 'claude-app');
const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const b64uABytes = s => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };

async function cargarAvisos() {
  if (AV.cfg !== undefined || !LIVE || S.modo !== 'vivo' || !pushPosible()) return; AV.cfg = 'cargando';
  try { AV.cfg = await coachCall('avisos', {}, true); const reg = await navigator.serviceWorker.ready; AV.sub = await reg.pushManager.getSubscription(); }
  catch (e) { AV.cfg = null; }
  render();
}
async function activarAvisos() {
  if (AV.ocupado) return; AV.ocupado = true; AV.error = ''; render();
  try {
    if (await Notification.requestPermission() !== 'granted') throw new Error('permiso');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uABytes(AV.cfg.clave_publica) });
    const r = await coachCall('avisos_guardar', { suscripcion: { endpoint: sub.endpoint }, prueba: true }, true);
    AV.sub = sub; AV.cfg = { ...AV.cfg, dispositivos: r.dispositivos, prefs: r.prefs }; toast('Avisos activados: te acabo de mandar uno de prueba');
  } catch (e) { AV.error = e.message === 'permiso' ? 'El navegador no ha dado permiso. Puedes darlo en los ajustes del sitio (el candado de la barra de direcciones).' : 'No he podido activarlos. Vuelve a probar en un momento.'; }
  AV.ocupado = false; render();
}
async function desactivarAvisos() {
  const sub = AV.sub; if (!sub) return;
  try { await coachCall('avisos_guardar', { quitar: sub.endpoint }, true); await sub.unsubscribe(); AV.sub = null; AV.cfg = { ...AV.cfg, dispositivos: Math.max(0, (AV.cfg.dispositivos || 1) - 1) }; toast('Avisos desactivados en este dispositivo'); }
  catch (e) { toast('No he podido desactivarlos ahora'); }
  render();
}
async function prefAviso(k, v) {
  AV.cfg = { ...AV.cfg, prefs: { ...AV.cfg.prefs, [k]: v } }; render();
  try { await coachCall('avisos_guardar', { prefs: { [k]: v } }, true); } catch (e) { AV.cfg = { ...AV.cfg, prefs: { ...AV.cfg.prefs, [k]: !v } }; toast('No he podido guardarlo'); render(); }
}

/** La sección de Ajustes. Devuelve '' donde no tiene sentido (dentro de Claude, o un navegador sin push). */
function secAvisos() {
  if (window.PLATFORM && PLATFORM.name === 'claude-app') return '';
  const instalar = instalarEvt ? `<div class="btns" style="margin-top:0"><button class="btn tonal" type="button" data-a="app-instalar">Instalar myCoach</button></div><p class="small muted">Se abre como una app, sin la barra del navegador, y puede avisarte con ella cerrada.</p>` : '';
  if (!pushPosible()) return instalar || (esIOS() && !instalada() ? '<p class="small">En iPhone, los avisos funcionan con myCoach en la pantalla de inicio: en Safari, Compartir → Añadir a pantalla de inicio, y ábrela desde allí.</p>' : '<p class="small muted">Este navegador no puede mandar avisos.</p>');
  if (!LIVE || S.modo !== 'vivo') return `${instalar}<p class="small muted">Los avisos se activan con tu cuenta conectada, no en el modo demo.</p>`;
  cargarAvisos();
  const c = AV.cfg; if (c === undefined || c === 'cargando') return `${instalar}<p class="small muted" role="status">Mirando tus avisos…</p>`;
  if (c === null) return `${instalar}<p class="small">No he podido leer tus avisos.</p>`;
  const denegado = Notification.permission === 'denied';
  if (!AV.sub) return `${instalar}<div class="card stack" style="gap:12px"><p>Te aviso aunque la app esté cerrada: cada mañana con el semáforo del día y, el domingo, si la semana que viene no tiene plan o menús. Nada más.</p>
    ${denegado ? '<p class="small">Los avisos están bloqueados en este navegador. Actívalos en los ajustes del sitio (el candado de la barra de direcciones) y vuelve aquí.</p>' : `<div class="btns" style="margin-top:0"><button class="btn fill" type="button" data-a="avisos-activar"${AV.ocupado ? ' disabled' : ''}>${AV.ocupado ? 'Activando…' : 'Activar avisos'}</button></div>`}
    ${AV.error ? `<p class="small" role="alert">${esc(AV.error)}</p>` : ''}</div>`;
  return `${instalar}<div class="list">${Object.entries(c.tipos).map(([k, t]) => `<label class="toggle-row" for="av-${k}"><span class="main"><b>${{ semaforo: 'Tu día', plan: 'Semana sin plan', menus: 'Semana sin menús' }[k] || k}</b><br><span class="small muted">${esc(t)}</span></span><input class="switch" type="checkbox" id="av-${k}" data-a="aviso-pref" data-v="${k}" ${c.prefs[k] ? 'checked' : ''}></label>`).join('')}</div>
    <div class="btns"><button class="btn tonal" type="button" data-a="avisos-prueba">Mandar un aviso de prueba</button><button class="link" type="button" data-a="avisos-quitar">Desactivar en este dispositivo</button></div>`;
}
document.addEventListener('change', e => { if (e.target && e.target.dataset && e.target.dataset.a === 'aviso-pref') prefAviso(e.target.dataset.v, e.target.checked); });
Object.assign(ACTIONS, {
  'avisos-activar': () => activarAvisos(),
  'avisos-quitar': () => desactivarAvisos(),
  'avisos-prueba': async () => { try { const r = await coachCall('avisos_guardar', { prueba: true }, true); toast(r.prueba && r.prueba.enviados ? 'Aviso de prueba enviado' : 'No ha salido: desactívalos y vuelve a activarlos'); } catch (e) { toast('No he podido mandarlo'); } },
  'app-instalar': async () => { if (!instalarEvt) return; instalarEvt.prompt(); try { await instalarEvt.userChoice; } catch (e) { } instalarEvt = null; render(); },
});
