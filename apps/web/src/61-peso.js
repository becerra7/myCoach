/* ===== Tu peso: lo que hay en Garmin (lo que le dices a Claude o tu báscula), con calma =====
   El conector lo lee de Garmin (peso_historico). Se ve en Forma y se esconde en Ajustes.
   Sin colores de bien o mal: es tendencia, no juicio. */
const PZ = { datos: undefined }; // undefined (sin pedir) · 'cargando' · null (error) · { pesajes, resumen }
const RANGOS_PESO = [['90', '3 meses'], ['365', '1 año'], ['todo', 'Todo']];

async function cargarPeso(fresco) {
  if (PZ.datos === 'cargando') return;
  const fuente = fuenteDatos(); if (fuente === 'espera') { cuandoHayaConector(); return; }
  PZ.fuente = fuente;
  if (fuente === 'demo') { PZ.datos = pesoDemo(); return; }
  PZ.datos = 'cargando';
  try { PZ.datos = await coachCall('peso_historico', { dias: 1830 }, fresco); } catch (e) { PZ.datos = null; }
  render();
}

// Modo demo: unos meses de pesajes de ejemplo, con huecos como en la vida real.
function pesoDemo() {
  const pesajes = []; let kg = 73.4;
  for (let i = 200; i >= 0; i--) {
    kg += (Math.sin(i * 1.7) * 0.25) - 0.008;
    if (i % 3 !== 1 && i % 11 !== 4) pesajes.push({ fecha: addDays(HOY, -i), kg: Math.round(kg * 10) / 10 });
  }
  const ult = pesajes[pesajes.length - 1]; const ult7 = pesajes.filter(p => p.fecha > addDays(ult.fecha, -7));
  const ref = d => { const r = [...pesajes].reverse().find(p => p.fecha <= addDays(ult.fecha, -d)); return r ? Math.round((ult.kg - r.kg) * 10) / 10 : null; };
  return { demo: true, pesajes, resumen: { ultimo: ult, media_7_dias: Math.round(ult7.reduce((a, p) => a + p.kg, 0) / ult7.length * 10) / 10, cambio_30_dias: ref(30), cambio_90_dias: ref(90) } };
}

const kgTxt = v => `${nf(v, 2)} kg`;
const cambioTxt = (v, cuando) => v == null ? '' : v === 0 ? `igual que hace ${cuando}` : `${v > 0 ? '+' : '−'}${nf(Math.abs(v), 1)} kg en ${cuando}`;

/** Media de los pesajes de los 7 días que acaban en cada uno: la línea de tendencia. */
function tendenciaPeso(ps) {
  return ps.map(p => { const v = ps.filter(q => q.fecha <= p.fecha && q.fecha > addDays(p.fecha, -7)); return v.reduce((a, q) => a + q.kg, 0) / v.length; });
}

/* Puntos: cada pesaje. Línea: la media de 7 días. Eje x por fecha real (los huecos se ven). */
function chartPeso(ps, desde) {
  const W = 600, H = 300, pl = 44, pr = 56, pt = 14, pb = 30;
  const t0 = dte(desde).getTime(), t1 = dte(HOY).getTime(); const tx = f => dte(f).getTime();
  const X = f => pl + (W - pl - pr) * ((tx(f) - t0) / Math.max(1, t1 - t0));
  const kgs = ps.map(p => p.kg); const lo = Math.floor(Math.min(...kgs) - 0.5), hi = Math.ceil(Math.max(...kgs) + 0.5);
  const Y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const tend = tendenciaPeso(ps); const ult = ps[ps.length - 1];
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Peso del ${fDia(ps[0].fecha)} al ${fDia(ult.fecha)}: de ${kgTxt(ps[0].kg)} a ${kgTxt(ult.kg)}, ${ps.length} pesajes">`;
  for (const t of [lo, (lo + hi) / 2, hi]) s += `<line class="g" x1="${pl}" x2="${W - pr}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${pl - 6}" y="${Y(t) + 4}" text-anchor="end">${nf(t, t % 1 ? 1 : 0)}</text>`;
  // Marcas de mes (o de año, si el rango es largo), como mucho seis.
  const dias = (t1 - t0) / 864e5; const paso = dias > 800 ? 12 : dias > 200 ? 2 : 1;
  const d0 = dte(desde); let m = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); let n = 0;
  while (m.getTime() <= t1) {
    if (m.getMonth() % paso === 0 || paso === 1) { const f = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01`; s += `<text class="ax" x="${X(f)}" y="${H - 6}" text-anchor="middle">${paso === 12 ? m.getFullYear() : MC[m.getMonth()]}</text>`; n++; }
    m = new Date(m.getFullYear(), m.getMonth() + (paso === 12 ? 12 : 1), 1); if (n > 8) break;
  }
  s += ps.map(p => `<circle cx="${X(p.fecha).toFixed(1)}" cy="${Y(p.kg).toFixed(1)}" r="2.5" class="pz-pt"/>`).join('');
  s += `<polyline points="${ps.map((p, i) => `${X(p.fecha).toFixed(1)},${Y(tend[i]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--tint)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  s += `<circle cx="${X(ult.fecha)}" cy="${Y(ult.kg)}" r="5" fill="var(--tint)" stroke="var(--card)" stroke-width="2"/><text class="lbl" x="${X(ult.fecha) + 8}" y="${Y(ult.kg) + 4}">${nf(ult.kg, 2)}</text>`;
  // Marcador del pesaje señalado: línea vertical y punto con anillo (lo mueve el manejador común de los gráficos).
  s += `<g class="sel" visibility="hidden" aria-hidden="true"><line class="sel-l" x1="0" x2="0" y1="${pt}" y2="${H - pb}"/><circle class="sel-c" r="9" cx="0" cy="0"/></g>`;
  // Zonas de toque: de punto medio a punto medio, para que el más cercano responda.
  ps.forEach((p, i) => {
    const a = i ? (X(ps[i - 1].fecha) + X(p.fecha)) / 2 : pl, b = i < ps.length - 1 ? (X(p.fecha) + X(ps[i + 1].fecha)) / 2 : W - pr;
    s += `<rect class="hit" x="${a.toFixed(1)}" y="${pt}" width="${Math.max(1, b - a).toFixed(1)}" height="${H - pt - pb}" data-cx="${X(p.fecha).toFixed(1)}" data-cy="${Y(p.kg).toFixed(1)}" data-tip="${esc(`${fDia(p.fecha)}: ${kgTxt(p.kg)} · media ${kgTxt(Math.round(tend[i] * 10) / 10)}`)}"/>`;
  });
  return `<div class="chart pz-chart">${s}</svg><div class="tip"></div></div>`;
}

function cardPeso() {
  if (S.verPeso === false) return '';
  // Si cambia de dónde salen los datos (conector listo, o modo demo ↔ vivo), se vuelven a leer.
  if (PZ.datos !== undefined && PZ.datos !== 'cargando' && fuenteDatos() !== 'espera' && PZ.fuente !== fuenteDatos()) PZ.datos = undefined;
  if (PZ.datos === undefined) cargarPeso();
  const d = PZ.datos; const cab = extra => `<div class="act-h"><h2 class="card-t" id="peso-t">Tu peso</h2>${extra || ''}</div>`;
  let cuerpo;
  if (d === undefined || d === 'cargando') cuerpo = '<p class="small muted" role="status">Leyendo tus pesajes de Garmin…</p>';
  else if (d === null) cuerpo = '<p class="small">No he podido leer tu peso de Garmin. Vuelve a probar en un momento.</p><div class="btns"><button class="btn tonal" type="button" data-a="peso-recargar">Volver a probar</button></div>';
  else if (!d.pesajes || !d.pesajes.length) cuerpo = '<p class="small">Aún no hay pesajes en tu Garmin. Dile a Claude lo que pesas por la mañana, o pásale tu histórico, y aparecerá aquí.</p>';
  else {
    const r = d.resumen; const rango = S.pesoRango || '365';
    const desde = rango === 'todo' ? d.pesajes[0].fecha : [addDays(HOY, -(+rango)), d.pesajes[0].fecha].sort()[1];
    const ps = d.pesajes.filter(p => p.fecha >= desde);
    const viejo = r.ultimo.fecha < addDays(HOY, -14);
    cuerpo = `<div class="pz-hoy"><span class="pz-v">${nf(r.ultimo.kg, 2)} <small>kg</small></span><span class="small muted">${r.ultimo.fecha === HOY ? 'Hoy' : `El ${fDia(r.ultimo.fecha)}`}${r.media_7_dias ? ` · media de 7 días ${kgTxt(r.media_7_dias)}` : ''}</span>
        ${r.cambio_30_dias != null || r.cambio_90_dias != null ? `<span class="small">${[cambioTxt(r.cambio_30_dias, '30 días'), cambioTxt(r.cambio_90_dias, '3 meses')].filter(Boolean).join(' · ')}</span>` : ''}</div>
      <div class="seg" role="group" aria-label="Periodo">${RANGOS_PESO.map(([v, l]) => `<button type="button" data-a="peso-rango" data-v="${v}" aria-pressed="${rango === v}">${l}</button>`).join('')}</div>
      ${ps.length >= 2 ? chartPeso(ps, desde) : '<p class="small muted">Con dos pesajes en este periodo ya sale la gráfica.</p>'}
      <p class="xs">Puntos: cada pesaje. Línea: la media de 7 días, que es la que cuenta: el peso de un día sube y baja con el agua y la comida.</p>
      <details class="pz-tabla"><summary>Ver los pesajes</summary><ul>${ps.slice().reverse().slice(0, 60).map(p => `<li><span>${fDia(p.fecha)}</span><b>${kgTxt(p.kg)}</b></li>`).join('')}</ul></details>
      ${viejo ? '<p class="small muted">Hace más de dos semanas del último pesaje. Cuando te peses, díselo a Claude.</p>' : ''}`;
  }
  return `<section class="card b-full stack" style="gap:12px" aria-labelledby="peso-t">${cab(d && d.demo ? simTag('Ejemplo') : '')}${cuerpo}</section>`;
}

Object.assign(ACTIONS, {
  'peso-rango': el => { S.pesoRango = el.dataset.v; save(); render(); },
  'peso-recargar': () => { PZ.datos = undefined; cargarPeso(true); },
});
