/* ===== v1 · Plan: ¿qué toca esta semana y por dónde salgo? =====
   La semana día a día (con lo hecho y lo que falta), tus rutas guardadas en Garmin y tus entrenos.
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

function tabPlanV1() {
  const w = addDays(SEM, 7 * V.semOff), r = resumen(w), pl = planDe(w), g = S.goal || {}, m = MODOS[g.modo] || MODOS.forma;
  if (RUT.datos === undefined) cargarRutas();
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
  const rutas = RUT.datos === 'cargando' || RUT.datos === undefined ? '<p class="muted">Leyendo tus rutas de Garmin…</p>'
    : RUT.datos === null ? '<p class="muted">No he podido leer tus rutas. Vuelve a probar en un rato.</p>'
    : (() => { const l = listaRutas(RUT.datos); return l.length ? `<ul class="filas">${l.slice(0, 6).map(x => `<li><b>${esc(x.n)}</b>${x.km != null ? `<span class="small muted" style="display:block">${nf(x.km)} km${x.desn != null ? ` y ${nf(x.desn, 0)} m de desnivel` : ''}</span>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">Aún no tienes rutas guardadas en Garmin. Pídele una a tu Claude: la traza por carreteras reales y, si te gusta, la guarda.</p>'; })();
  return { title: 'Plan', html: `<div class="v1"><header class="v1-h"><h1>Plan</h1><p>${esc(g.titulo || m.n)}${g.fecha ? `, ${fDia(g.fecha)}` : ''} <button class="link" type="button" data-a="push" data-v="objetivo">Cambiar</button></p></header>
    <div class="cols"><div class="col">${blk(semana, 'first')}</div><div class="col">
      ${blk(`${blkH('Tus rutas', `${RUT.datos?.demo ? '<span class="demo-tag">Ejemplo</span>' : ''}<button class="link" type="button" data-a="v-encargo" data-v="2">Trazar una</button>`)}${rutas}`)}
      ${blk(`${blkH('Tus entrenos', '<button class="link" type="button" data-a="push" data-v="entrenos">Verlos</button>')}<p class="muted">Fuerza, bici y correr: con sus ejercicios o pasos, la última vez que los hiciste y el envío al reloj.</p>`)}
    </div></div></div>` };
}
Object.assign(ACTIONS, { 'v-plan-mano': () => { V.planMano = !V.planMano; render(); } });
