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
function vSerie({ pts, desde, hasta = HOY, h = 190, fmt = v => nf(v, 1), color = 'var(--ink)', refs = [], aria, tend = true, y0, y1 }) {
  const pad = { t: 14, r: 10, b: 24, l: 38 }, t0 = dte(desde).getTime(), t1 = dte(hasta).getTime();
  const X = f => pad.l + (dte(f).getTime() - t0) / Math.max(1, t1 - t0) * (VW - pad.l - pad.r);
  const vals = pts.map(p => p.v), lo = Math.min(...vals), hi = Math.max(...vals), marg = Math.max((hi - lo) * .6, Math.abs(hi) * .03);
  refs = refs.filter(r => r.siempre || (r.v >= lo - marg && r.v <= hi + marg));
  const [a, b] = y0 != null ? [y0, y1] : rango([...vals, ...refs.map(r => r.v)], .18);
  const Y = v => pad.t + (1 - (v - a) / (b - a)) * (h - pad.t - pad.b);
  const yt = vTicks(a, b, 4).filter(t => t >= a && t <= b);
  // Marcas del eje x: semanas si el periodo es corto; meses (o cada dos) si es largo.
  const dias = (t1 - t0) / 864e5, xt = [];
  if (dias <= 45) { for (let f = addDays(weekOf(desde), 7); f <= hasta; f = addDays(f, 7)) xt.push([f, fDia(f)]); }
  else { const d0 = dte(desde), paso = dias > 200 ? 2 : 1; for (let m = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); m.getTime() <= t1; m = new Date(m.getFullYear(), m.getMonth() + paso, 1)) { const f = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01`; xt.push([f, MC[m.getMonth()]]); } }
  const ejeX = xt.map(([f, l]) => `<text x="${X(f)}" y="${h - 8}" text-anchor="middle">${l}</text>`).join('');
  // La etiqueta de cada referencia va a la izquierda: lo reciente (a la derecha) es lo que más se mira.
  const rf = refs.filter(r => r.v >= a && r.v <= b).map(r => `<line class="${r.cls || 'ref'}" x1="${pad.l}" x2="${VW - pad.r}" y1="${Y(r.v)}" y2="${Y(r.v)}"/><text x="${pad.l + 4}" y="${Y(r.v) - 4}" class="lbl">${esc(r.t)}</text>`).join('');
  // La media se corta donde hay más de 5 semanas sin datos: no se inventa lo que pasó en el hueco.
  const tramos = []; pts.forEach((p, i) => { if (!i || dte(p.f) - dte(pts[i - 1].f) > 35 * 864e5) tramos.push([]); tramos[tramos.length - 1].push(i); });
  const ini = []; tramos.forEach(t => t.forEach(i => { ini[i] = t[0]; }));
  const media = pts.map((p, i) => { const w = pts.slice(Math.max(ini[i], i - 2), i + 1); return w.reduce((s, q) => s + q.v, 0) / w.length; });
  const linea = tend && pts.length >= 3 ? tramos.filter(t => t.length > 1).map(t => `<polyline points="${t.map(i => `${X(pts[i].f).toFixed(1)},${Y(media[i]).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`).join('') : '';
  const muchos = pts.length > 40;
  const marcas = pts.map(p => `<g data-tip="${esc(p.tip)}"><circle class="hit" cx="${X(p.f)}" cy="${Y(p.v)}" r="14"/>${muchos ? '' : `<circle cx="${X(p.f)}" cy="${Y(p.v)}" r="4" fill="color-mix(in srgb,${color} ${tend ? 45 : 100}%,var(--paper))" stroke="var(--paper)" stroke-width="1.5"/>`}</g>`).join('');
  const ult = pts[pts.length - 1];
  const fin = ult ? `<text class="lbl" x="${Math.min(X(ult.f), VW - pad.r - 2)}" y="${Y(tend && pts.length >= 3 ? media[media.length - 1] : ult.v) - 9}" text-anchor="end">${esc(fmt(tend && pts.length >= 3 ? media[media.length - 1] : ult.v))}</text>` : '';
  const sinTend = !tend && pts.length > 1 ? `<polyline points="${pts.map(p => `${X(p.f).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` : '';
  return `<svg class="chart2" viewBox="0 0 ${VW} ${h}" role="img" aria-label="${esc(aria)}">${vEjeY(a, b, yt, h, pad, fmt)}${ejeX}${rf}${sinTend}${marcas}${linea}${fin}</svg>`;
}
const leyendaSerie = col => `<div class="leyenda"><span><i style="background:color-mix(in srgb,${col} 45%,var(--paper));border-radius:50%"></i>Cada salida</span><span><i class="ln" style="border-top:2.5px solid ${col}"></i>Media de las 3 últimas</span></div>`;

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
function vCurvas({ series, h = 200, fmtY = v => nf(v, 0), aria }) {
  const pad = { t: 14, r: 10, b: 38, l: 38 }, xs = series.flatMap(s => s.pts.map(p => p[0])), ys = series.flatMap(s => s.pts.map(p => p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), [y0, y1] = rango(ys, .12), yt = vTicks(y0, y1, 4).filter(t => t >= y0 && t <= y1);
  const X = v => pad.l + (v - x0) / Math.max(1, x1 - x0) * (VW - pad.l - pad.r), Y = v => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b);
  const ejeX = [...new Set(xs)].sort((a, b) => a - b).map(x => `<text x="${X(x)}" y="${h - pad.b + 14}" text-anchor="middle">${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}</text>`).join('');
  const lineas = series.map(s => `<polyline points="${s.pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.dash ? 2 : 2.5}"${s.dash ? ' stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>
    ${s.pts.map(p => `<g data-tip="${esc(p[2])}"><circle class="hit" cx="${X(p[0])}" cy="${Y(p[1])}" r="14"/><circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${s.dash ? 3 : 4}" fill="${s.dash ? 'var(--paper)' : s.color}" stroke="${s.color}" stroke-width="1.5"/></g>`).join('')}`).join('');
  return `<svg class="chart2" viewBox="0 0 ${VW} ${h}" role="img" aria-label="${esc(aria)}">${vEjeY(y0, y1, yt, h, pad, fmtY)}${ejeX}
    <text x="${(pad.l + VW - pad.r) / 2}" y="${h - 4}" text-anchor="middle">Pendiente (%)</text>${lineas}</svg>`;
}

/* ===== Por terreno: suma del periodo, con medias por tiempo (como hace el conector en cada salida) ===== */
function sumaTerreno(as, peso) {
  const z = () => ({ n: 0, km: 0, min: 0, fcm: 0, fcmin: 0, desn: 0 }); const L = z(), U = z(), B = z();
  const sumar = (x, km, min, fc) => { x.n++; x.km += km; x.min += min; if (fc) { x.fcm += fc * min; x.fcmin += min; } };
  for (const a of as) { const t = a.ter; if (!t) continue;
    if (t.llano && t.llano.kmh) sumar(L, t.llano.km, t.llano.km / t.llano.kmh * 60, t.llano.fc);
    if (t.subida && t.subida.min) { sumar(U, t.subida.km, t.subida.min, t.subida.fc); U.desn += t.subida.km * t.subida.pend * 10; }
    if (t.bajada && t.bajada.kmh) { sumar(B, t.bajada.km, t.bajada.km / t.bajada.kmh * 60); B.desn += t.bajada.km * Math.abs(t.bajada.pend) * 10; } }
  const base = x => ({ n: x.n, km: x.km, kmh: x.km / (x.min / 60), fc: x.fcmin ? x.fcm / x.fcmin : null });
  const ll = L.n && L.min ? base(L) : null; if (ll && ll.fc) ll.mpl = (L.km * 1000 / L.min) / ll.fc;
  const su = U.n && U.min ? { ...base(U), vam: U.desn / (U.min / 60), pend: U.desn / (U.km * 10), wkg: wkgFisica(U.km, U.desn, U.min, peso) } : null;
  const ba = B.n && B.min ? { ...base(B), pend: B.desn / (B.km * 10) } : null;
  return { llano: ll, subida: su, bajada: ba };
}
function tablaTerreno(dep, as) {
  const T = sumaTerreno(as, (M.perfil || {}).peso), V = VEL[dep], n = x => `${nf(x.km, 0)} km en ${x.n} ${dep === 'bici' ? 'salida' : 'actividad'}${x.n === 1 ? '' : 's'}`;
  const celda = (nom, v, u) => `<div class="ter-c"><span class="n">${nom}</span><b>${v}${u ? ` <small>${u}</small>` : ''}</b></div>`;
  const fila = (nom, ico, x, celdas, extra = '') => `<div class="ter-f"><div class="ter-n"><b><i aria-hidden="true">${ico}</i>${nom}</b><span>${x ? n(x) : 'Sin tramos en este periodo'}${extra}</span></div>${x ? celdas.join('') : ''}</div>`;
  const filas = [];
  if (dep !== 'skimo') filas.push(fila('Llano', '→', T.llano, T.llano ? [celda(V.n, V.f(T.llano.kmh), V.u), celda('Pulso', T.llano.fc ? nf(T.llano.fc, 0) : '—', 'ppm'), celda('Por latido', T.llano.mpl ? nf(T.llano.mpl, 2) : '—', 'm')] : []));
  filas.push(fila('Subida', '↗', T.subida, T.subida ? [dep === 'skimo' ? celda('Velocidad', nf(T.subida.kmh, 1), 'km/h') : celda(V.n, V.f(T.subida.kmh), V.u), celda('VAM', nf(T.subida.vam, 0), 'm/h'), celda('Pulso', T.subida.fc ? nf(T.subida.fc, 0) : '—', 'ppm')] : [],
    T.subida ? ` al ${nf(T.subida.pend, 1)} %${dep === 'bici' && T.subida.wkg ? ` · ≈${nf(T.subida.wkg, 1)} W/kg estimados` : ''}` : ''));
  if (dep !== 'skimo') filas.push(fila('Bajada', '↘', T.bajada, T.bajada ? [celda(V.n, V.f(T.bajada.kmh), V.u), celda('Pendiente', nf(T.bajada.pend, 1), '%')] : []));
  return { html: `<div class="ter">${filas.join('')}</div>`, T };
}

/* ===== Un deporte: tus números por terreno, lo esencial en gráficas y "Para profundizar" ===== */
function progDep(dep) {
  const desde = insDesde(), dias = insDias();
  const todas = acts().filter(a => a.dep === dep && a.f > desde && a.min >= 15).sort((x, y) => x.f.localeCompare(y.f));
  const R = REND[dep], col = scol(dep), V = VEL[dep];
  if (todas.length < 2) return blk(pendiente(`Hay pocas ${dep === 'bici' ? 'salidas' : 'actividades'} de ${SPORTS[dep].n.toLowerCase()} en ${INS_TXT[dias]}`, 'Con dos ya te enseño tus números por terreno; con tres, tendencias. Prueba con un periodo más largo o actualiza los datos de Garmin.') + '<div class="btns"><button class="btn tonal" type="button" data-a="v-sync">Actualizar con Garmin</button></div>', 'first');
  const conTer = todas.filter(a => a.ter), sinDet = todas.length - conTer.length;
  const tot = { h: todas.reduce((s, a) => s + a.min, 0) / 60, km: todas.reduce((s, a) => s + (a.km || 0), 0), desn: todas.reduce((s, a) => s + (a.desn || 0), 0) };
  const { html: tabla } = tablaTerreno(dep, conTer);
  const numeros = blk(`${blkH(`Tus números en ${INS_TXT[dias]}`, info(`ter-${dep}`, 'Tus números por terreno', `Suma de todas tus ${dep === 'bici' ? 'salidas' : 'actividades'} del periodo, separadas por terreno en tramos de 500 m: llano por debajo del 1,5 % de pendiente, subida desde el 3 % y bajada desde el −3 %. Las medias son por tiempo. "Por latido" son los metros que recorres con cada latido en llano: si sube, vas más rápido con el mismo esfuerzo. La VAM son los metros de desnivel que subes por hora.${dep === 'bici' ? ' Los W/kg salen de la física de la subida (sin potenciómetro): son una estimación.' : ''} La bajada depende más de la pendiente y del tráfico que de tu forma.`))}
    <p class="small muted" style="margin:-4px 0 12px">${todas.length} ${dep === 'bici' ? 'salidas' : 'actividades'} · ${nf(tot.h, 0)} h · ${nf(tot.km, 0)} km${tot.desn ? ` · ${nf(tot.desn, 0)} m de desnivel` : ''}</p>
    ${conTer.length ? tabla : '<p class="muted">Aún no tengo el detalle por terreno de estas actividades: se completa al actualizar con Garmin.</p>'}
    ${sinDet && conTer.length ? `<p class="xs muted" style="margin-top:8px">${sinDet} sin analizar todavía: se completan al actualizar con Garmin.</p>` : ''}`, 'first');

  const top = [], mas = [];
  const serie = (titulo, inf, pts, o) => blk(`${vizT(titulo, inf)}<div class="viz">${vSerie({ desde, color: col, ...o, pts })}</div>${o.tend === false ? '' : leyendaSerie(col)}`);
  // Lo esencial: velocidad en llano (o ritmo), VAM en subida y horas por semana
  const pLl = conTer.filter(a => a.ter.llano && a.ter.llano.km >= 2).map(a => ({ f: a.f, v: a.ter.llano.kmh, a }));
  if (dep !== 'skimo' && pLl.length >= 2) top.push(serie(`${V.n} en llano`, info(`vll-${dep}`, `${V.n} en llano`, `Cada punto es una ${dep === 'bici' ? 'salida' : 'actividad'}: su velocidad media en los tramos llanos. La línea es la media de las tres últimas, para que una salida con viento o en grupo no engañe. Toca un punto para ver el pulso y la temperatura: con calor el pulso sube a la misma velocidad, así que en verano la eficiencia parece peor de lo que es.`),
    pLl.map(p => ({ ...p, tip: `${fDia(p.f)}: ${dep === 'correr' ? ritmo(p.v) : `${nf(p.v, 1)} km/h`} a ${p.a.ter.llano.fc || '—'} ppm (${nf(p.a.ter.llano.km, 0)} km llanos${p.a.tc != null ? `, ${nf(p.a.tc, 0)} °C` : ''})` })),
    { fmt: dep === 'correr' ? ritmoC : v => nf(v, 1), aria: `${V.n} en llano por ${dep === 'bici' ? 'salida' : 'actividad'} en ${INS_TXT[dias]}` }));
  const pSu = conTer.filter(a => a.ter.subida && a.ter.subida.km >= 1).map(a => ({ f: a.f, v: a.ter.subida.vam, a }));
  if (pSu.length >= 2) top.push(serie('Subidas: metros por hora (VAM)', info(`vam-${dep}`, 'VAM en subida', 'Metros de desnivel que subes por hora en los tramos de subida de cada salida (desde el 3 %). Es la cifra con la que se comparan los escaladores sin potenciómetro, pero depende de la pendiente: en rampas suaves sale más baja que en un puerto duro, así que compara salidas parecidas. Toca un punto para ver la pendiente, el pulso y los vatios estimados.'),
    pSu.map(p => { const s = p.a.ter.subida; return { ...p, tip: `${fDia(p.f)}: ${nf(s.vam, 0)} m/h, ${nf(s.km, 1)} km al ${nf(s.pend, 1)} % a ${s.fc || '—'} ppm${s.wkg ? `, ≈${nf(s.wkg, 1)} W/kg` : ''}` }; }),
    { fmt: v => nf(v, 0), aria: `VAM en subida por actividad en ${INS_TXT[dias]}` }));
  if (dep !== 'skimo') {
    const antes = acts().filter(a => a.dep === dep && a.f > addDays(desde, -dias) && a.f <= desde && a.ter), A = sumaPendiente(conTer), B = sumaPendiente(antes);
    const v = x => x.km / (x.min / 60), fv = dep === 'correr' ? (x => `${ritmo(x)}`) : (x => `${nf(x, 1)} km/h`);
    const pts = [...A.entries()].filter(([, x]) => x.km >= 1).sort((a, b) => a[0] - b[0]);
    const prev = [...B.entries()].filter(([p, x]) => x.km >= 1 && A.has(p) && A.get(p).km >= 1).sort((a, b) => a[0] - b[0]);
    if (pts.length >= 3) {
      const txt = p => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`;
      const series = [{ color: col, pts: pts.map(([p, x]) => [p, v(x), `${txt(p)}: ${fv(v(x))} en ${nf(x.km, 0)} km${B.get(p) && B.get(p).km >= 1 ? ` (antes ${fv(v(B.get(p)))})` : ''}`]) }];
      if (prev.length >= 2) series.push({ color: 'var(--ink-2)', dash: true, pts: prev.map(([p, x]) => [p, v(x), `${txt(p)}, periodo anterior: ${fv(v(x))} en ${nf(x.km, 0)} km`]) });
      top.push(blk(`${vizT('Velocidad según la pendiente', info(`vpend-${dep}`, 'Velocidad según la pendiente', `Tu velocidad media en cada pendiente, de bajadas (a la izquierda) a subidas (a la derecha), sumando todos los tramos de 500 m del periodo. La línea discontinua es el periodo anterior, de la misma duración: si la de ahora queda por encima en las mismas pendientes, vas más rápido en el mismo terreno. Así se compara sin que importe si has hecho rutas más llanas o más duras. El viento y el pulso no se descuentan.`))}
        <div class="viz">${vCurvas({ series, fmtY: dep === 'correr' ? ritmoC : v => nf(v, 0), aria: `${V.n} según la pendiente en ${INS_TXT[dias]}${prev.length >= 2 ? ', frente al periodo anterior' : ''}` })}</div>
        <div class="leyenda"><span><i class="ln" style="border-top:2.5px solid ${col}"></i>${cap1(INS_TXT[dias])}</span>${prev.length >= 2 ? `<span><i class="ln" style="border-top:2px dashed var(--ink-2)"></i>Periodo anterior</span>` : ''}</div>
        ${prev.length >= 2 ? `<p class="lee">${difPend(A, B)}</p>` : ''}`));
    }
  }
  const nSem = Math.min(52, Math.ceil(dias / 7)), sems = Array.from({ length: nSem }, (_, i) => addDays(SEM, (i - nSem + 1) * 7));
  const vol = sems.map(w => { const wk = (M.weeks || []).find(x => x[0] === w); return [fDia(w), ((wk && wk[1][dep]) || 0) / 60, w === SEM]; });
  const vy = niceMax(Math.max(...vol.map(v => v[1]), 1));
  top.push(blk(`${vizT('Horas por semana', info(`vol-${dep}`, 'Horas por semana', `Horas de ${SPORTS[dep].n.toLowerCase()} cada semana. La de esta semana va más clara porque aún no ha acabado.`))}
    <div class="viz">${vBarras({ datos: vol, y0: 0, y1: vy, ticks: vTicks(0, vy), h: 160, cada: Math.ceil(nSem / 6), color: d => d[2] ? `color-mix(in srgb,${col} 45%,var(--paper))` : col,
      tip: d => `Semana del ${d[0]}: ${nf(d[1])} h${d[2] ? ' (en curso)' : ''}`, etiqueta: nSem <= 13 ? (d => d[1] ? nf(d[1]) : '') : null, aria: 'Horas por semana', fmt: v => nf(v, 1) })}</div>`));

  // Para profundizar
  const fondo = a => ['rec', 'fondo'].includes(tipoAct(a));
  const pEf = conTer.filter(a => fondo(a) && a.ter.llano && a.ter.llano.mpl).map(a => ({ f: a.f, v: a.ter.llano.mpl, a }));
  if (dep !== 'skimo' && pEf.length >= 2) mas.push(serie('Eficiencia: metros por latido en llano', info(`mpl-${dep}`, 'Metros por latido', 'Los metros que recorres en llano con cada latido: velocidad dividida por pulso. Es la idea del factor de eficiencia de Intervals.icu o TrainingPeaks, pero con velocidad porque no hay potenciómetro. Si sube, tu motor aeróbico mejora. Solo cuenta las salidas suaves y constantes (fondos): con series o con un grupo, el dato no sirve. En una misma ruta repetida sale casi igual aunque cambie el ritmo, pero entre rutas distintas varía mucho más (viento, tráfico, grupo): mira la línea, no un punto.'),
    pEf.map(p => ({ ...p, tip: `${fDia(p.f)}: ${nf(p.v, 2)} m por latido (${nf(p.a.ter.llano.kmh, 1)} km/h a ${p.a.ter.llano.fc} ppm${p.a.tc != null ? `, ${nf(p.a.tc, 0)} °C` : ''})` })), { fmt: v => nf(v, 2), aria: 'Metros por latido en llano por actividad' }));
  const pts = todas.map(a => [fDia(a.f), R.fc(a), R.v(a)]).filter(p => p[1] && p[2]);
  if (pts.length >= 3) { const [xa, xb] = rango(pts.map(p => p[1])), [ya, yb] = rango(pts.map(p => p[2])), n = pts.length;
    const mejor = pts.reduce((m, p, i) => p[2] / p[1] > pts[m][2] / pts[m][1] ? i : m, 0);
    mas.push(blk(`${vizT(`${R.n} frente a pulso`, info(`ve-${dep}`, `${R.n} frente a pulso`, `Cada punto es una ${dep === 'bici' ? 'salida' : 'actividad'}: a la derecha, más pulso; arriba, más ${R.n.toLowerCase()}. Más oscuro, más reciente. Mejoras si los puntos recientes quedan arriba y a la izquierda: lo mismo con menos pulso. ${R.nota}`))}
      <div class="viz">${vPuntos({ datos: pts, x0: xa, x1: xb, y0: ya, y1: yb, xt: vTicks(xa, xb, 4).filter(t => t >= xa && t <= xb), yt: vTicks(ya, yb, 4).filter(t => t >= ya && t <= yb), xl: 'Pulso medio (ppm)', yl: R.u,
        fill: (d, i) => `color-mix(in srgb,${col} ${30 + i / Math.max(1, n - 1) * 70}%,var(--paper))`, tip: d => `${d[0]}: ${R.tip(d[2])} a ${d[1]} ppm`, aria: `${R.n} frente a pulso medio en ${n} actividades`, etiquetas: [n - 1, mejor], fmtX: v => nf(v, 0), fmtY: v => nf(v, dep === 'skimo' ? 0 : 1) })}</div>
      <p class="lee">Tu mejor relación: ${pts[mejor][0]}, ${R.tip(pts[mejor][2])} a ${pts[mejor][1]} ppm.</p>`)); }
  const pDc = todas.filter(a => a.dc != null && a.min >= 60 && fondo(a)).map(a => ({ f: a.f, v: a.dc, a }));
  if (dep !== 'skimo' && pDc.length >= 2) mas.push(serie('Desacople en las salidas largas', info(`dc-${dep}`, 'Desacople', 'Cuánto empeora la relación entre velocidad y pulso de la primera mitad a la segunda, medido solo en llano (método de Joe Friel, el mismo que usan Intervals.icu y TrainingPeaks). Por debajo del 5 % aguantas bien el ritmo; por encima, te falta fondo para esa duración o fuiste deprisa al principio. Solo fondos de una hora o más: en salidas con series, repechos o grupo salen cifras sin sentido (de −15 % a +18 %).'),
    pDc.map(p => ({ ...p, tip: `${fDia(p.f)}: ${p.v > 0 ? '+' : ''}${nf(p.v, 1)} % en ${dur(p.a.min)}` })), { fmt: v => `${nf(v, 0)} %`, tend: false, refs: [{ v: 5, t: 'Límite 5 %', siempre: true }], aria: 'Desacople por salida larga' }));
  const fsMax = i => { const v = todas.map(a => a.fs && a.fs[i]).filter(Boolean); return v.length ? Math.max(...v) : null; };
  const curva = [['5 min', fsMax(0)], ['20 min', fsMax(1)], ['60 min', fsMax(2)]].filter(c => c[1]);
  if (curva.length >= 2) { const lthr = (M.perfil && M.perfil.lthr) || null, cy0 = Math.floor((Math.min(...curva.map(c => c[1])) - 15) / 10) * 10, cy1 = Math.ceil((Math.max(...curva.map(c => c[1]), lthr || 0) + 5) / 10) * 10;
    mas.push(blk(`${vizT('Tu mejor pulso sostenido', info(`fs-${dep}`, 'Pulso máximo sostenido', `El pulso medio más alto que has aguantado durante 5, 20 y 60 minutos en ${INS_TXT[dias]}. Es como la curva de pulso de Intervals.icu. El de 20 minutos se acerca a tu umbral${lthr ? ` (${lthr} ppm según Garmin)` : ''}: si sube sin que suba tu umbral, has apretado más; si baja, no has hecho esfuerzos largos y fuertes en este periodo.`))}
      <div class="viz">${vBarras({ datos: curva, y0: cy0, y1: cy1, ticks: vTicks(cy0, cy1, 4).filter(t => t >= cy0 && t <= cy1), h: 160, color: () => col, refs: lthr ? [{ v: lthr, t: `Umbral ${lthr}` }] : [], tip: d => `${d[0]}: ${d[1]} ppm`, etiqueta: d => String(d[1]), aria: 'Pulso medio máximo durante 5, 20 y 60 minutos', fmt: v => nf(v, 0) })}</div>`)); }
  const pBa = conTer.filter(a => a.ter.bajada && a.ter.bajada.km >= 1).map(a => ({ f: a.f, v: a.ter.bajada.kmh, a }));
  if (dep === 'bici' && pBa.length >= 2) mas.push(serie('Velocidad en bajada', info('baj', 'Velocidad en bajada', 'Velocidad media en los tramos de bajada (desde el −3 %). Depende sobre todo de la pendiente, del tráfico y de la técnica, no de tu forma: es para curiosear, no para medir si mejoras.'),
    pBa.map(p => ({ ...p, tip: `${fDia(p.f)}: ${nf(p.v, 1)} km/h al ${nf(p.a.ter.bajada.pend, 1)} %` })), { fmt: v => nf(v, 0), aria: 'Velocidad en bajada por salida' }));
  // Disciplina en los fondos y zonas por semana
  const L = ((M.perfil && M.perfil.lthr) || 170) - (dep === 'bici' ? 5 : 0), techo = Math.round(L * .86), z2 = Math.round(L * .81);
  const ult = todas.slice(-16).filter(a => a.fc);
  if (ult.length >= 3) { const fcs = ult.map(a => a.fc), dy0 = Math.floor(Math.min(...fcs, z2) / 10) * 10 - 5, dy1 = Math.ceil(Math.max(...fcs, techo) / 10) * 10 + 5;
    const fondos = ult.filter(a => ['rec', 'fondo'].includes(tipoAct(a))), dentro = fondos.filter(a => a.fc <= techo).length;
    mas.push(blk(`${vizT('Disciplina en los fondos', info(`dis-${dep}`, 'Disciplina en los fondos', `Pulso medio de cada salida. En los fondos (en color) el objetivo es quedarte por debajo del techo de ${techo} ppm; ${z2} ppm es el centro de tu zona 2. Salen de tu umbral de Garmin (${L} ppm). En gris, las salidas de otro tipo.`))}
      <div class="viz">${vBarras({ datos: ult.map(a => [fDia(a.f), a.fc, ['rec', 'fondo'].includes(tipoAct(a))]), y0: dy0, y1: dy1, ticks: vTicks(dy0, dy1, 4).filter(t => t >= dy0 && t <= dy1), h: 190, cada: Math.ceil(ult.length / 6),
        color: d => d[2] ? col : 'var(--line-3)', tip: d => `${d[0]}: ${d[1]} ppm${d[2] ? ', fondo' : ''}`, refs: [{ v: techo, t: `Techo ${techo}` }, { v: z2, t: `Z2 ${z2}`, cls: 'ref2' }], aria: 'Pulso medio por salida', fmt: v => nf(v, 0) })}</div>
      <p class="lee">${fondos.length ? `${dentro} de ${fondos.length} fondos por debajo del techo.` : 'En estas salidas no hay fondos.'}</p>`)); }
  const zon = sems.map(w => { const z = [0, 0, 0]; acts().filter(a => a.dep === dep && weekOf(a.f) === w && a.z).forEach(a => a.z.forEach((v, k) => { z[k] += v; })); return [fDia(w), z.map(v => v / 60)]; });
  if (zon.filter(c => c[1].some(Boolean)).length >= 3) mas.push(blk(`${vizT('Suave, medio y duro por semana', info(`zon-${dep}`, 'Suave, medio y duro por semana', 'Horas de cada semana según tu pulso: suave (por debajo del 90 % de tu umbral), medio y duro. En los aficionados que mejoran, cerca del 80 % es suave.'))}
    <div class="viz">${vApiladas({ cols: zon, claves: ['suave', 'medio', 'duro'], colores: [`color-mix(in srgb,${col} 35%,var(--paper))`, `color-mix(in srgb,${col} 65%,var(--paper))`, col], tip: c => `Semana del ${c[0]}: ${nf(c[1][0])} h suaves, ${nf(c[1][1])} h medias, ${nf(c[1][2])} h duras`, aria: 'Horas suaves, medias y duras por semana', fmt: v => nf(v, 1), cada: Math.ceil(nSem / 6) })}</div>
    <div class="leyenda"><span><i style="background:color-mix(in srgb,${col} 35%,var(--paper))"></i>Suave</span><span><i style="background:color-mix(in srgb,${col} 65%,var(--paper))"></i>Medio</span><span><i style="background:${col}"></i>Duro</span></div>`));
  mas.push(blk(`${blkH('Durabilidad y combustible', info('pend', 'Lo que falta por guardar', 'La stamina mínima de cada salida larga y los gramos de hidrato por hora que tomaste los calcula tu Claude al analizar una salida, pero aún no se guardan en myCoach. Cuando se guarden, saldrán aquí con su gráfica.'))}
    <p class="muted">Aún no se guardan. Mientras, pídeselos a tu Claude.</p><div class="btns"><button class="btn tonal" type="button" data-a="v-encargo" data-v="4">Preguntárselo a Claude</button></div>`));
  return `${numeros}<div class="grid2">${top.join('')}</div>
    <details class="mas"${S.insMas ? ' open' : ''}><summary data-a="ins-mas"><span>Para profundizar</span><small>Eficiencia, desacople, pulso, bajadas y zonas</small></summary>
      ${bloqueMismaRuta(dep)}<div class="grid2">${mas.join('')}</div></details>`;
}

/* Dos salidas son "la misma ruta" si empiezan a menos de 500 m y la distancia se parece (±8 %) */
function mismaRuta(dep) {
  const rutas = (DSET && DSET.rutas) || {}; const pt = a => { const p = rutas[a.id]; if (!p) return null; try { const d = decodePoly(p); return d && d[0]; } catch (e) { return null; } };
  const desde = insDesde(), as = acts().filter(a => a.dep === dep && a.km > 3 && a.f > desde && rutas[a.id]).slice(0, 40);
  for (let i = 0; i < as.length; i++) { const a = as[i], pa = pt(a); if (!pa) continue;
    for (let j = i + 1; j < as.length; j++) { const b = as[j], pb = pt(b); if (!pb) continue;
      if (Math.abs(a.km - b.km) / a.km < .08 && hav(pa, pb) < .5) return [b, a]; } }
  return null;
}
function bloqueMismaRuta(dep) {
  const par = mismaRuta(dep); if (!par) return '';
  const [a, b] = par, mpl = x => x.fc && x.min ? x.km * 1000 / (x.min * x.fc) : null;
  const filas = [
    ['FC media', 'ppm', a.fc, b.fc, v => nf(v, 0), (x, y) => y < x],
    ['Metros por latido', '', mpl(a), mpl(b), v => nf(v, 2), (x, y) => y > x],
    [REND[dep].n, REND[dep].u, REND[dep].v(a), REND[dep].v(b), v => nf(v, dep === 'skimo' ? 0 : 1), (x, y) => y > x],
    ['Tiempo', '', a.min, b.min, v => dur(v), (x, y) => y < x],
  ].filter(f => f[2] != null && f[3] != null);
  return blk(`${blkH(`Misma ruta: ${fDia(a.f)} y ${fDia(b.f)}`, info('misma', 'Misma ruta', 'Comparar una salida con otra por el mismo recorrido es la forma más honesta de ver si mejoras: mismo terreno, distinta forma. Ojo con el viento, el calor o ir en grupo, que también cuentan.'))}
    <p class="small muted" style="margin:-8px 0 12px">${esc(b.lugar)}, ${nf(b.km)} km</p>
    <div class="tot">${filas.map(([n, u, x, y, fmt, mejor]) => `<div><span class="n">${n}${u ? ` (${u})` : ''}</span><b>${fmt(x)} <span class="muted" style="font-weight:500">→</span> ${fmt(y)}</b>${mejor(x, y) ? '<span class="d si">↑ Mejor</span>' : x === y ? '<span class="d">Igual</span>' : '<span class="d">Peor</span>'}</div>`).join('')}</div>`);
}


/* ===== General: dónde estás (comparado con otra gente), cómo evoluciona, cuánto entrenas y tu peso ===== */
const ESC_KEYS = ['motor', 'fondo', 'subida', 'volumen', 'equilibrio'];
function dondeEstas() {
  const d = dims(), nota = forma(), bici = S.sports.includes('bici') || acts().some(a => a.dep === 'bici');
  const filas = ESC_KEYS.filter(k => k !== 'subida' || bici).map(k => { const x = d[k];
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
  const una = (clave, titulo, inf, fmt, refs = []) => {
    const todo = serieGarmin(clave), pts = todo.filter(p => p.f >= desde); if (!todo.length) return;
    const ult = todo[todo.length - 1], prim = pts[0];
    const lee = pts.length >= 2 && prim !== ult ? `${fmt(ult.v)} ahora; ${fmt(prim.v)} el ${fDia(prim.f)}.` : `${fmt(ult.v)} (${fDia(ult.f)}).`;
    const ps = pts.length >= 2 ? pts : todo.slice(-2);
    out.push(blk(`${vizT(titulo, inf)}${ps.length >= 2 ? `<div class="viz">${vSerie({ pts: ps.map(p => ({ ...p, tip: `${fDia(p.f)}: ${fmt(p.v)}` })), desde: pts.length >= 2 ? desde : ps[0].f, tend: false, h: 160, fmt, refs, aria: `${titulo} en ${INS_TXT[dias]}` })}</div>` : ''}<p class="lee">${lee}</p>`));
  };
  una('es', 'Endurance Score', info('ev-es', 'Endurance Score', 'Lo calcula Garmin con todas tus actividades de resistencia, de cualquier deporte: mide cuánto aguantas esfuerzos largos. Las líneas marcan sus niveles: Entrenado desde 5.800, Muy entrenado desde 6.600 y Experto desde 7.300.'), v => nf(v, 0), [{ v: 5800, t: 'Entrenado' }, { v: 6600, t: 'Muy entrenado' }, { v: 7300, t: 'Experto' }]);
  una('vo2', 'VO2máx', info('ev-vo2', 'VO2máx', 'El oxígeno que tu cuerpo puede usar por minuto y kilo: el tamaño de tu motor. Garmin lo estima en carreras con pulso y GPS. Sube despacio: un punto en unos meses ya es mucho.'), v => nf(v, 1));
  if (serieGarmin('vo2b').length) una('vo2b', 'VO2máx en bici', info('ev-vo2b', 'VO2máx en bici', 'El VO2máx que estima Garmin en bici. Necesita potenciómetro.'), v => nf(v, 1));
  una('hill', 'Hill Score', info('ev-hill', 'Hill Score', 'Lo calcula Garmin con tus carreras y caminatas en cuesta: fuerza y resistencia subiendo. No usa la bici.'), v => nf(v, 0));
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
    <div class="viz">${vApiladas({ cols, claves: deps, colores: deps.map(scol), tip: c => `Semana del ${c[0]}: ${deps.map((k, i) => c[1][i] ? `${SPORTS[k].n} ${nf(c[1][i])} h` : '').filter(Boolean).join(', ') || 'nada'}`, aria: `Horas por semana y deporte en ${INS_TXT[dias]}`, fmt: v => nf(v, 1), cada: Math.ceil(nSem / 6) })}</div>
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
  return `${dondeEstas()}${evolucionGarmin()}<div class="grid2">${horasDeportes()}${bloquePeso(insDesde())}</div>
    ${carga ? `<div class="grid2">${fresc}${carga}</div>` : fresc}
    <div class="btns" style="margin:8px 0 24px"><button class="link" type="button" data-a="push" data-v="numeros">Tus umbrales y predicciones</button></div>`;
}

function tabProgresoV1() {
  const deps = DEP_PROG.filter(d => S.sports.includes(d) || acts().some(a => a.dep === d && a.f > addDays(HOY, -365)));
  if (!V.prog || (V.prog !== 'forma' && !deps.includes(V.prog))) V.prog = 'forma';
  const segs = [['forma', 'General'], ...deps.map(d => [d, SPORTS[d].n])], rg = String(insDias());
  return { title: 'Insights', html: `<div class="v1"><header class="v1-h"><h1>Insights</h1></header>
    <div class="seg-row ins-ctl">${segs.length > 1 ? `<div class="seg2" role="group" aria-label="Qué ver">${segs.map(([k, l]) => `<button type="button" data-a="v-prog" data-v="${k}" aria-pressed="${V.prog === k}">${l}</button>`).join('')}</div>` : ''}
      <div class="seg2" role="group" aria-label="Periodo">${RANGOS_INS.map(([v, l]) => `<button type="button" data-a="ins-rango" data-v="${v}" aria-pressed="${rg === v}">${l}</button>`).join('')}</div></div>
    ${V.prog === 'forma' ? progForma() : progDep(V.prog)}</div>` };
}
Object.assign(ACTIONS, {
  'v-sync': () => sync(true),
  'ins-rango': el => { S.insRango = el.dataset.v; save(); render(); },
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
