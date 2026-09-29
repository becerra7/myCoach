/* ===== Tu cuenta de myCoach y Garmin como fuente vinculada =====
   Entras en myCoach con tu email y tu contraseña (también al conectar Claude);
   Garmin se vincula aparte, desde Ajustes. Así conectar Claude no depende del
   login de Garmin. Las contraseñas van al conector por /api/cuenta: ni pasan
   por el chat ni se guardan en la web. Solo en la web: en Claude no hay /api. */
let CUENTA = undefined; // undefined: sin comprobar · null: no disponible · { contrasena, garmin: { vinculado, desde } }
const enWeb = () => !!(window.PLATFORM && PLATFORM.name === 'web');

async function apiCuenta(ruta = '', metodo = 'GET', body) {
  const r = await fetch('/api/cuenta' + ruta, {
    method: metodo, credentials: 'same-origin',
    headers: metodo === 'GET' ? {} : { 'Content-Type': 'application/json' },
    ...(metodo === 'GET' ? {} : { body: JSON.stringify(body || {}) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || 'No he podido hacerlo'), { code: j.code });
  return j;
}

async function cargarCuenta() {
  if (!enWeb() || !LIVE) { CUENTA = null; return; }
  try { CUENTA = await apiCuenta(); } catch (e) { CUENTA = null; }
  render(); if (!S.onboarded) renderOnboarding();
}

/** La tarjeta de Garmin en Conexiones. */
function cardGarmin() {
  const caja = (estado, cuerpo) => `<div class="card stack" style="gap:12px"><div class="card-h">${ic('watch', 18)}<span class="grow">Garmin</span>${estado}</div>${cuerpo}</div>`;
  if (!enWeb()) return caja(LIVE ? '<span class="live">Conectado</span>' : '', `<p class="small">${LIVE ? 'Leo tus actividades, tu sueño, tu VFC y tu readiness.' : 'Se conecta con el conector de myCoach en tu Claude.'}</p>`);
  if (!LIVE) return caja('', `<p class="small">Entra en myCoach y vincula tu Garmin para que tu entrenador vea tus actividades, tu sueño y tu readiness.</p>
    <div class="btns"><button class="btn fill" type="button" data-a="web-login">Entrar en myCoach</button></div>`);
  if (CUENTA === undefined) { cargarCuenta(); return caja('', '<p class="small muted" role="status">Comprobando…</p>'); }
  if (CUENTA === null) return caja('', '<p class="small">No he podido comprobar tu Garmin. Vuelve a abrir Ajustes en un momento.</p>');
  if (CUENTA.garmin.vinculado) return caja('<span class="live">Vinculado</span>', `<p class="small">Leo tus actividades, tu sueño, tu VFC y tu readiness${CUENTA.garmin.desde ? `. Vinculado el ${fDia(CUENTA.garmin.desde.slice(0, 10))}` : ''}.</p>
    <div class="btns"><button class="btn plain" type="button" data-a="garmin-vincular">Volver a vincular</button><button class="btn plain" type="button" data-a="garmin-quitar">Desvincular</button></div>`);
  return caja('', `<p class="small">Vincúlalo para que tu entrenador vea tus actividades, tu sueño y tu readiness.</p>
    <div class="btns"><button class="btn fill" type="button" data-a="garmin-vincular">Vincular Garmin</button></div>`);
}

/** Tu cuenta: contraseña de myCoach y cerrar sesión. */
function cardCuenta() {
  if (!enWeb() || !LIVE) return '';
  if (!CUENTA) return '';
  const cuerpo = CUENTA.contrasena
    ? `<p class="small">Entras con tu email y tu contraseña de myCoach, también al conectar tu Claude.</p>
      <div class="btns"><button class="btn plain" type="button" data-a="cuenta-pass">Cambiar la contraseña</button><button class="btn plain" type="button" data-a="web-logout">Cerrar sesión</button></div>`
    : `<p class="small">Crea tu contraseña de myCoach: con ella entras aquí y conectas tu Claude sin pasar por el login de Garmin.</p>
      <div class="btns"><button class="btn fill" type="button" data-a="cuenta-pass">Crear la contraseña</button><button class="btn plain" type="button" data-a="web-logout">Cerrar sesión</button></div>`;
  return `<div class="card stack" style="gap:12px"><div class="card-h">${ic('user', 18)}<span class="grow">Cuenta de myCoach</span>${CUENTA.contrasena ? '<span class="live">Con contraseña</span>' : ''}</div>${cuerpo}</div>`;
}

const campo = (id, texto, tipo, auto, extra = '') => `<label class="stack" for="${id}" style="gap:6px"><b class="small">${texto}</b><input id="${id}" class="search" type="${tipo}" autocomplete="${auto}" autocapitalize="off" spellcheck="false" ${extra}></label>`;
const errorHoja = id => `<p class="small" id="${id}" role="alert" style="color:var(--bad);margin:0"></p>`;
const decirError = (id, msg) => { const x = $('#' + id); if (x) x.textContent = msg; };

function hojaContrasena() {
  const cambiar = CUENTA && CUENTA.contrasena;
  openSheet({ title: cambiar ? 'Cambiar la contraseña' : 'Crea tu contraseña', size: 'auto', id: 'cuenta-pass', body: () => `<div class="stack" style="gap:14px">
    ${cambiar ? '' : '<p class="small muted">Entrarás en myCoach y conectarás tu Claude con <b>el email de tu cuenta de Garmin</b> y esta contraseña.</p>'}
    ${cambiar ? campo('pass-actual', 'Contraseña actual', 'password', 'current-password') : ''}
    ${campo('pass-nueva', 'Nueva contraseña', 'password', 'new-password', 'minlength="8" aria-describedby="pass-h"')}
    <span class="small muted" id="pass-h">Al menos 8 caracteres.</span>
    ${errorHoja('pass-err')}
    <div class="btns"><button class="btn fill" type="button" data-a="cuenta-pass-guardar">${cambiar ? 'Guardar la contraseña' : 'Crear la contraseña'}</button></div></div>` });
  setTimeout(() => ($('#pass-actual') || $('#pass-nueva'))?.focus(), 50);
}

let garminPendiente = null; // { pendiente, metodo } mientras Garmin pide el código
function hojaGarmin() {
  garminPendiente = null;
  openSheet({ title: 'Vincular Garmin', size: 'auto', id: 'garmin', body: () => garminPendiente
    ? `<div class="stack" style="gap:14px"><p class="small">Garmin te ha enviado un código por ${esc(garminPendiente.metodo || 'email')}.</p>
      ${campo('g-codigo', 'Código', 'text', 'one-time-code', 'inputmode="numeric"')}
      ${errorHoja('g-err')}
      <div class="btns"><button class="btn fill" type="button" data-a="garmin-mfa">Verificar</button></div></div>`
    : `<div class="stack" style="gap:14px"><p class="small muted">Tu cuenta de Garmin Connect. La contraseña solo se usa para vincular: no se guarda.</p>
      ${campo('g-email', 'Email de Garmin', 'email', 'username')}
      ${campo('g-pass', 'Contraseña de Garmin', 'password', 'current-password')}
      ${errorHoja('g-err')}
      <div class="btns"><button class="btn fill" type="button" data-a="garmin-enviar">Vincular Garmin</button></div></div>` });
  setTimeout(() => $('#g-email')?.focus(), 50);
}

async function garminVinculado() {
  closeSheet(); garminPendiente = null;
  CUENTA = await apiCuenta().catch(() => CUENTA);
  toast('Garmin vinculado'); S.modo = 'vivo'; save(); sync(false);
  if (!S.onboarded) renderOnboarding();
}

/** Espera mientras Garmin responde: el login puede tardar unos segundos. */
async function ocupado(el, texto, fn) {
  const antes = el.textContent; el.disabled = true; el.textContent = texto;
  try { return await fn(); } finally { if (el.isConnected) { el.disabled = false; el.textContent = antes; } }
}

Object.assign(ACTIONS, {
  'cuenta-pass': () => hojaContrasena(),
  'cuenta-pass-guardar': async el => {
    const actual = $('#pass-actual')?.value || '', nueva = $('#pass-nueva')?.value || '';
    if (nueva.length < 8) { decirError('pass-err', 'La contraseña necesita al menos 8 caracteres.'); $('#pass-nueva')?.focus(); return; }
    try {
      await ocupado(el, 'Guardando…', () => apiCuenta('/contrasena', 'POST', { nueva, ...(actual ? { actual } : {}) }));
      const nueva1 = !(CUENTA && CUENTA.contrasena); CUENTA = { ...CUENTA, contrasena: true };
      closeSheet(); render(); toast(nueva1 ? 'Contraseña creada. Ya puedes conectar Claude con ella' : 'Contraseña cambiada');
    } catch (e) { decirError('pass-err', e.message); }
  },
  'garmin-vincular': () => hojaGarmin(),
  'garmin-enviar': async el => {
    const email = $('#g-email')?.value.trim() || '', password = $('#g-pass')?.value || '';
    if (!email || !password) { decirError('g-err', 'Pon el email y la contraseña de Garmin.'); (!email ? $('#g-email') : $('#g-pass'))?.focus(); return; }
    try {
      const r = await ocupado(el, 'Hablando con Garmin… puede tardar unos segundos', () => apiCuenta('/garmin', 'POST', { email, password }));
      if (r.mfa) { garminPendiente = { pendiente: r.pendiente, metodo: r.metodo }; fillSheet(); setTimeout(() => $('#g-codigo')?.focus(), 50); return; }
      await garminVinculado();
    } catch (e) { decirError('g-err', e.message); }
  },
  'garmin-mfa': async el => {
    const codigo = $('#g-codigo')?.value.trim() || '';
    if (!codigo) { decirError('g-err', 'Pon el código que te ha llegado.'); $('#g-codigo')?.focus(); return; }
    try { await ocupado(el, 'Verificando…', () => apiCuenta('/garmin', 'POST', { pendiente: garminPendiente.pendiente, codigo })); await garminVinculado(); }
    catch (e) { decirError('g-err', e.message); }
  },
  'garmin-quitar': () => ask({ title: '¿Desvincular Garmin?', text: 'Dejo de leer tu Garmin. Lo que ya he guardado sigue en tu progreso y puedes volver a vincularlo cuando quieras.', actions: [
    { label: 'Desvincular', kind: 'fill', fn: async () => { try { await apiCuenta('/garmin', 'DELETE'); CUENTA = { ...CUENTA, garmin: { vinculado: false } }; render(); toast('Garmin desvinculado'); } catch (e) { toast('No he podido desvincularlo'); } } },
    { label: 'Cancelar' }] }),
});
