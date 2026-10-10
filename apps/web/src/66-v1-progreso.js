/* ===== v1 · Insights: ¿dónde estoy y cómo voy? =====
   Arriba, lo fácil de leer y de comparar con otra gente (notas de 1 a 10 con sus cifras de Garmin);
   debajo, las gráficas del periodo elegido; y en "Para profundizar", el detalle para quien lo quiera.
   Un único selector de periodo manda en toda la pestaña. Lo de cada salida (llano, subida y bajada)
   lo calcula el conector (garmin_activity_detail → analisis.por_terreno); aquí solo se suma y se dibuja. */

const DEP_PROG = ['bici', 'correr', 'skimo'];
const RANGOS_INS = [['28', '4 sem.'], ['90', '3 meses'], ['182', '6 meses'], ['365', '1 año']];
const insDias = () => RANGOS_INS.some(r => r[0] === S.insRango) ? +S.insRango : 90;
const insDesde = () => addDays(HOY, -insDias());
const INS_TXT = { 28: 'las últimas 4 semanas', 90: 'los últimos 3 meses', 182: 'los últimos 6 meses', 365: 'el último año' };
const kmh = a => a.km && a.min ? a.km / (a.min / 60) : null;
const ritmoC = v => { if (!v) return '—'; const s = Math.round(3600 / v); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const ritmo = v => v ? `${ritmoC(v)} min/km` : '—';
/* En carrera se dibuja el ritmo (segundos por km, en negativo): así las marcas del eje son ritmos redondos
   (4:00, 5:00…) y lo más rápido queda arriba, como en el resto de gráficas. */
const segKm = kmh => -3600 / kmh, fmtRitmoSeg = s => ritmoC(3600 / -s);
/* Cómo se lee la velocidad en cada deporte: km/h en bici y skimo, ritmo en carrera */
const VEL = {
  bici: { n: 'Velocidad', u: 'km/h', f: v => nf(v, 1) },
  correr: { n: 'Ritmo', u: 'min/km', f: ritmoC },
  skimo: { n: 'Velocidad', u: 'km/h', f: v => nf(v, 1) },
};
/* Lo que mide el rendimiento en cada deporte (para la gráfica de velocidad frente a pulso) */
const REND = {
  bici: { n: 'Velocidad', u: 'km/h', v: a => a.ter?.llano?.kmh || a.llano?.kmh || kmh(a), fc: a => a.ter?.llano?.fc || a.llano?.fc || a.fc, tip: v => `${nf(v, 1)} km/h`, nota: 'En llano cuando la salida tiene tramos llanos; si no, la media.' },
  correr: { n: 'Velocidad', u: 'km/h', v: a => a.ter?.llano?.kmh || kmh(a), fc: a => a.ter?.llano?.fc || a.fc, tip: v => `${nf(v, 1)} km/h (${ritmo(v)})`, nota: 'En llano cuando la carrera tiene tramos llanos; si no, la media.' },
  skimo: { n: 'Subida por hora', u: 'm/h', v: a => a.ter?.subida?.vam || (a.desn && a.min ? a.desn / (a.min / 60) : null), fc: a => a.ter?.subida?.fc || a.fc, tip: v => `${nf(v, 0)} m/h`, nota: 'VAM de los tramos de subida; si no los hay, desnivel por hora de actividad.' },
};

/* ===== Gráfica de serie temporal: un punto por salida (o por semana) y la media de los 3 últimos ===== */
/* Unidad del eje y, encima de los números del eje: así ninguna gráfica deja dudas de qué mide. */
const vUnidad = (u, pad) => u ? `<text x="${pad.l - 6}" y="10" text-anchor="end">${esc(u)}</text>` : '';
/* Marcas del eje y: redondas en la escala que se lee (para el ritmo, minutos enteros o medios). */
const ticksY = (a, b, paso) => { if (!paso) return vTicks(a, b, 4).filter(t => t >= a && t <= b); if (paso === 'ritmo') paso = b - a > 200 ? 60 : 30; const t = []; for (let v = Math.ceil(a / paso) * paso; v <= b; v += paso) t.push(v); return t; };
/* Recta de tendencia (mínimos cuadrados) de una serie temporal: { a, b } con y = a + b · días. */
function tendencia(pts) {
  const xs = pts.map(p => dte(p.f).getTime() / 864e5), n = xs.length, mx = xs.reduce((s, x) => s + x, 0) / n, my = pts.reduce((s, p) => s + p.v, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0); if (!sxx) return null;
  const b = xs.reduce((s, x, i) => s + (x - mx) * (pts[i].v - my), 0) / sxx; return { a: my - b * mx, b };
}

/* ===== Gráfica de serie temporal =====
   modo "puntos": un punto por salida, la media del periodo (la misma cifra que la tabla) y la recta de tendencia.
   modo "linea": una línea que une los valores (series de Garmin y desacople). */
function vSerie({ pts, desde, hasta = HOY, h = 190, fmt = v => nf(v, 1), color = 'var(--ink)', refs = [], aria, modo = 'puntos', media = null, u = '', y0, y1, pasoY, fin: conFin = true }) {
  const pad = { t: 22, r: 10, b: 24, l: 38 }, t0 = dte(desde).getTime(), t1 = dte(hasta).getTime();
  const X = f => pad.l + (dte(f).getTime() - t0) / Math.max(1, t1 - t0) * (VW - pad.l - pad.r);
  const vals = pts.map(p => p.v), lo = Math.min(...vals), hi = Math.max(...vals), marg = Math.max((hi - lo) * .6, Math.abs(hi) * .03);
  refs = refs.filter(r => r.siempre || (r.v >= lo - marg && r.v <= hi + marg));
  const [a, b] = y0 != null ? [y0, y1] : rango([...vals, ...refs.map(r => r.v), ...(media != null ? [media] : [])], .18);
  const Y = v => pad.t + (1 - (v - a) / (b - a)) * (h - pad.t - pad.b);
  const yt = ticksY(a, b, pasoY);
  // Marcas del eje x: semanas si el periodo es corto; meses (o cada dos) si es largo.
  const dias = (t1 - t0) / 864e5, xt = [];
  if (dias <= 45) { for (let f = addDays(weekOf(desde), 7); f <= hasta; f = addDays(f, 7)) xt.push([f, fDia(f)]); }
  else { const d0 = dte(desde), paso = dias > 200 ? 2 : 1; for (let m = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); m.getTime() <= t1; m = new Date(m.getFullYear(), m.getMonth() + paso, 1)) { const f = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01`; xt.push([f, MC[m.getMonth()]]); } }
  const ejeX = xt.map(([f, l]) => `<text x="${X(f)}" y="${h - 8}" text-anchor="middle">${l}</text>`).join('');
  // La etiqueta de cada referencia va a la izquierda: lo reciente (a la derecha) es lo que más se mira.
  const rf = [...refs, ...(media != null ? [{ v: media, t: `Media ${fmt(media)}`, cls: 'ref2' }] : [])].filter(r => r.v >= a && r.v <= b)
    .map(r => `<line class="${r.cls || 'ref'}" x1="${pad.l}" x2="${VW - pad.r}" y1="${Y(r.v)}" y2="${Y(r.v)}"/><text x="${pad.l + 4}" y="${Y(r.v) - 4}" class="lbl">${esc(r.t)}</text>`).join('');
  const tr = modo === 'puntos' && pts.length >= 4 ? tendencia(pts) : null;
  const recta = tr ? (() => { const fa = pts[0].f, fb = pts[pts.length - 1].f, v = f => tr.a + tr.b * dte(f).getTime() / 864e5;
    return `<line x1="${X(fa)}" y1="${Y(v(fa))}" x2="${X(fb)}" y2="${Y(v(fb))}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`; })() : '';
  const linea = modo === 'linea' && pts.length > 1 ? `<polyline points="${pts.map(p => `${X(p.f).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` : '';
  const muchos = pts.length > 40;
  const marcas = pts.map(p => `<g data-tip="${esc(p.tip)}"><circle class="hit" cx="${X(p.f)}" cy="${Y(p.v)}" r="14"/>${muchos ? '' : `<circle cx="${X(p.f)}" cy="${Y(p.v)}" r="4" fill="color-mix(in srgb,${color} ${modo === 'puntos' ? 55 : 100}%,var(--paper))" stroke="var(--paper)" stroke-width="1.5"/>`}</g>`).join('');
  const ult = pts[pts.length - 1];
  const fin = modo === 'linea' && conFin && ult ? `<text class="lbl" x="${Math.min(X(ult.f), VW - pad.r - 2)}" y="${Y(ult.v) - 9}" text-anchor="end">${esc(fmt(ult.v))}</text>` : '';
  return `<svg class="chart2" viewBox="0 0 ${VW} ${h}" role="img" aria-label="${esc(aria)}">${vUnidad(u, pad)}${vEjeY(a, b, yt, h, pad, fmt)}${ejeX}${rf}${linea}${recta}${marcas}${fin}</svg>`;
}
const leyendaSerie = (col, media = true) => `<div class="leyenda"><span><i style="background:color-mix(in srgb,${col} 55%,var(--paper));border-radius:50%"></i>Cada actividad</span><span><i class="ln" style="border-top:2.5px solid ${col}"></i>Tendencia</span>${media ? '<span><i class="ln" style="border-top:2px dashed var(--ink-2)"></i>Media del periodo</span>' : ''}</div>`;

/* ===== Velocidad según la pendiente: este periodo frente al anterior, a igual desnivel ===== */
function sumaPendiente(as) {
  const m = new Map(); for (const a of as) for (const [p, km, min] of (a.ter && a.ter.pp) || []) { const x = m.get(p) || { km: 0, min: 0 }; x.km += km; x.min += min; m.set(p, x); }
  return m;
}
/* La diferencia con el periodo anterior, a igual pendiente: en llano (−1 a +1 %) y en subida (+2 % o más),
   ponderada por los km de ahora. Más de un 2 % se dice como cambio; menos, como "igual". */
function difPend(A, B) {
  const dif = f => { let w = 0, s = 0; for (const [p, x] of A) if (f(p) && B.has(p) && B.get(p).km >= 1 && x.km >= 1) { const r = (x.km / x.min) / (B.get(p).km / B.get(p).min) - 1; s += r * x.km; w += x.km; } return w ? s / w * 100 : null; };
  const txt = (n, d) => d == null ? '' : `${n}, ${Math.abs(d) < 2 ? 'igual que antes' : `un ${nf(Math.abs(d), 0)} % más ${d > 0 ? 'rápido' : 'lento'}`}`;
  const t = [txt('En llano', dif(p => p === 0)), txt('en subida', dif(p => p >= 2))].filter(Boolean);
  return t.length ? `${t.join('; ')} que en el periodo anterior, a igual pendiente.` : '';
}
function vCurvas({ series, h = 200, fmtY = v => nf(v, 0), aria, u = '', pasoY }) {
  const pad = { t: 22, r: 10, b: 38, l: 38 }, xs = series.flatMap(s => s.pts.map(p => p[0])), ys = series.flatMap(s => s.pts.map(p => p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), [y0, y1] = rango(ys, .12), yt = ticksY(y0, y1, pasoY);
  const X = v => pad.l + (v - x0) / Math.max(1, x1 - x0) * (VW - pad.l - pad.r), Y = v => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b);
  const ejeX = [...new Set(xs)].sort((a, b) => a - b).map(x => `<text x="${X(x)}" y="${h - pad.b + 14}" text-anchor="middle">${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}</text>`).join('');
  const lineas = series.map(s => `<polyline points="${s.pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.dash ? 2 : 2.5}"${s.dash ? ` stroke-dasharray="${Array.isArray(s.dashArr) ? s.dashArr.join(' ') : '5 4'}"` : ''} stroke-linejoin="round"/>
    ${s.pts.map(p => `<g data-tip="${esc(p[2])}"><circle class="hit" cx="${X(p[0])}" cy="${Y(p[1])}" r="14"/><circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${s.dash ? 3 : 4}" fill="${s.dash ? 'var(--paper)' : s.color}" stroke="${s.color}" stroke-width="1.5"/></g>`).join('')}`).join('');
  return `<svg class="chart2" viewBox="0 0 ${VW} ${h}" role="img" aria-label="${esc(aria)}">${vUnidad(u, pad)}${vEjeY(y0, y1, yt, h, pad, fmtY)}${ejeX}
    <text x="${(pad.l + VW - pad.r) / 2}" y="${h - 4}" text-anchor="middle">Pendiente (%)</text>${lineas}</svg>`;
}

/* ===== Por terreno: suma del periodo, con medias por tiempo (como hace el conector en cada salida) ===== */
function sumaTerreno(as, peso) {
  const z = () => ({ n: 0, km: 0, min: 0, fcm: 0, fcmin: 0, desn: 0 }); const L = z(), U = z(), B = z(), G = z(), O = z();
  const sumar = (x, km, min, fc) => { x.n++; x.km += km; x.min += min; if (fc) { x.fcm += fc * min; x.fcmin += min; } };
  for (const a of as) { const t = a.ter; if (!t) continue;
    if (t.llano && t.llano.kmh) sumar(L, t.llano.km, t.llano.km / t.llano.kmh * 60, t.llano.fc);
    if (t.subida && t.subida.min) { sumar(U, t.subida.km, t.subida.min, t.subida.fc); U.desn += t.subida.km * t.subida.pend * 10; }
    if (t.bajada && t.bajada.kmh) { sumar(B, t.bajada.km, t.bajada.km / t.bajada.kmh * 60); B.desn += t.bajada.km * Math.abs(t.bajada.pend) * 10; }
    if (t.gap && t.gap.min) sumar(G, t.gap.km, t.gap.min, t.gap.fc);
    if (t.ondulado && t.ondulado.min) sumar(O, t.ondulado.km, t.ondulado.min, t.ondulado.fc); }
  const base = x => ({ n: x.n, km: x.km, kmh: x.km / (x.min / 60), fc: x.fcmin ? x.fcm / x.fcmin : null });
  const ll = L.n && L.min ? base(L) : null; if (ll && ll.fc) ll.mpl = (L.km * 1000 / L.min) / ll.fc;
  const su = U.n && U.min ? { ...base(U), vam: U.desn / (U.min / 60), pend: U.desn / (U.km * 10), wkg: wkgFisica(U.km, U.desn, U.min, peso) } : null;
  if (su && su.fc) su.dpl = su.vam / 60 / su.fc * 100; // metros de desnivel por cada 100 latidos
  const ba = B.n && B.min ? { ...base(B), pend: B.desn / (B.km * 10) } : null;
  const gp = G.n && G.min ? base(G) : null; if (gp && gp.fc) gp.mpl = (G.km * 1000 / G.min) / gp.fc;
  const on = O.n && O.min ? { ...base(O), min: O.min } : null;
  return { llano: ll, subida: su, bajada: ba, gap: gp, ondulado: on, min: { llano: L.min, ondulado: O.min, subida: U.min, bajada: B.min } };
}
/* R: otra suma para comparar (en una actividad, tu media de los 3 meses anteriores). */
function tablaTerreno(dep, T, R = null) {
  const V = VEL[dep], una = T.llano && T.llano.n === 1 || T.subida && T.subida.n === 1, n = x => una ? `${nf(x.km, x.km < 10 ? 1 : 0)} km` : `${nf(x.km, 0)} km en ${x.n} ${dep === 'bici' ? 'salida' : 'actividad'}${x.n === 1 ? '' : 's'}`;
  const celda = (nom, v, u, ref) => `<div class="ter-c"><span class="n">${nom}</span><b>${v}${u ? ` <small>${u}</small>` : ''}</b>${ref ? `<small class="ter-ref">Tu media ${ref}</small>` : ''}</div>`;
  const fila = (nom, ico, x, celdas, extra = '') => `<div class="ter-f"><div class="ter-n"><b><i aria-hidden="true">${ico}</i>${nom}</b><span>${x ? n(x) : 'Sin tramos en este periodo'}${extra}</span></div>${x ? celdas.join('') : ''}</div>`;
  const pulso = x => celda('Pulso', x.fc ? nf(x.fc, 0) : '—', 'ppm'), filas = [];
  const r = (k, f) => R && R[k] ? f(R[k]) : null;
  if (dep === 'correr') filas.push(fila('Ajustado a pendiente', '≈', T.gap, T.gap ? [celda('Ritmo', ritmoC(T.gap.kmh), 'min/km', r('gap', x => ritmoC(x.kmh))), pulso(T.gap), celda('Por latido', T.gap.mpl ? nf(T.gap.mpl, 2) : '—', 'm', r('gap', x => x.mpl && nf(x.mpl, 2)))] : [], T.gap ? ' equivalentes en llano' : ''));
  if (dep !== 'skimo') filas.push(fila('Llano', '→', T.llano, T.llano ? [celda(V.n, V.f(T.llano.kmh), V.u, r('llano', x => V.f(x.kmh))), pulso(T.llano), celda('Por latido', T.llano.mpl ? nf(T.llano.mpl, 2) : '—', 'm', r('llano', x => x.mpl && nf(x.mpl, 2)))] : []));
  if (dep !== 'skimo' && T.ondulado) filas.push(fila('Ondulado', '∿', T.ondulado, [celda(V.n, V.f(T.ondulado.kmh), V.u, r('ondulado', x => V.f(x.kmh))), pulso(T.ondulado)], ' entre el 1,5 y el 3 %'));
  filas.push(fila('Subida', '↗', T.subida, T.subida ? [celda('VAM', nf(T.subida.vam, 0), 'm/h', r('subida', x => nf(x.vam, 0))), pulso(T.subida),
    dep === 'skimo' ? celda('Por 100 latidos', nf(T.subida.dpl, 1), 'm') : celda(V.n, V.f(T.subida.kmh), V.u)] : [],
    T.subida ? ` al ${nf(T.subida.pend, 1)} %${dep === 'bici' && T.subida.wkg ? ` · ≈${nf(T.subida.wkg, 1)} W/kg estimados` : ''}` : ''));
  if (dep !== 'skimo') filas.push(fila('Bajada', '↘', T.bajada, T.bajada ? [celda(V.n, V.f(T.bajada.kmh), V.u), celda('Pendiente', nf(T.bajada.pend, 1), '%')] : []));
  return `<div class="ter">${filas.join('')}</div>`;
}
/* Qué explica la tabla en cada deporte */
const AYUDA_TER = {
  bici: 'Suma de todas tus salidas del periodo, separadas por terreno en tramos de 500 m: llano por debajo del 1,5 % de pendiente, subida desde el 3 % y bajada desde el −3 %. Las medias son por tiempo. "Por latido" son los metros que recorres en llano con cada latido: si sube, vas más rápido con el mismo esfuerzo. La VAM son los metros de desnivel que subes por hora. Los W/kg salen de la física de la subida (sin potenciómetro): son una estimación. La bajada depende más de la pendiente y del tráfico que de tu forma.',
  correr: 'En carrera, la cifra que manda es el ritmo ajustado a la pendiente: cada tramo se pasa a su equivalente en llano con el coste energético de correr cuesta arriba y cuesta abajo (Minetti y otros, 2002), así una salida con cuestas se compara con una llana. Solo cuenta pendientes entre −10 % y +10 %, donde el modelo es fiable. "Por latido" son los metros equivalentes que recorres con cada latido: es la idea del índice pulso-velocidad, que en estudios sigue la mejora de forma (Vesterinen y otros, 2014). Debajo, el mismo cálculo por terreno.',
  skimo: 'En skimo lo que cuenta es subir: la VAM (metros de desnivel por hora) y con qué pulso la consigues. "Por 100 latidos" son los metros de desnivel que ganas cada 100 latidos: si sube, subes más con el mismo esfuerzo. En los estudios de skimo, lo que más explica el rendimiento es el VO2máx y el umbral (correlaciones de 0,7 a 0,9), y la VAM sostenida es lo más parecido que se puede medir sin laboratorio. La altitud la baja: compara salidas a cotas parecidas.',
};

/* ===== Un deporte: tus números, lo esencial en gráficas y "Para profundizar" ===== */
function progDep(dep) {
  const desde = insDesde(), dias = insDias(), act = dep === 'bici' ? 'salida' : 'actividad';
  const todas = acts().filter(a => a.dep === dep && a.f > desde && a.min >= 15).sort((x, y) => x.f.localeCompare(y.f));
  const antes = acts().filter(a => a.dep === dep && a.f > addDays(desde, -dias) && a.f <= desde && a.min >= 15);
  const R = REND[dep], col = scol(dep), V = VEL[dep];
  if (todas.length < 2) return blk(pendiente(`Hay pocas ${act}s de ${SPORTS[dep].n.toLowerCase()} en ${INS_TXT[dias]}`, 'Con dos ya te enseño tus números; con cuatro, tendencias. Prueba con un periodo más largo o actualiza los datos de Garmin.') + '<div class="btns"><button class="btn tonal" type="button" data-a="v-sync">Actualizar con Garmin</button></div>', 'first');
  const conTer = todas.filter(a => a.ter), sinDet = todas.length - conTer.length, T = sumaTerreno(conTer, (M.perfil || {}).peso);
  const tot = { h: todas.reduce((s, a) => s + a.min, 0) / 60, km: todas.reduce((s, a) => s + (a.km || 0), 0), desn: todas.reduce((s, a) => s + (a.desn || 0), 0) };
  const numeros = blk(`${blkH(`Tus números en ${INS_TXT[dias]}`, info(`ter-${dep}`, 'Tus números', AYUDA_TER[dep]))}
    <p class="small muted" style="margin:-4px 0 12px">${todas.length} ${act}s · ${nf(tot.h, 0)} h · ${nf(tot.km, 0)} km${tot.desn ? ` · ${nf(tot.desn, 0)} m de desnivel` : ''}</p>
    ${conTer.length ? tablaTerreno(dep, T) : '<p class="muted">Aún no tengo el detalle por terreno de estas actividades: se completa al actualizar con Garmin.</p>'}
    ${sinDet && conTer.length ? `<p class="xs muted" style="margin-top:8px">${sinDet} sin analizar todavía: se completan al actualizar con Garmin.</p>` : ''}`, 'first');

  const top = [], mas = [], fondo = a => ['rec', 'fondo'].includes(tipoAct(a)), temp = a => a.tc != null ? `, ${nf(a.tc, 0)} °C` : '';
  const serie = (titulo, inf, pts, o) => blk(`${vizT(titulo, inf)}<div class="viz">${vSerie({ desde, color: col, ...o, pts })}</div>${o.modo === 'linea' ? '' : leyendaSerie(col, o.media != null)}`);
  const fmtV = dep === 'correr' ? ritmoC : v => nf(v, 1), uV = dep === 'correr' ? 'min/km' : 'km/h', txtV = v => dep === 'correr' ? ritmo(v) : `${nf(v, 1)} km/h`;
  const ayudaPuntos = `Cada punto es una ${act}. La línea continua es la tendencia del periodo y la discontinua, la media del periodo (la misma cifra que la tabla de arriba).`;

  // ── Lo esencial ──
  if (dep === 'correr') { const p = conTer.filter(a => a.ter.gap).map(a => ({ f: a.f, v: a.ter.gap.kmh, a }));
    p.forEach(x => { x.kmh = x.v; x.v = segKm(x.v); });
    if (p.length >= 2) top.push(serie('Ritmo ajustado a pendiente', info('gap', 'Ritmo ajustado a pendiente', `${ayudaPuntos} Es tu ritmo equivalente en llano: las cuestas cuentan como más distancia y las bajadas suaves como menos (Minetti y otros, 2002). Así se comparan carreras por sitios distintos. Toca un punto para ver el pulso y la temperatura.`),
      p.map(x => ({ ...x, tip: `${fDia(x.f)}: ${ritmo(x.kmh)} a ${x.a.ter.gap.fc || '—'} ppm${temp(x.a)}` })), { fmt: fmtRitmoSeg, pasoY: 'ritmo', u: 'min/km', media: T.gap && segKm(T.gap.kmh), aria: `Ritmo ajustado a pendiente por carrera en ${INS_TXT[dias]}` })); }
  if (dep === 'bici') { const p = conTer.filter(a => a.ter.llano && a.ter.llano.km >= 2).map(a => ({ f: a.f, v: a.ter.llano.kmh, a }));
    if (p.length >= 2) top.push(serie('Velocidad en llano', info('vll-bici', 'Velocidad en llano', `${ayudaPuntos} Es la velocidad media en los tramos llanos de cada salida. Toca un punto para ver el pulso y la temperatura: con calor el pulso sube a la misma velocidad.`),
      p.map(x => ({ ...x, tip: `${fDia(x.f)}: ${nf(x.v, 1)} km/h a ${x.a.ter.llano.fc || '—'} ppm (${nf(x.a.ter.llano.km, 0)} km llanos${temp(x.a)})` })), { u: 'km/h', media: T.llano && T.llano.kmh, aria: `Velocidad en llano por salida en ${INS_TXT[dias]}` })); }
  const pSu = conTer.filter(a => a.ter.subida && a.ter.subida.km >= 1).map(a => ({ f: a.f, v: a.ter.subida.vam, a }));
  if (pSu.length >= 2) top.push(serie('Subidas: metros por hora (VAM)', info(`vam-${dep}`, 'VAM en subida', `${ayudaPuntos} La VAM son los metros de desnivel que subes por hora en los tramos de subida. Depende de la pendiente: en rampas suaves sale más baja que en una subida dura, así que compara ${act}s parecidas.`),
    pSu.map(x => { const s = x.a.ter.subida; return { ...x, tip: `${fDia(x.f)}: ${nf(s.vam, 0)} m/h al ${nf(s.pend, 1)} % a ${s.fc || '—'} ppm${s.wkg ? `, ≈${nf(s.wkg, 1)} W/kg` : ''}` }; }),
    { fmt: v => nf(v, 0), u: 'm/h', media: T.subida && T.subida.vam, aria: `VAM en subida por ${act} en ${INS_TXT[dias]}` }));
  // Mejor VAM sostenida (10, 20 y 60 min): este periodo frente al anterior. Esencial en skimo; en bici y carrera, para profundizar.
  const mejorVs = (as, i) => { const v = as.map(a => a.vs && a.vs[i]).filter(Boolean); return v.length ? Math.max(...v) : null; };
  const vsAhora = [0, 1, 2].map(i => mejorVs(todas, i)), vsAntes = [0, 1, 2].map(i => mejorVs(antes, i));
  if (vsAhora.filter(Boolean).length >= 2) {
    const etq = ['10 min', '20 min', '60 min'], datos = etq.map((l, i) => [l, vsAhora[i] || 0, vsAntes[i]]).filter(d => d[1]), vy = niceMax(Math.max(...datos.map(d => Math.max(d[1], d[2] || 0))));
    const b = blk(`${vizT('Tu mejor subida sostenida', info(`vs-${dep}`, 'Mejor VAM sostenida', `Los metros de desnivel por hora más altos que has mantenido durante 10, 20 y 60 minutos seguidos en ${INS_TXT[dias]}. Es como la curva de potencia de Intervals.icu, pero con lo que se puede medir sin potenciómetro: cuánto aguantas subiendo. La marca es el periodo anterior, de la misma duración.`))}
      <div class="viz">${vBarras({ datos, y0: 0, y1: vy, ticks: vTicks(0, vy), h: 170, u: 'm/h', color: () => col, marcas: datos.map(d => d[2]), tip: d => `${d[0]}: ${nf(d[1], 0)} m/h${d[2] ? ` (antes ${nf(d[2], 0)})` : ''}`, etiqueta: d => nf(d[1], 0), aria: 'Mejor VAM sostenida durante 10, 20 y 60 minutos', fmt: v => nf(v, 0) })}</div>
      ${datos.some(d => d[2]) ? '<div class="leyenda"><span><i style="background:' + col + '"></i>Este periodo</span><span><i class="ln" style="border-top:2.5px solid var(--ink)"></i>Periodo anterior</span></div>' : ''}`);
    (dep === 'skimo' ? top : mas).push(b);
  }
  // Velocidad (o ritmo) según la pendiente, este periodo frente al anterior
  if (dep !== 'skimo') {
    const A = sumaPendiente(conTer), B = sumaPendiente(antes.filter(a => a.ter)), v = x => x.km / (x.min / 60), yv = dep === 'correr' ? segKm : k => k;
    const pts = [...A.entries()].filter(([, x]) => x.km >= 1).sort((a, b) => a[0] - b[0]);
    const prev = [...B.entries()].filter(([p, x]) => x.km >= 1 && A.has(p) && A.get(p).km >= 1).sort((a, b) => a[0] - b[0]);
    if (pts.length >= 3) {
      const txt = p => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`;
      const series = [{ color: col, pts: pts.map(([p, x]) => [p, yv(v(x)), `${txt(p)}: ${txtV(v(x))} en ${nf(x.km, 0)} km${B.get(p) && B.get(p).km >= 1 ? ` (antes ${txtV(v(B.get(p)))})` : ''}`]) }];
      if (prev.length >= 2) series.push({ color: 'var(--ink-2)', dash: true, pts: prev.map(([p, x]) => [p, yv(v(x)), `${txt(p)}, periodo anterior: ${txtV(v(x))} en ${nf(x.km, 0)} km`]) });
      top.push(blk(`${vizT(`${V.n} según la pendiente`, info(`vpend-${dep}`, `${V.n} según la pendiente`, `Tu ${V.n.toLowerCase()} media en cada pendiente, de bajadas (a la izquierda) a subidas (a la derecha), sumando todos los tramos de 500 m del periodo. La línea discontinua es el periodo anterior, de la misma duración: si la de ahora queda por encima en las mismas pendientes, vas más rápido en el mismo terreno. Así se compara sin que importe si has hecho rutas más llanas o más duras. El viento y el pulso no se descuentan.`))}
        <div class="viz">${vCurvas({ series, fmtY: dep === 'correr' ? fmtRitmoSeg : fmtV, pasoY: dep === 'correr' ? 'ritmo' : null, u: uV, aria: `${V.n} según la pendiente en ${INS_TXT[dias]}${prev.length >= 2 ? ', frente al periodo anterior' : ''}` })}</div>
        <div class="leyenda"><span><i class="ln" style="border-top:2.5px solid ${col}"></i>${cap1(INS_TXT[dias])}</span>${prev.length >= 2 ? `<span><i class="ln" style="border-top:2px dashed var(--ink-2)"></i>Periodo anterior</span>` : ''}</div>
        ${prev.length >= 2 ? `<p class="lee">${difPend(A, B)}</p>` : ''}`));
    }
  }
  // Volumen por semana: horas (bici y carrera) o desnivel (skimo, donde el volumen se mide subiendo)
  const nSem = Math.min(52, Math.ceil(dias / 7)), sems = Array.from({ length: nSem }, (_, i) => addDays(SEM, (i - nSem + 1) * 7));
  const porSem = dep === 'skimo' ? sems.map(w => [fDia(w), acts().filter(a => a.dep === dep && weekOf(a.f) === w).reduce((s, a) => s + (a.desn || 0), 0), w === SEM])
    : sems.map(w => { const wk = (M.weeks || []).find(x => x[0] === w); return [fDia(w), ((wk && wk[1][dep]) || 0) / 60, w === SEM]; });
  const vy = niceMax(Math.max(...porSem.map(v => v[1]), 1)), skH = dep === 'skimo';
  top.push(blk(`${vizT(skH ? 'Desnivel por semana' : 'Horas por semana', info(`vol-${dep}`, skH ? 'Desnivel por semana' : 'Horas por semana', `${skH ? 'Metros de desnivel positivo' : `Horas de ${SPORTS[dep].n.toLowerCase()}`} cada semana; cada barra empieza el lunes que marca. La de esta semana va más clara porque aún no ha acabado.`))}
    <div class="viz">${vBarras({ datos: porSem, y0: 0, y1: vy, ticks: vTicks(0, vy), h: 160, u: skH ? 'm' : 'h', cada: Math.ceil(nSem / 6), color: d => d[2] ? `color-mix(in srgb,${col} 45%,var(--paper))` : col,
      tip: d => `Semana del ${d[0]}: ${skH ? `${nf(d[1], 0)} m` : `${nf(d[1])} h`}${d[2] ? ' (en curso)' : ''}`, etiqueta: nSem <= 13 ? (d => d[1] ? nf(d[1], skH ? 0 : 1) : '') : null, aria: skH ? 'Desnivel por semana' : 'Horas por semana', fmt: v => nf(v, skH ? 0 : 1) })}</div>`));

  // ── Para profundizar ──
  const efi = dep === 'correr' ? a => a.ter.gap && a.ter.gap.mpl : dep === 'bici' ? a => a.ter.llano && a.ter.llano.mpl : a => a.ter.subida && a.ter.subida.fc && a.ter.subida.vam / 60 / a.ter.subida.fc * 100;
  const pEf = conTer.filter(a => fondo(a) && efi(a)).map(a => ({ f: a.f, v: efi(a), a }));
  const mediaEf = (() => { const x = sumaTerreno(conTer.filter(fondo), (M.perfil || {}).peso); return dep === 'correr' ? x.gap && x.gap.mpl : dep === 'bici' ? x.llano && x.llano.mpl : x.subida && x.subida.dpl; })();
  if (pEf.length >= 2) mas.push(serie(dep === 'skimo' ? 'Eficiencia: desnivel por 100 latidos' : `Eficiencia: metros por latido${dep === 'correr' ? ' (ajustados a pendiente)' : ' en llano'}`,
    info(`mpl-${dep}`, 'Eficiencia', `${dep === 'skimo' ? 'Los metros de desnivel que ganas cada 100 latidos en los tramos de subida.' : `Los metros que recorres ${dep === 'correr' ? '(equivalentes en llano)' : 'en llano'} con cada latido.`} Es la idea del factor de eficiencia de Intervals.icu o TrainingPeaks, sin potenciómetro. Si sube, tu motor aeróbico mejora. Solo cuenta ${act}s suaves y constantes (fondos): con series o con un grupo, el dato no sirve. En una misma ruta repetida sale casi igual, pero entre rutas distintas varía mucho (viento, calor, grupo): mira la tendencia, no un punto.`),
    pEf.map(x => ({ ...x, tip: `${fDia(x.f)}: ${nf(x.v, dep === 'skimo' ? 1 : 2)}${temp(x.a)}` })), { fmt: v => nf(v, dep === 'skimo' ? 1 : 2), u: 'm', media: mediaEf, aria: `Eficiencia por ${act} en ${INS_TXT[dias]}` }));
  const pts = todas.map(a => [fDia(a.f), R.fc(a), R.v(a)]).filter(p => p[1] && p[2]);
  if (pts.length >= 3) { const [xa, xb] = rango(pts.map(p => p[1])), [ya, yb] = rango(pts.map(p => p[2])), n = pts.length;
    const mejor = pts.reduce((m, p, i) => p[2] / p[1] > pts[m][2] / pts[m][1] ? i : m, 0);
    mas.push(blk(`${vizT(`${R.n} frente a pulso`, info(`ve-${dep}`, `${R.n} frente a pulso`, `Cada punto es una ${act}: a la derecha, más pulso; arriba, más ${R.n.toLowerCase()}. Más oscuro, más reciente. Mejoras si los puntos recientes quedan arriba y a la izquierda: lo mismo con menos pulso. ${R.nota}`))}
      <div class="viz">${vPuntos({ datos: pts, x0: xa, x1: xb, y0: ya, y1: yb, xt: vTicks(xa, xb, 4).filter(t => t >= xa && t <= xb), yt: vTicks(ya, yb, 4).filter(t => t >= ya && t <= yb), xl: 'Pulso medio (ppm)', yl: R.u,
        fill: (d, i) => `color-mix(in srgb,${col} ${30 + i / Math.max(1, n - 1) * 70}%,var(--paper))`, tip: d => `${d[0]}: ${R.tip(d[2])} a ${d[1]} ppm`, aria: `${R.n} frente a pulso medio en ${n} actividades`, etiquetas: [n - 1, mejor], fmtX: v => nf(v, 0), fmtY: v => nf(v, dep === 'skimo' ? 0 : 1) })}</div>
      <p class="lee">Tu mejor relación: ${pts[mejor][0]}, ${R.tip(pts[mejor][2])} a ${pts[mejor][1]} ppm.</p>`)); }
  const pDc = todas.filter(a => a.dc != null && a.min >= 60 && fondo(a)).map(a => ({ f: a.f, v: a.dc, a }));
  if (dep !== 'skimo' && pDc.length >= 2) mas.push(serie('Desacople en los fondos largos', info(`dc-${dep}`, 'Desacople', 'Cuánto empeora la relación entre velocidad y pulso de la primera mitad a la segunda, medido solo en llano (método de Joe Friel, el mismo que usan Intervals.icu y TrainingPeaks). Por debajo del 5 % aguantas bien el ritmo; por encima, te falta fondo para esa duración o fuiste deprisa al principio. Solo fondos de una hora o más: en salidas con series, repechos o grupo salen cifras sin sentido (de −15 % a +18 %).'),
    pDc.map(x => ({ ...x, tip: `${fDia(x.f)}: ${x.v > 0 ? '+' : ''}${nf(x.v, 1)} % en ${dur(x.a.min)}` })), { fmt: v => nf(v, 0), u: '%', modo: 'linea', refs: [{ v: 5, t: 'Límite 5 %', siempre: true }], aria: 'Desacople por fondo largo' }));
  const fsMax = i => { const v = todas.map(a => a.fs && a.fs[i]).filter(Boolean); return v.length ? Math.max(...v) : null; };
  const curva = [['5 min', fsMax(0)], ['20 min', fsMax(1)], ['60 min', fsMax(2)]].filter(c => c[1]);
  if (curva.length >= 2) { const lthr = (M.perfil && M.perfil.lthr) || null, cy0 = Math.floor((Math.min(...curva.map(c => c[1])) - 15) / 10) * 10, cy1 = Math.ceil((Math.max(...curva.map(c => c[1]), lthr || 0) + 5) / 10) * 10;
    mas.push(blk(`${vizT('Tu mejor pulso sostenido', info(`fs-${dep}`, 'Pulso máximo sostenido', `El pulso medio más alto que has aguantado durante 5, 20 y 60 minutos en ${INS_TXT[dias]}. Es como la curva de pulso de Intervals.icu. El de 20 minutos se acerca a tu umbral${lthr ? ` (${lthr} ppm según Garmin)` : ''}: si sube sin que suba tu umbral, has apretado más; si baja, no has hecho esfuerzos largos y fuertes en este periodo.`))}
      <div class="viz">${vBarras({ datos: curva, y0: cy0, y1: cy1, ticks: vTicks(cy0, cy1, 4).filter(t => t >= cy0 && t <= cy1), h: 160, u: 'ppm', color: () => col, refs: lthr ? [{ v: lthr, t: `Umbral ${lthr}` }] : [], tip: d => `${d[0]}: ${d[1]} ppm`, etiqueta: d => String(d[1]), aria: 'Pulso medio máximo durante 5, 20 y 60 minutos', fmt: v => nf(v, 0) })}</div>`)); }
  const pBa = conTer.filter(a => a.ter.bajada && a.ter.bajada.km >= 1).map(a => ({ f: a.f, v: a.ter.bajada.kmh, a }));
  if (dep === 'bici' && pBa.length >= 2) mas.push(serie('Velocidad en bajada', info('baj', 'Velocidad en bajada', 'Velocidad media en los tramos de bajada (desde el −3 %). Depende sobre todo de la pendiente, del tráfico y de la técnica, no de tu forma: es para curiosear, no para medir si mejoras.'),
    pBa.map(x => ({ ...x, tip: `${fDia(x.f)}: ${nf(x.v, 1)} km/h al ${nf(x.a.ter.bajada.pend, 1)} %` })), { fmt: v => nf(v, 0), u: 'km/h', media: T.bajada && T.bajada.kmh, aria: 'Velocidad en bajada por salida' }));
  const Lt = ((M.perfil && M.perfil.lthr) || 170) - (dep === 'bici' ? 5 : 0), techo = Math.round(Lt * .86), z2 = Math.round(Lt * .81);
  const ult = todas.slice(-16).filter(a => a.fc);
  if (ult.length >= 3) { const fcs = ult.map(a => a.fc), dy0 = Math.floor(Math.min(...fcs, z2) / 10) * 10 - 5, dy1 = Math.ceil(Math.max(...fcs, techo) / 10) * 10 + 5;
    const fondos = ult.filter(fondo), dentro = fondos.filter(a => a.fc <= techo).length;
    mas.push(blk(`${vizT('Disciplina en los fondos', info(`dis-${dep}`, 'Disciplina en los fondos', `Pulso medio de cada ${act}. En los fondos (en color) el objetivo es quedarte por debajo del techo de ${techo} ppm; ${z2} ppm es el centro de tu zona 2. Salen de tu umbral de Garmin (${Lt} ppm). En gris, las ${act}s de otro tipo.`))}
      <div class="viz">${vBarras({ datos: ult.map(a => [fDia(a.f), a.fc, fondo(a)]), y0: dy0, y1: dy1, ticks: vTicks(dy0, dy1, 4).filter(t => t >= dy0 && t <= dy1), h: 190, u: 'ppm', cada: Math.ceil(ult.length / 6),
        color: d => d[2] ? col : 'var(--line-3)', tip: d => `${d[0]}: ${d[1]} ppm${d[2] ? ', fondo' : ''}`, refs: [{ v: techo, t: `Techo ${techo}` }, { v: z2, t: `Z2 ${z2}`, cls: 'ref2' }], aria: `Pulso medio por ${act}`, fmt: v => nf(v, 0) })}</div>
      <p class="lee">${fondos.length ? `${dentro} de ${fondos.length} fondos por debajo del techo.` : 'En este periodo no hay fondos.'}</p>`)); }
  const zon = sems.map(w => { const z = [0, 0, 0]; acts().filter(a => a.dep === dep && weekOf(a.f) === w && a.z).forEach(a => a.z.forEach((v, k) => { z[k] += v; })); return [fDia(w), z.map(v => v / 60)]; });
  if (zon.filter(c => c[1].some(Boolean)).length >= 3) mas.push(blk(`${vizT('Suave, medio y duro por semana', info(`zon-${dep}`, 'Suave, medio y duro por semana', 'Horas de cada semana según tu pulso: suave (por debajo del 90 % de tu umbral), medio y duro. En los aficionados que mejoran, cerca del 80 % es suave.'))}
    <div class="viz">${vApiladas({ cols: zon, claves: ['suave', 'medio', 'duro'], colores: [`color-mix(in srgb,${col} 35%,var(--paper))`, `color-mix(in srgb,${col} 65%,var(--paper))`, col], tip: c => `Semana del ${c[0]}: ${nf(c[1][0])} h suaves, ${nf(c[1][1])} h medias, ${nf(c[1][2])} h duras`, aria: 'Horas suaves, medias y duras por semana', fmt: v => nf(v, 1), u: 'h', cada: Math.ceil(nSem / 6) })}</div>
    <div class="leyenda"><span><i style="background:color-mix(in srgb,${col} 35%,var(--paper))"></i>Suave</span><span><i style="background:color-mix(in srgb,${col} 65%,var(--paper))"></i>Medio</span><span><i style="background:${col}"></i>Duro</span></div>`));
  mas.push(bloqueCombustible(dep, todas));
  const queMas = { bici: 'Eficiencia, VAM sostenida, desacople, pulso, bajadas y zonas', correr: 'Eficiencia, VAM sostenida, desacople, pulso y zonas', skimo: 'Eficiencia subiendo, pulso, disciplina y zonas' }[dep];
  return `${numeros}<div class="grid2">${top.join('')}</div>${bloqueComparar(dep, conTer)}
    <details class="mas"${S.insMas ? ' open' : ''}><summary data-a="ins-mas"><span>Para profundizar</span><small>${queMas}</small></summary>
      <div class="grid2">${mas.join('')}</div></details>`;
}

/* ===== General: dónde estás (comparado con otra gente), cómo evoluciona, cuánto entrenas y tu peso ===== */
// Solo lo común a todos los deportes: lo de cada deporte (los W/kg en subida, por ejemplo) vive en su pestaña.
const ESC_KEYS = ['motor', 'fondo', 'volumen', 'equilibrio'];
function dondeEstas() {
  const d = dims(), nota = forma();
  const filas = ESC_KEYS.map(k => { const x = d[k];
    const inf = info(`dim-${k}`, x.n, `${x.por || x.falta} ${x.mejora || ''}`);
    if (x.v == null) return `<div class="esc-f"><div class="esc-l"><b>${x.n}</b><span>${esc(x.falta || 'Sin datos todavía.')}</span></div>${inf}</div>`;
    return `<div class="esc-f"><div class="esc-l"><b>${x.n}</b><span>${esc(x.u)}</span></div>
      <div class="esc" role="img" aria-label="${esc(x.n)}: ${nf(x.v, 1)} sobre 10"><span class="esc-r" style="left:44.4%"></span><span class="esc-r" style="left:66.7%"></span><span class="esc-m" style="left:${(x.v - 1) / 9 * 100}%"></span></div>
      <b class="esc-v">${nf(x.v, 1)}</b>${inf}</div>`; }).join('');
  return blk(`${blkH('Dónde estás', info('donde', 'Dónde estás', 'Cada nota va de 1 a 10 y te compara con otra gente: 5 es un aficionado medio de tu edad y 7, uno fuerte (las dos marcas de cada barra). Salen de lo que mide Garmin (VO2máx, Endurance Score) y de tus actividades. Toca ⓘ en cada fila para ver de dónde sale y cómo mejorarla.'))}
    ${nota != null ? `<p class="esc-tot"><b>${nf(nota, 1)}</b><span>sobre 10 de forma general</span></p>` : ''}
    <div class="esc-lista">${filas}</div>
    <div class="esc-ej" aria-hidden="true"><span>1</span><span style="left:44.4%">Medio</span><span style="left:66.7%">Fuerte</span><span style="left:100%">10</span></div>`, 'first');
}
/* Series de Garmin (Endurance, VO2máx, Hill): semanales si la última sincronización las trajo; si no, la mensual. */
function serieGarmin(clave) {
  const s = M.forma && M.forma.series && M.forma.series[clave];
  if (s && s.length) return s.map(([f, v]) => ({ f, v })).filter(p => p.v != null);
  const k = { es: 'es', vo2: 'vo2', hill: 'hill', vo2b: 'vo2b' }[clave]; return (M.evo || []).filter(e => e[k] != null).map(e => ({ f: e.f, v: e[k] }));
}
function evolucionGarmin() {
  const desde = insDesde(), dias = insDias(), out = [];
  const una = (clave, titulo, inf, fmt, refs = [], u = '') => {
    const todo = serieGarmin(clave), pts = todo.filter(p => p.f >= desde); if (!todo.length) return;
    const ult = todo[todo.length - 1], prim = pts[0];
    const lee = pts.length >= 2 && prim !== ult ? `${fmt(ult.v)} ahora; ${fmt(prim.v)} el ${fDia(prim.f)}.` : `${fmt(ult.v)} (${fDia(ult.f)}).`;
    const ps = pts.length >= 2 ? pts : todo.slice(-2);
    out.push(blk(`${vizT(titulo, inf)}${ps.length >= 2 ? `<div class="viz">${vSerie({ pts: ps.map(p => ({ ...p, tip: `${fDia(p.f)}: ${fmt(p.v)}` })), desde: pts.length >= 2 ? desde : ps[0].f, modo: 'linea', h: 160, fmt, refs, u, aria: `${titulo} en ${INS_TXT[dias]}` })}</div>` : ''}<p class="lee">${lee}</p>`));
  };
  una('es', 'Endurance Score', info('ev-es', 'Endurance Score', 'Lo calcula Garmin con todas tus actividades de resistencia, de cualquier deporte: mide cuánto aguantas esfuerzos largos. Las líneas marcan sus niveles: Entrenado desde 5.800, Muy entrenado desde 6.600 y Experto desde 7.300.'), v => nf(v, 0), [{ v: 5800, t: 'Entrenado' }, { v: 6600, t: 'Muy entrenado' }, { v: 7300, t: 'Experto' }], 'puntos');
  una('vo2', 'VO2máx', info('ev-vo2', 'VO2máx', 'El oxígeno que tu cuerpo puede usar por minuto y kilo: el tamaño de tu motor. Garmin lo estima en carreras con pulso y GPS. Sube despacio: un punto en unos meses ya es mucho.'), v => nf(v, 1), [], 'ml/kg/min');
  if (serieGarmin('vo2b').length) una('vo2b', 'VO2máx en bici', info('ev-vo2b', 'VO2máx en bici', 'El VO2máx que estima Garmin en bici. Necesita potenciómetro.'), v => nf(v, 1), [], 'ml/kg/min');
  una('hill', 'Hill Score', info('ev-hill', 'Hill Score', 'Lo calcula Garmin con tus carreras y caminatas en cuesta: fuerza y resistencia subiendo. No usa la bici.'), v => nf(v, 0), [], 'puntos');
  return out.length ? `<div class="grid2">${out.join('')}</div>` : '';
}
/* Cuánto entrenas, todos los deportes juntos: horas por semana apiladas por deporte */
function horasDeportes() {
  const dias = insDias(), nSem = Math.min(52, Math.ceil(dias / 7)), sems = Array.from({ length: nSem }, (_, i) => addDays(SEM, (i - nSem + 1) * 7));
  const deps = SPORT_ORDER.filter(k => sems.some(w => ((M.weeks || []).find(x => x[0] === w)?.[1] || {})[k]));
  if (!deps.length) return '';
  const cols = sems.map(w => { const v = ((M.weeks || []).find(x => x[0] === w) || [w, {}])[1]; return [fDia(w), deps.map(k => (v[k] || 0) / 60)]; });
  const media = cols.reduce((s, c) => s + c[1].reduce((a, b) => a + b, 0), 0) / nSem;
  return blk(`${vizT('Horas por semana, todos los deportes', info('hdep', 'Horas por semana', 'Todo lo que haces cuenta como carga, también lo que no se planifica (pádel, montaña, fuerza). Toca una barra para ver el reparto de esa semana.'))}
    <div class="viz">${vApiladas({ cols, claves: deps, colores: deps.map(scol), tip: c => `Semana del ${c[0]}: ${deps.map((k, i) => c[1][i] ? `${SPORTS[k].n} ${nf(c[1][i])} h` : '').filter(Boolean).join(', ') || 'nada'}`, aria: `Horas por semana y deporte en ${INS_TXT[dias]}`, fmt: v => nf(v, 1), cada: Math.ceil(nSem / 6), u: 'h' })}</div>
    <div class="leyenda">${deps.map(k => `<span><i style="background:${scol(k)}"></i>${SPORTS[k].n}</span>`).join('')}</div>
    <p class="lee">${nf(media, 1)} h por semana de media en ${INS_TXT[dias]}.</p>`);
}
function progForma() {
  const c = coachHoy(), f = c && (c.forma || (c.demo ? { forma_ctl: 48, fatiga_atl: 56, frescura_tsb: -8 } : null));
  const tsb = f && f.frescura_tsb != null ? Math.round(f.frescura_tsb) : null;
  const zona = tsb == null ? null : tsb < -30 ? ['bad', '!', 'Muy cargado', 'Llevas mucha carga: unos días suaves te harán bien.'] : tsb < -10 ? ['good', '↑', 'Cargado, ganando forma', 'Entrenas lo suficiente para mejorar. Cargado no quiere decir fresco: antes de una prueba, toca bajar.'] : tsb <= 10 ? ['neutral', '=', 'En equilibrio', 'Ni cargado ni fresco: buena base para meter una semana fuerte.'] : ['good', '✓', 'Fresco', 'Llegas descansado: buen momento para una prueba o una salida exigente.'];
  const carga = progCarga();
  const fresc = blk(`${blkH('Tu frescura', info('fres', 'Tu frescura', 'Es tu forma (la carga media de las últimas 6 semanas) menos tu fatiga (la de los últimos 7 días). La carga de cada actividad sale de su pulso y su duración. Más negativo, más cargado.'))}
      ${tsb == null ? '<p class="muted">Aún no tengo tu frescura: la calcula el entrenador con tus actividades.</p>' : `<p><b style="font-size:44px;font-stretch:72%;font-weight:800;line-height:1">${tsb > 0 ? '+' : tsb < 0 ? '−' : ''}${Math.abs(tsb)}</b> ${tag(zona[0], zona[1], zona[2])}</p><p style="margin-top:8px">${zona[3]}</p>
      <div style="margin-top:12px">${escalaFrescura(tsb)}</div><p class="xs muted" style="margin-top:8px">${Math.round(f.forma_ctl)} de forma menos ${Math.round(f.fatiga_atl)} de fatiga.</p>`}`);
  // Frescura y carga responden a lo mismo (¿cómo llego?): en escritorio van juntas, en móvil una tras otra.
  return `${dondeEstas()}${evolucionGarmin()}${horasDeportes()}<div class="grid2">${bloquePeso(insDesde())}${bloqueMedidas(insDesde())}</div>
    ${carga ? `<div class="grid2">${fresc}${carga}</div>` : fresc}
    <div class="btns" style="margin:8px 0 24px"><button class="link" type="button" data-a="push" data-v="numeros">Tus umbrales y predicciones</button></div>`;
}

function tabProgresoV1() {
  const deps = DEP_PROG.filter(d => S.sports.includes(d) || acts().some(a => a.dep === d && a.f > addDays(HOY, -365)));
  if (!V.prog || (V.prog !== 'forma' && !deps.includes(V.prog))) V.prog = 'forma';
  const segs = [['forma', 'General'], ...deps.map(d => [d, SPORTS[d].n])], rg = String(insDias());
  return { title: 'Insights', html: `<div class="v1"><header class="v1-h"><h1>Insights</h1></header>
    <div class="seg-row ins-ctl">${segs.length > 1 ? `<div class="seg2" role="group" aria-label="Qué ver">${segs.map(([k, l]) => `<button type="button" data-a="v-prog" data-v="${k}" aria-pressed="${V.prog === k}">${l}</button>`).join('')}</div>` : ''}
      <label class="ins-per" for="ins-per"><span>Periodo</span><select id="ins-per">${RANGOS_INS.map(([v]) => `<option value="${v}"${rg === v ? ' selected' : ''}>${cap1(INS_TXT[v])}</option>`).join('')}</select></label></div>
    ${V.prog === 'forma' ? progForma() : progDep(V.prog)}</div>` };
}
Object.assign(ACTIONS, {
  'v-sync': () => sync(true),
  // Se abre y se cierra aquí (el clic general anula el del navegador) y se recuerda para la próxima vez.
  'ins-mas': el => { const d = el.closest('details'); d.open = !d.open; S.insMas = d.open; save(); },
});

/* ¿Me estoy pasando o me quedo corto? La carga de 7 días de Garmin frente a su franja óptima y el Load Focus
   de 4 semanas. Lo calcula Garmin y lo trae el conector: coach_hoy (de hoy) o, si no, la última sincronización. */
function cargaGarmin() {
  const c = coachHoy(); if (c && c.garmin) return c.garmin;
  const f = M.forma; return f && (f.carga || f.enfoque) ? { estado: f.estado, carga: f.carga, enfoque_carga: f.enfoque } : null;
}
const FOCO = [['anaerobica', 'Anaeróbico'], ['aerobica_alta', 'Aeróbico intenso'], ['aerobica_baja', 'Aeróbico suave']];
function filaFoco(nombre, v, [lo, hi]) {
  const max = Math.max(hi * 1.25, v, 1), estado = v < lo ? `↓ Faltan ${Math.round(lo - v)}` : v > hi ? `↑ ${Math.round(v - hi)} de más` : '✓ En objetivo';
  return `<div><div class="l"><b>${nombre}</b><span>${estado}</span></div>
    <div class="t" role="img" aria-label="${nombre}: ${Math.round(v)}; objetivo de ${Math.round(lo)} a ${Math.round(hi)}"><span class="zona" style="left:${lo / max * 100}%;width:${(hi - lo) / max * 100}%"></span><span class="ya" style="width:${Math.min(100, v / max * 100)}%"></span></div></div>`;
}
function progCarga() {
  const g = cargaGarmin(); const cg = g && g.carga, ef = g && g.enfoque_carga;
  const hayCarga = cg && cg.aguda_7d != null && Array.isArray(cg.franja_optima_cronica);
  const hayFoco = ef && FOCO.some(([k]) => ef[k] && Array.isArray(ef[k].objetivo) && ef[k].objetivo[1] != null);
  if (!hayCarga && !hayFoco) return '';
  let carga = '';
  if (hayCarga) {
    const [lo, hi] = cg.franja_optima_cronica, v = cg.aguda_7d, max = Math.max(hi * 1.35, v * 1.1), x = n => Math.round(Math.min(100, n / max * 100) * 10) / 10;
    const [lectura, txt] = v > hi ? [tag('warn', '!', 'Por encima de tu franja'), 'Cargas más de lo que asimilas bien: toca bajar unos días.']
      : v < lo ? [tag('neutral', '↓', 'Por debajo de tu franja'), 'Hay margen para cargar más sin riesgo.'] : [tag('good', '✓', 'En tu franja'), 'Cargas lo justo para mejorar.'];
    const estado = g.estado && g.estado.estado && g.estado.estado !== 'Sin estado' ? ` Garmin te ve en <b>${esc(g.estado.estado.toLowerCase())}</b>.` : '';
    carga = `<p><b style="font-size:44px;font-stretch:72%;font-weight:800;line-height:1">${Math.round(v)}</b> ${lectura}</p><p style="margin-top:8px">${txt}${estado}</p>
      <div class="fr-bar" role="img" aria-label="Carga de 7 días ${Math.round(v)}; tu franja va de ${Math.round(lo)} a ${Math.round(hi)}"><div class="fr-rail"></div><div class="fr-ok" style="left:${x(lo)}%;width:${x(hi) - x(lo)}%"></div><div class="fr-mark" style="left:${x(v)}%"></div></div>
      <p class="xs muted">Tu franja: ${Math.round(lo)}-${Math.round(hi)}.</p>`;
  }
  const foco = hayFoco ? `<h3 class="met-h" style="margin-top:${hayCarga ? 20 : 0}px">En qué has cargado (4 semanas)</h3>
    <div class="foco">${FOCO.filter(([k]) => ef[k] && ef[k].objetivo && ef[k].objetivo[1] != null).map(([k, n]) => filaFoco(n, ef[k].carga || 0, ef[k].objetivo)).join('')}</div>
    ${ef.que_hacer ? `<p style="margin-top:12px">${esc(ef.que_hacer)}</p>` : ef.veredicto ? `<p class="small muted" style="margin-top:12px">Garmin: ${esc(ef.veredicto.toLowerCase())}.</p>` : ''}` : '';
  return blk(`${blkH('Tu carga, según Garmin', info('cargag', 'Tu carga, según Garmin', 'Cada actividad suma su carga (Exercise Load, la estima Garmin por lo que te saca de tu equilibrio). La de los últimos 7 días se compara con una franja que sale de lo que vienes haciendo en 4 semanas: por debajo pierdes forma, por encima te arriesgas. Abajo, cómo se reparte la carga de 4 semanas (Load Focus) frente a lo que necesitas: anaeróbico, aeróbico intenso y aeróbico suave.'))}
    ${carga}${foco}`);
}

/* ===== Tus números: lo que Garmin calcula de ti y no cambia cada día =====
   Umbral, FTP, predicciones de carrera, edad física y aclimatación. Es de consulta: se llega desde Insights. */
function scrNumeros() {
  const f = M.forma || {}, P = M.perfil || {};
  const campo = (l, v, u) => v == null ? '' : `<div class="field"><span class="l">${l}</span><span class="v">${v}${u ? ` <small>${u}</small>` : ''}</span></div>`;
  const tarjeta = (id, t, cuerpo, nota) => cuerpo ? `<section class="card" aria-labelledby="num-${id}"><h2 class="card-t" id="num-${id}">${t}</h2><div class="fields">${cuerpo}</div>${nota ? `<p class="xs muted" style="margin-top:8px">${nota}</p>` : ''}</section>` : '';
  const u = f.umbral || {}, ftp = f.ftp || {}, pr = f.predicciones || {}, ed = f.edad || {}, ac = f.aclimatacion || {};
  const umbral = campo('Pulso de umbral', u.ppm ?? P.lthr, 'ppm') + campo('Ritmo de umbral', u.ritmo_min_km, 'min/km') + campo('FTP', ftp.vatios, 'W') + campo('FTP por kilo', ftp.w_kg != null ? nf(ftp.w_kg, 2) : null, 'W/kg');
  const pred = campo('5 km', pr['5k']) + campo('10 km', pr['10k']) + campo('Media maratón', pr.media) + campo('Maratón', pr.maraton);
  const edad = campo('Según tu forma', ed.edad_fisica != null ? nf(ed.edad_fisica, 0) : null, 'años') + campo('Edad real', ed.edad_real, 'años') + campo('Alcanzable', ed.alcanzable != null ? nf(ed.alcanzable, 0) : null, 'años');
  const acl = campo('Al calor', ac.calor_pct, '%') + campo('A la altitud', ac.altitud_m, 'm');
  const html = [
    tarjeta('umb', 'Umbrales', umbral, 'Tus zonas de pulso y de potencia salen de aquí. Si no cuadran, haz un test de umbral con el reloj.'),
    tarjeta('pred', 'Si corrieras hoy', pred, 'Predicción de Garmin con tu VO2máx y tus carreras recientes.'),
    tarjeta('edad', 'Edad física', edad, 'La calcula Garmin con tu VO2máx, tu pulso en reposo y tu actividad.'),
    tarjeta('acl', 'Aclimatación', acl, 'Cuánto te has adaptado al calor y a la altitud con lo que has entrenado allí.'),
  ].join('');
  return { title: 'Tus números', html: head('Tus números', 'Lo que Garmin calcula de ti') + `<div class="content" style="max-width:760px">${html ||
    `${pendiente('Aún no tengo tus números', 'Salen de tu Garmin: umbral, FTP, predicciones de carrera y edad física. Actualiza para traerlos.')}<div class="btns"><button class="btn fill" type="button" data-a="v-sync">Actualizar con Garmin</button></div>`}</div>` };
}
/* El periodo es un desplegable nativo: se cambia con el evento change, no con el clic general (que lo anularía). */
document.addEventListener('change', e => { if (e.target && e.target.id === 'ins-per') { S.insRango = e.target.value; save(); render(); document.getElementById('ins-per')?.focus(); } });

/* ===== Medidas corporales: viven en myCoach (Garmin no guarda perímetros) =====
   Junto al peso, en General. Una gráfica pequeña por medida para ver su progreso, sin juicios:
   el número y cuánto ha cambiado, nunca si está bien o mal. */
const MEDS = [['pecho_cm', 'Pecho'], ['cintura_cm', 'Cintura'], ['cadera_cm', 'Cadera'], ['brazo_derecho_cm', 'Brazo derecho'], ['brazo_izquierdo_cm', 'Brazo izquierdo']];
const MEDS_FIJAS = [['entrepierna_cm', 'Entrepierna', 'cm'], ['pie_eu', 'Pie', 'EU']];
const MZ = { datos: undefined, fuente: null };
function medidasDemo() {
  const r = []; for (let i = 0; i < 6; i++) { const f = addDays(HOY, -150 + i * 30); r.push({ fecha: f, pecho_cm: 101 - i * .3, cintura_cm: Math.round((88 - i * .8) * 10) / 10, cadera_cm: Math.round((99 - i * .4) * 10) / 10, brazo_derecho_cm: Math.round((32 + i * .2) * 10) / 10, brazo_izquierdo_cm: Math.round((31.6 + i * .2) * 10) / 10, ...(i === 0 ? { entrepierna_cm: 84, pie_eu: 43 } : {}) }); }
  return { demo: true, registros: r };
}
async function cargarMedidas(fresco) {
  if (MZ.datos === 'cargando') return; const fuente = fuenteDatos(); if (fuente === 'espera') return;
  MZ.fuente = fuente; if (fuente === 'demo') { MZ.datos = MZ.datos && MZ.datos.demo ? MZ.datos : medidasDemo(); return; }
  MZ.datos = 'cargando'; try { MZ.datos = await coachCall('medidas', {}, fresco); } catch (e) { MZ.datos = null; } render();
}
function bloqueMedidas(desde) {
  if (MZ.datos !== undefined && MZ.datos !== 'cargando' && fuenteDatos() !== 'espera' && MZ.fuente !== fuenteDatos()) MZ.datos = undefined;
  if (MZ.datos === undefined) cargarMedidas();
  const d = MZ.datos, regs = d && d.registros || [], boton = '<div class="btns"><button class="btn tonal" type="button" data-a="medidas-apuntar">Apuntar medidas</button></div>';
  const cab = blkH('Medidas', `${d && d.demo ? '<span class="demo-tag">Ejemplo</span>' : ''}${info('medidas', 'Medidas', 'Perímetros con cinta métrica, en centímetros: pecho a la altura de los pezones, cintura a la altura del ombligo, cadera por la parte más ancha y brazo relajado por la parte más ancha. Mejor siempre a la misma hora (por la mañana) y en el mismo sitio. Se guardan en myCoach y también te las lee tu Claude.')}`);
  if (d === undefined || d === 'cargando') return blk(`${cab}<p class="muted" role="status">Leyendo tus medidas…</p>`);
  if (d === null) return blk(`${cab}<p>No he podido leer tus medidas.</p><div class="btns"><button class="btn tonal" type="button" data-a="medidas-recargar">Volver a probar</button></div>`);
  if (!regs.length) return blk(`${cab}<p class="muted">Aún no has apuntado medidas. Con una cinta métrica, por la mañana: pecho, cintura, cadera y brazos. Cada vez que las tomes verás cómo cambian.</p>${boton}`);
  const filas = MEDS.map(([k, n]) => { const todas = regs.filter(r => r[k] != null).map(r => ({ f: r.fecha, v: r[k] })); if (!todas.length) return '';
    const pts = todas.filter(p => p.f >= desde), ult = todas[todas.length - 1], ref = pts.length >= 2 ? pts[0] : todas.length >= 2 ? todas[0] : null, cambio = ref ? Math.round((ult.v - ref.v) * 10) / 10 : null;
    const graf = pts.length >= 2 ? `<div class="viz">${vSerie({ pts: pts.map(p => ({ ...p, tip: `${fDia(p.f)}: ${nf(p.v, 1)} cm` })), desde, modo: 'linea', fin: false, h: 110, u: 'cm', fmt: v => nf(v, 1), color: 'var(--ink)', aria: `${n}: de ${nf(pts[0].v, 1)} a ${nf(ult.v, 1)} cm` })}</div>` : '';
    return `<div class="med-f"><div class="med-l"><b>${n}</b><span>${nf(ult.v, 1)} cm</span>${cambio != null ? `<small>${cambio === 0 ? 'Igual' : `${cambio > 0 ? '+' : '−'}${nf(Math.abs(cambio), 1)} cm`} desde el ${fDia(ref.f)}</small>` : `<small>${fDia(ult.f)}</small>`}</div>${graf}</div>`; }).join('');
  const fijas = MEDS_FIJAS.map(([k, n, u]) => { const r = [...regs].reverse().find(x => x[k] != null); return r ? `${n} ${nf(r[k], 1)} ${u}` : ''; }).filter(Boolean).join(' · ');
  return blk(`${cab}<div class="med">${filas}</div>${fijas ? `<p class="small muted" style="margin-top:12px">${fijas}</p>` : ''}${boton}`);
}
/* Hoja para apuntar: solo se guardan los campos que escribes; se enseña antes → después. */
let HMED = null;
function hojaMedidas() {
  const regs = (MZ.datos && MZ.datos.registros) || [], ult = k => { const r = [...regs].reverse().find(x => x[k] != null); return r ? r[k] : null; };
  const campos = [...MEDS.map(([k, n]) => [k, n, 'cm']), ...MEDS_FIJAS];
  const st = { fecha: HOY, v: {}, guardando: false, error: '' }; HMED = { st, campos, ult };
  const num = s => { const x = parseFloat(String(s).replace(',', '.')); return Number.isFinite(x) ? Math.round(x * 10) / 10 : null; };
  HMED.cambios = () => Object.entries(st.v).map(([k, s]) => [k, num(s)]).filter(([, x]) => x != null);
  const resumen = () => { const c = HMED.cambios(); return c.length ? `Se guardará el ${st.fecha === HOY ? 'día de hoy' : fDia(st.fecha)}: ${c.map(([k, x]) => { const [, n, u] = campos.find(f => f[0] === k), a = ult(k); return `${n.toLowerCase()} ${a != null ? `${nf(a, 1)} → ` : ''}${nf(x, 1)} ${u}`; }).join(', ')}.` : 'Escribe solo las medidas que hayas tomado; las demás no cambian.'; };
  HMED.resumen = resumen;
  const boton = () => { const c = HMED.cambios(); return `<button class="btn fill" type="button" data-a="medidas-guardar"${c.length && !st.guardando ? '' : ' disabled'}>${st.guardando ? 'Guardando…' : c.length ? `Guardar ${c.length} medida${c.length === 1 ? '' : 's'}` : 'Guardar'}</button>`; };
  HMED.boton = boton;
  openSheet({ title: 'Apuntar medidas', size: 'large', id: 'medidas', onClose: () => { HMED = null; }, body: () => `<form class="stack" style="gap:12px" data-form="medidas">
    <label class="stack" for="md-f" style="gap:4px"><span class="small">Día</span><input id="md-f" class="search" type="date" max="${HOY}" value="${st.fecha}"></label>
    <div class="med-campos">${campos.map(([k, n, u]) => `<label class="stack" for="md-${k}" style="gap:4px"><span class="small">${n} (${u})</span><input id="md-${k}" class="search" type="text" inputmode="decimal" autocomplete="off" value="${esc(st.v[k] || '')}" placeholder="${ult(k) != null ? nf(ult(k), 1) : ''}"></label>`).join('')}</div>
    <p class="small" role="status">${resumen()}</p>${st.error ? `<p class="small" role="alert">${esc(st.error)}</p>` : ''}${boton()}</form>` });
}
document.addEventListener('input', e => { if (!HMED || !e.target || !e.target.id) return; const id = e.target.id;
  if (id === 'md-f') HMED.st.fecha = e.target.value; else if (id.startsWith('md-')) HMED.st.v[id.slice(3)] = e.target.value; else return;
  HMED.st.error = ''; const f = document.querySelector('[data-form="medidas"]'); if (!f) return;
  // Solo el resumen y el botón: así no se pierde el foco del campo que escribes.
  f.querySelector('[role="status"]').textContent = HMED.resumen(); const t = document.createElement('div'); t.innerHTML = HMED.boton(); f.querySelector('[data-a="medidas-guardar"]').replaceWith(t.firstChild); });
async function guardarMedidas() {
  if (!HMED) return; const st = HMED.st, c = HMED.cambios(); if (!c.length) return;
  st.guardando = true; fillSheet();
  try {
    if (MZ.fuente === 'demo' || S.modo === 'demo') { const regs = MZ.datos.registros.filter(r => r.fecha !== st.fecha), prev = MZ.datos.registros.find(r => r.fecha === st.fecha) || { fecha: st.fecha }; regs.push({ ...prev, ...Object.fromEntries(c) }); regs.sort((a, b) => a.fecha.localeCompare(b.fecha)); MZ.datos = { ...MZ.datos, registros: regs }; }
    else { await coachCall('medidas_registrar', { fecha: st.fecha, ...Object.fromEntries(c), confirm: true }, true); MZ.datos = undefined; }
    closeSheet(); toast(`${c.length} medida${c.length === 1 ? '' : 's'} guardada${c.length === 1 ? '' : 's'}`); render();
  } catch (e) { st.guardando = false; st.error = /entre/.test(e && e.message || '') ? e.message : 'No he podido guardarlas. Vuelve a probar en un momento.'; fillSheet(); }
}
Object.assign(ACTIONS, { 'medidas-apuntar': () => hojaMedidas(), 'medidas-guardar': () => guardarMedidas(), 'medidas-recargar': () => { MZ.datos = undefined; cargarMedidas(true); } });

/* ===== El análisis de cada salida (salida_guardar): lo que concluye tu Claude, guardado por actividad =====
   Lo leen la pantalla de la actividad y "Durabilidad y combustible". */
const SZ = { datos: undefined, fuente: null };
function salidasDemo() {
  const d = {}; acts().filter(a => a.dep === 'bici' && a.min >= 90).slice(0, 6).forEach((a, i) => { d[a.id] = { fecha: a.f, hidratos_g_h: [25, 40, 55, 30, 60, 45][i], rpe: [6, 7, 5, 8, 6, 6][i], resumen: ['Fondo constante: el pulso apenas subió en la segunda mitad.', 'En las subidas, VAM por encima de tu media.'], sensaciones: 'Bien hasta la última hora; las piernas, algo cargadas.', proxima_vez: 'Empieza a comer en la primera hora.' }; });
  return d;
}
async function cargarSalidas(fresco) {
  if (SZ.datos === 'cargando') return; const f = fuenteDatos(); if (f === 'espera') return; SZ.fuente = f;
  if (f === 'demo') { SZ.datos = SZ.datos && SZ.datos.demo !== undefined ? SZ.datos : Object.assign(salidasDemo(), { demo: true }); return; }
  SZ.datos = 'cargando'; try { SZ.datos = (await coachCall('app_leer', { doc: 'salidas/analisis' }, fresco)) || {}; } catch (e) { SZ.datos = null; } render();
}
const analisisDe = id => { if (SZ.datos !== undefined && SZ.datos !== 'cargando' && fuenteDatos() !== 'espera' && SZ.fuente !== fuenteDatos()) SZ.datos = undefined; if (SZ.datos === undefined) cargarSalidas(); return SZ.datos && typeof SZ.datos === 'object' ? SZ.datos[id] || null : null; };
const pedirAnalisis = a => `Analiza mi actividad de ${SPORTS[a.dep].n.toLowerCase()} del ${fDia(a.f)} (activity_id ${a.id}) con myCoach: qué tal fue, por terreno y frente a mis salidas parecidas. Pregúntame qué comí y bebí durante y cómo me encontré, y al acabar guárdalo con salida_guardar.`;
Object.assign(ACTIONS, { 'salida-analizar': el => { const a = actById(el.dataset.v); if (a) enClaude(pedirAnalisis(a)); } });

/* Durabilidad y combustible: en las salidas largas, lo que tomaste por hora frente a la stamina con la que acabaste. */
function bloqueCombustible(dep, todas) {
  const col = scol(dep), largas = todas.filter(a => a.min >= 90);
  const pts = largas.map(a => { const x = analisisDe(a.id); return x && x.hidratos_g_h != null && a.st && a.st[1] != null ? [fDia(a.f), x.hidratos_g_h, a.st[1], a] : null; }).filter(Boolean);
  const ayuda = info(`comb-${dep}`, 'Durabilidad y combustible', 'Cada punto es una salida de hora y media o más: a la derecha, más hidrato por hora; arriba, más stamina al acabar (la estima Garmin con tu pulso). Si los puntos de la derecha quedan más arriba, comer te sirve: lo habitual en salidas largas es 60-90 g por hora a partir de la segunda hora. Lo que comiste lo guarda tu Claude al analizar la salida contigo.');
  if (pts.length < 2) return blk(`${blkH('Durabilidad y combustible', ayuda)}<p class="muted">${largas.length ? `Tienes ${largas.length} salida${largas.length === 1 ? '' : 's'} larga${largas.length === 1 ? '' : 's'} en este periodo, pero ${pts.length ? 'solo una' : 'ninguna'} con lo que comiste. Analízalas con tu Claude y dile qué tomaste: lo guardará aquí.` : 'En este periodo no hay salidas de hora y media o más.'}</p>
    ${largas.length ? `<div class="btns"><button class="btn tonal" type="button" data-a="salida-analizar" data-v="${largas[largas.length - 1].id}">Analizar la última con Claude</button></div>` : ''}`);
  const [xa, xb] = [0, niceMax(Math.max(...pts.map(p => p[1]), 60))], [ya, yb] = [0, 100];
  return blk(`${vizT('Durabilidad y combustible', ayuda)}
    <div class="viz">${vPuntos({ datos: pts, x0: xa, x1: xb, y0: ya, y1: yb, xt: vTicks(xa, xb, 4), yt: [0, 25, 50, 75, 100], xl: 'Hidrato durante (g/h)', yl: 'Stamina al acabar (%)', fill: () => col, tip: d => `${d[0]}: ${nf(d[1], 0)} g/h, acabaste con un ${d[2]} % de stamina (${dur(d[3].min)})`, aria: 'Hidrato por hora frente a la stamina al acabar en las salidas largas', fmtX: v => nf(v, 0), fmtY: v => nf(v, 0) })}</div>`);
}

/* ===== Comparar actividades: las eliges tú (hasta 3) =====
   Por defecto, la misma ruta repetida si la hay; si no, las dos últimas. Tabla lado a lado y la velocidad
   según la pendiente de cada una (con trazo distinto, no solo color). */
const CMP = {}; // por deporte: ids elegidos
const CMP_MAX = 3;
function mismaRutaEn(as) {
  const rutas = (DSET && DSET.rutas) || {}, pt = a => { const p = rutas[a.id]; if (!p) return null; try { const d = decodePoly(p); return d && d[0]; } catch (e) { return null; } };
  const rec = [...as].reverse().filter(a => a.km > 3 && rutas[a.id]).slice(0, 40);
  for (let i = 0; i < rec.length; i++) { const pa = pt(rec[i]); if (!pa) continue;
    for (let j = i + 1; j < rec.length; j++) { const pb = pt(rec[j]); if (pb && Math.abs(rec[i].km - rec[j].km) / rec[i].km < .08 && hav(pa, pb) < .5) return [rec[j], rec[i]]; } }
  return null;
}
function bloqueComparar(dep, conTer) {
  if (conTer.length < 2) return '';
  const ids = new Set(conTer.map(a => a.id)); let sel = (CMP[dep] || []).filter(id => ids.has(id));
  const par = mismaRutaEn(conTer);
  if (!CMP[dep]) sel = par ? par.map(a => a.id) : conTer.slice(-2).map(a => a.id);
  CMP[dep] = sel;
  const elegidas = sel.map(id => conTer.find(a => a.id === id)).filter(Boolean).sort((a, b) => a.f.localeCompare(b.f));
  const ver = V.cmpTodas === dep ? conTer : conTer.slice(-6), act = dep === 'bici' ? 'salidas' : 'actividades';
  const fila = a => { const on = sel.includes(a.id), lleno = !on && sel.length >= CMP_MAX, ruta = par && par.some(x => x.id === a.id);
    return `<div class="cmp-f"><label class="cmp-l" for="cmp-${a.id}"><input type="checkbox" id="cmp-${a.id}" data-cmp="${dep}" value="${a.id}" ${on ? 'checked' : ''} ${lleno ? 'disabled' : ''}>
      <span><b>${fDia(a.f)} · ${esc(a.lugar)}</b><span class="small muted">${nf(a.km || 0, 0)} km · ${dur(a.min)}${a.desn ? ` · ${nf(a.desn, 0)} m` : ''}${ruta ? ' · misma ruta' : ''}</span></span></label>
      <button class="iconbtn" type="button" data-a="push" data-v="actividad" data-id="${a.id}" aria-label="Ver la actividad del ${fDia(a.f)}">${ic('chev', 18)}</button></div>`; };
  const lista = `<div class="cmp-lista">${[...ver].reverse().map(fila).join('')}</div>
    ${conTer.length > 6 ? `<button class="link" type="button" data-a="cmp-todas" data-v="${dep}">${V.cmpTodas === dep ? 'Ver solo las últimas' : `Ver las ${conTer.length} del periodo`}</button>` : ''}`;
  let tabla = '', curva = '';
  if (elegidas.length >= 2) {
    const V2 = VEL[dep], g = (a, f) => { try { return f(a); } catch (e) { return null; } };
    const filas = [
      ['Distancia', 'km', a => a.km, v => nf(v, 1), 0],
      ['Tiempo', '', a => a.min, v => dur(v), 0],
      ['Desnivel', 'm', a => a.desn, v => nf(v, 0), 0],
      ['Pulso medio', 'ppm', a => a.fc, v => nf(v, 0), 0],
      dep === 'correr' ? ['Ritmo ajustado', 'min/km', a => a.ter.gap && a.ter.gap.kmh, ritmoC, 1] : null,
      dep !== 'skimo' ? [`${V2.n} en llano`, V2.u, a => a.ter.llano && a.ter.llano.kmh, V2.f, 1] : null,
      dep !== 'skimo' ? ['Pulso en llano', 'ppm', a => a.ter.llano && a.ter.llano.fc, v => nf(v, 0), -1] : null,
      dep !== 'skimo' ? ['Por latido (llano)', 'm', a => a.ter.llano && a.ter.llano.mpl, v => nf(v, 2), 1] : null,
      dep !== 'skimo' ? [`${V2.n} ondulado`, V2.u, a => a.ter.ondulado && a.ter.ondulado.kmh, V2.f, 1] : null,
      ['VAM en subida', 'm/h', a => a.ter.subida && a.ter.subida.vam, v => nf(v, 0), 1],
      ['Mejor VAM 20 min', 'm/h', a => a.vs && a.vs[1], v => nf(v, 0), 1],
      dep === 'bici' ? ['Velocidad en bajada', 'km/h', a => a.ter.bajada && a.ter.bajada.kmh, v => nf(v, 1), 0] : null,
      ['Stamina al acabar', '%', a => a.st && a.st[1], v => nf(v, 0), 1],
      ['Temperatura', '°C', a => a.tc, v => nf(v, 0), 0],
    ].filter(Boolean).map(([n, u, f, fmt, mejor]) => { const vs = elegidas.map(a => g(a, f)); if (vs.every(v => v == null)) return '';
      const ok = vs.filter(v => v != null), best = mejor && ok.length > 1 ? (mejor > 0 ? Math.max(...ok) : Math.min(...ok)) : null;
      return `<tr><th scope="row">${n}${u ? ` <small>${u}</small>` : ''}</th>${vs.map(v => `<td>${v == null ? '—' : `${fmt(v)}${best != null && v === best ? ' <span class="cmp-mejor">↑ mejor</span>' : ''}`}</td>`).join('')}</tr>`; }).join('');
    tabla = `<div class="cmp-t"><table><thead><tr><th scope="col"><span class="vh">Dato</span></th>${elegidas.map(a => `<th scope="col">${fDia(a.f)}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table></div>`;
    if (dep !== 'skimo') {
      const trazos = [[], [6, 4], [2, 3]], col = scol(dep), yv = dep === 'correr' ? segKm : k => k, v = x => x.km / (x.min / 60);
      const series = elegidas.map((a, i) => { const m = sumaPendiente([a]); const pts = [...m.entries()].filter(([, x]) => x.km >= .5).sort((p, q) => p[0] - q[0]);
        return pts.length >= 3 ? { color: i === elegidas.length - 1 ? col : `color-mix(in srgb,${col} ${55 + i * 15}%,var(--ink))`, dash: i > 0 ? trazos[i] : null, pts: pts.map(([p, x]) => [p, yv(v(x)), `${fDia(a.f)}, ${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %: ${dep === 'correr' ? ritmo(v(x)) : `${nf(v(x), 1)} km/h`}`]) } : null; });
      if (series.filter(Boolean).length >= 2) {
        const ser = series.filter(Boolean).map(sx => ({ ...sx, dash: !!sx.dash, dashArr: sx.dash }));
        curva = `<h3 class="met-h" style="margin-top:16px">${V2.n} según la pendiente</h3><div class="viz">${vCurvas({ series: ser, fmtY: dep === 'correr' ? fmtRitmoSeg : x => nf(x, 0), pasoY: dep === 'correr' ? 'ritmo' : null, u: dep === 'correr' ? 'min/km' : 'km/h', aria: `${V2.n} según la pendiente de ${elegidas.length} actividades` })}</div>
          <div class="leyenda">${elegidas.map((a, i) => series[i] ? `<span><i class="ln" style="border-top:2.5px ${i === 0 ? 'solid' : i === 1 ? 'dashed' : 'dotted'} ${series[i].color}"></i>${fDia(a.f)}</span>` : '').join('')}</div>`;
      }
    }
  }
  return blk(`${blkH('Comparar actividades', info(`cmp-${dep}`, 'Comparar actividades', `Elige hasta ${CMP_MAX} ${act} del periodo y las verás lado a lado: por terreno, esfuerzos y velocidad según la pendiente. Lo más honesto es comparar la misma ruta (te la marco si la encuentro); entre rutas distintas, el terreno, el viento y el calor pesan. "↑ mejor" marca la mejor cifra de cada fila cuando tiene sentido (más rápido, menos pulso a igual terreno, más metros por latido).`))}
    <p class="small muted" style="margin:-4px 0 8px">${elegidas.length < 2 ? `Marca al menos dos ${act}.` : `${elegidas.length} elegidas${elegidas.length >= CMP_MAX ? ': quita una para elegir otra' : ''}.`}</p>
    ${lista}${tabla}${curva}`);
}
document.addEventListener('change', e => { const el = e.target; if (!el || !el.dataset || !el.dataset.cmp) return; const dep = el.dataset.cmp, s = new Set(CMP[dep] || []);
  if (el.checked) { if (s.size < CMP_MAX) s.add(el.value); } else s.delete(el.value); CMP[dep] = [...s]; render(); document.getElementById(`cmp-${el.value}`)?.focus(); });
Object.assign(ACTIONS, { 'cmp-todas': el => { V.cmpTodas = V.cmpTodas === el.dataset.v ? null : el.dataset.v; render(); } });
