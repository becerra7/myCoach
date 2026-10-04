/* ===== Fuerza: el entreno del día, lo que hiciste y tu histórico =====
   El entreno lo propone y lo guarda Claude (herramientas fuerza_* del conector); la app lo enseña.
   Antes: cada ejercicio con series × reps, peso, material, descanso y lo que hiciste la última vez.
   Después: plan frente a lo hecho (lo cuenta el reloj o se lo dices a Claude). Sin marcar series aquí. */
const FZ = {}; // fecha → undefined (sin pedir) · 'cargando' · null (nada) · { entreno, hecha, cambios_frente_al_plan }

// Cualquier día de fuerza: aunque el plan no diga qué entreno es, el conector lo busca por lo que se mandó
// al reloj o se hizo ese día. Si no hay ninguno, el bloque no sale.
const fuerzaDelDia = f => { const s = sesion(f); return s && s.dep === 'fuerza' && s.t !== 'descanso' ? s : null; };

// Modo demo: un entreno de ejemplo para ver cómo queda, sin conector.
const DEMO_FUERZA = { id: 'demo', nombre: 'Fuerza en casa (ejemplo)', ejercicios: [
  { nombre: 'Sentadilla búlgara', series: 3, reps: 10, peso_kg: 8, material: 'mancuernas', descanso_s: 90, garmin: true },
  { nombre: 'Peso muerto rumano', series: 3, reps: 10, peso_kg: 16, material: 'kettlebell', descanso_s: 90, garmin: true },
  { nombre: 'Plancha', series: 3, segundos: 40, descanso_s: 60, garmin: true },
] };

async function cargarFuerza(f, fresco) {
  if (FZ[f] === 'cargando') return;
  const fuente = fuenteDatos(); if (fuente === 'espera') { cuandoHayaConector(); return; }
  if (fuente === 'demo') { FZ[f] = { entreno: DEMO_FUERZA, demo: true }; return; }
  FZ[f] = 'cargando';
  try { FZ[f] = await coachCall('fuerza_dia', { fecha: f }, fresco); } catch (e) { FZ[f] = null; }
  render(); if (sheetState && sheetState.id === 'dia') fillSheet();
}

const kg = v => (v || v === 0) && v !== undefined ? `${String(v).replace('.', ',')} kg` : '';
function objetivoEj(e) {
  const reps = e.segundos ? `${e.segundos} s` : e.reps_max ? `${e.reps}-${e.reps_max}` : e.reps;
  return [`${e.series} × ${reps}`, kg(e.peso_kg), e.material, e.descanso_s ? `descanso ${e.descanso_s >= 60 && e.descanso_s % 60 === 0 ? `${e.descanso_s / 60} min` : `${e.descanso_s} s`}` : ''].filter(Boolean).join(' · ');
}
const ESTADO_EJ = {
  hecho: ['check', 'Como estaba', 'var(--good)'],
  mas: ['check', 'Más que el plan', 'var(--good)'],
  cambiado: ['edit', 'Cambiado', 'var(--warn)'],
  no_hecho: ['close', 'No hecho', 'var(--bad)'],
};

/** El bloque de fuerza de un día. '' si ese día no hay entreno de fuerza.
    enActividad: desde la pantalla de una actividad de fuerza, aunque el plan no la tuviera. */
function bloqueFuerza(f, enActividad) {
  const s = fuerzaDelDia(f) || (enActividad ? {} : null); if (!s) return '';
  if (FZ[f] && FZ[f].demo && fuenteDatos() === 'vivo') FZ[f] = undefined; // el ejemplo no se queda si ya hay conector
  if (FZ[f] === undefined) cargarFuerza(f);
  if (FZ[f] === undefined || FZ[f] === 'cargando') return '<p class="small muted" role="status">Cargando el entreno…</p>';
  const d = FZ[f]; const e = d && d.entreno;
  if (!e) return s.entreno ? `<p class="small">Este día apunta al entreno <b>${esc(s.entreno)}</b>, que ya no existe. Pídele a Claude que lo vuelva a crear.</p>`
    : enActividad ? '<p class="small">Aún no tengo tus series de este día. Pídele a Claude que las lea de tu reloj o cuéntale qué hiciste.</p>' : '';
  const cambios = Object.fromEntries((d.cambios_frente_al_plan || []).map(c => [c.ejercicio, c]));
  const filas = e.ejercicios.map(x => {
    const c = d.hecha && cambios[x.nombre]; const est = c && ESTADO_EJ[c.estado];
    // Hecho o no hecho: debajo va el plan y la etiqueta dice cómo fue. Cambiado: qué cambió.
    const detalle = c && (c.estado === 'mas' || c.estado === 'cambiado') ? c.texto.replace(`${x.nombre}: `, '') : objetivoEj(x);
    const ultima = x.ultima ? (x.ultima.texto === x.plan ? `Igual que la última vez (${fDia(x.ultima.fecha)})` : `La última vez: ${x.ultima.texto} (${fDia(x.ultima.fecha)})`) : '';
    return `<button type="button" class="li" data-a="fz-hist" data-v="${esc(x.nombre)}" aria-label="${esc(x.nombre)}: ${esc(detalle)}. Ver histórico">
      ${est ? `<span style="color:${est[2]}" aria-hidden="true">${ic(est[0], 20)}</span>` : ''}
      <span class="main"><b>${esc(x.nombre)}</b><span>${esc(detalle)}</span>${est ? `<span class="small" style="color:${est[2]}">${est[1]}</span>` : ultima ? `<span class="small muted">${esc(ultima)}</span>` : ''}${x.nota && !c ? `<span class="small muted">${esc(x.nota)}</span>` : ''}</span>
      ${ic('chev', 18, 'chev')}</button>`;
  }).join('');
  const extra = (d.cambios_frente_al_plan || []).filter(c => c.estado === 'extra').map(c => `<p class="small muted">${esc(c.texto)}</p>`).join('');
  const enReloj = e.garmin && e.garmin.fecha === f && !e.garmin.desactualizado;
  const pie = d.hecha
    ? `<p class="small muted">${d.hecha.fuente === 'garmin' ? 'Contada por tu reloj.' : 'Registrada con Claude.'} Toca un ejercicio para ver su histórico.</p>`
    : enActividad ? '<p class="small muted">Aún sin registrar: pídele a Claude que lea las series de tu reloj.</p>'
    : f >= HOY ? `<div class="btns"><button class="btn tonal" type="button" data-a="fz-reloj" data-v="${f}">${ic('watch', 18)} ${enReloj ? 'Volver a enviar al reloj' : 'Enviar al reloj'}</button></div>
      ${enReloj ? '<p class="small muted">Ya está en tu reloj para este día: sincronízalo y búscalo en Entrenamientos.</p>' : ''}` : '';
  return `<div class="stack" style="gap:8px">${d.hecha ? `<p class="small"><b>Hecha.</b> Así ha ido frente al plan:</p>` : ''}<div class="list">${filas}</div>${extra}${pie}</div>`;
}

function hojaHistorialFuerza(nombre) {
  let datos;
  const cuerpo = () => {
    if (datos === undefined) return '<p class="small muted" role="status">Cargando…</p>';
    if (!datos || !datos.sesiones || !datos.sesiones.length) return '<p class="small">Aún no hay registros de este ejercicio. Cuando acabes una sesión, díselo a Claude o hazla con el reloj en modo fuerza.</p>';
    const max = Math.max(...datos.sesiones.map(x => x.peso_max || 0));
    const evo = datos.evolucion ? datos.evolucion.replace(/\d{4}-\d{2}-\d{2}/g, f => fDia(f)) : '';
    return `${evo ? `<p class="small">${esc(evo)}</p>` : ''}
      <div class="list">${datos.sesiones.map(x => `<div class="li" style="cursor:default"><span class="main"><b>${fDia(x.fecha)}</b><span>${esc(x.texto)}</span><span class="small muted">${esc(x.entreno)}</span></span>
        ${max ? `<span aria-hidden="true" style="width:72px;height:8px;border-radius:4px;background:var(--fill);overflow:hidden"><span style="display:block;height:100%;width:${Math.round((x.peso_max || 0) / max * 100)}%;background:var(--tint)"></span></span>` : ''}</div>`).join('')}</div>`;
  };
  openSheet({ title: nombre, size: 'auto', id: 'fz-hist', body: cuerpo });
  coachCall('fuerza_historial', { ejercicio: nombre }, true).then(r => { datos = r; }, () => { datos = null; }).then(() => { if (sheetState && sheetState.id === 'fz-hist') fillSheet(); });
}

function enviarAlReloj(f) {
  const d = FZ[f]; const e = d && d.entreno; if (!e) return;
  if (d.demo) { toast('En el modo demo no se envía nada. Conecta tu Garmin para usarlo.'); return; }
  const sin = e.ejercicios.filter(x => !x.garmin).map(x => x.nombre);
  if (sin.length) { ask({ title: 'Falta un paso', text: `Para mandarlo al reloj, Claude tiene que elegir el ejercicio de Garmin de: ${sin.join(', ')}. Pídeselo y vuelve a probar.`, actions: [{ label: 'Entendido', kind: 'fill' }] }); return; }
  ask({
    title: 'Enviar al reloj',
    text: `${e.garmin && e.garmin.workout_id ? `Se actualiza "${e.nombre}" en tu Garmin Connect (el mismo entreno, no otro)` : `Se crea "${e.nombre}" en tu Garmin Connect`} con ${e.ejercicios.length} ejercicios (series, reps, peso y descanso) y se programa para el ${fDia(f)}.`,
    actions: [
      { label: 'Enviar al reloj', kind: 'fill', fn: async () => {
        try { const r = await coachCall('entreno_enviar_garmin', { tipo: 'fuerza', entreno: e.id, fecha: f, confirm: true }, true); toast(r.programado ? 'En tu reloj: sincronízalo' : 'En Garmin, pero no en el calendario'); FZ[f] = undefined; cargarFuerza(f, true); }
        catch (err) { toast('No he podido enviarlo: ' + (err.message || 'error')); }
      } },
      { label: 'Cancelar' },
    ],
  });
}

Object.assign(ACTIONS, {
  'fz-hist': el => hojaHistorialFuerza(el.dataset.v),
  'fz-reloj': el => enviarAlReloj(el.dataset.v),
});
