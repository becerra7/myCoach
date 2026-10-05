/* ===== v1 · Piezas comunes del rediseño (docs/PLAN-V1.md) =====
   Icono de información, etiquetas de estado, gráficas SVG de una sola escala con tooltip,
   y la hoja de Claude. Las pantallas están en 63-67. */
const V = { carga: null, prog: null, pueb: 'año', semOff: 0 };

/* Texto explicativo detrás de un icono ⓘ: se registra al pintar y se abre en una hoja */
const INFOS = {};
const ICO_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
function info(clave, titulo, texto) {
  INFOS[clave] = { titulo, texto };
  return `<button class="info" type="button" data-a="v-info" data-v="${esc(clave)}" aria-label="Qué es: ${esc(titulo)}">${ICO_INFO}</button>`;
}
const tag = (tono, icono, texto) => `<span class="tag ${tono}"><i aria-hidden="true">${icono}</i>${texto}</span>`;
const TONO_EST = { bien: ['good', '↑', 'Bien'], normal: ['neutral', '=', 'Normal'], leve: ['warn', '!', 'Algo peor'], fuerte: ['bad', '!', 'Peor'], sin_dato: ['neutral', '·', 'Sin dato'] };
const TONO_SEM = { verde: ['good', '✓'], ambar: ['warn', '!'], rojo: ['bad', '✕'] };
const blk = (cuerpo, cls = '') => `<section class="blk ${cls}">${cuerpo}</section>`;
const blkH = (titulo, extra = '') => `<div class="blk-h"><h2>${titulo}</h2>${extra}</div>`;
const vizT = (titulo, inf = '') => `<div class="viz-t"><span>${titulo}</span>${inf}</div>`;
const pendiente = (titulo, texto) => `<div class="vacio"><h2>${titulo}</h2><p class="muted">${texto}</p></div>`;

/* ===== Gráficas: una escala por gráfica, rejilla recesiva, marcas finas y tooltip (data-tip) ===== */
const VW = 340;
function vEjeY(y0, y1, ticks, h, pad, fmt = v => nf(v, 1)) {
  return ticks.map(t => { const y = pad.t + (1 - (t - y0) / (y1 - y0)) * (h - pad.t - pad.b);
    return `<line class="grid" x1="${pad.l}" x2="${VW - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${fmt(t)}</text>`; }).join('');
}
function vTicks(lo, hi, n = 4) {
  const paso = niceMax((hi - lo) / n || 1); const a = Math.floor(lo / paso) * paso, b = Math.ceil(hi / paso) * paso;
  const t = []; for (let v = a; v <= b + 1e-9; v += paso) t.push(Math.round(v * 100) / 100); return t;
}
const vBar = (x, base, y, w, fill) => `<path class="mk" d="M${x},${base}V${Math.min(base - 1, y + 3)}q0,-3 3,-3h${Math.max(0, w - 6)}q3,0 3,3V${base}z" fill="${fill}"/>`;
function vBarras({ datos, y0 = 0, y1, ticks, refs = [], h = 180, color = () => 'var(--s-bici)', tip, fmt, cada = 1, aria, etiqueta }) {
  const pad = { t: 12, r: 6, b: 24, l: 34 }, n = datos.length, bw = (VW - pad.l - pad.r) / Math.max(n, 1), gap = Math.max(2, bw * .28);
  const Y = v => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b), base = Y(Math.max(y0, 0));
  const marcas = datos.map((d, i) => { const x = pad.l + i * bw + gap / 2, w = bw - gap, y = Y(Math.max(y0, Math.min(y1, d[1])));
    return `<g data-tip="${esc(tip(d))}"><rect class="hit" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${h - pad.t - pad.b}"/>${d[1] > y0 ? vBar(x, base, y, w, color(d, i)) : ''}</g>
      ${(n - 1 - i) % cada === 0 ? `<text x="${x + w / 2}" y="${h - 8}" text-anchor="middle">${esc(d[0])}</text>` : ''}
      ${etiqueta ? `<text class="lbl" x="${x + w / 2}" y="${y - 5}" text-anchor="middle">${esc(etiqueta(d, i))}</text>` : ''}`; }).join('');
  const rf = refs.map(r => `<line class="${r.cls || 'ref'}" x1="${pad.l}" x2="${VW - pad.r}" y1="${Y(r.v)}" y2="${Y(r.v)}"/><text x="${VW - pad.r}" y="${Y(r.v) - 4}" text-anchor="end" class="lbl">${esc(r.t)}</text>`).join('');
  return `<svg class="chart2" viewBox="0 0 ${VW} ${h}" role="img" aria-label="${esc(aria)}">${vEjeY(y0, y1, ticks, h, pad, fmt)}${marcas}${rf}</svg>`;
}
/* Barras apiladas (p. ej. minutos suaves, medios y duros por semana) */
function vApiladas({ cols, claves, colores, h = 180, tip, aria, fmt = v => nf(v, 0) }) {
  const tot = cols.map(c => claves.reduce((a, k, i) => a + (c[1][i] || 0), 0)); const y1 = niceMax(Math.max(...tot, 1));
  const pad = { t: 12, r: 6, b: 24, l: 34 }, n = cols.length, bw = (VW - pad.l - pad.r) / Math.max(n, 1), gap = Math.max(2, bw * .3);
  const Y = v => pad.t + (1 - v / y1) * (h - pad.t - pad.b);
  const marcas = cols.map((c, i) => { const x = pad.l + i * bw + gap / 2, w = bw - gap; let acc = 0;
    const segs = claves.map((k, j) => { const v = c[1][j] || 0; if (!v) return ''; const y0 = Y(acc), y = Y(acc + v); acc += v; return `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(0, y0 - y - 2)}" rx="2" fill="${colores[j]}"/>`; }).join('');
    return `<g data-tip="${esc(tip(c))}"><rect class="hit" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${h - pad.t - pad.b}"/>${segs}</g><text x="${x + w / 2}" y="${h - 8}" text-anchor="middle">${esc(c[0])}</text>`; }).join('');
  return `<svg class="chart2" viewBox="0 0 ${VW} ${h}" role="img" aria-label="${esc(aria)}">${vEjeY(0, y1, vTicks(0, y1), h, pad, fmt)}${marcas}</svg>`;
}
function vPuntos({ datos, x0, x1, y0, y1, xt, yt, h = 220, xl, yl, r = () => 6, fill, tip, aria, etiquetas = [], fmtX = v => nf(v, 1), fmtY = v => nf(v, 1) }) {
  const pad = { t: 12, r: 12, b: 38, l: 38 };
  const X = v => pad.l + (v - x0) / (x1 - x0) * (VW - pad.l - pad.r), Y = v => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b);
  const gx = xt.map(t => `<line class="grid" x1="${X(t)}" x2="${X(t)}" y1="${pad.t}" y2="${h - pad.b}"/><text x="${X(t)}" y="${h - pad.b + 14}" text-anchor="middle">${fmtX(t)}</text>`).join('');
  const pts = datos.map((d, i) => `<g data-tip="${esc(tip(d))}"><circle class="hit" cx="${X(d[1])}" cy="${Y(d[2])}" r="14"/><circle cx="${X(d[1])}" cy="${Y(d[2])}" r="${r(d)}" fill="${fill(d, i)}" stroke="var(--paper)" stroke-width="2"/></g>`).join('');
  const lb = etiquetas.filter(i => datos[i]).map(i => { const d = datos[i], xr = X(d[1]) > VW - 70; return `<text class="lbl" x="${X(d[1]) + (xr ? -r(d) - 4 : r(d) + 4)}" y="${Y(d[2]) + 4}" text-anchor="${xr ? 'end' : 'start'}">${esc(d[0])}</text>`; }).join('');
  return `<svg class="chart2" viewBox="0 0 ${VW} ${h}" role="img" aria-label="${esc(aria)}">${vEjeY(y0, y1, yt, h, pad, fmtY)}${gx}
    <text x="${(pad.l + VW - pad.r) / 2}" y="${h - 4}" text-anchor="middle">${esc(xl)}</text>
    <text transform="translate(10 ${(pad.t + h - pad.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yl)}</text>${pts}${lb}</svg>`;
}
const rango = (vals, margen = .08) => { const lo = Math.min(...vals), hi = Math.max(...vals), m = (hi - lo || Math.abs(hi) || 1) * margen; return [lo - m, hi + m]; };

/* Tooltip de las gráficas: ratón y toque */
const vtip = document.createElement('div'); vtip.className = 'vtip'; vtip.setAttribute('role', 'tooltip'); app.append(vtip);
function moverTip(e) {
  const g = e.target.closest?.('#view [data-tip]'); if (!g) { vtip.style.opacity = 0; return; }
  vtip.textContent = g.dataset.tip; vtip.style.opacity = 1;
  const r = app.getBoundingClientRect(); const x = Math.min(r.right - vtip.offsetWidth - 8, e.clientX + 12);
  vtip.style.left = Math.max(r.left + 8, x) + 'px'; vtip.style.top = Math.max(8, e.clientY - vtip.offsetHeight - 12) + 'px';
}
document.addEventListener('pointermove', moverTip, { passive: true });
document.addEventListener('pointerdown', moverTip, { passive: true });
scroller.addEventListener('scroll', () => { vtip.style.opacity = 0; }, { passive: true });

/* ===== Claude: los encargos se hacen en tu Claude; la web los prepara =====
   Si esta vista corre dentro de Claude con permiso para usarlo, se mantiene el chat de verdad. */
const ENCARGOS = [
  ['Prepárame la semana que viene', 'Prepárame la semana que viene con myCoach: lee mi perfil, mi estado y mi calendario, propónmela con coach_proponer y enséñamela antes de guardarla.'],
  ['Registra lo que he comido', 'Voy a contarte lo que he comido (o te mando una foto). Regístralo en myCoach con comida_registrar, en cuartos de plato, y dime cómo voy hoy de hidrato y proteína.'],
  ['Trázame una ruta de bici', 'Trázame una ruta de bici de unos 80 km y 1.000 m saliendo de donde suelo salir. Mira antes mis rutas guardadas y no la guardes en Garmin sin preguntarme.'],
  ['¿Cómo me ha ido la última salida?', 'Analiza mi última actividad con myCoach: cómo fue, si cuadró con el plan y qué comí durante. Compárala con la misma ruta si la he hecho antes.'],
  ['¿Estoy mejorando?', 'Con coach_progreso, dime si estoy mejorando en bici: motor aeróbico, desacople, disciplina en los fondos, durabilidad y combustible en ruta.'],
  ['Prepárame los menús de la semana', 'Prepárame los menús de la semana que viene con myCoach: mira comida_plan (la carga de cada día, el hidrato que toca en cada comida y lo que aún no sabes de mí), usa mis platos guardados y propónmelos con comida_proponer. Enséñamelos antes de guardarlos.'],
];
function hojaClaude() {
  if (typeof claudeReal === 'function' && claudeReal()) { openClaude(); return; }
  openSheet({ title: `Hacerlo con tu Claude`, size: 'auto', id: 'v-claude', body: () => `<p class="muted">Lo que cambia tus datos se hace en tu Claude, con tu conector de Garmin. Copio el encargo y lo pegas allí; lo que haga se ve aquí.</p>
    <div class="filas">${ENCARGOS.map(([t], i) => `<button class="fila-b" type="button" data-a="v-encargo" data-v="${i}"><b>${esc(t)}</b>${ic('chev', 18, 'chev')}</button>`).join('')}</div>` });
}
$('#claude-top').addEventListener('click', hojaClaude);

/* La semana en siete casillas: franja llena = hecho, hueca = pendiente, rayada = no hecho */
function estadoDia(f) {
  const s = sesion(f), a = s?.a || acts().find(x => x.f === f);
  if (a) return { k: 'hecho', txt: '✓', largo: 'hecho', dep: a.dep, t: s ? s.d : a.lugar };
  if (!s || s.t === 'descanso') return { k: 'libre', txt: 'Libre', largo: s ? 'descanso' : 'libre', dep: null, t: s ? 'Descanso' : 'Libre' };
  if (f < HOY) return { k: 'no', txt: 'No', largo: 'no hecho', dep: s.dep, t: s.d };
  return { k: f === HOY ? 'hoy' : 'pend', txt: f === HOY ? 'Hoy' : '', largo: f === HOY ? 'hoy' : 'pendiente', dep: s.dep, t: s.d };
}
function semana7(w) {
  return `<div class="sem7">${days7(w).map(f => { const e = estadoDia(f), d = dte(f);
    const cls = e.k === 'hoy' ? 'hoy pend' : e.k === 'pend' ? 'pend' : e.k === 'no' ? 'raya' : '';
    return `<button class="d7v ${cls}" type="button" style="--c:${e.dep ? scol(e.dep) : 'transparent'}" data-a="day" data-v="${f}" aria-label="${cap1(fLarga(f))}: ${esc(e.t || '')}, ${e.largo}">
      <small aria-hidden="true">${DC[d.getDay()]}</small><b aria-hidden="true">${d.getDate()}</b><em aria-hidden="true">${esc(e.txt)}</em></button>`; }).join('')}</div>`;
}

Object.assign(ACTIONS, {
  'v-info': el => { const x = INFOS[el.dataset.v]; if (x) openSheet({ title: x.titulo, size: 'auto', body: () => `<p>${x.texto}</p>` }); },
  'v-encargo': el => { const e = ENCARGOS[+el.dataset.v]; if (!e) return; closeSheet(); enClaude(e[1]); },
  'v-prog': el => { V.prog = el.dataset.v; render(); },
  'v-pueb': el => { V.pueb = el.dataset.v; render(); },
  'v-sem': el => { V.semOff = Math.max(-8, Math.min(1, V.semOff + +el.dataset.v)); render(); },
});
