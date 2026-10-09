/* ===== v1 · Comer: ¿cómo como día a día y cómo afecta a mi peso? =====
   Todo en cuartos de plato (la medida con la que registras con tu Claude), sin calorías.
   El objetivo sale de la carga de cada día, así comida y entreno van de la mano. */

function tabComerV1() {
  const o = objetivosComida(HOY), sum = sumaComida(HOY), falta = o.hidrato[0] - sum.c;
  const titular = !sum.ms.length ? 'Aún no has registrado nada hoy' : falta > 0 ? `Te ${falta === 1 ? 'falta' : 'faltan'} ${qTxt(falta)} de hidrato` : sum.c > o.hidrato[1] ? `Llevas ${qTxt(sum.c - o.hidrato[1])} de hidrato de más` : 'Hidrato en objetivo';
  const s = sesion(HOY);
  const porque = `${o.cg.n} (${esc(o.cg.txt)}): entre ${nf(o.hidrato[0])} y ${nf(o.hidrato[1])} cuartos de hidrato y ${o.proteina[0]}-${o.proteina[1]} de proteína.${sum.p < o.proteina[0] && sum.ms.length ? ` De proteína llevas ${qTxt(sum.p)}.` : ''}`;
  const durante = s && SPORTS[s.dep]?.cardio && s.t !== 'descanso' && !s.a
    ? (s.min >= 90 ? `Para ${esc(s.d)}: 60-90 g de hidrato por hora desde la segunda hora (geles, barritas o bebida).` : 'La sesión de hoy dura menos de 90 min: con agua basta.')
    : 'Hoy no hay entreno largo.';
  return { title: 'Comer', html: `<div class="v1"><div class="cols"><div class="col">
      <section class="decision" aria-labelledby="com-t"><p class="fecha">${cap1(fLarga(HOY))}${S.modo === 'demo' ? '<span class="demo-tag">Ejemplo</span>' : ''}</p>
        <h1 id="com-t" style="font-size:clamp(34px,9.5cqi,56px)">${titular}</h1><p class="porque">${porque}</p>
        <div class="btns"><button class="btn fill" type="button" data-a="v-encargo" data-v="1">Registrar con Claude</button><button class="link" type="button" data-a="meal-add">Añadir a mano</button></div></section>
      ${bloqueDia(false)}
      ${bloqueMenus()}
      ${blk(`${blkH('Durante el entreno', info('durante', 'Comer durante el entreno', 'En salidas de más de 90 minutos, a partir de la segunda hora conviene tomar 60-90 g de hidrato por hora. Lo que tomas de verdad en cada salida lo guardará tu Claude al analizarla, y saldrá en Insights como combustible.'))}<p>${durante}</p>`)}
    </div><div class="col">
      ${historicoComida()}
      ${blk(`${blkH('Peso')}<p>Tu peso y su tendencia están en Insights, junto a tu forma.</p><div class="btns"><button class="link" type="button" data-a="v-prog-ir" data-v="forma">Ver mi peso en Insights</button></div>`)}
    </div></div></div>` };
}

/* Hidrato por día de las dos últimas semanas frente al mínimo de ese día según su carga */
function historicoComida() {
  const dias = Array.from({ length: 14 }, (_, i) => addDays(HOY, i - 13));
  const filas = dias.map(f => { const o = objetivosComida(f), x = sumaComida(f); return { f, k: o.cg.k, min: o.hidrato[0], c: x.c, p: x.p, n: x.ms.length }; });
  const con = filas.filter(r => r.n); if (con.length < 2) return blk(`${blkH('Cómo comes según entrenas')}${pendiente('Aún hay pocos días registrados', 'Con dos o tres comidas al día durante unos días verás aquí si comes según la carga de cada día.')}`);
  const h = 200, pad = { t: 12, r: 6, b: 34, l: 30 }, n = filas.length, bw = (VW - pad.l - pad.r) / n, gap = bw * .3, y1 = Math.max(8, Math.ceil(Math.max(...filas.map(r => Math.max(r.c, r.min + 1)))));
  const Y = v => pad.t + (1 - v / y1) * (h - pad.t - pad.b), L = { suave: 'S', medio: 'M', duro: 'D' };
  const cuerpo = filas.map((r, i) => { const x = pad.l + i * bw + gap / 2, w = bw - gap, corto = r.n && r.c < r.min * .9, d = dte(r.f);
    return `<g data-tip="${esc(`${fDia(r.f)}, ${r.k === 'duro' ? 'día duro' : r.k === 'medio' ? 'día moderado' : 'día suave'}: ${r.n ? `${qTxt(r.c)} de hidrato, mínimo ${nf(r.min)}` : 'sin registrar'}`)}"><rect class="hit" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${h - pad.t - pad.b}"/>
      ${r.n ? vBar(x, Y(0), Y(r.c), w, corto ? 'var(--warn)' : 'var(--ink-2)') : ''}<line x1="${x - 2}" x2="${x + w + 2}" y1="${Y(r.min)}" y2="${Y(r.min)}" stroke="var(--ink)" stroke-width="2"/></g>
      <text x="${x + w / 2}" y="${h - 20}" text-anchor="middle">${d.getDate()}</text><text x="${x + w / 2}" y="${h - 6}" text-anchor="middle" class="${r.k === 'duro' ? 'lbl' : ''}">${L[r.k]}</text>`; }).join('');
  const cortos = con.filter(r => r.c < r.min * .9), duros = con.filter(r => r.k === 'duro');
  const lee = cortos.length ? `${cortos.length === 1 ? 'Un día' : `${cortos.length} días`} te quedaste corto de hidrato${duros.some(r => r.c < r.min * .9) ? ', sobre todo en días duros' : ''}.` : 'Comes según entrenas: ningún día te quedaste corto.';
  return blk(`${vizT('Cómo comes según entrenas', info('hist', 'Cómo comes según entrenas', 'Cada barra es el hidrato que registraste ese día, en cuartos de plato; la raya, el mínimo que pedía según su carga. En naranja, los días que te quedaste corto. Debajo de cada día: D duro, M moderado, S suave.'))}
    <div class="viz"><svg class="chart2" viewBox="0 0 ${VW} ${h}" role="img" aria-label="Hidrato por día de las dos últimas semanas frente al mínimo de cada día">${vEjeY(0, y1, vTicks(0, y1), h, pad, v => nf(v, 0))}${cuerpo}</svg></div>
    <div class="leyenda"><span><i style="background:var(--ink-2)"></i>Comido</span><span><i class="ln" style="border-top-style:solid"></i>Mínimo del día</span><span><i style="background:var(--warn)"></i>Por debajo</span></div>
    <p class="lee">${lee}</p>`);
}

/* Peso: los pesajes y la media de 7 días (la que cuenta). Vive en Insights, que le pasa el inicio de su periodo. */
function bloquePeso(desdeIns) {
  if (PZ.datos !== undefined && PZ.datos !== 'cargando' && fuenteDatos() !== 'espera' && PZ.fuente !== fuenteDatos()) PZ.datos = undefined;
  if (PZ.datos === undefined) cargarPeso();
  const d = PZ.datos; let cuerpo;
  if (d === undefined || d === 'cargando') cuerpo = '<p class="muted" role="status">Leyendo tus pesajes de Garmin…</p>';
  else if (d === null) cuerpo = '<p>No he podido leer tu peso de Garmin.</p><div class="btns"><button class="btn tonal" type="button" data-a="peso-recargar">Volver a probar</button></div>';
  else if (!d.pesajes?.length) cuerpo = '<p class="muted">Aún no hay pesajes. Dile a tu Claude lo que pesas por la mañana y aparecerá aquí.</p>';
  else {
    const r = d.resumen;
    const desde = [desdeIns, d.pesajes[0].fecha].sort()[1], ps = d.pesajes.filter(p => p.fecha >= desde);
    cuerpo = `<div class="tot" style="margin-bottom:12px"><div><span class="n">Media de 7 días</span><b>${r.media_7_dias ? nf(r.media_7_dias, 1) : nf(r.ultimo.kg, 1)} <small style="font-size:15px">kg</small></b></div>
      <div><span class="n">Cambio</span><b style="font-size:22px">${cambioTxt(r.cambio_30_dias, '30 días') || '—'}</b><span class="xs muted">${cambioTxt(r.cambio_90_dias, '3 meses')}</span></div></div>
      <div class="viz">${ps.length >= 2 ? chartPeso(ps, desde) : '<p class="muted">Con dos pesajes en este periodo ya sale la gráfica.</p>'}</div>
      ${r.ultimo.fecha < addDays(HOY, -14) ? '<p class="small muted">Hace más de dos semanas del último pesaje.</p>' : ''}`;
  }
  return blk(`${blkH('Peso', `${d?.demo ? '<span class="demo-tag">Ejemplo</span>' : ''}${info('peso', 'Peso', 'Puntos: cada pesaje. Línea: la media de 7 días, que es la que cuenta, porque el peso de un día sube y baja con el agua y la comida. Sale de Garmin: de tu báscula o de lo que le dices a tu Claude.')}`)}${cuerpo}
    <div class="btns"><button class="btn tonal" type="button" data-a="peso-apuntar">Apuntar peso</button><button class="link" type="button" data-a="v-peso-claude">Con Claude</button></div>`);
}
Object.assign(ACTIONS, { 'v-prog-ir': el => { V.prog = el.dataset.v; go('progreso'); }, 'v-peso-claude': () => enClaude('Hoy peso X kg en ayunas. Regístralo en myCoach con peso_registrar y dime cómo va la tendencia de la media de 7 días.') });

/* Apuntar el peso a mano: se enseña lo que se va a guardar y se sube a Garmin (peso_registrar), que es donde
   vive el peso. En el modo demo se queda en este navegador. */
function hojaPeso() {
  const d = PZ.datos && PZ.datos.resumen, ult = d && d.ultimo;
  const st = { kg: ult ? String(ult.kg).replace('.', ',') : '', fecha: HOY, guardando: false, error: '' };
  const kg = () => { const v = parseFloat(String(st.kg).replace(',', '.')); return v >= 25 && v <= 300 ? Math.round(v * 100) / 100 : null; };
  const pinta = () => { const v = kg(); return `<form class="stack" style="gap:12px" data-form="peso">
      <label class="stack" for="pz-kg" style="gap:4px"><span class="small">Peso en kg</span><input id="pz-kg" class="search" type="text" inputmode="decimal" autocomplete="off" value="${esc(st.kg)}" placeholder="79,2"></label>
      <label class="stack" for="pz-f" style="gap:4px"><span class="small">Día</span><input id="pz-f" class="search" type="date" max="${HOY}" value="${st.fecha}"></label>
      <p class="small" role="status">${v ? `Se guardará en Garmin: <b>${nf(v, 2)} kg</b> el ${st.fecha === HOY ? 'día de hoy' : fDia(st.fecha)}${ult ? ` (el último fue ${nf(ult.kg, 2)} kg, el ${fDia(ult.fecha)})` : ''}. Si te equivocas, se borra en Garmin Connect.` : 'Escribe un peso entre 25 y 300 kg.'}</p>
      ${st.error ? `<p class="small" role="alert">${esc(st.error)}</p>` : ''}
      <button class="btn fill" type="button" data-a="peso-guardar"${v && !st.guardando ? '' : ' disabled'}>${st.guardando ? 'Guardando…' : v ? `Guardar ${nf(v, 2)} kg` : 'Guardar'}</button></form>`; };
  HPESO = { st, kg };
  openSheet({ title: 'Apuntar peso', size: 'auto', id: 'peso', body: pinta, onClose: () => { HPESO = null; } });
  setTimeout(() => document.getElementById('pz-kg')?.focus(), 400);
}
let HPESO = null;
document.addEventListener('input', e => { if (!HPESO) return; const id = e.target && e.target.id;
  if (id === 'pz-kg' || id === 'pz-f') { HPESO.st[id === 'pz-kg' ? 'kg' : 'fecha'] = e.target.value; HPESO.st.error = '';
    // Se repinta solo el resumen y el botón, para no perder el foco ni el cursor del campo.
    const f = document.querySelector('[data-form="peso"]'); if (!f) return; const tmp = document.createElement('div'); tmp.innerHTML = sheetState.body();
    f.querySelector('[role="status"]').replaceWith(tmp.querySelector('[role="status"]')); f.querySelector('[data-a="peso-guardar"]').replaceWith(tmp.querySelector('[data-a="peso-guardar"]')); } });
async function guardarPeso() {
  if (!HPESO) return; const st = HPESO.st, v = HPESO.kg(); if (!v) return;
  st.guardando = true; fillSheet();
  try {
    if (PZ.fuente === 'demo' || S.modo === 'demo') { const ps = PZ.datos.pesajes.filter(p => p.fecha !== st.fecha); ps.push({ fecha: st.fecha, kg: v }); ps.sort((a, b) => a.fecha.localeCompare(b.fecha)); PZ.datos = { ...PZ.datos, pesajes: ps, resumen: { ...PZ.datos.resumen, ultimo: ps[ps.length - 1] } }; }
    else { await coachCall('peso_registrar', { kg: v, fecha: st.fecha, confirm: true }, true); PZ.datos = undefined; cargarPeso(true); }
    closeSheet(); toast(`${nf(v, 2)} kg guardados${S.modo === 'demo' ? ' (demo)' : ' en Garmin'}`); render();
  } catch (e) { st.guardando = false; st.error = 'No he podido guardarlo en Garmin. Vuelve a probar en un momento.'; fillSheet(); }
}
Object.assign(ACTIONS, { 'peso-apuntar': () => hojaPeso(), 'peso-guardar': () => guardarPeso() });
