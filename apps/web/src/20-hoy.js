/* ===== Primitivas de interfaz ===== */
const app = $('#app'), scroller = $('#scroller'), layer = $('#layer'), toasts = $('#toasts');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
function vt(fn) { if (document.startViewTransition && !reduced) document.startViewTransition(fn); else fn(); }
let sheetState = null;
function openSheet({ title = '', size = 'medium', body, onClose, id = '' }) {
  closeSheet(true);
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="scrim"></div><section class="sheet ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}" data-sheet="${esc(id)}">
    <button class="grab" type="button" aria-label="Cambiar altura" data-a="sheet-detent"></button>
    <div class="sheet-h"><h3>${esc(title)}</h3><button class="close" type="button" aria-label="Cerrar" data-a="sheet-close">${ic('close', 18)}</button></div>
    <div class="sheet-b"></div></section>`;
  layer.append(...wrap.children);
  const sh = layer.querySelector('.sheet'), sc = layer.querySelector('.scrim');
  sheetState = { sh, sc, body, onClose, id }; fillSheet();
  sc.addEventListener('click', () => closeSheet());
  requestAnimationFrame(() => requestAnimationFrame(() => { sh.classList.add('in'); sc.classList.add('in'); }));
}
function fillSheet() { if (sheetState) { const b = sheetState.sh.querySelector('.sheet-b'); const y = b.scrollTop; b.innerHTML = sheetState.body(); b.scrollTop = y; } }
function closeSheet(instant) {
  if (!sheetState) return; const { sh, sc, onClose } = sheetState; sheetState = null;
  if (instant) { sh.remove(); sc.remove(); } else { sh.classList.remove('in'); sc.classList.remove('in'); setTimeout(() => { sh.remove(); sc.remove(); }, 380); }
  onClose && onClose();
}
function ask({ title, text = '', actions }) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="scrim"></div><div class="dialog" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${text ? `<p class="small muted">${esc(text)}</p>` : ''}<div class="btns">${actions.map((a, i) => `<button type="button" class="btn ${a.kind || 'text'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
  const [sc, dg] = wrap.children; layer.append(sc, dg);
  const done = () => { dg.classList.remove('in'); sc.classList.remove('in'); setTimeout(() => { dg.remove(); sc.remove(); }, 250); };
  dg.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; done(); actions[+b.dataset.i].fn?.(); });
  sc.addEventListener('click', done);
  requestAnimationFrame(() => requestAnimationFrame(() => { dg.classList.add('in'); sc.classList.add('in'); }));
}
function toast(msg, { undo, action, ms = 5000 } = {}) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `<span class="msg">${esc(msg)}</span>${undo ? '<button type="button" data-u>Deshacer</button>' : ''}${action ? `<button type="button" data-x>${esc(action.label)}</button>` : ''}`;
  toasts.innerHTML = ''; toasts.append(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('in')));
  const kill = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); };
  t.querySelector('[data-u]')?.addEventListener('click', () => { undo(); kill(); });
  t.querySelector('[data-x]')?.addEventListener('click', () => { action.fn(); kill(); });
  setTimeout(kill, ms);
}
function commit(msg, mut) {
  const prev = clone({ plan: S.plan, next: S.next, adapt: S.adapt, otro: S.otro });
  mut(); save(); render();
  toast(msg, { undo: () => { Object.assign(S, prev); save(); render(); toast('Deshecho'); } });
}
/* Enlace a Claude: copia el encargo y abre Claude (el prefijado por URL no es fiable) */
function enClaude(prompt) {
  const done = () => toast('Encargo copiado. Pégalo en Claude: usará tu conector de Garmin.', { action: { label: 'Abrir Claude', fn: () => window.open('https://claude.ai/new', '_blank', 'noopener') } , ms: 8000 });
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(prompt).then(done, () => showPrompt(prompt)); else showPrompt(prompt);
  markFlow('ia');
}
function showPrompt(p) { openSheet({ title: 'Encargo para Claude', size: 'auto', body: () => `<p class="small muted">Cópialo y pégalo en Claude con tu conector de Garmin activo.</p><label class="vh" for="pr-t">Encargo</label><textarea id="pr-t" class="card" style="min-height:140px;font:14px/1.4 var(--font-ui);color:var(--label);border:0" readonly>${esc(p)}</textarea><a class="btn fill" href="https://claude.ai/new" target="_blank" rel="noopener">Abrir Claude</a>` }); }

/* ===== Navegación ===== */
function go(tab) { vt(() => { S.tab = tab; S.stack = []; save(); render(true); }); }
function push(screen) { vt(() => { S.stack.push(screen); save(); render(true); }); }
function pop() { vt(() => { S.stack.pop(); save(); render(true); }); }
const TABS = [['hoy', 'Hoy'], ['plan', 'Plan'], ['comer', 'Comer'], ['progreso', 'Progreso'], ['pueblos', 'Pueblos']];
// El botón de Ajustes lleva tus iniciales (Ajustes → Tu nombre); sin nombre, un icono de persona.
function pintarAvatar() {
  const el = $('#avatar .avatar'); if (!el) return;
  const ini = String(S.nombre || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
  el.innerHTML = ini ? esc(ini) : ic('user', 18);
}
function renderTabs() { pintarAvatar(); $('#tabs').innerHTML = TABS.map(([id, l]) => `<button class="tab" type="button" data-a="tab" data-v="${id}" ${S.tab === id ? 'aria-current="page"' : ''}><span class="ic">${ic(id)}</span><span>${l}</span></button>`).join(''); }
function render(resetScroll) {
  document.body.classList.toggle('framed', !!S.framed);
  app.dataset.os = S.os;
  if (S.theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = S.theme;
  renderTabs();
  const scr = S.stack[S.stack.length - 1];
  let html, title;
  try { ({ html, title } = scr ? SCREENS[scr.s](scr) : TABSCR[S.tab]()); }
  catch (e) { console.error(e); title = 'Error'; html = `<div class="content"><div class="card"><div class="card-h"><span class="grow">Esta pantalla ha fallado</span></div><p class="small">Ya está anotado para arreglarlo. Mientras, prueba otra pestaña o actualiza.</p><p class="xs">${esc(e && e.message)}</p></div></div>`; }
  $('#tsmall').textContent = title; $('#topback').hidden = !scr;
  $('#view').innerHTML = html;
  $('#tabbar').classList.toggle('hidden', !S.onboarded);
  if (resetScroll) scroller.scrollTop = 0;
  onScroll(); renderOnboarding(); if (sheetState) fillSheet(); renderProtoStatus(); afterRender();
}
function afterRender() { $$('#view .heat').forEach(h => { h.scrollLeft = h.scrollWidth; }); $$('#view .map').forEach(applyMapFilter); const wk = $('#weeks'), sel = wk && wk.querySelector('[aria-pressed="true"]'); if (sel) wk.scrollLeft = sel.offsetLeft - wk.clientWidth / 2 + sel.offsetWidth / 2; }
let lastY = 0;
function onScroll() {
  const y = scroller.scrollTop; $('#topbar').classList.toggle('compact', y > 36);
  const tb = $('#tabbar'); if (y > 120 && y > lastY + 4) tb.classList.add('mini'); else if (y < lastY - 4 || y < 60) tb.classList.remove('mini'); lastY = y;
}
scroller.addEventListener('scroll', onScroll, { passive: true });
const head = (t, sub) => `<header class="bigtitle"><h1>${esc(t)}</h1>${sub ? `<p>${sub}</p>` : ''}</header>`;
const fchips = (key, list, sel, todos = 'Todos') => `<div class="filters" role="group" aria-label="Filtrar por deporte"><button type="button" class="fchip" data-a="fsel" data-k="${key}" data-v="" aria-pressed="${!sel.length}">${todos}</button>${list.map(k => `<button type="button" class="fchip" data-a="fsel" data-k="${key}" data-v="${k}" aria-pressed="${sel.includes(k)}">${sportDot(k)}${SPORTS[k].n}</button>`).join('')}</div>`;

/* ===== Gráficos (SVG propio: una escala, rejilla recesiva, tooltip al pasar) ===== */
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v || 1))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function chartStacked(cols, keys, { h = 180, unit = 'h', fmt = v => nf(v), labelsEvery = 4 } = {}) {
  const W = 600, H = h, pl = 30, pr = 6, pt = 8, pb = 22; const n = cols.length; const tot = cols.map(c => keys.reduce((a, k) => a + (c.v[k] || 0), 0));
  const mx = niceMax(Math.max(...tot, 1)); const bw = Math.min(24, (W - pl - pr) / n - 2); const X = i => pl + (i + .5) * (W - pl - pr) / n; const Y = v => pt + (H - pt - pb) * (1 - v / mx);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Columnas apiladas por semana">`;
  for (const t of [0, mx / 2, mx]) s += `<line class="g" x1="${pl}" x2="${W - pr}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${pl - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
  cols.forEach((c, i) => {
    let acc = 0; const segs = keys.filter(k => c.v[k] > 0);
    segs.forEach((k, j) => { const v = c.v[k]; const y0 = Y(acc), y1 = Y(acc + v); const top = j === segs.length - 1; const hgt = Math.max(0, y0 - y1 - (j ? 2 : 0));
      s += top ? `<path d="M${X(i) - bw / 2},${y0 - (j ? 2 : 0)}V${y1 + 4}q0,-4 4,-4h${bw - 8}q4,0 4,4V${y0 - (j ? 2 : 0)}z" fill="${scol(k)}"/>` : `<rect x="${X(i) - bw / 2}" y="${y1}" width="${bw}" height="${hgt}" fill="${scol(k)}"/>`; acc += v; });
    if ((i % labelsEvery === 0 && n - 1 - i >= labelsEvery / 2) || i === n - 1) s += `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="middle">${c.l}</text>`;
    s += `<rect class="hit" x="${X(i) - (W - pl - pr) / n / 2}" y="${pt}" width="${(W - pl - pr) / n}" height="${H - pt - pb}" data-tip="${esc(c.tip || `${c.l}: ${fmt(tot[i])} ${unit}`)}"/>`;
  });
  return `<div class="chart">${s}</svg><div class="tip"></div></div>`;
}
function chartLine(pts, { h = 170, min, max, unit = '', fmt = v => nf(v), bands = [], color = 'var(--tint)' } = {}) {
  const W = 600, H = h, pl = 40, pr = 40, pt = 12, pb = 22; const vs = pts.filter(p => p.v != null).map(p => p.v);
  const lo = min ?? Math.floor(Math.min(...vs) * 0.98), hi = max ?? Math.ceil(Math.max(...vs) * 1.02);
  const X = i => pl + (W - pl - pr) * (pts.length === 1 ? .5 : i / (pts.length - 1)), Y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución">`;
  for (const t of [lo, (lo + hi) / 2, hi]) s += `<line class="g" x1="${pl}" x2="${W - pr}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${pl - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
  for (const [v, l] of bands) if (v > lo && v < hi) s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--label-3)" stroke-width="1" stroke-dasharray="3 4"/><text class="ax" x="${W - pr + 4}" y="${Y(v) + 4}">${esc(l)}</text>`;
  const seg = []; let cur = []; pts.forEach((p, i) => { if (p.v == null) { if (cur.length) seg.push(cur); cur = []; } else cur.push(`${X(i)},${Y(p.v)}`); }); if (cur.length) seg.push(cur);
  for (const c of seg) s += `<polyline points="${c.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  pts.forEach((p, i) => { if (p.v != null) s += `<circle cx="${X(i)}" cy="${Y(p.v)}" r="${i === pts.length - 1 ? 5 : 3.5}" fill="${color}" stroke="var(--card)" stroke-width="2"/>`; });
  const last = [...pts].reverse().find(p => p.v != null); const li = pts.lastIndexOf(last);
  s += `<text class="lbl" x="${X(li) + 8}" y="${Y(last.v) - 8}">${fmt(last.v)}</text>`;
  pts.forEach((p, i) => { if (i % 2 === 0 || i === pts.length - 1) s += `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="middle">${p.l}</text>`; s += `<rect class="hit" x="${X(i) - (W - pl - pr) / pts.length / 2}" y="${pt}" width="${(W - pl - pr) / pts.length}" height="${H - pt - pb}" data-tip="${esc(`${p.l}: ${p.v == null ? 'sin dato' : fmt(p.v) + ' ' + unit}`)}"/>`; });
  return `<div class="chart">${s}</svg><div class="tip"></div></div>`;
}
function señalarEnGrafico(e) {
  const h = e.target.closest && e.target.closest('.hit'); const charts = $$('.chart .tip.on'); charts.forEach(t => { if (!h || t.parentElement !== h.closest('.chart')) { t.classList.remove('on'); t.style.opacity = 0; t.parentElement.querySelector('.sel')?.setAttribute('visibility', 'hidden'); } });
  if (!h) return; const c = h.closest('.chart'), tip = c.querySelector('.tip'); const r = c.getBoundingClientRect(); const hr = h.getBoundingClientRect();
  // Marcador: si el gráfico lo tiene, se coloca en el punto señalado.
  const sel = c.querySelector('.sel'); if (sel && h.dataset.cx) { sel.querySelector('.sel-l').setAttribute('x1', h.dataset.cx); sel.querySelector('.sel-l').setAttribute('x2', h.dataset.cx); sel.querySelector('.sel-c').setAttribute('cx', h.dataset.cx); sel.querySelector('.sel-c').setAttribute('cy', h.dataset.cy); sel.setAttribute('visibility', 'visible'); }
  tip.textContent = h.dataset.tip; const mitad = tip.offsetWidth / 2;
  // Dentro del gráfico: cerca de los bordes, el recuadro no se sale de la tarjeta.
  tip.style.left = Math.min(r.width - mitad, Math.max(mitad, hr.left - r.left + hr.width / 2)) + 'px'; tip.style.top = '12px'; tip.style.opacity = 1; tip.classList.add('on');
}
// Ratón al pasar y dedo al tocar (en el móvil un toque no siempre genera pointermove).
document.addEventListener('pointermove', señalarEnGrafico);
document.addEventListener('pointerdown', señalarEnGrafico);

/* ===== Hoy y tu semana =====
   Arriba, la sesión de hoy y si encaja con tu estado (la tarjeta de arriba): si el entrenador
   propone cambiarla, el antes → después y "Aplicar el cambio". Abajo, la semana en 7 días.