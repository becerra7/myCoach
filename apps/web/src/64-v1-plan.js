/* ===== v1 · Calendario (antes Plan): ¿qué toca esta semana y qué hice cuándo? =====
   La semana día a día (con lo hecho y lo que falta) y el mes, para mirar hacia atrás. Rutas y entrenos viven en Más.
   Preparar o cambiar la semana se hace con tu Claude; aquí también se puede a mano. */

/* Rutas guardadas en Garmin (garmin_courses), solo lectura */
const RUT = { datos: undefined };
async function cargarRutas() {
  if (RUT.datos === 'cargando') return;
  const fuente = fuenteDatos(); if (fuente === 'espera') { cuandoHayaConector(); return; }
  if (fuente === 'demo') { RUT.datos = { demo: true, recorridos: [{ nombre: 'La Roca, llano', distancia_km: 32, desnivel_m: 90 }, { nombre: 'Llinars y Bellaterra', distancia_km: 82, desnivel_m: 980 }, { nombre: 'Montseny por Sant Celoni', distancia_km: 96, desnivel_m: 1650 }] }; return; }
  RUT.datos = 'cargando';
  try { RUT.datos = await coachCall('garmin_courses', { limit: 20 }); } catch (e) { RUT.datos = null; }
  render();
}
const listaRutas = d => (Array.isArray(d) ? d : d?.recorridos || d?.courses || []).map(r => ({
  n: r.nombre || r.name || r.courseName || 'Ruta', km: r.distancia_km ?? r.km ?? (r.distance ? r.distance / 1000 : null), desn: r.desnivel_m ?? r.elevacion_m ?? r.elevationGain ?? null }));

function nombreSemana(w) {
  if (w === SEM) return 'Esta semana'; if (w === PROX) return 'La semana que viene'; if (w === addDays(SEM, -7)) return 'La semana pasada';
  return `Del ${fDia(w)} al ${fDia(addDays(w, 6))}`;
}
function filaDia(f) {
  const s = sesion(f), as = acts().filter(a => a.f === f), e = estadoDia(f), d = dte(f);
  const titulo = s ? (s.t === 'descanso' ? 'Descanso' : s.d) : as.length ? as.map(a => a.lugar).join(' y ') : 'Libre';
  const hecho = s?.a || as[0];
  const det = hecho ? `${esc(hecho.lugar)}${hecho.km && SPORTS[hecho.dep]?.cardio ? `, ${nf(hecho.km)} km` : ''}, ${dur(hecho.min)}${hecho.fc ? ` a ${hecho.fc} ppm` : ''}`
    : s && s.ruta ? esc(s.ruta) : s && s.min && s.t !== 'descanso' ? `${SPORTS[s.dep]?.n || ''}, ${dur(s.min)}` : '';
  const st = e.k === 'hecho' ? '✓ Hecho' : e.k === 'no' ? 'No hecho' : e.k === 'hoy' ? 'Hoy' : e.k === 'pend' ? 'Pendiente' : '';
  const ag = agendaDia(f), ocupado = ag.length && (AGENDA_LIBRE[f]?.todo_ocupado || AGENDA_LIBRE[f]?.libre_min < 30);
  // Un día sin hueco no es "no hecho": sin culpa.
  const st2 = e.k === 'no' && ocupado ? 'Ocupado' : st;
  return `<li class="${f === HOY ? 'es-hoy' : ''}"><button type="button" style="--c:${e.dep ? scol(e.dep) : 'var(--fill)'}" data-a="day" data-v="${f}" aria-label="${cap1(fLarga(f))}: ${esc(titulo)}${ag.length ? `. ${esc(ag.map(textoEvento).join('; '))}` : ''}${st2 ? `, ${st2.replace('✓ ', '')}` : ''}">
    <span class="fd" aria-hidden="true"><small>${DC[d.getDay()]}</small><b>${d.getDate()}</b></span>
    <span class="t"><b>${esc(titulo)}</b>${det ? `<span class="small muted">${det}</span>` : ''}${lineaAgenda(f)}</span><span class="st">${st2}</span></button></li>`;
}

/* El mes: cada día con lo que hiciste (icono del deporte) o lo previsto (cuadro hueco). Tocar un día enseña sus actividades.
   Es la manera de mirar hacia atrás: hasta tu primera actividad guardada. */
const mesDe = off => { const d = new Date(+HOY.slice(0, 4), +HOY.slice(5, 7) - 1 + off, 1); return { y: d.getFullYear(), m: d.getMonth() }; };
const isoDia = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const detalleAct = a => [SPORTS[a.dep]?.n, a.km && SPORTS[a.dep]?.cardio ? `${nf(a.km)} km` : '', dur(a.min), a.desn ? `${nf(a.desn, 0)} m de desnivel` : ''].filter(Boolean).join(', ');
function bloqueMes() {
  const todas = acts(), primera = todas.length ? todas.reduce((m, a) => a.f < m ? a.f : m, HOY) : HOY;
  const minOff = (+primera.slice(0, 4) - +HOY.slice(0, 4)) * 12 + (+primera.slice(5, 7) - +HOY.slice(5, 7));
  V.calMes = Math.max(minOff, Math.min(1, V.calMes));
  const { y, m } = mesDe(V.calMes), ini = isoDia(y, m, 1), nDias = new Date(y, m + 1, 0).getDate(), fin = isoDia(y, m, nDias);
  const delMes = todas.filter(a => a.f >= ini && a.f <= fin).sort((a, b) => a.f < b.f ? 1 : a.f > b.f ? -1 : 0);
  const porDia = {}; delMes.forEach(a => (porDia[a.f] = porDia[a.f] || []).push(a));
  if (V.calDia && (V.calDia < ini || V.calDia > fin)) V.calDia = null;
  const hueco = (dte(ini).getDay() + 6) % 7;
  const celdas = Array.from({ length: nDias }, (_, k) => {
    const f = isoDia(y, m, k + 1), as = (porDia[f] || []).slice().sort((a, b) => b.min - a.min), s = f >= HOY && !as.length ? sesion(f) : null, prev = s && s.t !== 'descanso' ? s : null;
    const marca = as.length ? `<span class="m" style="--c:${scol(as[0].dep)}">${ic(SPORTS[as[0].dep].ic, 16)}${as.length > 1 ? `<small>+${as.length - 1}</small>` : ''}</span>`
      : prev ? `<span class="m"><i class="prev" style="--c:${scol(prev.dep)}"></i></span>` : '<span class="m"></span>';
    const voz = as.length ? as.map(a => `${a.lugar}, ${detalleAct(a)}`).join('; ') : prev ? `previsto: ${prev.d}` : f > HOY ? 'nada previsto' : 'sin actividad';
    return `<button type="button" class="cal-d${f === HOY ? ' hoy' : ''}" data-a="cal-dia" data-v="${f}" aria-pressed="${V.calDia === f}" aria-label="${cap1(fLarga(f))}: ${esc(voz)}"><b>${k + 1}</b>${marca}</button>`;
  }).join('');
  const nav = `<div class="blk-h"><button class="iconbtn" type="button" data-a="cal-mes" data-v="-1" aria-label="Mes anterior" ${V.calMes <= minOff ? 'disabled' : ''}>${ic('back', 22)}</button>
    <h2 style="text-align:center">${cap1(MS[m])} de ${y}</h2><button class="iconbtn" type="button" data-a="cal-mes" data-v="1" aria-label="Mes siguiente" ${V.calMes >= 1 ? 'disabled' : ''}><span style="display:inline-block;transform:scaleX(-1)">${ic('back', 22)}</span></button></div>`;
  const min = delMes.reduce((t, a) => t + a.min, 0), km = delMes.reduce((t, a) => t + (SPORTS[a.dep]?.cardio ? a.km || 0 : 0), 0);
  const linea = delMes.length ? `${delMes.length} actividad${delMes.length === 1 ? '' : 'es'}, ${nf(min / 60, min < 600 ? 1 : 0)} h${km >= 1 ? ` y ${nf(km, 0)} km` : ''}` : ini > HOY ? 'Aún no ha empezado' : 'Sin actividades este mes';
  const fila = a => { const d = dte(a.f); return `<li><button type="button" style="--c:${scol(a.dep)}" data-a="push" data-v="actividad" data-id="${a.id}" aria-label="${cap1(fLarga(a.f))}: ${esc(a.lugar)}, ${esc(detalleAct(a))}. Ver la actividad">
    <span class="fd" aria-hidden="true"><small>${DC[d.getDay()]}</small><b>${d.getDate()}</b></span><span class="t"><b>${esc(a.lugar)}</b><span class="small muted">${esc(detalleAct(a))}</span></span><span class="st" aria-hidden="true">${ic('chev', 18)}</span></button></li>`; };
  let lista;
  if (V.calDia) {
    const as = porDia[V.calDia] || [], s = sesion(V.calDia), prev = s && s.t !== 'descanso' && !as.length ? s : null;
    lista = `<div class="blk-h" style="margin-top:16px"><h3 class="met-h" style="flex:1;margin:0">${cap1(fLarga(V.calDia))}</h3><button class="link" type="button" data-a="cal-dia" data-v="${V.calDia}">Ver todo el mes</button></div>
      ${as.length ? `<ul class="dias">${as.map(fila).join('')}</ul>` : prev && V.calDia >= HOY ? `<p class="muted">Previsto: ${esc(prev.d)}${prev.min ? `, ${dur(prev.min)}` : ''}.</p><div class="btns"><button class="btn tonal" type="button" data-a="day" data-v="${V.calDia}">Ver el día</button></div>`
        : `<p class="muted">${V.calDia > HOY ? 'No hay nada previsto.' : 'Ese día no hay ninguna actividad guardada.'}</p>`}`;
  } else lista = delMes.length ? `<h3 class="met-h" style="margin-top:16px">Lo que hiciste</h3><ul class="dias">${delMes.map(fila).join('')}</ul>` : '';
  // La app guarda las últimas 300 actividades: al llegar al tope se dice, para que no parezca que antes no hubo nada.
  const tope = V.calMes <= minOff && todas.length >= 300 ? '<p class="xs" style="margin-top:12px">Hasta aquí llegan tus últimas 300 actividades, que son las que guarda la app.</p>' : '';
  return `${nav}<p class="small muted" style="margin:-4px 0 12px">${linea}</p>
    <div class="cal-g" role="group" aria-label="Días de ${MS[m]} de ${y}">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(x => `<span class="wd" aria-hidden="true">${x}</span>`).join('')}${'<span></span>'.repeat(hueco)}${celdas}</div>
    <p class="xs cal-ley"><span>${ic('bike', 14)} Hecho, con el icono del deporte</span><span><i class="prev"></i> Previsto</span></p>${lista}${tope}`;
}

function tabPlanV1() {
  const w = addDays(SEM, 7 * V.semOff), r = resumen(w), pl = planDe(w), g = S.goal || {}, m = MODOS[g.modo] || MODOS.forma;
  const planeadas = Object.values(pl || {}).filter(x => x.t !== 'descanso');
  const linea = w >= SEM && pl ? (w === SEM ? `${r.hechas} de ${r.plan} sesiones hechas, ${nf(r.min / 60)} de ${nf(planeadas.reduce((a, x) => a + (x.min || 0), 0) / 60)} h` : `${planeadas.length} sesiones, ${nf(planeadas.reduce((a, x) => a + (x.min || 0), 0) / 60)} h planeadas`)
    : `${nf(r.min / 60)} h y ${r.n} actividad${r.n === 1 ? '' : 'es'}${pl ? `, ${r.hechas} de ${r.plan} del plan` : ''}`;
  const nav = `<div class="blk-h"><button class="iconbtn" type="button" data-a="v-sem" data-v="-1" aria-label="Semana anterior" ${V.semOff <= -8 ? 'disabled' : ''}>${ic('back', 22)}</button>
    <h2 style="text-align:center">${nombreSemana(w)}</h2><button class="iconbtn" type="button" data-a="v-sem" data-v="1" aria-label="Semana siguiente" ${V.semOff >= 1 ? 'disabled' : ''}><span style="display:inline-block;transform:scaleX(-1)">${ic('back', 22)}</span></button></div>`;
  let semana;
  if (w === PROX && !pl) semana = `${nav}<p class="muted">Aún no está preparada. Lo más rápido: pídesela a tu Claude, que la propone con tu estado, tus horas y tu calendario, y te la enseña antes de guardarla.</p>
    <div class="btns"><button class="btn fill" type="button" data-a="v-encargo" data-v="0">Prepararla con Claude</button><button class="link" type="button" data-a="v-plan-mano">Hacerla aquí</button></div>
    ${V.planMano ? `<div style="margin-top:16px">${planificador(PROX)}</div>` : ''}`;
  else semana = `${nav}<p class="small muted" style="margin:-4px 0 12px">${linea}</p>${avisoChoques(w)}<ul class="dias">${days7(w).map(filaDia).join('')}</ul>
    ${w >= SEM ? `<div class="btns"><button class="btn tonal" type="button" data-a="v-encargo" data-v="0">Cambiarla con Claude</button>${w === PROX ? '<button class="link" type="button" data-a="replan">Rehacerla</button>' : ''}</div>` : ''}`;
  // En móvil se elige Semana o Mes; en escritorio caben las dos, lado a lado, y el selector sobra.
  return { title: 'Calendario', html: `<div class="v1"><header class="v1-h"><h1>Calendario</h1><p>${esc(g.titulo || m.n)}${g.fecha ? `, ${fDia(g.fecha)}` : ''} <button class="link" type="button" data-a="push" data-v="objetivo">Cambiar</button></p></header>
    <div class="seg-row cal-sel"><div class="seg2" role="group" aria-label="Ver">${[['sem', 'Semana'], ['mes', 'Mes']].map(([k, l]) => `<button type="button" data-a="cal-vista" data-v="${k}" aria-pressed="${V.calVista === k}">${l}</button>`).join('')}</div></div>
    <div class="cols cal" data-vista="${V.calVista}"><div class="col cal-sem">${blk(semana, 'first')}</div><div class="col cal-mes">${blk(bloqueMes(), 'first')}</div></div></div>` };
}

/* ===== Más: lo que no es de todos los días. Entrenos, rutas y pueblos. ===== */
function tabMasV1() {
  const nPueblos = Object.keys(M.towns || {}).length;
  const fila = (icono, titulo, texto, attrs) => `<button type="button" class="li" ${attrs}><span class="mas-ic" aria-hidden="true">${ic(icono, 22)}</span><span class="main"><b>${titulo}</b><span>${texto}</span></span><span aria-hidden="true">${ic('chev', 18)}</span></button>`;
  return { title: 'Más', html: `<div class="v1"><header class="v1-h"><h1>Más</h1></header>
    <div class="list mas-l">${fila('dumbbell', 'Entrenos', 'Fuerza, bici y correr: verlos, ajustarlos y mandarlos al reloj', 'data-a="push" data-v="entrenos"')}
      ${fila('bike', 'Rutas', 'Las que tienes guardadas en Garmin', 'data-a="push" data-v="rutas"')}
      ${fila('pueblos', 'Pueblos', nPueblos ? `${nPueblos} municipios cruzados, tu mapa y tus totales` : 'Por dónde has pasado y tus totales', 'data-a="push" data-v="pueblos"')}</div></div>` };
}
function scrRutas() {
  if (RUT.datos === undefined) cargarRutas();
  const cuerpo = RUT.datos === 'cargando' || RUT.datos === undefined ? '<p class="small muted" role="status">Leyendo tus rutas de Garmin…</p>'
    : RUT.datos === null ? '<p class="small">No he podido leer tus rutas. Vuelve a probar en un rato.</p>'
    : (() => { const l = listaRutas(RUT.datos); return l.length ? `<div class="list">${l.map(x => `<div class="li"><span class="main"><b>${esc(x.n)}</b>${x.km != null ? `<span>${nf(x.km)} km${x.desn != null ? ` y ${nf(x.desn, 0)} m de desnivel` : ''}</span>` : ''}</span></div>`).join('')}</div>`
      : '<div class="card stack" style="gap:8px"><b>Aún no tienes rutas guardadas en Garmin</b><p class="small">Pídele una a tu Claude: la traza por carreteras reales y, si te gusta, la guarda.</p></div>'; })();
  return { title: 'Tus rutas', html: head('Tus rutas', `Guardadas en Garmin${RUT.datos?.demo ? ' · <span class="demo-tag">Ejemplo</span>' : ''}`) + `<div class="content stack" style="max-width:640px;gap:12px">${cuerpo}
    <div class="btns" style="margin-top:0"><button class="btn tonal" type="button" data-a="v-encargo" data-v="2">Trazar una con Claude</button></div></div>` };
}
Object.assign(ACTIONS, { 'v-plan-mano': () => { V.planMano = !V.planMano; render(); },
  'cal-vista': el => { V.calVista = el.dataset.v; render(); const b = $(`.cal-sel [data-v="${V.calVista}"]`); if (b) b.focus(); },
  'cal-mes': el => { V.calMes += +el.dataset.v; V.calDia = null; render(); const b = $(`[data-a="cal-mes"][data-v="${el.dataset.v}"]`); if (b && !b.disabled) b.focus(); },
  'cal-dia': el => { const f = el.dataset.v; V.calDia = V.calDia === f ? null : f; render(); const b = $(`.cal-d[data-v="${f}"]`); if (b) b.focus(); } });
