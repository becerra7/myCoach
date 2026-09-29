/* ===== Entrenador: el semáforo del día =====
   Lo decide el conector (coach_hoy), no la web: así la app y tu Claude usan el
   mismo método. La web solo lo enseña, deja aplicarlo (coach_proponer, que
   vuelve a validar) y anota cómo te encuentras (coach_anotar).
   Si el conector aún no tiene las herramientas coach_*, la tarjeta no sale. */
let COACH = null, coachCargando = false;
/* Cada estado lleva texto e icono, no solo color: el color refuerza, no informa solo */
const COACH_TXT = { verde: ['Verde', 'adelante con el plan', 'check'], ambar: ['Ámbar', 'mejor suave', 'info'], rojo: ['Rojo', 'hoy toca recuperar', 'stop'] };
const COACH_EST = { bien: ['good', 'Bien'], normal: ['label-2', 'Normal'], leve: ['warn', 'Algo peor'], fuerte: ['bad', 'Peor'], sin_dato: ['label-2', 'Sin dato'] };
const NOMBRE_DATO = { frescura: 'Frescura', readiness: 'Readiness' };
/* El nombre lo pone cada uno (Ajustes o su Claude); se guarda en el perfil del conector. Por defecto, myCoach. */
const nombreCoach = () => (S.coachNombre || '').trim() || (COACH && COACH.entrenador) || 'myCoach';
const coachCall = (tool, input, fresh) => LIVE.callTool('Garmin', tool, input, { cache: fresh ? { refresh: true } : { staleTime: 20 * 60e3 } }).then(r => r.payload);

async function cargarCoach(fresco) {
  if (!LIVE || S.modo !== 'vivo' || coachCargando) return;
  coachCargando = true;
  try { const r = await coachCall('coach_hoy', {}, fresco); COACH = r && r.semaforo ? r : null; if (COACH && COACH.entrenador && document.activeElement?.id !== 'coach-nombre') { S.coachNombre = COACH.entrenador === 'myCoach' ? '' : COACH.entrenador; } }
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
  else if (libre && color === 'ambar' && ['int', 'tempo'].includes(s.t)) propuesta = { accion: 'cambiar', texto: `Cambia ${s.d} por ${m5(0.75)} min suaves.`, sesion: { dep: s.dep, t: 'fondo', d: `${m5(0.75)} min suaves`, min: m5(0.75), ajustada: true } };
  else if (libre && color === 'ambar' && s.t === 'fondo' && s.min >= 120) propuesta = { accion: 'recortar', texto: `Recorta el fondo a ${dur(m5(0.7))} y sin apretar.`, sesion: { ...s, a: undefined, f: undefined, d: `${s.d.split(',')[0].replace(/\d+ h( \d+)?|\d+ min/, dur(m5(0.7)))}`, min: m5(0.7), ajustada: true } };
  const R = (M.perfil || {}).ready || {};
  const datos = [
    { clave: 'readiness', nombre: 'Readiness de Garmin', valor: r == null ? null : String(r), normal: null, estado: r == null ? 'sin_dato' : r < 35 ? 'fuerte' : r < 55 ? 'leve' : r >= 70 ? 'bien' : 'normal' },
    { clave: 'sueno', nombre: 'Sueño', valor: R.sleep != null ? `7 h 40 · ${R.sleep}/100` : '7 h 40', normal: '7 h 20', estado: 'bien' },
    { clave: 'vfc', nombre: 'VFC nocturna', valor: '52 ms', normal: '50 ms', estado: 'bien' },
    { clave: 'pulso', nombre: 'Pulso en reposo', valor: '49 ppm', normal: '48 ppm', estado: 'bien' },
    { clave: 'frescura', nombre: 'Frescura', valor: '−8, equilibrado', normal: null, estado: 'normal' },
  ];
  return { fecha: HOY, demo: true, sesion_prevista: s, semaforo: { color, datos, razones: color === 'verde' ? [] : [`readiness ${r} de Garmin`], positivos: color === 'verde' ? ['has dormido 7 h 40', 'VFC normal'] : [] }, propuesta };
}

/* Qué hacer hoy, en una frase: la propuesta del motor o la sesión del plan */
function coachQue(c) {
  if (c.propuesta && c.propuesta.texto) return c.propuesta.texto;
  if (c.ya_entrenado_hoy && c.ya_entrenado_hoy.length) return 'Ya has entrenado hoy. Ahora toca recuperar.';
  const s = c.sesion_prevista;
  return s && s.t !== 'descanso' ? `Hoy toca ${s.d}${s.min && !/\d/.test(s.d) ? ` (${dur(s.min)})` : ''}.` : 'Hoy toca descanso.';
}
/* El cambio que propone, como antes → después y día a día: se ve antes de aplicarlo */
function coachCambios(c) {
  const p = c.propuesta; if (!p || !p.sesion) return '';
  const fila = (dia, antes, despues) => `<li><b>${esc(dia)}</b><span>${antes ? `<s>${esc(antes.d || TIPOS[antes.t]?.n || '')}</s><span class="vh"> pasa a </span><span aria-hidden="true"> → </span>` : ''}${esc(despues.d)}</span></li>`;
  return `<ul class="coach-cambio" aria-label="Cambios propuestos">${fila('Hoy', c.sesion_prevista, p.sesion)}${p.mover ? fila(cap1(p.mover.dia), p.mover.sustituye, p.mover.sesion) : ''}</ul>`;
}
function cardCoach() {
  const c = S.modo === 'demo' ? coachDemo() : COACH; if (!c) return '';
  const sm = c.semaforo; const [col, lectura, icono] = COACH_TXT[sm.color];
  const aplicable = c.propuesta && c.propuesta.sesion && !c.ya_entrenado_hoy?.length;
  const datos = (sm.datos || []).map(d => { const [tono, txt] = COACH_EST[d.estado] || COACH_EST.normal;
    return `<div class="coach-dato"><dt>${esc(NOMBRE_DATO[d.clave] || d.nombre)}</dt><dd class="coach-est" style="color:var(--${tono})">${txt}</dd><dd class="coach-val"><b>${d.valor == null ? '—' : esc(d.valor)}</b>${d.normal ? `<span class="muted"> · lo normal: ${esc(d.normal)}</span>` : ''}</dd></div>`; }).join('');
  return `<section class="card coach" aria-labelledby="coach-t">
    <div class="card-h">${ic('heart', 18)}<span class="grow">${esc(nombreCoach())}</span>${c.demo ? simTag('Demo') : '<span class="live">En vivo</span>'}</div>
    <h2 id="coach-t" class="coach-estado ${sm.color}"><span class="coach-ico" aria-hidden="true">${ic(icono, 18)}</span>${col}: ${lectura}</h2>
    <p class="coach-msg">${esc(coachQue(c))}</p>
    ${aplicable ? coachCambios(c) : ''}
    ${aplicable ? `<div class="btns"><button class="btn fill" type="button" data-a="coach-aplicar">Aplicar el cambio</button><button class="btn text" type="button" data-a="coach-claude">${ic('claude', 18)} Hablarlo con Claude</button></div>` : ''}
    ${sm.datos_que_faltan && sm.datos_que_faltan.length === 3 ? '<p class="small muted">Garmin aún no tiene tu noche: el semáforo se afinará cuando la tenga.</p>' : ''}
    ${datos ? `<h3 class="coach-sub">Por qué</h3><dl class="coach-datos">${datos}</dl>` : ''}
    ${c.demo ? '' : `<button class="link coach-sentir" type="button" data-a="coach-sentir-hoja">${ic('edit', 18)} Cuéntame cómo te encuentras</button>`}
  </section>`;
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

/* Cómo te encuentras: una hoja con opciones y un campo para el dolor (nada de prompt()) */
const SENSACIONES = [[1, 'Reventado'], [2, 'Cansado'], [3, 'Normal'], [4, 'Bien'], [5, 'Genial']];
function hojaSentir() {
  openSheet({ title: '¿Cómo te encuentras?', size: 'auto', id: 'sentir', body: () => `<p class="small muted">Lo tengo en cuenta en el semáforo de hoy y de mañana.</p>
    <div class="opts" role="group" aria-label="Cómo te encuentras">${SENSACIONES.map(([n, t]) => `<button type="button" class="radio" style="border:0;font:inherit;color:inherit;text-align:left;width:100%" data-a="coach-sentir" data-v="${n}"><b style="font-weight:600">${t}</b></button>`).join('')}</div>
    <label class="stack" for="dolor-t" style="gap:6px;margin-top:20px"><b>¿Te duele algo?</b><textarea id="dolor-t" class="search" style="min-height:76px;padding:10px 14px;font:15px/1.4 var(--font-ui)" placeholder="Qué te duele y desde cuándo"></textarea></label>
    <div class="btns"><button class="btn tonal" type="button" data-a="coach-dolor">Anotar el dolor</button></div>` });
}

async function coachAnotar(entrada, gracias) {
  if (!LIVE) return;
  try { await coachCall('coach_anotar', entrada, true); toast(gracias); cargarCoach(true); }
  catch (e) { toast('No he podido anotarlo: ' + (e.message || e.code || 'error')); }
}

async function guardarNombreCoach(v) {
  S.coachNombre = v.trim().slice(0, 24); save(); render();
  if (S.modo !== 'vivo' || !LIVE) { toast('Guardado'); return; }
  try { await coachCall('coach_perfil_guardar', { cambios: { entrenador: { nombre: S.coachNombre || 'myCoach' } } }, true); toast(`Tu entrenador se llama ${nombreCoach()}. Tu Claude también lo sabrá.`); cargarCoach(true); }
  catch (e) { toast('Guardado aquí; no he podido avisar al conector (' + (e.code || 'error') + ')'); }
}
document.addEventListener('change', e => { if (e.target && e.target.dataset && e.target.dataset.a === 'coach-nombre') guardarNombreCoach(e.target.value); });

Object.assign(ACTIONS, {
  'coach-aplicar': () => coachAplicar(),
  'coach-claude': () => enClaude(PROMPT_COACH()),
  'coach-sentir-hoja': () => hojaSentir(),
  'coach-sentir': el => { const n = +el.dataset.v; closeSheet(); coachAnotar({ tipo: 'sensacion', nivel: n, texto: SENSACIONES.find(x => x[0] === n)[1] }, n <= 2 ? 'Anotado: lo tengo en cuenta para hoy' : 'Anotado'); },
  'coach-dolor': () => { const t = ($('#dolor-t') || {}).value || ''; if (!t.trim()) { $('#dolor-t')?.focus(); return; } closeSheet(); coachAnotar({ tipo: 'dolor', texto: t.trim() }, 'Anotado. Hoy bajamos la carga; si no mejora, consulta a un profesional.'); },
});

// Si al abrir se sincroniza, el semáforo se pide al acabar (en sync): no dos veces.
capListo.then(() => { if (LIVE && S.onboarded && !syncing) cargarCoach(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && LIVE && S.onboarded) cargarCoach(); });
