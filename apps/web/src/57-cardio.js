/* ===== Series de bici y correr: el entreno guiado de un día =====
   Los crea Claude con entreno_enviar_garmin (tipo cardio) y quedan enlazados al día del plan (entreno_cardio).
   La app enseña los pasos y deja volver a mandarlo al reloj. */
const CZ = {}; // id → undefined (sin pedir) · 'cargando' · null (no está) · entreno con resumen

const cardioDelDia = f => { const s = sesion(f); return s && (s.dep === 'bici' || s.dep === 'correr') && s.t !== 'descanso' ? s : null; };

async function cargarCardio(id, fresco) {
  if (CZ[id] === 'cargando') return;
  const fuente = fuenteDatos(); if (fuente === 'espera') { cuandoHayaConector(); return; }
  if (fuente === 'demo') return; // en el modo demo no hay series guardadas
  CZ[id] = 'cargando';
  try { CZ[id] = await coachCall('entrenos', { tipo: 'cardio', id }, fresco); } catch (e) { CZ[id] = null; }
  render(); if (sheetState && (sheetState.id === 'dia' || sheetState.id === 'cent')) fillSheet();
}

/** Los pasos en filas; los de un bloque que se repite, sangrados debajo de "5 ×". */
function pasosCardio(resumen) {
  return `<ol class="pasos">${resumen.map(l => {
    const dentro = /^\s/.test(l); const t = l.trim();
    const rep = /^\d+ ×$/.test(t);
    const [tipo, ...resto] = t.split(': ');
    return `<li class="${dentro ? 'dentro' : ''}${rep ? ' rep' : ''}">${rep ? `<b>${esc(t.replace('×', 'veces'))}</b>` : `<b>${esc(tipo)}</b>${resto.length ? ` <span>${esc(resto.join(': '))}</span>` : ''}`}</li>`;
  }).join('')}</ol>`;
}

/** El bloque de series de un día. '' si no es de bici o correr. */
function bloqueCardio(f) {
  const s = cardioDelDia(f); if (!s) return '';
  if (!s.entreno_cardio) {
    if (f < HOY || s.a) return '';
    return `<div class="dia-pista stack"><p class="small">¿Lo quieres guiado en el reloj, con series y zonas? Claude te lo prepara y lo manda a tu Garmin.</p>
      <div class="btns"><button class="btn tonal" type="button" data-a="claude" data-v="${esc(`Prepárame el entreno del ${fLarga(f)} (${s.d}) para el reloj`)}">${ic('claude', 18)} Pedírselo a Claude</button></div></div>`;
  }
  const id = s.entreno_cardio;
  if (CZ[id] === undefined) cargarCardio(id);
  if (fuenteDatos() === 'demo') return '<p class="small muted">En el modo demo no hay series guardadas.</p>';
  if (CZ[id] === undefined || CZ[id] === 'cargando') return '<p class="small muted" role="status">Cargando los pasos…</p>';
  const e = CZ[id];
  if (!e) return `<p class="small">Este día apunta al entreno <b>${esc(id)}</b>, que no encuentro. Pídele a Claude que lo vuelva a crear.</p>`;
  const enReloj = e.garmin && e.garmin.fecha === f;
  return `<div class="stack" style="gap:8px">
    <div class="card-h" style="margin:0"><span class="grow"><b>${esc(e.nombre)}</b></span>${e.min_estimados ? `<span class="small muted">≈ ${dur(e.min_estimados)}</span>` : ''}</div>
    ${e.nota ? `<p class="small muted">${esc(e.nota)}</p>` : ''}
    ${pasosCardio(e.resumen || [])}
    ${f >= HOY ? `<div class="btns"><button class="btn tonal" type="button" data-a="cz-reloj" data-v="${f}">${ic('watch', 18)} ${enReloj ? 'Volver a enviar al reloj' : 'Enviar al reloj'}</button></div>
      ${enReloj ? '<p class="small muted">Ya está en tu reloj para este día: sincronízalo y búscalo en Entrenamientos.</p>' : ''}` : ''}
  </div>`;
}

function enviarCardioAlReloj(f) {
  const s = cardioDelDia(f); const e = s && CZ[s.entreno_cardio]; if (!e || typeof e !== 'object') return;
  ask({
    title: 'Enviar al reloj',
    text: e.garmin && e.garmin.workout_id ? `Se actualiza "${e.nombre}" en tu Garmin Connect (el mismo entreno, no otro) y se programa para el ${fDia(f)}.` : `Se crea "${e.nombre}" en tu Garmin Connect, paso a paso, y se programa para el ${fDia(f)}.`,
    actions: [
      { label: 'Enviar al reloj', kind: 'fill', fn: async () => {
        try { const r = await coachCall('entreno_enviar_garmin', { tipo: 'cardio', id: e.id, fecha: f, confirm: true }, true); toast(r.programado ? 'En tu reloj: sincronízalo' : 'En Garmin, pero no en el calendario'); CZ[e.id] = undefined; cargarCardio(e.id, true); }
        catch (err) { toast('No he podido enviarlo: ' + (err.message || 'error')); }
      } },
      { label: 'Cancelar' },
    ],
  });
}

Object.assign(ACTIONS, { 'cz-reloj': el => enviarCardioAlReloj(el.dataset.v) });
