/* ===== Entrenador: el semáforo del día =====
   Lo decide el conector (coach_hoy), no la web: así la app y tu Claude usan el
   mismo método. La web solo lo enseña, deja aplicarlo (coach_proponer, que
   vuelve a validar) y anota cómo te encuentras (coach_anotar).
   Si el conector aún no tiene las herramientas coach_*, la tarjeta no sale. */
let COACH = null, coachCargando = false;
const COACH_TXT = { verde: 'Verde: adelante', ambar: 'Ámbar: mejor suave', rojo: 'Rojo: hoy toca recuperar' };
const coachCall = (tool, input, fresh) => LIVE.callTool('Garmin', tool, input, { cache: fresh ? { refresh: true } : { staleTime: 20 * 60e3 } }).then(r => r.payload);

async function cargarCoach(fresco) {
  if (!LIVE || S.modo !== 'vivo' || coachCargando) return;
  coachCargando = true;
  try { const r = await coachCall('coach_hoy', {}, fresco); COACH = r && r.semaforo ? r : null; }
  catch (e) { if (!COACH || COACH.fecha !== HOY) COACH = null; }
  coachCargando = false; render();
}

/* En demo no hay conector: un ejemplo con el readiness de la demo, marcado como tal */
function coachDemo() {
  const r = rdy(); const s = sesion(HOY);
  const color = r == null ? 'verde' : r < 40 ? 'rojo' : r < 60 ? 'ambar' : 'verde';
  // Las mismas reglas que el motor del conector (ajusteDelDia), en pequeño.
  const m5 = f => Math.max(30, Math.round(s.min * f / 5) * 5);
  let propuesta = null; const libre = s && !s.a && !s.ajustada;
  if (libre && s.t !== 'descanso' && color === 'rojo') propuesta = { accion: 'cambiar', texto: 'Hoy descanso o 30 min muy suaves.', sesion: { dep: s.dep, t: 'rec', d: 'Descanso o 30 min muy suaves', min: 30, ajustada: true } };
  else if (libre && color === 'ambar' && ['int', 'tempo'].includes(s.t)) propuesta = { accion: 'cambiar', texto: `Cambia ${s.d} por ${m5(0.75)} min suaves.`, sesion: { dep: s.dep, t: 'fondo', d: `${m5(0.75)} min suaves en lugar de: ${s.d}`, min: m5(0.75), ajustada: true } };
  else if (libre && color === 'ambar' && s.t === 'fondo' && s.min >= 120) propuesta = { accion: 'recortar', texto: `Recorta el fondo a ${m5(0.7)} min y sin apretar.`, sesion: { ...s, a: undefined, f: undefined, d: `${s.d} (recortado a ${m5(0.7)} min)`, min: m5(0.7), ajustada: true } };
  const que = propuesta ? propuesta.texto : s && s.t !== 'descanso' ? `Hoy toca ${s.d}.` : 'Hoy descanso.';
  return { fecha: HOY, demo: true, semaforo: { color, razones: color === 'verde' ? [] : [`readiness ${r} de Garmin`], positivos: color === 'verde' ? ['has dormido 7 h 40', 'VFC normal'] : [] },
    propuesta, mensaje: `${que} ${color === 'verde' ? 'Dormiste bien y la VFC está normal.' : `Readiness ${r}.`}` };
}

function cardCoach() {
  const c = S.modo === 'demo' ? coachDemo() : COACH; if (!c) return '';
  const sm = c.semaforo; const p = c.propuesta;
  const porque = (sm.color === 'verde' ? sm.positivos : sm.razones).slice(0, 3);
  const aplicable = p && p.sesion && !c.ya_entrenado_hoy?.length;
  return `<div class="card"><div class="card-h">${ic('heart', 18)}<span class="grow">Tu entrenador</span>${c.demo ? simTag('Demo') : '<span class="live">En vivo</span>'}</div>
    <div class="row"><span class="semaf ${sm.color}" role="img" aria-label="Semáforo ${sm.color}"></span><div class="grow stack" style="gap:2px"><b style="font-size:17px">${COACH_TXT[sm.color]}</b>
      ${porque.length ? `<span class="small muted">${esc(cap1(porque.join(' · ')))}</span>` : ''}</div></div>
    <p class="coach-msg">${esc(String(c.mensaje || '').replace(/^(🟢|🟠|🔴)\s*/u, ''))}</p>
    ${p && p.mover && p.mover.sustituye ? `<p class="small muted">El ${esc(p.mover.dia)} tenías ${esc(p.mover.sustituye.d || 'otra sesión')}: se sustituye.</p>` : ''}
    ${sm.datos_que_faltan && sm.datos_que_faltan.length === 3 ? '<p class="small muted">Garmin aún no tiene tu noche: el semáforo se afinará cuando la tenga.</p>' : ''}
    ${aplicable ? `<div class="btns"><button class="btn fill" type="button" data-a="coach-aplicar">Aplicar</button><button class="btn text" type="button" data-a="coach-claude">Hablarlo con Claude</button></div>` : ''}
    ${c.demo ? '' : `<div class="coach-feel" role="group" aria-label="¿Cómo te encuentras?"><span class="small muted" style="width:100%">¿Cómo te encuentras?</span>${[[1, 'Reventado'], [2, 'Cansado'], [3, 'Normal'], [5, 'Genial']].map(([n, t]) => `<button class="sug" type="button" data-a="coach-sentir" data-v="${n}">${t}</button>`).join('')}<button class="sug" type="button" data-a="coach-dolor">Me duele algo</button></div>`}
  </div>`;
}

const PROMPT_COACH = () => `Usa mi conector de Garmin (myCoach). Llama a coach_hoy y dime qué hago hoy y por qué. Si el motor propone cambiar o mover la sesión, explícamelo y, si te digo que sí, aplícalo con coach_proponer (primero sin guardar y luego con guardar=true).`;

async function coachAplicar() {
  const c = S.modo === 'demo' ? coachDemo() : COACH; const p = c && c.propuesta; if (!p || !p.sesion) return;
  const cambios = { [c.fecha]: p.sesion }; if (p.mover) cambios[p.mover.a] = p.mover.sesion;
  markFlow('ajustar');
  const local = () => commit(p.mover ? `Hoy suave; la sesión pasa al ${p.mover.dia}` : 'Sesión de hoy ajustada', () => { for (const [f, s] of Object.entries(cambios)) { const key = weekOf(f) === SEM ? 'plan' : 'next'; if (!S[key]) S[key] = {}; S[key][f] = s; } });
  if (c.demo) { local(); return; }
  try {
    const r = await coachCall('coach_proponer', { cambios, porque: `Semáforo ${{ verde: 'verde', ambar: 'ámbar', rojo: 'rojo' }[c.semaforo.color]}: ${c.semaforo.razones.slice(0, 2).join(', ')}`, guardar: true }, true);
    if (!r.guardado) { ask({ title: 'El entrenador no lo guarda', text: (r.semanas || []).flatMap(s => s.errores.map(e => e.texto)).join(' ') || 'No cumple las reglas del plan.', actions: [{ label: 'Entendido', kind: 'fill' }] }); return; }
    local(); COACH = { ...COACH, propuesta: null }; cargarCoach(true);
  } catch (e) { toast('No he podido cambiar el plan: ' + (e.message || e.code || 'error'), { ms: 7000 }); }
}

async function coachAnotar(entrada, gracias) {
  if (!LIVE) return;
  try { await coachCall('coach_anotar', entrada, true); toast(gracias); cargarCoach(true); }
  catch (e) { toast('No he podido anotarlo: ' + (e.message || e.code || 'error')); }
}

Object.assign(ACTIONS, {
  'coach-aplicar': () => coachAplicar(),
  'coach-claude': () => enClaude(PROMPT_COACH()),
  'coach-sentir': el => { const n = +el.dataset.v; coachAnotar({ tipo: 'sensacion', nivel: n, texto: { 1: 'Reventado', 2: 'Cansado', 3: 'Normal', 5: 'Genial' }[n] }, n <= 2 ? 'Anotado: lo tengo en cuenta para hoy' : 'Anotado'); },
  'coach-dolor': () => { const t = prompt('¿Qué te duele y desde cuándo?'); if (t && t.trim()) coachAnotar({ tipo: 'dolor', texto: t.trim() }, 'Anotado. Hoy bajamos la carga; si no mejora, consulta a un profesional.'); },
});

// Si al abrir se sincroniza, el semáforo se pide al acabar (en sync): no dos veces.
capListo.then(() => { if (LIVE && S.onboarded && !syncing) cargarCoach(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && LIVE && S.onboarded) cargarCoach(); });
