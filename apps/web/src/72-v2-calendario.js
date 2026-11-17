/* ===== v2 · Calendario: ¿qué toca esta semana y qué hice cuándo? =====
   La semana y el mes de la v1, con el avance a la vista, el objetivo al final (con lo que falta para el reto)
   y la entrada al historial de cambios del plan. */

/* Lo que falta para el reto, si el objetivo tiene fecha. Solo cuenta semanas: las fases las pone el entrenador. */
function cuentaAtras() {
  const g = S.goal || {}; if (!g.fecha || g.fecha < HOY) return '';
  const dias = Math.round((dte(g.fecha) - dte(HOY)) / 864e5), sem = Math.floor(dias / 7);
  return dias === 0 ? 'Es hoy' : dias < 14 ? `Faltan ${dias} día${dias === 1 ? '' : 's'}` : `Faltan ${sem} semanas`;
}
function tabPlanV2() {
  const w = addDays(SEM, 7 * V.semOff), r = resumen(w), pl = planDe(w), g = S.goal || {}, m = MODOS[g.modo] || MODOS.forma;
  const planeadas = Object.values(pl || {}).filter(x => x.t !== 'descanso'), hPlan = planeadas.reduce((a, x) => a + (x.min || 0), 0) / 60;
  const nav = `<div class="blk-h"><button class="iconbtn" type="button" data-a="v-sem" data-v="-1" aria-label="Semana anterior" ${V.semOff <= -8 ? 'disabled' : ''}>${ic('back', 22)}</button>
    <h2 style="text-align:center">${nombreSemana(w)}</h2><button class="iconbtn" type="button" data-a="v-sem" data-v="1" aria-label="Semana siguiente" ${V.semOff >= 1 ? 'disabled' : ''}><span style="display:inline-block;transform:scaleX(-1)">${ic('back', 22)}</span></button></div>`;
  const avance = w === SEM && pl ? barra2(`${r.hechas} de ${r.plan} sesiones hechas`, `${nf(r.min / 60)} de ${nf(hPlan)} h`, hPlan ? r.min / 60 / hPlan * 100 : 0)
    : `<p class="small muted">${w > SEM && pl ? `${planeadas.length} sesiones, ${nf(hPlan)} h planeadas` : `${nf(r.min / 60)} h y ${r.n} actividad${r.n === 1 ? '' : 'es'}${pl ? `, ${r.hechas} de ${r.plan} del plan` : ''}`}</p>`;
  let semana;
  if (w === PROX && !pl) semana = `${nav}<p class="muted">Aún no está preparada. Lo más rápido: pídesela a tu Claude, que la propone con tu estado, tus horas y tu calendario, y te la enseña antes de guardarla.</p>
    <div class="btns"><button class="btn fill" type="button" data-a="v-encargo" data-v="0">Prepararla con Claude</button><button class="link" type="button" data-a="v-plan-mano">Hacerla aquí</button></div>
    ${V.planMano ? `<div style="margin-top:16px">${planificador(PROX)}</div>` : ''}`;
  else semana = `${nav}<div style="margin-bottom:12px">${avance}</div>${avisoChoques(w)}<ul class="dias">${days7(w).map(filaDia).join('')}</ul>`;
  const acciones = w >= SEM && !(w === PROX && !pl) ? `<div class="btns" style="padding:0 4px"><button class="btn tonal" type="button" data-a="v-encargo" data-v="0">Cambiarla con Claude</button>${w === PROX ? '<button class="link" type="button" data-a="replan">Rehacerla</button>' : ''}</div>` : '';
  const falta = cuentaAtras();
  const pie = grupo2((typeof filaTemporada === 'function' ? filaTemporada() : '') + fila2('Tu objetivo', esc(`${g.titulo || m.n}${g.fecha ? `, ${fDia(g.fecha)}` : ''}`), 'data-a="push" data-v="objetivo"', { valor: falta })
    + fila2('Lo que ha cambiado tu entrenador', 'Los cambios del plan y su porqué', 'data-a="push" data-v="cambios"'));
  return { title: 'Calendario', html: `<div class="v2">${cab2('Calendario')}
    <div class="seg-row cal-sel" style="padding:0"><div class="seg2" role="group" aria-label="Ver">${[['sem', 'Semana'], ['mes', 'Mes']].map(([k, l]) => `<button type="button" data-a="cal-vista" data-v="${k}" aria-pressed="${V.calVista === k}">${l}</button>`).join('')}</div></div>
    <div class="v2-cols cal" data-vista="${V.calVista}"><div class="col cal-sem">${blk(semana, 'first')}${acciones}</div><div class="col cal-mes">${blk(bloqueMes(), 'first')}</div></div>
    ${pie}</div>` };
}
tabV2('plan', tabPlanV2);

/* El historial de cambios del plan: lo que guarda el conector cada vez que se aplica un cambio (coach/decisiones).
   Solo se lee; deshacer un cambio se hace desde el plan o con tu Claude. */
const CAMB = { datos: undefined, fuente: null };
async function cargarCambios() {
  const f = fuenteDatos(); if (f === 'espera') { cuandoHayaConector(); return; } CAMB.fuente = f;
  if (f === 'demo') { CAMB.datos = [{ fecha: addDays(HOY, -3), porque: 'Semáforo ámbar: has dormido 5 h 50', cambios: { [addDays(HOY, -3)]: { d: '45 min suaves', dep: 'bici' } }, antes: { [addDays(HOY, -3)]: { d: 'Series 4 × 8 min', dep: 'bici' } } }, { fecha: addDays(HOY, -9), porque: 'Cena de trabajo el jueves', cambios: { [addDays(HOY, -9)]: null, [addDays(HOY, -8)]: { d: 'Series 4 × 8 min', dep: 'bici' } }, antes: { [addDays(HOY, -9)]: { d: 'Series 4 × 8 min', dep: 'bici' }, [addDays(HOY, -8)]: null } }]; return; }
  CAMB.datos = 'cargando';
  try { CAMB.datos = (await coachCall('app_leer', { doc: 'coach/decisiones' }, true)) || []; } catch (e) { CAMB.datos = null; }
  render();
}
/* Cada línea de un cambio: [día, lo que había, lo que queda]. Los cambios antiguos no guardaban lo que había: ahí solo sale cómo queda. */
function textoCambio(c, antes) {
  const nom = s => s ? (s.t === 'descanso' ? 'Descanso' : s.d || s.t || 'Sesión') : 'Libre';
  if (c && typeof c === 'object' && !Array.isArray(c) && antes && typeof antes === 'object')
    return Object.entries(c).filter(([f]) => /^\d{4}-\d{2}-\d{2}$/.test(f)).map(([f, s]) => ({ dia: cap1(fLarga(f)), antes: nom(antes[f]), despues: nom(s) }));
  if (Array.isArray(c)) return c.map(x => typeof x === 'string' ? x : [x.fecha ? cap1(fLarga(x.fecha)) : '', x.antes != null ? `antes, ${typeof x.antes === 'string' ? x.antes : x.antes?.d || x.antes?.descripcion || 'nada'}` : '', x.despues != null ? `después, ${typeof x.despues === 'string' ? x.despues : x.despues?.d || x.despues?.descripcion || 'nada'}` : ''].filter(Boolean).join(': ').replace(': después', '; después'));
  if (c && typeof c === 'object') return Object.entries(c).filter(([f]) => /^\d{4}-\d{2}-\d{2}$/.test(f)).map(([f, s]) => `${cap1(fLarga(f))}: ${s ? (s.t === 'descanso' ? 'descanso' : s.d || s.t || 'sesión cambiada') : 'sin sesión'}`);
  return [];
}
function scrCambios() {
  if (CAMB.datos !== undefined && CAMB.datos !== 'cargando' && fuenteDatos() !== 'espera' && CAMB.fuente !== fuenteDatos()) CAMB.datos = undefined;
  if (CAMB.datos === undefined) cargarCambios();
  const d = CAMB.datos; let cuerpo;
  if (d === undefined || d === 'cargando') cuerpo = '<p class="muted" role="status">Leyendo los cambios…</p>';
  else if (d === null) cuerpo = '<div class="card"><p>No he podido leer los cambios.</p><div class="btns"><button class="btn tonal" type="button" data-a="v2-cambios-recargar">Volver a probar</button></div></div>';
  else { const l = (Array.isArray(d) ? d : []).slice().reverse().slice(0, 40);
    cuerpo = l.length ? `<div class="list">${l.map(x => { const lineas = textoCambio(x.cambios, x.antes);
      return `<div class="li" style="cursor:default"><span class="main cambio-l"><small>${x.fecha ? cap1(fLarga(x.fecha)) : ''}${x.tipo === 'comida' ? ' · comidas' : ''}</small><b>${esc(x.porque || 'Cambio del plan')}</b>${lineas.slice(0, 4).map(t => typeof t === 'string' ? `<span>${esc(t)}</span>` : `<span class="cambio-ad"><i>${esc(t.dia)}</i><s>${esc(t.antes)}</s><span aria-hidden="true">→</span><span class="vh"> pasa a </span><b>${esc(t.despues)}</b></span>`).join('')}</span></div>`; }).join('')}</div>`
      : '<div class="card"><b>Aún no hay cambios</b><p class="small muted">Cuando tú, tu entrenador o tu Claude cambiéis el plan, aquí quedará qué se cambió y por qué.</p></div>'; }
  return { title: 'Cambios del plan', html: `<div class="v2">${cab2('Cambios del plan', `Qué se cambió y por qué${CAMB.fuente === 'demo' ? ' · <span class="demo-tag">Ejemplo</span>' : ''}`)}${cuerpo}</div>` };
}
scrV2('cambios', scrCambios);
Object.assign(ACTIONS, { 'v2-cambios-recargar': () => { CAMB.datos = undefined; render(); } });

/* El resumen de la semana, el domingo: lo hecho y lo mejor, sin culpa. Sale en Hoy. */
function tarjetaResumenSemana() {
  if (dte(HOY).getDay() !== 0) return '';
  const r = resumen(SEM), as = acts().filter(a => a.f >= SEM && a.f <= HOY); if (!as.length) return '';
  const larga = as.slice().sort((a, b) => b.min - a.min)[0], km = as.reduce((t, a) => t + (SPORTS[a.dep]?.cardio ? a.km || 0 : 0), 0);
  return `<section class="card" aria-labelledby="rs-t"><h2 class="g-h" id="rs-t" style="padding:0"><span>Tu semana</span></h2>
    ${facts2([['Actividades', String(as.length)], ['Horas', nf(r.min / 60)], km >= 1 ? ['Kilómetros', nf(km, 0)] : null])}
    <p class="small">Lo más largo: ${esc(larga.lugar)}, ${dur(larga.min)}${planDe(SEM) ? `. Del plan, ${r.hechas} de ${r.plan}.` : '.'}</p>
    <button class="btn tonal wide" type="button" data-a="tab" data-v="plan">Ver la semana</button></section>`;
}
