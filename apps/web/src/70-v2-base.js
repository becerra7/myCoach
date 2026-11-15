/* ===== v2 · Diseño nuevo: base (docs/PLAN-COACH.md, decisión 33) =====
   Capa aparte sobre la v1: no cambia sus pantallas, las sustituye mientras S.diseno sea 'v2'.
   Para volver a la v1: Ajustes › Avanzado › Diseño anterior. Para quitarla del todo: borrar los
   módulos 7x-v2-*.js y app-v2.css.
   Aquí: el interruptor, las piezas comunes (filas, grupos, cabeceras), el botón de Claude junto a la
   barra, tirar para actualizar y "Actualizado hace…". */
if (S.diseno !== 'v1') S.diseno = 'v2';
const esV2 = () => S.diseno === 'v2';
function aplicarDiseno() { app.toggleAttribute('data-d2', esV2()); }
aplicarDiseno();

/* Las pantallas de la v1 se guardan y cada módulo v2 registra la suya encima */
const V1_TABS = { ...TABSCR }, V1_SCR = { ...SCREENS };
const conV2 = (v2, v1) => (...a) => (esV2() ? v2 : v1)(...a);
const tabV2 = (k, fn) => { TABSCR[k] = conV2(fn, V1_TABS[k]); };
const scrV2 = (k, fn) => { SCREENS[k] = V1_SCR[k] ? conV2(fn, V1_SCR[k]) : fn; };

/* Piezas comunes */
const fila2 = (titulo, sub, attrs, { valor = '', icono = '', chev = true, cls = '', el = 'button' } = {}) =>
  `<${el} class="li ${cls}" ${el === 'button' ? 'type="button"' : ''} ${attrs || ''}>${icono}<span class="main"><b>${titulo}</b>${sub ? `<span>${sub}</span>` : ''}</span>${valor ? `<span class="val">${valor}</span>` : ''}${chev ? ic('chev', 18, 'chev') : ''}</${el}>`;
const grupo2 = (filas, titulo = '', extra = '') => `${titulo ? `<h2 class="g-h"><span>${titulo}</span>${extra}</h2>` : ''}<div class="list">${filas}</div>`;
const cab2 = (titulo, sub = '', extra = '') => `<header class="v2-h">${extra ? `<div class="fila"><h1>${titulo}</h1>${extra}</div>` : `<h1>${titulo}</h1>`}${sub ? `<p class="sub">${sub}</p>` : ''}</header>`;
const depL = (dep, texto) => `<span class="dep-l"><i style="--c:${dep ? scol(dep) : 'var(--fill)'}" aria-hidden="true"></i><span>${texto}</span></span>`;
const facts2 = pares => `<div class="facts">${pares.filter(Boolean).map(([n, v]) => `<div><span>${n}</span><b>${v}</b></div>`).join('')}</div>`;
const barra2 = (nombre, texto, pct) => `<div><div class="bar2-l"><b>${nombre}</b><span>${texto}</span></div><div class="bar2" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div></div>`;

/* Hace cuánto se actualizaron los datos, dicho en llano */
function haceTxt(t) {
  if (!t) return ''; const m = Math.round((Date.now() - t) / 60e3);
  return m < 1 ? 'ahora mismo' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} día${Math.round(m / 1440) === 1 ? '' : 's'}`;
}
/* La línea de estado de los datos: de dónde salen, hace cuánto y un toque para actualizar.
   Sustituye al botón de actualizar de la barra (que en el móvil se cambia por tirar hacia abajo). */
function estadoDatos() {
  if (S.modo === 'demo') return '<span class="pie-l" style="cursor:default">Datos de ejemplo</span>';
  if (LIVE === undefined) return '<span class="pie-l" style="cursor:default" role="status">Abriendo tu myCoach…</span>';
  if (!LIVE) return '<button class="pie-l" type="button" data-a="push" data-v="ajustes">Sin conectar<b>Conectar</b></button>';
  const mal = S.liveOk === false;
  return `<button class="pie-l" type="button" data-a="v-sync">${mal ? 'Garmin no ha contestado del todo' : S.lastSync ? `Actualizado ${haceTxt(S.lastSync)}` : 'Aún sin actualizar'}<b>${mal ? 'Volver a probar' : 'Actualizar'}</b></button>`;
}

/* El botón de Claude de la barra abre la hoja de encargos (en la v1 abría el chat) */
$('#tabbar').addEventListener('click', e => { if (esV2() && e.target.closest('#claude-btn')) { e.stopPropagation(); hojaClaude(); } }, true);

/* Volver: el botón dice a dónde vuelve. Y la pantalla actual queda en data-scr para los estilos. */
const TIT_V2 = [];
const afterRenderV1 = afterRender;
afterRender = function () {
  afterRenderV1(); aplicarDiseno();
  const scr = S.stack[S.stack.length - 1]; app.dataset.scr = scr ? scr.s : S.tab;
  const tit = $('#tsmall').textContent; TIT_V2.length = S.stack.length; TIT_V2[S.stack.length] = tit;
  const b = $('#topback'); if (!b) return;
  const txt = b.lastChild; const prev = S.stack.length > 1 ? TIT_V2[S.stack.length - 1] : (TABS.find(t => t[0] === S.tab) || [])[1];
  if (txt && txt.nodeType === 3) txt.textContent = esV2() && prev ? prev : 'Atrás';
  b.setAttribute('aria-label', esV2() && prev ? `Volver a ${prev}` : 'Atrás');
};

/* Tirar hacia abajo para actualizar (táctil). Con teclado o ratón, el enlace "Actualizar" de la línea de estado. */
{
  const ptr = document.createElement('div'); ptr.className = 'ptr'; ptr.setAttribute('aria-hidden', 'true'); ptr.innerHTML = ic('sync', 20); app.append(ptr);
  let y0 = null, d = 0; const UMBRAL = 78;
  const pinta = suelta => { ptr.classList.toggle('suelta', !!suelta); ptr.classList.toggle('lista', d >= UMBRAL); ptr.style.opacity = d > 8 ? 1 : 0; ptr.style.transform = `translateY(${Math.min(d, 110) - 48}px) rotate(${d * 2}deg)`; };
  scroller.addEventListener('touchstart', e => { y0 = esV2() && scroller.scrollTop <= 0 && !sheetState && e.touches.length === 1 ? e.touches[0].clientY : null; d = 0; }, { passive: true });
  scroller.addEventListener('touchmove', e => { if (y0 == null) return; d = Math.max(0, (e.touches[0].clientY - y0) * .55); if (scroller.scrollTop > 0) { y0 = null; d = 0; } pinta(false); }, { passive: true });
  const fin = () => { if (y0 == null) return; const ok = d >= UMBRAL; y0 = null; d = 0; pinta(true); if (ok) sync(true); };
  scroller.addEventListener('touchend', fin, { passive: true }); scroller.addEventListener('touchcancel', fin, { passive: true });
}

/* Elegir diseño: se guarda en este dispositivo y se puede volver cuando se quiera */
function ponerDiseno(v) {
  S.diseno = v === 'v1' ? 'v1' : 'v2'; S.stack = S.stack.filter(x => SCREENS[x.s] && !(S.diseno === 'v1' && !V1_SCR[x.s])); save(); aplicarDiseno(); render(true);
  toast(S.diseno === 'v2' ? 'Diseño nuevo activado' : 'Has vuelto al diseño anterior', { undo: () => ponerDiseno(v === 'v1' ? 'v2' : 'v1') });
}
Object.assign(ACTIONS, { 'v2-diseno': el => ponerDiseno(el.dataset.v) });
ICP.search = '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>';
