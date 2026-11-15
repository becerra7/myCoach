/* ===== v2 · Modo entreno de fuerza: el móvil al lado mientras entrenas =====
   Una serie por pantalla: el ejercicio, las repeticiones y el peso en grande, un botón y el descanso.
   Al acabar se enseña lo hecho y, con tu sí, se guarda con fuerza_registrar (lo mismo que hace tu Claude).
   El borrador vive en este dispositivo (S.fv): si cierras la app a medias, sigue donde estaba. */
let FV_T = null, FV_LOCK = null;
const fvEnt = f => { if (FZ[f] && FZ[f].demo && fuenteDatos() === 'vivo') FZ[f] = undefined; if (FZ[f] === undefined) cargarFuerza(f); const d = FZ[f]; return d && typeof d === 'object' ? d.entreno : d; };
function fvEmpezar(f) {
  if (!S.fv || S.fv.f !== f) S.fv = { f, i: 0, hechas: {}, reps: null, kg: null, hasta: 0 };
  save(); push({ s: 'fuerza-vivo', id: f });
  try { navigator.wakeLock && navigator.wakeLock.request('screen').then(l => { FV_LOCK = l; }).catch(() => {}); } catch (e) { /* sin bloqueo de pantalla: no pasa nada */ }
}
function fvSalir() { clearInterval(FV_T); FV_T = null; try { FV_LOCK && FV_LOCK.release(); } catch (e) { /* ya estaba suelto */ } FV_LOCK = null; }
const fvVal = (st, x) => ({ n: st.reps ?? (x.segundos || x.reps || 10), kg: st.kg ?? (x.peso_kg ?? null) });
const fvSerieTxt = (x, s) => `${x.segundos ? `${s.reps} s` : s.reps}${s.peso_kg != null ? ` × ${String(s.peso_kg).replace('.', ',')} kg` : ''}`;
function scrFuerzaVivo(scr) {
  const f = scr.id, e = fvEnt(f), st = S.fv && S.fv.f === f ? S.fv : null;
  const fuera = t => ({ title: 'Entreno', html: `<div class="fv"><h1>Entreno de fuerza</h1><section class="card">${t}</section></div>` });
  if (e === undefined || e === 'cargando') return fuera('<p class="muted" role="status">Cargando el entreno…</p>');
  if (!e || !st || !e.ejercicios?.length) return fuera('<p>No encuentro el entreno de este día. Vuelve atrás y ábrelo desde la sesión.</p>');
  const n = e.ejercicios.length;
  if (st.i >= n) { // resumen: lo que se va a guardar, antes de guardarlo
    const filas = e.ejercicios.map((x, i) => { const h = st.hechas[i] || [];
      return `<div class="li" style="cursor:default"><span class="main"><b>${esc(x.nombre)}</b><span>${h.length ? h.map(s => fvSerieTxt(x, s)).join(' · ') : 'No hecho'}</span><span class="small muted">Plan: ${esc(objetivoEj(x))}</span></span>${h.length ? tag('good', '✓', '') : tag('neutral', '✕', '')}</div>`; }).join('');
    const algo = Object.values(st.hechas).some(h => h.length);
    return { title: 'Resumen', html: `<div class="fv"><h1>Lo que has hecho</h1><p class="muted">Repásalo. Se guarda en tu myCoach tal como está aquí${st.demo || fuenteDatos() !== 'vivo' ? ' (en el modo demo no se guarda)' : ''}.</p>
      <div class="list">${filas}</div>
      <button class="btn fill wide" type="button" data-a="fv-guardar"${algo && !st.guardando ? '' : ' disabled'}>${st.guardando ? 'Guardando…' : 'Guardar la sesión'}</button>
      <button class="btn text" type="button" data-a="fv-volver">Volver al último ejercicio</button>
      <button class="btn text danger" type="button" data-a="fv-descartar">Descartar lo apuntado</button></div>` };
  }
  const x = e.ejercicios[st.i], hechas = st.hechas[st.i] || [], total = x.series || 1, v = fvVal(st, x), tiempo = !!x.segundos;
  const ult = x.ultima_vez || x.ultima, resto = Math.max(0, Math.round((st.hasta - Date.now()) / 1000));
  return { title: e.nombre || 'Entreno', html: `<div class="fv">
    <div class="fv-prog" role="img" aria-label="Ejercicio ${st.i + 1} de ${n}">${e.ejercicios.map((_, i) => `<i class="${i < st.i ? 'ya' : i === st.i ? 'act' : ''}"></i>`).join('')}</div>
    <div><p class="small muted">Ejercicio ${st.i + 1} de ${n}</p><h1>${esc(x.nombre)}</h1>
      <p class="muted" style="margin-top:4px">Serie ${Math.min(hechas.length + 1, total)} de ${total}${x.material ? ` · ${esc(x.material)}` : ''}${ult && typeof ult === 'string' ? ` · la última vez, ${esc(ult)}` : ''}</p></div>
    <div class="fv-st" role="group" aria-label="${tiempo ? 'Segundos' : 'Repeticiones'}"><button type="button" data-a="fv-n" data-v="${tiempo ? -5 : -1}" aria-label="Menos ${tiempo ? 'segundos' : 'repeticiones'}">−</button><div class="c"><b class="cifra xl" aria-live="polite">${v.n}</b><span>${tiempo ? 'segundos' : 'repeticiones'}</span></div><button type="button" data-a="fv-n" data-v="${tiempo ? 5 : 1}" aria-label="Más ${tiempo ? 'segundos' : 'repeticiones'}">+</button></div>
    ${v.kg != null ? `<div class="fv-st" role="group" aria-label="Peso"><button type="button" data-a="fv-kg" data-v="-1" aria-label="Menos peso">−</button><div class="c"><b class="cifra xl" aria-live="polite">${String(v.kg).replace('.', ',')}<small>kg</small></b><span>peso</span></div><button type="button" data-a="fv-kg" data-v="1" aria-label="Más peso">+</button></div>` : ''}
    <button class="btn fill wide" type="button" data-a="fv-hecha">${hechas.length >= total ? 'Otra serie más' : 'Serie hecha'}</button>
    ${hechas.length ? `<div class="fv-series" aria-label="Series hechas">${hechas.map(s => `<span>${fvSerieTxt(x, s)}</span>`).join('')}</div>` : ''}
    <div class="fv-desc"><span>${resto ? 'Descanso' : `Descanso previsto${x.descanso_s ? '' : ': libre'}`}</span><b class="cifra" id="fv-reloj" style="font-size:28px" role="timer">${resto ? `${Math.floor(resto / 60)}:${String(resto % 60).padStart(2, '0')}` : x.descanso_s ? `${Math.floor(x.descanso_s / 60)}:${String(x.descanso_s % 60).padStart(2, '0')}` : '—'}</b></div>
    <div class="btns" style="justify-content:space-between"><button class="btn tonal" type="button" data-a="fv-ir" data-v="-1"${st.i ? '' : ' disabled'}>Anterior</button><button class="btn tonal" type="button" data-a="fv-ir" data-v="1">${st.i === n - 1 ? 'Terminar' : hechas.length ? 'Siguiente ejercicio' : 'Saltar'}</button></div>
    ${hechas.length ? '<button class="btn text" type="button" data-a="fv-quitar">Quitar la última serie</button>' : ''}
  </div>` };
}
scrV2('fuerza-vivo', scrFuerzaVivo);
function fvReloj() {
  clearInterval(FV_T);
  FV_T = setInterval(() => { const el = document.getElementById('fv-reloj'), st = S.fv; if (!el || !st) { clearInterval(FV_T); return; }
    const r = Math.round((st.hasta - Date.now()) / 1000);
    if (r <= 0) { clearInterval(FV_T); st.hasta = 0; render(); try { navigator.vibrate && navigator.vibrate(200); } catch (e) { /* sin vibración */ } return; }
    el.textContent = `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; }, 500);
}
async function fvGuardar() {
  const st = S.fv; if (!st) return; const e = fvEnt(st.f); if (!e || typeof e !== 'object') return;
  const ejercicios = e.ejercicios.map((x, i) => { const h = st.hechas[i] || []; return h.length ? { nombre: x.nombre, series: h.length, series_hechas: h.map(s => ({ reps: s.reps, ...(s.peso_kg != null ? { peso_kg: s.peso_kg } : {}) })) } : { nombre: x.nombre, omitido: true }; });
  const fin = msg => { const f = st.f; S.fv = null; save(); fvSalir(); FZ[f] = undefined; S.stack = S.stack.filter(s => s.s !== 'fuerza-vivo'); render(true); toast(msg); };
  if (fuenteDatos() !== 'vivo' || e.id === 'demo') { fin('Sesión terminada (en el modo demo no se guarda)'); return; }
  st.guardando = true; render();
  try { await coachCall('fuerza_registrar', { entreno: e.id || e.nombre, fecha: st.f, ejercicios }, true); fin('Sesión guardada. Tu entrenador ya la ve.'); }
  catch (err) { st.guardando = false; render(); toast('No he podido guardarla. Lo apuntado sigue aquí: vuelve a probar en un momento.', { ms: 7000 }); }
}
Object.assign(ACTIONS, {
  'fv-empezar': el => { closeSheet(); fvEmpezar(el.dataset.v || HOY); },
  'fv-n': el => { const st = S.fv, x = fvEnt(st.f).ejercicios[st.i]; st.reps = Math.max(1, fvVal(st, x).n + +el.dataset.v); save(); render(); },
  'fv-kg': el => { const st = S.fv, x = fvEnt(st.f).ejercicios[st.i], kg = fvVal(st, x).kg || 0, paso = kg >= 20 ? 2.5 : 1; st.kg = Math.max(0, Math.round((kg + paso * +el.dataset.v) * 2) / 2); save(); render(); },
  'fv-hecha': () => { const st = S.fv, x = fvEnt(st.f).ejercicios[st.i], v = fvVal(st, x); (st.hechas[st.i] = st.hechas[st.i] || []).push({ reps: v.n, ...(v.kg != null ? { peso_kg: v.kg } : {}) });
    st.hasta = x.descanso_s ? Date.now() + x.descanso_s * 1000 : 0; save(); render(); if (st.hasta) fvReloj(); },
  'fv-quitar': () => { const st = S.fv; (st.hechas[st.i] || []).pop(); st.hasta = 0; save(); render(); },
  'fv-ir': el => { const st = S.fv; st.i = Math.max(0, st.i + +el.dataset.v); st.reps = null; st.kg = null; st.hasta = 0; clearInterval(FV_T); save(); render(true); },
  'fv-volver': () => { const st = S.fv; st.i = Math.max(0, fvEnt(st.f).ejercicios.length - 1); save(); render(true); },
  'fv-guardar': () => fvGuardar(),
  'fv-descartar': () => ask({ title: '¿Descartar lo apuntado?', text: 'Se borran las series que has marcado en esta sesión. El plan no cambia.', actions: [{ label: 'Seguir entrenando' }, { label: 'Descartar', kind: 'fill', fn: () => { S.fv = null; save(); fvSalir(); pop(); } }] }),
});
/* Al salir de la pantalla se suelta el reloj y la pantalla; el borrador se queda */
{ const popV1 = pop; pop = function () { const s = S.stack[S.stack.length - 1]; if (s && s.s === 'fuerza-vivo') fvSalir(); popV1(); }; }
