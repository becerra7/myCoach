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
const TABS = [['hoy', 'Hoy'], ['plan', 'Plan'], ['forma', 'Forma'], ['pueblos', 'Pueblos']];
function renderTabs() { $('#tabs').innerHTML = TABS.map(([id, l]) => `<button class="tab" type="button" data-a="tab" data-v="${id}" ${S.tab === id ? 'aria-current="page"' : ''}><span class="ic">${ic(id)}</span><span>${l}</span></button>`).join(''); }
function render(resetScroll) {
  document.body.classList.toggle('framed', !!S.framed);
  app.dataset.os = S.os;
  if (S.theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = S.theme;
  renderTabs();
  const scr = S.stack[S.stack.length - 1];
  const { html, title } = scr ? SCREENS[scr.s](scr) : TABSCR[S.tab]();
  $('#tsmall').textContent = title; $('#topback').hidden = !scr;
  $('#view').innerHTML = html;
  $('#tabbar').classList.toggle('hidden', !S.onboarded);
  if (resetScroll) scroller.scrollTop = 0;
  onScroll(); renderOnboarding(); if (sheetState) fillSheet(); renderProtoStatus(); afterRender();
}
function afterRender() { $$('#view .map').forEach(applyMapFilter); const wk = $('#weeks'), sel = wk && wk.querySelector('[aria-pressed="true"]'); if (sel) wk.scrollLeft = sel.offsetLeft - wk.clientWidth / 2 + sel.offsetWidth / 2; }
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
document.addEventListener('pointermove', e => {
  const h = e.target.closest && e.target.closest('.hit'); const charts = $$('.chart .tip.on'); charts.forEach(t => { if (!h || t.parentElement !== h.closest('.chart')) { t.classList.remove('on'); t.style.opacity = 0; } });
  if (!h) return; const c = h.closest('.chart'), tip = c.querySelector('.tip'); const r = c.getBoundingClientRect(); const hr = h.getBoundingClientRect();
  tip.textContent = h.dataset.tip; tip.style.left = (hr.left - r.left + hr.width / 2) + 'px'; tip.style.top = '12px'; tip.style.opacity = 1; tip.classList.add('on');
});

/* ===== HOY ===== */
function cardSemana(big) {
  const r = resumen(SEM); const pct = r.plan ? Math.round(r.hechas / r.plan * 100) : 0;
  const strip = days7(SEM).map(f => {
    const s = sesion(f); const d = dte(f); let cls = '', dot = '';
    if (s) { const k = tipoSes(s); dot = s.t === 'descanso' ? '' : `<i style="background:${scol(s.dep)}"></i>`; if (s.a) cls = 'done'; else if (f < HOY && s.t !== 'descanso') cls = 'miss'; if (f === HOY && !s.a) cls = 'today'; }
    return `<button type="button" class="d7" data-a="day" data-v="${f}" aria-label="${fLarga(f)}${s ? ': ' + esc(s.d) : ''}"><small>${DL[d.getDay()]}</small><span class="b ${cls}">${dot}${s && s.a ? `<span class="ok">${ic('check', 11)}</span>` : ''}</span><small>${d.getDate()}</small></button>`;
  }).join('');
  const hoy = sesion(HOY); const fit = fitHoy();
  return `<div class="card ${big ? 'hero' : ''}">
    <button type="button" class="card-h" style="border:0;background:none;padding:0;cursor:pointer;color:inherit;font:inherit;text-align:left" data-a="tab" data-v="plan">${ic('plan', 18)}<span class="grow">Esta semana · ${rangoSem(SEM)}</span>${ic('chev', 18, 'chev')}</button>
    <div class="row"><div class="cring" style="--p:${pct}" role="img" aria-label="${r.plan ? `${r.hechas} de ${r.plan} sesiones hechas` : `${r.n} actividades`}"><span><b>${r.plan ? `${r.hechas}/${r.plan}` : r.n}</b><small>${r.plan ? 'hechas' : 'hechas'}</small></span></div>
      <div class="grow stack" style="gap:4px"><b style="font-size:17px">${r.plan ? `${pct} % del plan cumplido` : 'Sin plan esta semana'}</b><span class="small muted">${nf(r.min / 60)} h hechas${r.plan ? ` · ${r.pendientes} pendiente${r.pendientes === 1 ? '' : 's'}` : ' · toca para planificar'}</span>${r.fuerza < objetivos().fuerza ? `<span class="small" style="color:var(--bad)">Te falta fuerza: ${r.fuerza} de ${objetivos().fuerza}</span>` : ''}</div></div>
    <div class="strip7">${strip}</div>
    ${hoy ? `<button type="button" class="li" style="padding:10px 0 0;min-height:0" data-a="day" data-v="${HOY}"><span class="main"><span>${hoy.a ? 'Hecho hoy' : 'Hoy toca'}</span><b>${esc(hoy.a ? `${hoy.a.lugar} · ${nf(hoy.a.km || 0)} km` : hoy.d)}</b>${!hoy.a && fit.nivel === 'suave' ? '<span style="color:var(--warn)">Encaja si lo haces suave: readiness moderada.</span>' : ''}</span>${chip(tipoSes(hoy))}${ic('chev', 18, 'chev')}</button>` : ''}
  </div>`;
}
function cardReadiness() {
  const R = (M.perfil || {}).ready || {}; const r = S.readiness ?? R.score; const fit = fitHoy(); const s = sesion(HOY);
  if (r == null) return `<div class="card"><div class="card-h">${ic('battery', 18)}<span class="grow">Cómo estás hoy</span></div><p class="small muted">Garmin aún no ha calculado tu readiness de hoy. Necesita que hayas dormido con el reloj puesto.</p></div>`;
  const nivel = r < 50 ? 'baja' : r < 75 ? 'moderada' : 'alta'; const real = r === R.score;
  let out = `<div class="card"><div class="card-h">${ic('battery', 18)}<span class="grow">Cómo estás hoy</span>${real ? (M.fuente === 'vivo' ? '<span class="live">En vivo</span>' : simTag('Demo')) : simTag('Simulado')}</div>
    <div class="row"><div class="ring" style="--p:${r};--c:${r < 50 ? 'var(--bad)' : r < 75 ? 'var(--warn)' : 'var(--good)'}"><span>${r}</span></div><div class="grow stack" style="gap:2px"><b style="font-size:17px">Readiness ${nivel}</b><span class="small muted">${real ? [R.sleep != null ? `Sueño ${R.sleep}` : '', R.hrv != null ? `VFC ${R.hrv}` : '', R.rec ? `${nf(R.rec, 0)} h de recuperación` : 'recuperado'].filter(Boolean).join(' · ') : 'Valor simulado para probar el flujo'}</span></div></div></div>`;
  if (!fit.ok && S.adapt === null) out += `<div class="adapt"><div class="card-h">${ic('info', 18)}<span class="grow">Tu plan de hoy no encaja</span><span class="xs" style="text-transform:none">sin IA: reglas</span></div>
      <p>Tenías <b>${esc(s.d)}</b>. Con readiness ${r}, elige:</p>
      <button type="button" class="opt rec" data-a="adapt" data-v="suave">${ic('check', 22)}<span class="main"><b>1 h muy suave hoy y lo fuerte mañana</b><span>Recuperación hoy; la sesión pasa a mañana.</span></span></button>
      <button type="button" class="opt" data-a="adapt" data-v="descanso">${ic('battery', 22)}<span class="main"><b>Descansar hoy</b><span>Y la sesión, mañana.</span></span></button>
      <button type="button" class="opt" data-a="adapt" data-v="mantener">${ic('flag', 22)}<span class="main"><b>Mantener el plan</b><span>Vigila el pulso.</span></span></button>
      <button type="button" class="opt" data-a="otro">${ic('edit', 22)}<span class="main"><b>Otro</b><span>Dime qué vas a hacer y reajusto la semana.</span></span></button></div>`;
  return out;
}

function sportStats(k) {
  const all = acts().filter(x => x.dep === k); const d30 = addDays(HOY, -30); const mes = all.filter(x => x.f > d30);
  const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
  const temporada = k === 'skimo' || k === 'esqui' ? all.filter(x => x.f > addDays(HOY, -300)) : all;
  switch (k) {
    case 'bici': return [[nf(sum(mes, x => x.km), 0), 'km', `últimos 30 días · ${mes.length} salidas`], [nf(sum(mes, x => x.desn), 0), 'm+', 'últimos 30 días']];
    case 'skimo': { const vs = temporada.filter(x => x.sub && !x.sub.remonte).map(x => x.sub.vam); return [[nf(sum(temporada, x => x.desn), 0), 'm+', `temporada · ${temporada.length} salidas`], [vs.length ? nf(Math.max(...vs), 0) : '—', 'm/h', 'mejor ritmo de subida']]; }
    case 'correr': return [[all.length, 'carreras', `${nf(sum(all, x => x.km), 0)} km en total`], [mes.length, 'último mes', `${nf(sum(mes, x => x.km), 0)} km`]];
    case 'raqueta': return [[all.length, 'partidos', `${nf(sum(all, x => x.min) / 60, 0)} h en total`], [mes.length, 'último mes', '']];
    case 'fuerza': { const sem = M.weeks.filter(([, v]) => v.fuerza).length; return [[all.length, 'sesiones', `en ${M.weeks.length} semanas`], [sem, 'semanas', `con fuerza de ${M.weeks.length}`]]; }
    default: return [[nf(sum(all, x => x.min) / 60, 0), 'h', `${all.length} salidas`], [nf(sum(all, x => x.km), 0), 'km', 'en total']];
  }
}
function tilesDeportes() {
  const sel = S.sports.filter(k => acts().some(a => a.dep === k));
  if (!sel.length) return '<p class="small muted">Elige en Ajustes los deportes que quieres que analice.</p>';
  return `<div class="tiles">${sel.map(k => { const [[v, u, s]] = sportStats(k); return `<button type="button" class="tile" data-a="sportsel" data-v="${k}"><span class="h">${sportDot(k)}${SPORTS[k].n}</span><span class="v">${v} <small>${u}</small></span><span class="s">${s}</span></button>`; }).join('')}</div>`;
}

function cardForma(mini) {
  const [tipo] = tipoAtleta(); const f = forma();
  return `<button type="button" class="card tap" data-a="tab" data-v="forma"><div class="card-h">${ic('forma', 18)}<span class="grow">Tu forma</span>${ic('chev', 18, 'chev')}</div>
    <div class="row" style="align-items:flex-end"><div class="bignum"><span class="v" style="font-size:${mini ? 56 : 72}px">${f == null ? '—' : nf(f)}</span><span class="of">/10</span></div></div><span class="kind" style="font-size:18px">${esc(tipo)}</span></button>`;
}

function cardComida() {
  const hoy = S.meals.filter(m => m.f === HOY); const cg = cargaDia(HOY); const c = hoy.length ? hoy.reduce((a, m) => a + m.c, 0) / hoy.length : null;
  return `<button type="button" class="card tap" data-a="push" data-v="nutri"><div class="card-h">${ic('food', 18)}<span class="grow">Comida</span>${labTag()}${ic('chev', 18, 'chev')}</div>
    <p class="small"><b>${cg.n}</b> (${esc(cg.txt)}): ${cg.c === 2 ? 'la mitad' : cg.c === 1.5 ? 'algo más de un tercio' : 'un cuarto'} de cada plato, carbohidrato. ${hoy.length ? `Llevas ${hoy.length} comida${hoy.length === 1 ? '' : 's'} con ${nf(c)} de 4 cuartos de media.` : 'Aún no has registrado nada hoy.'}</p></button>`;
}

function cardPueblos() {
  const ts = Object.values(M.towns || {}); const ult = acts().find(a => a.nuevos && a.nuevos.length);
  return `<button type="button" class="card tap" data-a="tab" data-v="pueblos"><div class="card-h">${ic('pueblos', 18)}<span class="grow">Tus pueblos</span>${ic('chev', 18, 'chev')}</div>
    <div class="row"><span class="num" style="font-size:44px;font-weight:700;line-height:1">${ts.length}</span><div class="grow small muted">municipios cruzados.${ult ? `<br>Últimos nuevos (${fDia(ult.f)}): ${esc(ult.nuevos.slice(0, 3).join(', '))}.` : ''}</div></div></button>`;
}

function syncLine() {
  const t = S.lastSync ? new Date(S.lastSync) : null;
  return `<span class="sync" id="synctxt">${M.fuente === 'vivo' ? '<span class="live">En vivo</span> ' : '<span class="sim">Demo</span> '}${t ? `Actualizado a las ${t.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : 'Sin sincronizar'}</span>`;
}
function tabHoy() {
  const banner = S.simRide && !S.seenSim && M.fuente === 'demo' ? `<div class="adapt b-full"><div class="row">${ic('pueblos', 26)}<div class="grow"><b style="font-size:17px">Nueva actividad: +3 pueblos</b><p class="small muted">Palau-solità i Plegamans, Polinyà y Santa Perpètua de Mogoda.</p></div></div><div class="btns"><button class="btn fill" type="button" data-a="seen-sim">Ver en el mapa</button></div></div>` : '';
  const orden = S.variant === 'forma' ? ['forma', 'semana', 'ready'] : S.variant === 'objetivo' ? ['obj', 'semana', 'ready'] : ['semana', 'ready', 'forma'];
  const bloques = { semana: `<div class="b-hero">${cardSemana(true)}</div>`, ready: `<div class="b-side stack" style="gap:16px">${cardReadiness()}</div>`, forma: `<div class="b-side">${cardForma(S.variant !== 'forma')}</div>`, obj: `<div class="b-hero">${cardObjetivo()}</div>` };
  const html = orden.map(k => bloques[k]).join('');
  return { title: 'Hoy', html: head('Hoy', `${cap1(fLarga(HOY))} · ${syncLine()}`) + `<div class="content"><div class="bento">${banner}${html}
    <div class="b-full"><div class="section-h"><h2>Tus deportes</h2><button class="link" type="button" data-a="push" data-v="ajustes">Elegir</button></div>${tilesDeportes()}</div>
    ${S.variant === 'objetivo' ? `<div class="b-third">${cardForma(true)}</div>` : `<div class="b-third">${cardObjetivo(true)}</div>`}<div class="b-third">${cardComida()}</div><div class="b-third">${cardPueblos()}</div>
  </div></div>` };
}
function cardObjetivo(mini) {
  const g = S.goal, m = MODOS[g.modo] || MODOS.forma, o = objetivos();
  return `<button type="button" class="card tap ${mini ? '' : 'hero'}" data-a="push" data-v="objetivo"><div class="card-h">${ic('target', 18)}<span class="grow">Tu objetivo</span>${ic('chev', 18, 'chev')}</div>
    <span class="kind" style="font-size:${mini ? 18 : 24}px">${esc(g.titulo || m.n)}</span>
    <span class="small muted">${o.h[0]}-${o.h[1]} h/semana · ${o.int[0]}-${o.int[1]} intensos · ${o.fuerza} de fuerza${g.fecha ? ` · ${fDia(g.fecha)}` : ''}</span>
    ${mini ? '' : '<p class="say">Cada semana te comparo con esto. Cámbialo cuando quieras: se adapta, no te ata.</p>'}</button>`;
}
