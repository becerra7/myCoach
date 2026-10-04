/* ===== Agenda: lo que te ocupa y no es entreno =====
   Tus compromisos (los que anotas aquí o con tu Claude) y tu calendario (iCal) viven en el
   conector: herramienta agenda. El motor decide si una sesión cabe y qué hacer si no;
   la web lo enseña y deja anotar algo rápido en un día ("No puedo este día"). */
let CAL = null; // { 'AAAA-MM-DD': [{ titulo, de?, a?, todo_dia?, origen, id? }] } o null sin agenda
let AGENDA_LIBRE = {}; // { 'AAAA-MM-DD': { libre_min, todo_ocupado, huecos } }
const calDisponible = () => fuenteDatos() === 'vivo';
async function cargarCalendario(fresco) {
  // Al arrancar aún no se sabe si hay conector: se vuelve a pedir en cuanto se sepa.
  if (!calDisponible()) { if (fuenteDatos() === 'espera') capListo.then(() => { if (calDisponible()) cargarCalendario(fresco); }); return; }
  try {
    const r = await coachCall('agenda', { desde: SEM, dias: 14 }, fresco);
    const o = {}, l = {};
    for (const d of r.dias || []) { if (d.eventos.length) { o[d.fecha] = d.eventos; l[d.fecha] = { libre_min: d.libre_min, todo_ocupado: d.todo_ocupado, huecos: d.huecos }; } }
    CAL = Object.keys(o).length || r.calendario?.conectado ? o : null; AGENDA_LIBRE = l;
    S.calOk = !!r.calendario?.conectado; S.calError = r.calendario?.error || ''; for (const k of Object.keys(CHOQUES)) delete CHOQUES[k]; render();
    if (sheetState && sheetState.id === 'dia') fillSheet();
  } catch (e) { }
}
const agendaDia = f => ((CAL && CAL[f]) || []);
const diaCorto = f => `${DC[dte(f).getDay()]} ${dte(f).getDate()}`;
const textoEvento = e => e.todo_dia ? e.titulo : `${e.titulo}, de ${e.de} a ${e.a === '24:00' ? '00:00' : e.a}`;
/* El día en una línea, con candado: nunca solo color */
function lineaAgenda(f) {
  const ev = agendaDia(f); if (!ev.length) return '';
  const l = AGENDA_LIBRE[f] || {};
  const que = l.todo_ocupado || l.libre_min < 30 ? `Ocupado: ${ev.map(e => e.titulo).join(', ')}` : ev.map(e => e.todo_dia ? e.titulo : `${e.titulo} ${e.de}-${e.a === '24:00' ? '00:00' : e.a}`).join(', ');
  return `<span class="agenda-l small">${ic('lock', 14)}<span>${esc(que)}</span></span>`;
}

/* Semana nueva hecha en la app: el motor la valida con tu agenda y se usa su versión corregida.
   Devuelve lo que ha cambiado, en frases. Sin conector (demo) no hay agenda: se queda igual. */
async function encajarEnAgenda(p) {
  if (!calDisponible() || !Object.keys(p).length) return [];
  try {
    const r = await coachCall('coach_proponer', { cambios: p, porque: 'Semana preparada en la app' }, true);
    const errores = (r.semanas || []).flatMap(s => s.errores);
    const corr = Object.assign({}, ...(r.semanas || []).map(s => s.cambios_corregidos || {}));
    if (!errores.length) return [];
    for (const [f, s] of Object.entries(corr)) if (f in p || s) { if (s) p[f] = s; else delete p[f]; }
    return errores.filter(e => ['dia_ocupado', 'no_cabe'].includes(e.regla)).map(e => e.texto);
  } catch (e) { return []; }
}

/* Lo que choca entre tu agenda y el plan de una semana (p. ej. un evento nuevo en tu calendario).
   El motor valida los días que quedan y da su versión corregida; Plan la enseña antes → después. */
const CHOQUES = {}; // { lunes: { errores, cambios } | 'cargando' }
async function cargarChoques(w) {
  if (!calDisponible() || CHOQUES[w] === 'cargando') return;
  const p = planDe(w) || {}, dias = Object.keys(p).filter(f => f >= HOY && p[f].t !== 'descanso' && agendaDia(f).length);
  if (!dias.length) { CHOQUES[w] = null; return; }
  CHOQUES[w] = 'cargando';
  try {
    const cambios = Object.fromEntries(dias.map(f => [f, { dep: p[f].dep, t: p[f].t, d: p[f].d, min: p[f].min }]));
    const r = await coachCall('coach_proponer', { cambios, porque: 'Revisar la semana con tu agenda' }, true);
    const errores = (r.semanas || []).flatMap(x => x.errores).filter(e => ['dia_ocupado', 'no_cabe'].includes(e.regla));
    CHOQUES[w] = errores.length ? { errores, cambios: Object.assign({}, ...(r.semanas || []).map(x => x.cambios_corregidos || {})) } : null;
  } catch (e) { CHOQUES[w] = null; }
  render();
}
function avisoChoques(w) {
  if (!CAL || w < SEM) return '';
  if (!(w in CHOQUES)) { cargarChoques(w); return ''; }
  const c = CHOQUES[w]; if (!c || c === 'cargando') return '';
  const filas = Object.entries(c.cambios).sort(([x], [y]) => x.localeCompare(y)).map(([g, s]) => { const antes = sesion(g);
    return `<li><b>${diaCorto(g)}</b><span>${antes && antes.t !== 'descanso' ? `<s>${esc(antes.d)}</s><span class="vh"> pasa a </span><span aria-hidden="true"> → </span>` : ''}${s ? esc(s.d) : 'Libre'}</span></li>`; }).join('');
  return `<div class="choques" role="status"><p class="agenda-l">${ic('lock', 16)}<b>Tu agenda choca con el plan</b></p>
    <p class="small">${esc(c.errores.map(e => e.texto).join(' '))}</p>
    ${filas ? `<ul class="coach-cambio" aria-label="Cambios que propone tu entrenador">${filas}</ul>` : ''}
    <div class="btns">${filas ? `<button class="btn fill" type="button" data-a="choques-aplicar" data-v="${w}">Aplicar el cambio</button>` : ''}<button class="btn text" type="button" data-a="choques-dejar" data-v="${w}">Dejarlo como está</button></div></div>`;
}
async function aplicarChoques(w) {
  const c = CHOQUES[w]; if (!c) return;
  const antes = Object.fromEntries(Object.keys(c.cambios).map(f => [f, sesion(f) || null]));
  try {
    const r = await coachCall('coach_proponer', { cambios: c.cambios, porque: c.errores.map(e => e.texto).join(' ').slice(0, 190), guardar: true }, true);
    if (!r.guardado) { toast('Tu entrenador no lo ha guardado: ' + ((r.semanas || []).flatMap(x => x.errores.map(e => e.texto)).join(' ') || 'no cumple las reglas'), { ms: 8000 }); return; }
    const poner = m => { for (const [f, s] of Object.entries(m)) { const k = weekOf(f) === SEM ? 'plan' : 'next'; if (!S[k]) S[k] = {}; if (s) S[k][f] = s; else delete S[k][f]; } };
    poner(c.cambios); CHOQUES[w] = null; save(); render(); cargarCoach(true);
    toast('Plan cambiado por tu agenda', { undo: async () => { try { await coachCall('coach_proponer', { cambios: antes, porque: 'Deshacer el cambio por la agenda', guardar: true, entrena_igualmente: true }, true); poner(antes); save(); render(); } catch (e) { toast('No he podido deshacerlo'); } } });
  } catch (e) { toast('No he podido cambiar el plan: ' + (e.message || e.code || 'error'), { ms: 7000 }); }
}

/* ===== "No puedo este día": anotar algo rápido y ver qué cambia antes de guardarlo ===== */
let COMP = null; // borrador: { f, id, previo, todo, de, a, titulo, paso: 'editar'|'ver', res }
function hojaCompromiso(f, id) {
  const previo = id ? agendaDia(f).find(e => e.id === id) : null;
  COMP = { f, id: id || null, previo, todo: previo ? !!previo.todo_dia : false, de: previo?.de || '19:00', a: previo?.a || '21:00', titulo: previo?.titulo || '', paso: 'editar', res: null };
  openSheet({ title: f === HOY ? 'Hoy no puedo' : `No puedo el ${DS[dte(f).getDay()]} ${dte(f).getDate()}`, size: 'auto', id: 'comp', body: cuerpoCompromiso });
}
function cuerpoCompromiso() {
  const c = COMP;
  if (c.paso === 'ver') {
    const r = c.res, cambios = r.propuesta_plan?.cambios || {};
    const filas = Object.entries(cambios).sort(([x], [y]) => x.localeCompare(y)).map(([g, s]) => { const antes = sesion(g);
      return `<li><b>${diaCorto(g)}</b><span>${antes && antes.t !== 'descanso' ? `<s>${esc(antes.d)}</s><span class="vh"> pasa a </span><span aria-hidden="true"> → </span>` : ''}${s ? esc(s.d) + (s.min ? ` (${dur(s.min)})` : '') : 'Libre'}</span></li>`; }).join('');
    return `<p><b>${esc(c.titulo)}</b>${c.todo ? ', todo el día' : `, de ${c.de} a ${c.a}`}</p>
      ${r.choques.length ? `<p class="small">${esc(r.choques.map(x => x.texto).join(' '))}</p>
        ${filas ? `<ul class="coach-cambio" aria-label="Cambios propuestos en tu plan">${filas}</ul>` : ''}
        <div class="btns">${filas ? '<button class="btn fill" type="button" data-a="comp-guardar" data-v="plan">Aplicar el cambio</button>' : ''}<button class="btn ${filas ? 'text' : 'fill'}" type="button" data-a="comp-guardar" data-v="solo">Solo apuntarlo</button></div>`
      : `<p class="small muted">No choca con tu plan${sesion(c.f) && sesion(c.f).t !== 'descanso' ? ': la sesión cabe en el resto del día' : ''}.</p>
        <div class="btns"><button class="btn fill" type="button" data-a="comp-guardar" data-v="solo">Apuntarlo</button></div>`}
      <button class="btn text" type="button" data-a="comp-editar">Cambiar lo que he puesto</button>`;
  }
  return `<div class="stack" style="gap:14px">
    <label class="stack" for="comp-t" style="gap:6px"><b>¿Qué tienes?</b><input id="comp-t" class="search" autocomplete="off" maxlength="80" placeholder="Cena, viaje, reunión…" value="${esc(c.titulo)}"></label>
    <div class="stack" style="gap:6px"><b>¿Cuánto rato?</b><div class="seg" role="group" aria-label="Cuánto rato">
      <button type="button" data-a="comp-todo" data-v="0" aria-pressed="${!c.todo}">Unas horas</button>
      <button type="button" data-a="comp-todo" data-v="1" aria-pressed="${c.todo}">Todo el día</button></div></div>
    ${c.todo ? '' : `<div class="row" style="gap:12px"><label class="stack grow" for="comp-de" style="gap:6px"><b class="small">De</b><input id="comp-de" class="search" type="time" step="900" value="${c.de}"></label>
      <label class="stack grow" for="comp-a" style="gap:6px"><b class="small">A</b><input id="comp-a" class="search" type="time" step="900" value="${c.a}"></label></div>`}
    <div class="btns"><button class="btn fill" type="button" data-a="comp-ver">Ver cómo queda</button></div>
    ${c.id ? '<button class="btn text" type="button" data-a="comp-borrar">Ya no lo tengo: quitarlo</button>' : ''}</div>`;
}
function leerFormComp() {
  const c = COMP; c.titulo = (($('#comp-t') || {}).value || c.titulo).trim();
  if (!c.todo) { c.de = ($('#comp-de') || {}).value || c.de; c.a = ($('#comp-a') || {}).value || c.a; }
}
const argsComp = c => ({ fecha: c.f, titulo: c.titulo, ...(c.todo ? { de: '', a: '' } : { de: c.de, a: c.a }), ...(c.id ? { id: c.id } : {}) });
async function verCompromiso() {
  leerFormComp(); const c = COMP;
  if (!c.titulo) { toast('Pon qué tienes: cena, viaje…'); $('#comp-t')?.focus(); return; }
  if (!c.todo && !(c.a > c.de)) { toast('La hora de acabar tiene que ser después de la de empezar'); return; }
  try { c.res = await coachCall('agenda_anotar', argsComp(c), true); c.paso = 'ver'; fillSheet(); }
  catch (e) { toast('No he podido mirarlo: ' + (e.message || e.code || 'error'), { ms: 7000 }); }
}
async function guardarCompromiso(conPlan) {
  const c = COMP, r = c.res, cambios = conPlan ? r.propuesta_plan?.cambios : null;
  try {
    const g = await coachCall('agenda_anotar', { ...argsComp(c), guardar: true }, true);
    const antes = {};
    if (cambios) {
      for (const f of Object.keys(cambios)) antes[f] = sesion(f) || null;
      const p = await coachCall('coach_proponer', { cambios, porque: r.propuesta_plan.porque, guardar: true }, true);
      if (!p.guardado) toast('Apuntado, pero el plan no se ha podido cambiar: ' + ((p.semanas || []).flatMap(s => s.errores.map(e => e.texto)).join(' ') || 'no cumple las reglas'), { ms: 8000 });
      else for (const [f, s] of Object.entries(cambios)) { const k = weekOf(f) === SEM ? 'plan' : 'next'; if (!S[k]) S[k] = {}; if (s) S[k][f] = s; else delete S[k][f]; }
    }
    closeSheet(); save(); await cargarCalendario(true); cargarCoach(true);
    const deshacer = async () => {
      try {
        const p = c.previo;
        if (p) await coachCall('agenda_anotar', { id: c.id, fecha: c.f, titulo: p.titulo, de: p.de || '', a: p.a || '', guardar: true }, true);
        else await coachCall('agenda_anotar', { id: g.compromiso.id, borrar: true, guardar: true }, true);
        if (cambios) await coachCall('coach_proponer', { cambios: antes, porque: 'Deshacer el cambio por la agenda', guardar: true, entrena_igualmente: true }, true);
        for (const [f, s] of Object.entries(antes)) { const k = weekOf(f) === SEM ? 'plan' : 'next'; if (!S[k]) S[k] = {}; if (s) S[k][f] = s; else delete S[k][f]; }
        save(); await cargarCalendario(true); cargarCoach(true);
      } catch (e) { toast('No he podido deshacerlo: ' + (e.message || e.code || 'error')); }
    };
    toast(cambios ? 'Apuntado y plan cambiado' : c.id ? 'Cambiado' : 'Apuntado', { undo: deshacer });
  } catch (e) { toast('No he podido guardarlo: ' + (e.message || e.code || 'error'), { ms: 7000 }); }
}
async function borrarCompromiso() {
  const c = COMP;
  try {
    const prev = agendaDia(c.f).find(e => e.id === c.id);
    await coachCall('agenda_anotar', { id: c.id, borrar: true, guardar: true }, true);
    closeSheet(); await cargarCalendario(true); cargarCoach(true);
    toast('Quitado', { undo: async () => { await coachCall('agenda_anotar', { fecha: c.f, titulo: prev.titulo, ...(prev.todo_dia ? {} : { de: prev.de, a: prev.a }), guardar: true }, true); cargarCalendario(true); } });
  } catch (e) { toast('No he podido quitarlo: ' + (e.message || e.code || 'error')); }
}
// Se suman a ACTIONS en 50-pueblos-comida-claude.js, que es donde se crea.
const ACCIONES_AGENDA = {
  'comp-nuevo': el => { closeSheet(true); hojaCompromiso(el.dataset.v); },
  'comp-abrir': el => { closeSheet(true); hojaCompromiso(el.dataset.v, el.dataset.id); },
  'comp-todo': el => { leerFormComp(); COMP.todo = el.dataset.v === '1'; fillSheet(); },
  'comp-ver': () => verCompromiso(),
  'comp-editar': () => { COMP.paso = 'editar'; fillSheet(); },
  'comp-guardar': el => guardarCompromiso(el.dataset.v === 'plan'),
  'comp-borrar': () => borrarCompromiso(),
  'choques-aplicar': el => aplicarChoques(el.dataset.v),
  // Lo decide el usuario: se respeta y no se vuelve a insistir con lo mismo esta vez.
  'choques-dejar': el => { CHOQUES[el.dataset.v] = null; render(); toast('Lo dejas como está. Tu entrenador lo tendrá en cuenta si hablas con él.'); },
};

/* Aviso en Hoy: semana sin plan, o (de viernes a domingo) la siguiente sin preparar */
function cardAvisoPlan() {
  const dow = dte(HOY).getDay(); let w = null, t = '', s = '';
  if (!planDe(SEM)) { w = SEM; t = 'Aún no has preparado esta semana'; s = `Te la preparo desde hoy con tus deportes${CAL ? ' y respetando tu agenda' : ''}. Tarda un segundo.`; }
  else if ([5, 6, 0].includes(dow) && !planDe(PROX)) { w = PROX; t = 'Prepara la semana que viene'; s = `Del ${fDia(PROX)} al ${fDia(addDays(PROX, 6))}${CAL ? ', encajada en tu agenda' : ''}.`; }
  if (!w) return '';
  return `<div class="adapt b-full"><div class="row">${ic('plan', 26)}<div class="grow"><b style="font-size:17px">${t}</b><p class="small muted">${s}</p></div></div>
    <div class="btns"><button class="btn fill" type="button" data-a="plan-sem" data-v="${w}">Prepararla</button><button class="btn text" type="button" data-a="claude" data-v="${w === SEM ? 'Prepárame el resto de esta semana' : 'Prepárame la semana que viene'}">${ic('claude', 18)} Con Claude</button></div></div>`;
}

/* Ajustes: conectar el calendario */
function cardCalendario() {
  const tit = estado => `<div class="card-h">${ic('plan', 18)}<span class="grow">Calendario</span>${estado || ''}</div>`;
  if (S.calOk) { const n = Object.values(CAL || {}).flat().filter(e => e.origen === 'calendario').length; return `<div class="card stack" style="gap:12px">${tit('<span class="live">Conectado</span>')}<p class="small">${S.calError ? esc(S.calError) : `${n} evento${n === 1 ? '' : 's'} en los próximos 14 días. Si una sesión no cabe, te propongo moverla o acortarla.`}</p><div class="btns"><button class="btn plain" type="button" data-a="cal-quitar">Quitar calendario</button></div></div>`; }
  return `<div><div class="card stack" style="gap:10px">${tit()}
    <p class="small">Conecta tu calendario y no te pondré entrenos cuando estés ocupado.</p>
    <label class="vh" for="cal-url">Enlace privado iCal</label><input id="cal-url" class="search" inputmode="url" autocomplete="off" placeholder="https://calendar.google.com/…/basic.ics">
    <div class="btns"><button class="btn fill" type="button" data-a="cal-guardar">Conectar calendario</button></div>
    <details><summary class="small">Dónde encuentro el enlace</summary><ul class="small" style="padding-left:18px;margin:8px 0">
      <li><b>Google Calendar</b> (desde el ordenador): Configuración → tu calendario → Integrar el calendario → <i>Dirección secreta en formato iCal</i>.</li>
      <li><b>Outlook</b>: Configuración → Calendario → Calendarios compartidos → Publicar un calendario → enlace ICS.</li>
      <li><b>iCloud</b>: app Calendario → (i) junto al calendario → Calendario público → Compartir enlace (ojo: lo hace público).</li></ul>
      <p class="xs">Solo uso cuándo estás ocupado y el título de cada evento. El enlace se guarda cifrado en tu cuenta de myCoach y tu Claude también ve tus huecos.</p></details></div></div>`;
}
