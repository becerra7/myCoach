/* ===== PLAN: selector de semana · revisión · semana actual · planificar ===== */
/* Semana elegida: la que tocaste si sigue en la lista; si no, la actual */
const semSel = () => (S.week && semanas().includes(S.week) ? S.week : SEM);
const semanas = () => { const out = []; let w = addDays(SEM, -7 * 8); while (w <= PROX) { out.push(w); w = addDays(w, 7); } return out; };
const sportDot2 = k => `<i class="dot" style="background:${scol(k)};vertical-align:1px"></i>`;
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
        ${pasado ? '' : `<button class="li" type="button" data-a="move" data-v="${f}">${ic('move')}<span class="main"><b>Mover a otro día</b></span>${ic('chev', 18, 'chev')}</button>`}
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
