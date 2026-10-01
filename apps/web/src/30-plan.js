/* ===== PLAN: selector de semana · revisión · semana actual · planificar ===== */
/* Semana elegida: la que tocaste si sigue en la lista; si no, la actual */
const semSel = () => (S.week && semanas().includes(S.week) ? S.week : SEM);
const semanas = () => { const out = []; let w = addDays(SEM, -7 * 8); while (w <= PROX) { out.push(w); w = addDays(w, 7); } return out; };
function weekChips() {
  return `<div class="weeks" role="group" aria-label="Semana" id="weeks">${semanas().map(w => {
    const r = resumen(w); const lbl = w === SEM ? 'Esta semana' : w === PROX ? 'Próxima' : `${fDia(w)}`;
    const sub = w === PROX ? (planDe(PROX) ? 'planificada' : 'sin planificar') : r.n ? `${nf(r.min / 60)} h · ${r.n} act.` : 'sin actividad';
    const tot = Object.values(r.dep).reduce((a, b) => a + b, 0) || 1;
    return `<button type="button" class="wkc" data-a="week" data-v="${w}" aria-pressed="${semSel() === w}"><b>${lbl}</b><small>${sub}</small><span class="mini">${SPORT_ORDER.filter(k => r.dep[k]).map(k => `<i style="width:${r.dep[k] / tot * 100}%;background:${scol(k)}"></i>`).join('')}</span></button>`;
  }).join('')}</div>`;
}
function saludMix(r, o) {
  const rows = [
    ['Cardio', 'heart', r.cardioMin / 60, [o.h[0] * .8, o.h[1]], v => `${nf(v)} h de ${nf(o.h[0] * .8)}-${o.h[1]} h`, 'cardio', 12],
    ['Fuerza', 'dumbbell', r.fuerza, [o.fuerza, o.fuerza + 1], v => `${v} de ${o.fuerza} sesiones`, 'fuerza', 4],
    ['Intensidad', 'flame', r.tipos.int, o.int, v => `${v} de ${o.int[0]}-${o.int[1]} días`, 'int', 4],
    ...(r.juego ? [['Juego', 'racket', r.juego, [0, 2], v => `${v} partido${v === 1 ? '' : 's'}`, 'raqueta', 4]] : []),
  ];
  return `<div class="hm">${rows.map(([n, i, v, [lo, hi], f, col, mx]) => {
    const st = v < lo ? 'lo' : v > hi ? 'hi' : 'ok'; const pc = x => Math.min(100, x / mx * 100);
    return `<div class="hmr"><span class="n">${ic(i, 18)}${n}</span><span class="v st-${st}">${f(v)} ${st === 'ok' ? '✓' : st === 'lo' ? '· falta' : '· de más'}</span>
      <span class="tk" aria-hidden="true"><i class="fl" style="width:${pc(v)}%;background:${col === 'int' ? 'var(--int)' : scol(col === 'cardio' ? 'bici' : col)}"></i><i class="band" style="left:${pc(lo)}%;width:${Math.max(2, pc(hi) - pc(lo))}%"></i></span></div>`;
  }).join('')}</div><p class="xs">El recuadro es lo recomendado para tu objetivo (${esc((MODOS[S.goal.modo] || MODOS.forma).n.toLowerCase())}). Fuerza: 2 días por semana, como recomienda la OMS.</p>`;
}
function listaDias(w) {
  const p = planDe(w);
  return days7(w).map(f => {
    const s = p ? sesion(f) : null; const d = dte(f); const as = acts().filter(a => a.f === f);
    if (!s && !as.length) return `<div class="li" style="cursor:default"><span class="day"><small>${DC[d.getDay()]}</small><b>${d.getDate()}</b></span><span class="main"><span>Sin actividad</span></span></div>`;
    if (!s) return as.map((a, j) => `<button type="button" class="li" data-a="push" data-v="actividad" data-id="${a.id}"><span class="day">${j ? '' : `<small>${DC[d.getDay()]}</small><b>${d.getDate()}</b>`}</span><span class="main"><b>${sportDot2(a.dep)} ${esc(a.lugar)}</b><span>${a.km && SPORTS[a.dep].cardio ? nf(a.km) + ' km · ' : ''}${dur(a.min)}${a.fc ? ' · ' + a.fc + ' ppm' : ''}</span></span>${SPORTS[a.dep].cardio ? chip(tipoAct(a)) : `<span class="chip k-otros">${SPORTS[a.dep].n}</span>`}</button>`).join('');
    let st = '';
    if (s.a) st = SPORTS[s.dep]?.cardio && tipoAct(s.a) !== s.t && !S.overrides[s.a.id] ? `<span class="st dev">Plan: ${TIPOS[s.t].n.toLowerCase()}</span>` : `<span class="st done">${ic('check', 14)} Hecho</span>`;
    else if (f === HOY) st = '<span class="st hoy">Hoy</span>'; else if (f < HOY && s.t !== 'descanso') st = '<span class="st" style="color:var(--bad)">No hecho</span>'; else if (w === PROX) st = '<span class="st plan">Planeado</span>';
    return `<button type="button" class="li ${f === HOY ? 'today' : ''}" data-a="day" data-v="${f}"><span class="day"><small>${DC[d.getDay()]}</small><b>${d.getDate()}</b></span>
      <span class="main"><b>${s.t === 'descanso' ? '' : sportDot2(s.dep) + ' '}${esc(s.a ? `${s.a.lugar}${s.a.km && SPORTS[s.a.dep].cardio ? ` · ${nf(s.a.km)} km` : ''}` : s.d)}</b><span>${s.a ? `${dur(s.a.min)}${s.a.fc ? ` · ${s.a.fc} ppm` : ''}` : `${s.h ? s.h + ' · ' : ''}${s.ruta ? `Ruta: ${esc(s.ruta)}` : s.min ? dur(s.min) : ''}${f >= HOY && resumenAgenda(f) ? ` · ${resumenAgenda(f)}` : ''}`}</span></span>
      <span class="stack" style="align-items:flex-end;gap:4px">${s.dep === 'fuerza' || s.dep === 'raqueta' ? `<span class="chip k-otros">${SPORTS[s.dep].n}</span>` : chip(tipoSes(s))}${st}</span></button>`;
  }).join('');
}
const sportDot2 = k => `<i class="dot" style="background:${scol(k)};vertical-align:1px"></i>`;
function tabPlan() {
  const w = semSel(); const r = resumen(w), o = objetivos();
  let body = '';
  if ((w === PROX || w === SEM) && !planDe(w)) body = planificador(w) + (w === SEM ? `<div class="list split" style="margin-top:16px">${listaDias(SEM)}</div>` : '');
  else {
    const ins = insightsSemana(w);
    const cabecera = w === SEM && !r.plan ? `<div class="row"><div class="cring" style="--p:0"><span><b>${r.n}</b><small>hechas</small></span></div><div class="grow stack" style="gap:2px"><b style="font-size:17px">Sin plan esta semana</b><span class="small muted">${nf(r.min / 60)} h hechas · planifica la próxima con el botón "Próxima"</span></div></div>`
      : w === SEM ? `<div class="row"><div class="cring" style="--p:${Math.round(r.hechas / r.plan * 100)}"><span><b>${r.hechas}/${r.plan}</b><small>hechas</small></span></div><div class="grow stack" style="gap:2px"><b style="font-size:17px">${Math.round(r.hechas / r.plan * 100)} % cumplido</b><span class="small muted">${nf(r.min / 60)} h hechas de ${nf(Object.values(planDe(SEM) || {}).reduce((a, s) => a + s.min, 0) / 60)} h planeadas</span></div></div>`
      : w === PROX ? `<div class="row"><div class="grow stack" style="gap:2px"><b style="font-size:17px">Semana planificada</b><span class="small muted">${nf(Object.values(planDe(PROX) || {}).reduce((a, s) => a + s.min, 0) / 60)} h · ${Object.values(planDe(PROX) || {}).filter(s => s.t !== 'descanso').length} sesiones</span></div><button class="btn plain" type="button" data-a="replan">Rehacer</button></div>`
      : `<div class="fields"><div class="field"><span class="l">Horas</span><span class="v">${nf(r.min / 60)}</span></div><div class="field"><span class="l">Actividades</span><span class="v">${r.n}</span></div><div class="field"><span class="l">Días activos</span><span class="v">${r.dias.size}</span></div><div class="field"><span class="l">Plan</span><span class="v" style="font-size:16px">sin plan</span></div></div>`;
    const rp = w === PROX ? resumenPlan(planDe(PROX)) : r;
    // Plan responde "¿qué toca esta semana y cómo voy?": una línea de resumen, los días (cada uno se
    // abre con sus ejercicios o pasos y "Enviar al reloj") y lo que necesitas por tipo. El análisis, plegado.
    const planeadas = Object.values(planDe(w) || {}).reduce((a, x) => a + (x.min || 0), 0) / 60;
    const linea = w === SEM && r.plan ? `<b>${r.hechas} de ${r.plan}</b> sesiones hechas · ${nf(r.min / 60)} de ${nf(planeadas)} h`
      : w === SEM ? `<b>Sin plan</b> · ${nf(r.min / 60)} h hechas`
      : w === PROX ? `<b>${Object.values(planDe(PROX) || {}).filter(x => x.t !== 'descanso').length} sesiones</b> · ${nf(planeadas)} h planeadas`
      : `<b>${nf(r.min / 60)} h</b> · ${r.n} actividad${r.n === 1 ? '' : 'es'} · ${r.dias.size} días activos${planDe(w) ? ` · ${r.hechas} de ${r.plan} del plan` : ''}`;
    body = `<div class="bento plan-v">
      <div class="b-hero stack" style="gap:12px">
        <div class="plan-res"><p>${linea}</p>${w === PROX ? '<button class="btn text" type="button" data-a="replan">Rehacer</button>' : ''}</div>
        <div class="list split">${listaDias(w)}</div>
        ${w !== PROX && w !== SEM ? '' : `<div class="list"><button type="button" class="li" data-a="push" data-v="entrenos">${ic('dumbbell')}<span class="main"><b>Tus entrenos</b><span>Fuerza, bici y correr: velos, ajústalos y mándalos al reloj</span></span>${ic('chev', 18, 'chev')}</button></div>`}
      </div>
      <div class="b-side stack" style="gap:12px">
        <section class="card" aria-labelledby="nec-t"><h2 class="card-t" id="nec-t">${w === PROX ? 'Lo que llevas planeado' : 'Lo que necesitas esta semana'}</h2>${saludMix(rp, o)}</section>
        ${w !== PROX ? `<details class="card plan-ins"><summary><span class="grow">Lo que dice tu semana</span><span class="small muted">${ins.length}</span></summary><ul class="insights">${ins.map(([k, i, t]) => `<li class="ins-${k}"><span class="ic">${ic(i, 16)}</span><span>${esc(t)}</span></li>`).join('')}</ul></details>`
        : `<div class="btns"><button class="btn tonal" type="button" data-a="claude" data-v="Revisa mi semana que viene y afínala">${ic('claude', 18)} Afinarla con Claude</button></div>`}
      </div></div>`;
  }
  const sub = w === SEM ? `${rangoSem(SEM)} · en curso` : w === PROX ? `${rangoSem(PROX)} · planificar` : `Semana del ${fDia(w)} · revisión`;
  return { title: 'Plan', html: head('Plan', sub) + `<div class="content">${weekChips()}${body}</div>` };
}
function resumenPlan(p) {
  const r = { min: 0, n: 0, dep: {}, tipos: { rec: 0, fondo: 0, tempo: 0, int: 0 }, fuerza: 0, juego: 0, cardioMin: 0, dias: new Set() };
  for (const [f, s] of Object.entries(p || {})) { if (s.t === 'descanso') continue; r.n++; r.min += s.min; r.dep[s.dep] = (r.dep[s.dep] || 0) + s.min; if (s.t in r.tipos) r.tipos[s.t]++; if (s.dep === 'fuerza') r.fuerza++; if (s.dep === 'raqueta') r.juego++; if (SPORTS[s.dep].cardio) r.cardioMin += s.min; }
  return r;
}
function planificador(w = PROX) {
  const opts = ['bici', 'correr', 'skimo', 'montana', 'raqueta', 'fuerza'];
  // Por defecto: tus deportes y tus horas habituales (media del último mes)
  const mios = S.sports.filter(k => opts.includes(k)), h4 = M.ind && M.ind.h4;
  const d = S.nextDraft || (S.nextDraft = { deps: mios.length ? mios : ['bici', 'correr', 'fuerza'], h: h4 ? Math.min(12, Math.max(3, Math.round(h4 * 2) / 2)) : 7 });
  const falta = !d.deps.includes('fuerza');
  return `<div class="bento"><div class="card b-hero">
    ${w === SEM ? `<p><b>Esta semana aún no tiene plan.</b> Te la preparo desde hoy (${DS[dte(HOY).getDay()]}); lo ya hecho cuenta.</p>` : ''}
    <p class="small ${CAL ? '' : 'muted'}">${ic('plan', 16)} ${CAL ? `Tengo en cuenta tu agenda: ${days7(w).filter(f => f >= HOY).reduce((n, f) => n + agendaDia(f).length, 0)} eventos esta semana.` : calDisponible() ? 'Conecta tu calendario en Ajustes y respetaré tus horas ocupadas.' : 'Tu calendario se puede conectar desde la web de myCoach.'}</p>
    <div class="card-h"><span class="grow">1 · ¿Qué deportes harás?</span></div>
    <div class="filters" style="flex-wrap:wrap">${opts.map(k => `<button type="button" class="fchip" data-a="draft-dep" data-v="${k}" aria-pressed="${d.deps.includes(k)}">${sportDot(k)}${SPORTS[k].n}</button>`).join('')}</div>
    ${falta ? `<p class="small" style="color:var(--warn)">${ic('info', 16)} Sin fuerza esta semana. Recomendado: 2 sesiones cortas.</p>` : ''}
    <div class="card-h" style="margin-top:8px"><span class="grow">2 · ¿Cuántas horas tienes${w === SEM ? ' en toda la semana' : ''}?</span><span class="num" style="font-size:24px;color:var(--label)">${d.h} h</span></div>
    <label class="vh" for="draft-h">Horas disponibles</label><input id="draft-h" class="range" type="range" min="3" max="12" step="0.5" value="${d.h}" data-a="draft-h">
    <p class="xs">Tu objetivo (${esc((MODOS[S.goal.modo] || MODOS.forma).n.toLowerCase())}) pide ${objetivos().h[0]}-${objetivos().h[1]} h. ${w === SEM ? `La semana pasada hiciste ${nf(resumen(addDays(SEM, -7)).min / 60)} h.` : `Esta semana llevas ${nf(resumen(SEM).min / 60)} h.`}</p>
    <div class="btns"><button class="btn fill" type="button" data-a="gen-week">Proponer semana</button><button class="btn tonal" type="button" data-a="claude" data-v="Prepárame la semana que viene">${ic('claude', 18)} Con Claude</button></div>
    <p class="xs">"Proponer semana" usa reglas fijas: gratis y al instante. Claude puede afinarla después.</p>
  </div>
  <div class="card b-side"><div class="card-h"><span class="grow">Cómo reparte la semana</span></div>
    <ul class="insights"><li class="ins-good"><span class="ic">${ic('flame', 16)}</span><span>1 día intenso en tu deporte principal, a mitad de semana.</span></li><li class="ins-good"><span class="ic">${ic('clock', 16)}</span><span>Un fondo largo el sábado (un tercio de tus horas).</span></li><li class="ins-good"><span class="ic">${ic('dumbbell', 16)}</span><span>Fuerza el lunes y el viernes si la eliges.</span></li><li class="ins-good"><span class="ic">${ic('heart', 16)}</span><span>El resto suave, por debajo de 150 ppm.</span></li></ul></div></div>`;
}

/* Hoja de un día */
function sheetDia(f) {
  openSheet({ title: cap1(fLarga(f)), size: 'auto', id: 'dia', body: () => {
    const s = sesion(f); const as = acts().filter(a => a.f === f);
    if (!s) return as.length ? as.map(a => `<button type="button" class="li" data-a="push-close" data-v="actividad" data-id="${a.id}"><span class="main"><b>${esc(a.lugar)}</b><span>${SPORTS[a.dep].n} · ${dur(a.min)}</span></span>${ic('chev', 18, 'chev')}</button>`).join('') : '<p class="muted">Sin actividad ni plan.</p>';
    const k = tipoSes(s);
    if (s.a && fuerzaDelDia(f)) return `<p style="font-size:18px"><b>${esc(s.d)}</b></p>${bloqueFuerza(f)}<button class="btn text" type="button" data-a="push-close" data-v="actividad" data-id="${s.a.id}">Ver la actividad</button>`;
    if (s.a) return `<div class="row">${chip(k)}${s.a.sim ? simTag() : ''}</div><p><b>${esc(s.a.lugar)}</b> · ${s.a.km ? `${nf(s.a.km)} km · ` : ''}${dur(s.a.min)}${s.a.fc ? ` · ${s.a.fc} ppm` : ''}</p>${s.a.z ? distBar(s.a.z) : ''}
      ${s.t !== k && s.t !== 'otros' ? `<p class="small">Planeado: <b>${TIPOS[s.t].n}</b> (${esc(s.d)}).</p>` : ''}<button class="btn fill" type="button" data-a="push-close" data-v="actividad" data-id="${s.a.id}">Ver actividad</button>`;
    const pasado = f < HOY;
    const cuerpo = bloqueFuerza(f) || bloqueCardio(f);
    return `<div class="dia-cab">${sportDot2(s.dep)} <b>${SPORTS[s.dep].n}</b>${s.t !== 'otros' ? chip(s.t) : ''}${s.min ? `<span class="muted small">${dur(s.min)}</span>` : ''}</div>
      <p class="dia-t">${esc(s.d)}</p>${s.ruta ? `<p class="small muted">Ruta: ${esc(s.ruta)}</p>` : ''}
      ${pasado ? `<p class="small" style="color:var(--bad)">${ic('info', 16)} No consta en Garmin. Si la hiciste sin reloj, márcala como hecha.</p>` : ''}
      ${cuerpo}
      <div class="list">
        ${pasado ? `<button class="li" type="button" data-a="mark-done" data-v="${f}">${ic('check')}<span class="main"><b>Marcar como hecha</b></span></button>` : `<button class="li" type="button" data-a="move" data-v="${f}">${ic('move')}<span class="main"><b>Mover a otro día</b></span>${ic('chev', 18, 'chev')}</button>`}
        <button class="li" type="button" data-a="otro" data-v="${f}">${ic('edit')}<span class="main"><b>Cambiar por otra cosa</b></span>${ic('chev', 18, 'chev')}</button>
        ${pasado ? '' : `<button class="li" type="button" data-a="ent-elegir" data-v="${f}">${ic('dumbbell')}<span class="main"><b>${s.dep === 'fuerza' ? 'Cambiar el entreno de fuerza' : 'Poner un entreno de fuerza'}</b></span>${ic('chev', 18, 'chev')}</button>`}
      </div>`;
  } });
}
function capsCheck(week, fecha, tipo) {
  const p = weekOf(fecha) === SEM ? S.plan : S.next || {};
  const n = week.filter(d => d !== fecha).reduce((c, d) => { const s = p[d]; if (!s) return c; const a = s.act ? actById(s.act) : null; return c + ((a ? tipoAct(a) : s.t) === 'int' ? 1 : 0); }, 0) + (tipo === 'int' ? 1 : 0);
  const o = objetivos();
  if (tipo === 'int' && n > o.int[1]) return `Ya tienes ${o.int[1]} día${o.int[1] === 1 ? '' : 's'} intenso${o.int[1] === 1 ? '' : 's'} esta semana. Es el máximo para tu objetivo.`;
  if (tipo === 'int' && fecha === HOY && rdy() < 40) return `Readiness ${rdy()}: hoy nada intenso.`;
  return null;
}
function sheetMover(f) {
  const week = days7(weekOf(f)); const p = weekOf(f) === SEM ? S.plan : S.next; const s = p[f];
  openSheet({ title: 'Mover sesión', size: 'auto', id: 'mover', body: () => `<p class="small muted">${esc(s.d)}. Se intercambia con lo que haya ese día.</p>
    <div class="opts">${week.filter(d => d !== f && d >= HOY && !(p[d] && p[d].act)).map(d => { const o = p[d]; return `<button type="button" class="radio" style="border:0;text-align:left;font:inherit;color:inherit" data-a="move-to" data-v="${f}" data-to="${d}"><b style="width:92px">${fCorta(d)}</b><span class="small muted" style="flex:1">${o ? esc(o.d) : 'Libre'}</span></button>`; }).join('') || '<p class="small">No quedan días libres.</p>'}</div>` });
}
function doMove(f, to) {
  const wk = weekOf(f); const key = wk === SEM ? 'plan' : 'next'; const a = S[key][f], b = S[key][to];
  const warn = capsCheck(days7(wk).filter(d => d !== f), to, a.t);
  if (warn) { ask({ title: 'No se puede', text: warn, actions: [{ label: 'Entendido', kind: 'fill' }] }); return; }
  closeSheet(); commit(`Movido al ${fCorta(to)}`, () => { S[key][to] = a; S[key][f] = b || { dep: a.dep, t: 'descanso', d: 'Descanso', min: 0 }; }); markFlow('planificar');
}
/* "Otro": decir qué harás hoy (o ese día) sin IA; con IA opcional */
function sheetOtro(f = HOY) {
  const st = S.otroDraft = S.otroDraft && S.otroDraft.f === f ? S.otroDraft : { f, dep: 'correr', min: 60, int: 'suave', txt: '' };
  openSheet({ title: f === HOY ? '¿Qué vas a hacer hoy?' : `¿Qué harás el ${fCorta(f)}?`, size: 'large', id: 'otro', body: () => `
    <div class="stack"><b class="small">Deporte</b><div class="filters" style="flex-wrap:wrap">${['bici', 'correr', 'skimo', 'montana', 'raqueta', 'fuerza', 'otros'].map(k => `<button type="button" class="fchip" data-a="otro-set" data-k="dep" data-v="${k}" aria-pressed="${st.dep === k}">${sportDot(k)}${k === 'otros' ? 'Descansar' : SPORTS[k].n}</button>`).join('')}</div></div>
    ${st.dep === 'otros' ? '' : `<div class="stack"><b class="small">Cuánto</b><div class="filters">${[30, 45, 60, 90, 120, 180].map(m => `<button type="button" class="fchip" data-a="otro-set" data-k="min" data-v="${m}" aria-pressed="${st.min === m}">${dur(m)}</button>`).join('')}</div></div>
    <div class="stack"><b class="small">Cómo</b><div class="seg" role="group"><button type="button" data-a="otro-set" data-k="int" data-v="suave" aria-pressed="${st.int === 'suave'}">Suave</button><button type="button" data-a="otro-set" data-k="int" data-v="medio" aria-pressed="${st.int === 'medio'}">Medio</button><button type="button" data-a="otro-set" data-k="int" data-v="fuerte" aria-pressed="${st.int === 'fuerte'}">Fuerte</button></div></div>`}
    <label class="stack" for="otro-t"><b class="small">Algo más (opcional)</b><textarea id="otro-t" class="card" style="min-height:70px;border:0;font:15px/1.4 var(--font-ui);color:var(--label)" placeholder="Ej.: salgo con amigos, iremos a ritmo de charla" data-a="otro-txt">${esc(st.txt)}</textarea></label>
    <p class="small muted">${otroEfecto(st)}</p>
    <div class="btns col"><button class="btn fill" type="button" data-a="otro-save">Guardar y reajustar</button>
    ${st.txt ? `<button class="btn tonal" type="button" data-a="claude" data-v="${esc(`Hoy haré: ${SPORTS[st.dep]?.n || 'descanso'} ${dur(st.min)} ${st.int}. ${st.txt}. ¿Cómo reajusto el resto de la semana?`)}">${ic('claude', 18)} Que Claude reajuste la semana</button>` : ''}</div>` });
}
function otroEfecto(st) {
  if (st.dep === 'otros') return 'Hoy descansas. Tu sesión de hoy pasa al primer día libre si cabe.';
  const t = st.int === 'fuerte' ? 'int' : st.int === 'medio' ? 'tempo' : 'fondo';
  const warn = capsCheck(days7(weekOf(st.f)), st.f, t);
  if (warn) return warn;
  const s = sesion(st.f);
  return `Cuenta como ${TIPOS[t].n.toLowerCase()}${s && s.min >= 150 && st.min < 120 ? '. El fondo largo que tenías pasa a mañana' : ''}.`;
}
function saveOtro() {
  const st = S.otroDraft; const t = st.dep === 'otros' ? 'descanso' : st.int === 'fuerte' ? 'int' : st.int === 'medio' ? 'tempo' : 'fondo';
  const warn = t === 'int' ? capsCheck(days7(weekOf(st.f)), st.f, t) : null;
  if (warn) { ask({ title: 'No se puede', text: warn, actions: [{ label: 'Entendido', kind: 'fill' }] }); return; }
  const key = weekOf(st.f) === SEM ? 'plan' : 'next';
  closeSheet(); commit('Plan reajustado', () => {
    const prev = S[key][st.f]; const t2 = st.dep === 'fuerza' || st.dep === 'raqueta' ? 'otros' : t;
    S[key][st.f] = { dep: st.dep === 'otros' ? (prev?.dep || 'bici') : st.dep, t: t2, d: st.dep === 'otros' ? 'Descanso' : `${SPORTS[st.dep].n} ${dur(st.min)} ${st.int}${st.txt ? ' · ' + st.txt.slice(0, 40) : ''}`, min: st.dep === 'otros' ? 0 : st.min };
    const man = addDays(st.f, 1);
    if (prev && prev.min >= 150 && (st.dep === 'otros' || st.min < 120) && S[key][man] && !S[key][man].act) S[key][man] = { ...prev };
    S.adapt = 'otro';
  });
  S.otroDraft = null; markFlow('ajustar');
}
