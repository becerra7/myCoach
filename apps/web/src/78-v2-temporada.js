/* ===== v2 · Tu plan a futuro: dónde estás frente a lo esperado =====
   El plan de varias semanas lo monta y lo reajusta tu Claude (coach_temporada_guardar); aquí se ve.
   Lo calcula el conector (coach_temporada): cada semana con lo esperado y lo hecho, el acumulado y dónde estás.
   Las sesiones puestas en días lejanos salen como pre-programadas, sin confirmar (decisión 34). */
const TEMP = { datos: undefined, fuente: null };
const ENCARGO_TEMP = {
  montar: 'Quiero un plan de entreno a varias semanas con myCoach. Pregúntame mi objetivo y su fecha y las horas que tengo de verdad, mira lo que vengo haciendo y propónmelo semana a semana con coach_temporada_guardar. Enséñamelo antes de guardarlo.',
  reajustar: 'Mira con coach_temporada dónde estoy frente a lo esperado en mi plan y dime qué harías. Si conviene, reajusta las semanas que quedan con coach_temporada_guardar y enséñame el antes y el después antes de guardar.',
  sesion: 'Quiero dejar pre-programada una sesión en un día de más adelante en mi plan de myCoach. Pregúntame cuál y qué día, y guárdala con coach_temporada_guardar como pre-programada, sin confirmar.',
};
function temporadaDemo() {
  const l0 = addDays(SEM, -28), esp = [[6, 1, 120, 1, 'Base'], [7, 1, 150, 1, 'Base'], [8, 2, 180, 2, 'Base'], [5, 1, 120, 1, 'Descarga'], [8, 2, 180, 2, 'Construcción'], [9, 2, 210, 2, 'Construcción'], [10, 2, 240, 2, 'Construcción'], [6, 1, 150, 1, 'Descarga']];
  const real = [[5.5, 1, 110, 1], [6.8, 1, 160, 1], [5.1, 1, 120, 0], [4.4, 0, 90, 1], [6.6, 1, 182, 1]];
  const semanas = esp.map(([horas, intensos, larga_min, fuerza, fase], i) => { const lunes = addDays(l0, i * 7), r = real[i];
    return { lunes, n: i + 1, estado: lunes < SEM ? 'hecha' : lunes === SEM ? 'en_curso' : 'futura', esperado: { horas, intensos, larga_min, fuerza, fase }, ...(r ? { real: { horas: r[0], intensos: r[1], larga_min: r[2], fuerza: r[3] }, pct_horas: Math.round(r[0] / horas * 100) } : {}) }; });
  return { demo: true, hay_plan: true, nombre: 'Marcha de primavera', objetivo: 'Llegar con fondo para 140 km', desde: l0, hasta: addDays(l0, 55), semanas_totales: 8, semana_actual: 5, semanas_restantes: 3,
    donde_estas: { estado: 'por_detras', texto: 'Llevas el 84 % de las horas previstas en 4 semanas (21,8 de 26 h): vas por detrás de lo esperado.' },
    hasta_hoy: { semanas_cerradas: 4, horas_esperadas: 26, horas_hechas: 21.8, pct_horas: 84, intensos_esperados: 5, intensos_hechos: 3, fuerza_esperada: 5, fuerza_hecha: 3, largas_previstas: 4, largas_hechas: 2 },
    semanas, preprogramadas: [{ fecha: addDays(SEM, 19), sesion: { dep: 'bici', t: 'fondo', d: 'Salida larga con el grupo', min: 240 }, confirmada: false, toca_confirmar: false }], por_confirmar: 0 };
}
async function cargarTemporada(fresco) {
  const f = fuenteDatos(); if (f === 'espera') { cuandoHayaConector(); return; } TEMP.fuente = f;
  if (f === 'demo') { TEMP.datos = temporadaDemo(); return; }
  TEMP.datos = 'cargando';
  try { TEMP.datos = await coachCall('coach_temporada', {}, fresco); } catch (e) { TEMP.datos = null; }
  render();
}
const temporada = () => { if (TEMP.datos !== undefined && TEMP.datos !== 'cargando' && fuenteDatos() !== 'espera' && TEMP.fuente !== fuenteDatos()) TEMP.datos = undefined; if (TEMP.datos === undefined) cargarTemporada(); return TEMP.datos; };
const ESTADO_TEMP = { en_linea: ['good', '✓', 'Según lo esperado'], por_detras: ['warn', '!', 'Por detrás de lo esperado'], por_delante: ['good', '↑', 'Por delante de lo esperado'], empezando: ['neutral', '·', 'Empezando'] };
const txtEsperado = o => [`${nf(o.horas)} h`, o.intensos != null ? `${o.intensos} intenso${o.intensos === 1 ? '' : 's'}` : '', o.larga_min ? `largo de ${dur(o.larga_min)}` : '', o.fuerza ? `${o.fuerza} de fuerza` : ''].filter(Boolean).join(' · ');
function scrTemporada() {
  const d = temporada(), demo = d && d.demo ? ' · <span class="demo-tag">Ejemplo</span>' : '';
  const envuelve = (sub, cuerpo) => ({ title: 'Tu plan', html: `<div class="v2">${cab2('Tu plan a futuro', sub)}${cuerpo}</div>` });
  if (d === undefined || d === 'cargando') return envuelve('', '<p class="muted" role="status" style="padding:0 4px">Leyendo tu plan…</p>');
  if (d === null) return envuelve('', '<section class="card"><p>No he podido leer tu plan.</p><div class="btns"><button class="btn tonal" type="button" data-a="v2-temp-recargar">Volver a probar</button></div></section>');
  const pre = (d.preprogramadas || []), listaPre = pre.length ? grupo2(pre.map(p => fila2(esc(p.sesion.d || 'Sesión'), `${cap1(fLarga(p.fecha))}${p.sesion.min ? ` · ${dur(p.sesion.min)}` : ''}`, '', { el: 'div', chev: false, icono: `<i class="dot" style="background:${scol(p.sesion.dep)}" aria-hidden="true"></i>`, valor: p.toca_confirmar ? tag('warn', '!', 'Toca confirmarla') : tag('neutral', '·', 'Sin confirmar') })).join(''), 'Pre-programadas') + '<p class="xs" style="padding:0 4px">Están apuntadas, pero no son plan todavía: se confirman cuando su semana sea esta o la siguiente, y entonces pasan las reglas del entrenador.</p>' : '';
  if (!d.hay_plan) return envuelve('', `<section class="card"><b style="font-size:17px">Aún no tienes un plan a futuro</b>
      <p class="small muted">Tu Claude te lo monta semana a semana hasta tu objetivo, con tus horas de verdad y lo que vienes haciendo. Aquí verás cada semana con lo esperado y lo hecho, y si vas por delante o por detrás.</p>
      <button class="btn fill wide" type="button" data-a="v2-temp-claude" data-v="montar">Montarlo con Claude</button></section>${listaPre}`);
  const [tono, ico, pal] = ESTADO_TEMP[d.donde_estas.estado] || ESTADO_TEMP.empezando, h = d.hasta_hoy || {};
  const fila = s => { const e = s.esperado, r = s.real, ahora = s.estado === 'en_curso';
    return `<div class="li${ahora ? ' ahora' : ''}" style="cursor:default"><span class="day" aria-hidden="true"><small>Sem.</small><b>${s.n}</b></span>
      <span class="main"><b>${e.fase ? esc(cap1(e.fase)) : `Semana ${s.n}`}${ahora ? ' · esta semana' : ''}</b><span>Del ${fDia(s.lunes)} al ${fDia(addDays(s.lunes, 6))}</span>
      <span class="temp-l"><i>Previsto</i>${esc(txtEsperado(e))}</span>
      ${r ? `<span class="temp-l"><i>${ahora ? 'Llevas' : 'Hecho'}</i>${nf(r.horas)} h${r.intensos != null ? ` · ${r.intensos} intenso${r.intensos === 1 ? '' : 's'}` : ''}${r.larga_min ? ` · largo de ${dur(r.larga_min)}` : ''}</span>` : ''}${e.nota ? `<span>${esc(e.nota)}</span>` : ''}</span>
      ${r && !ahora && s.pct_horas != null ? `<span class="val" aria-label="${s.pct_horas} por ciento de las horas"><b class="cifra" style="font-size:20px;color:var(--ink)">${s.pct_horas} %</b><small class="temp-pct" aria-hidden="true">de las horas</small></span>` : ''}</div>`; };
  return envuelve(`${esc(d.nombre || d.objetivo || 'Semana a semana')}${d.hasta ? ` · hasta el ${fDia(d.hasta)}` : ''}${demo}`, `
    <section class="card" aria-label="Dónde estás">${tag(tono, ico, pal)}<p class="frase" style="font-size:22px">${esc(String(d.donde_estas.texto || '').replace(/[:,]\s*vas (por (detrás|delante) de|según) lo esperado\.?$/i, '.'))}</p>
      ${h.semanas_cerradas >= 1 && h.horas_esperadas ? barra2('Horas', `${nf(h.horas_hechas)} de ${nf(h.horas_esperadas)} h`, h.pct_horas || 0) : ''}
      ${h.semanas_cerradas >= 1 ? facts2([h.intensos_esperados ? ['Intensos', `${h.intensos_hechos} de ${h.intensos_esperados}`] : null, h.largas_previstas ? ['Largas', `${h.largas_hechas} de ${h.largas_previstas}`] : null, h.fuerza_esperada ? ['Fuerza', `${h.fuerza_hecha} de ${h.fuerza_esperada}`] : null]) : ''}
      <p class="small muted">Semana ${d.semana_actual || '—'} de ${d.semanas_totales}${d.semanas_restantes ? ` · quedan ${d.semanas_restantes}` : ''}. ${d.donde_estas.estado === 'por_detras' ? 'No se trata de recuperar lo perdido: se reajusta lo que queda.' : ''}</p>
      <button class="btn ${d.donde_estas.estado === 'en_linea' || d.donde_estas.estado === 'empezando' ? 'tonal' : 'fill'} wide" type="button" data-a="v2-temp-claude" data-v="reajustar">Reajustarlo con Claude</button></section>
    ${grupo2(d.semanas.map(fila).join(''), 'Semana a semana')}
    ${listaPre}
    <div class="btns" style="padding:0 4px"><button class="link" type="button" data-a="v2-temp-claude" data-v="sesion">Dejar una sesión pre-programada</button></div>`);
}
scrV2('temporada', scrTemporada);
/* En Calendario: la fila que lleva al plan, con dónde estás dicho en dos palabras */
function filaTemporada() {
  const d = temporada(), ok = d && typeof d === 'object';
  const sub = !ok ? 'Las semanas que vienen y dónde estás frente a lo esperado' : d.hay_plan ? `Semana ${d.semana_actual || '—'} de ${d.semanas_totales}${d.por_confirmar ? ` · ${d.por_confirmar} por confirmar` : ''}` : 'Aún no tienes uno: tu Claude te lo monta';
  return fila2('Tu plan a futuro', esc(sub), 'data-a="push" data-v="temporada"', { valor: ok && d.hay_plan ? esc((ESTADO_TEMP[d.donde_estas.estado] || ESTADO_TEMP.empezando)[2]) : '' });
}
Object.assign(ACTIONS, { 'v2-temp-claude': el => enClaude(ENCARGO_TEMP[el.dataset.v] || ENCARGO_TEMP.reajustar), 'v2-temp-recargar': () => { TEMP.datos = undefined; render(); } });
