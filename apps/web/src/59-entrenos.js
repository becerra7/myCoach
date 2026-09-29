/* ===== Tus entrenos: la librería de fuerza =====
   Los entrenos con nombre que guarda el conector (fuerza_*): verlos, editarlos y ponerlos en
   un día del plan. Se crean con Claude o duplicando uno; aquí se ajustan series, reps, kg y
   descanso, se quitan ejercicios o se añaden del catálogo de Garmin (así se pueden mandar al reloj). */
let ENTS; // undefined: sin pedir · 'cargando' · null: error · [ { id, nombre, lugar, ejercicios, min_estimados, ultima_sesion, veces } ]
const ENT = {}; // id → { original, borrador, sucio } del entreno abierto

async function cargarEntrenos(fresco) {
  if (!LIVE || S.modo !== 'vivo' || ENTS === 'cargando') return;
  ENTS = 'cargando';
  try { ENTS = (await coachCall('fuerza_entrenos', {}, fresco)).entrenos || []; } catch (e) { ENTS = null; }
  render(); if (sheetState && sheetState.id === 'elegir-entreno') fillSheet();
}
const clonar = o => JSON.parse(JSON.stringify(o));
const resumenEntreno = e => [`${e.ejercicios.length} ejercicio${e.ejercicios.length === 1 ? '' : 's'}`, e.min_estimados ? `≈ ${dur(e.min_estimados)}` : '', e.lugar === 'gym' ? 'gimnasio' : e.lugar === 'casa' ? 'en casa' : ''].filter(Boolean).join(' · ');
const ultimaVez = e => e.ultima_sesion ? `Última vez: ${fDia(e.ultima_sesion.fecha)}` : 'Sin hacer todavía';
const sinConector = '<p class="small">Tus entrenos viven en tu conector de Garmin. Conéctalo para verlos.</p>';

/* Lista */
function scrEntrenos() {
  let cuerpo;
  if (!LIVE || S.modo !== 'vivo') cuerpo = sinConector;
  else if (ENTS === undefined || ENTS === 'cargando') { if (ENTS === undefined) cargarEntrenos(true); cuerpo = '<p class="small muted" role="status">Cargando tus entrenos…</p>'; }
  else if (ENTS === null) cuerpo = '<p class="small">No he podido leer tus entrenos. Vuelve a probar en un momento.</p><div class="btns"><button class="btn tonal" type="button" data-a="ent-recargar">Volver a probar</button></div>';
  else if (!ENTS.length) cuerpo = '<div class="card stack" style="gap:8px"><b>Aún no tienes entrenos</b><p class="small">Pídele a Claude una sesión de fuerza (en casa o en el gimnasio) y dile que la guarde con un nombre, por ejemplo "Pierna A". Aparecerá aquí para editarla y ponerla en tu plan.</p></div>';
  else cuerpo = `<div class="list">${ENTS.map(e => `<button type="button" class="li" data-a="ent-abrir" data-v="${esc(e.id)}"><span class="main"><b>${esc(e.nombre)}</b><span>${esc(resumenEntreno(e))}</span><span class="small muted">${esc(ultimaVez(e))}${e.veces > 1 ? ` · ${e.veces} veces` : ''}</span></span>${ic('chev', 18, 'chev')}</button>`).join('')}</div>
    <p class="small muted aj-nota">Para ponerlos en tu semana, toca un día en Plan y elige "Poner un entreno de fuerza".</p>`;
  return { title: 'Tus entrenos', html: head('Tus entrenos', 'De fuerza, para repetirlos y ajustarlos') + `<div class="content" style="max-width:640px">${cuerpo}</div>` };
}

/* Un entreno, editable */
async function abrirEntreno(id, fresco) {
  ENT[id] = { cargando: true };
  try { const e = await coachCall('fuerza_entrenos', { id }, fresco); ENT[id] = { original: e, borrador: clonar(e), sucio: false }; }
  catch (err) { ENT[id] = { error: err.message || 'No lo encuentro' }; }
  render();
}
const campoNum = (i, k, etiqueta, v, extra = '', oculto = '') => `<label class="stack ent-campo" for="ent-${i}-${k}" style="gap:4px"><span class="xs">${etiqueta}${oculto ? `<span class="vh"> ${oculto}</span>` : ''}</span><input id="ent-${i}-${k}" class="search" type="number" inputmode="decimal" min="0" ${extra} value="${v ?? ''}" data-a="ent-campo" data-i="${i}" data-k="${k}"></label>`;

function scrEntreno(scr) {
  const st = ENT[scr.id];
  if (!st) { abrirEntreno(scr.id, true); return { title: '', html: head('Entreno', '') + '<div class="content"><p class="small muted" role="status">Cargando…</p></div>' }; }
  if (st.cargando) return { title: '', html: head('Entreno', '') + '<div class="content"><p class="small muted" role="status">Cargando…</p></div>' };
  if (st.error) return { title: 'Entreno', html: head('Entreno', '') + `<div class="content"><p class="small">${esc(st.error)}</p></div>` };
  const e = st.borrador;
  const ejercicios = e.ejercicios.map((x, i) => `<div class="card stack" style="gap:10px">
      <label class="stack" for="ent-${i}-nombre" style="gap:4px"><span class="xs">Ejercicio ${i + 1}</span><input id="ent-${i}-nombre" class="search" value="${esc(x.nombre)}" maxlength="60" data-a="ent-campo" data-i="${i}" data-k="nombre"></label>
      <div class="ent-grid">
        ${campoNum(i, 'series', 'Series', x.series, 'min="1" max="10" step="1"')}
        ${x.segundos ? campoNum(i, 'segundos', 'Segundos', x.segundos, 'min="5" max="900" step="5"') : campoNum(i, 'reps', 'Reps', x.reps, 'min="1" max="100" step="1"')}
        ${campoNum(i, 'peso_kg', 'Kg', x.peso_kg, 'step="0.5" max="500" placeholder="—"')}
        ${campoNum(i, 'descanso_s', 'Descanso', x.descanso_s, 'step="15" max="600"', 'en segundos')}
      </div>
      ${x.material || x.nota ? `<p class="small muted" style="margin:0">${esc([x.material, x.nota].filter(Boolean).join(' · '))}</p>` : ''}
      <div class="row" style="justify-content:space-between;gap:8px"><span class="small muted">${x.garmin ? `${ic('watch', 14)} Va al reloj` : 'Sin ejercicio de Garmin: no va al reloj'}</span>
        <button class="btn text" type="button" data-a="ent-quitar" data-v="${i}" aria-label="Quitar ${esc(x.nombre)}">Quitar</button></div>
    </div>`).join('');
  const html = head(e.nombre, esc(resumenEntreno(e))) + `<div class="content stack" style="max-width:640px;gap:16px">
    <div class="card stack" style="gap:12px">
      <label class="stack" for="ent-nombre" style="gap:4px"><span class="xs">Nombre</span><input id="ent-nombre" class="search" value="${esc(e.nombre)}" maxlength="60" data-a="ent-campo" data-k="nombre"></label>
      <div class="stack" style="gap:4px"><span class="xs" id="ent-lugar-l">Dónde</span><div class="seg" role="group" aria-labelledby="ent-lugar-l"><button type="button" data-a="ent-lugar" data-v="casa" aria-pressed="${e.lugar === 'casa'}">En casa</button><button type="button" data-a="ent-lugar" data-v="gym" aria-pressed="${e.lugar === 'gym'}">Gimnasio</button></div></div>
      ${e.nota ? `<p class="small muted" style="margin:0">${esc(e.nota)}</p>` : ''}
    </div>
    <h2 class="aj-h" style="margin:8px 0 0">Ejercicios</h2>
    ${ejercicios}
    <div class="btns"><button class="btn tonal" type="button" data-a="ent-anadir">Añadir ejercicio</button></div>
    <div class="ent-barra" id="ent-barra" ${st.sucio ? '' : 'hidden'}><div class="btns"><button class="btn fill" type="button" data-a="ent-guardar" id="ent-guardar" ${st.sucio ? '' : 'disabled'}>Guardar los cambios</button><button class="btn text" type="button" data-a="ent-descartar" id="ent-descartar">Descartar</button></div></div>
    <div class="btns"><button class="btn text" type="button" data-a="ent-duplicar">Duplicar</button><button class="btn text" type="button" data-a="ent-borrar" style="color:var(--bad)">Borrar el entreno</button></div>
  </div>`;
  return { title: e.nombre, html };
}

const entAbierto = () => { const t = S.stack[S.stack.length - 1]; return t && t.s === 'entreno' ? ENT[t.id] : null; };
function marcarSucio(st) {
  st.sucio = JSON.stringify(st.borrador) !== JSON.stringify(st.original);
  // Sin volver a pintar la pantalla, para no perder el foco del campo que se está escribiendo.
  const g = $('#ent-guardar'), barra = $('#ent-barra');
  if (g) g.disabled = !st.sucio; if (barra) barra.hidden = !st.sucio;
}
document.addEventListener('input', ev => {
  const el = ev.target; if (!el.dataset || el.dataset.a !== 'ent-campo') return;
  const st = entAbierto(); if (!st || !st.borrador) return;
  const k = el.dataset.k, i = el.dataset.i;
  const destino = i === undefined ? st.borrador : st.borrador.ejercicios[+i];
  if (k === 'nombre') destino.nombre = el.value;
  else if (el.value === '') delete destino[k];
  else destino[k] = Number(el.value.replace(',', '.'));
  marcarSucio(st);
});

const paraGuardar = e => ({
  id: e.id, nombre: (e.nombre || '').trim() || e.id, ...(e.lugar ? { lugar: e.lugar } : {}), ...(e.nota ? { nota: e.nota } : {}),
  ejercicios: e.ejercicios.map(({ plan, ultima, ...x }) => x),
});
async function guardarEntreno(el) {
  const st = entAbierto(); if (!st || !st.sucio) return;
  if (!st.borrador.ejercicios.length) { toast('El entreno necesita al menos un ejercicio'); return; }
  el.disabled = true; el.textContent = 'Guardando…';
  try {
    await coachCall('fuerza_entreno_guardar', paraGuardar(st.borrador), true);
    ENTS = undefined; for (const k of Object.keys(FZ)) delete FZ[k];
    const enReloj = st.borrador.garmin && st.borrador.garmin.workout_id;
    await abrirEntreno(st.borrador.id, true); toast(enReloj ? 'Guardado. Estaba en tu reloj: vuelve a enviarlo desde el día' : 'Entreno guardado', { ms: 6000 });
  } catch (err) { el.disabled = false; el.textContent = 'Guardar los cambios'; toast('No he podido guardarlo: ' + (err.message || 'error')); }
}

/* Añadir un ejercicio del catálogo de Garmin */
let busquedaEj = { q: '', res: null, pidiendo: false };
function hojaAnadirEjercicio() {
  busquedaEj = { q: '', res: null, pidiendo: false };
  openSheet({ title: 'Añadir ejercicio', size: 'large', id: 'ent-anadir', body: () => `<div class="stack" style="gap:12px">
    <label class="stack" for="ent-buscar" style="gap:6px"><span class="small">Busca en el catálogo de Garmin, en castellano o en inglés</span><input id="ent-buscar" class="search" type="search" placeholder="Sentadilla búlgara, remo con mancuerna…" value="${esc(busquedaEj.q)}" data-a="ent-buscar" autocomplete="off"></label>
    <div id="ent-res" aria-live="polite">${resultadosEj()}</div></div>` });
  setTimeout(() => $('#ent-buscar')?.focus(), 50);
}
function resultadosEj() {
  if (busquedaEj.pidiendo) return '<p class="small muted">Buscando…</p>';
  if (!busquedaEj.res) return '';
  if (!busquedaEj.res.length) return '<p class="small">No encuentro nada parecido. Prueba con otra palabra o en inglés (squat, lunge, row…).</p>';
  return `<div class="list">${busquedaEj.res.map((r, j) => `<button type="button" class="li" data-a="ent-elegir-ej" data-v="${j}"><span class="main"><b>${esc(r.nombre)}</b><span class="small muted">${esc(r.musculos.join(', '))}</span></span>${ic('check', 18)}</button>`).join('')}</div>`;
}
let esperaBusqueda = 0;
document.addEventListener('input', ev => {
  const el = ev.target; if (!el.dataset || el.dataset.a !== 'ent-buscar') return;
  busquedaEj.q = el.value; clearTimeout(esperaBusqueda);
  if (busquedaEj.q.trim().length < 3) { busquedaEj.res = null; const r = $('#ent-res'); if (r) r.innerHTML = ''; return; }
  esperaBusqueda = setTimeout(async () => {
    busquedaEj.pidiendo = true; const r = $('#ent-res'); if (r) r.innerHTML = resultadosEj();
    try { busquedaEj.res = (await coachCall('fuerza_ejercicios_garmin', { buscar: busquedaEj.q }, false)).ejercicios || []; } catch (e) { busquedaEj.res = []; }
    busquedaEj.pidiendo = false; const r2 = $('#ent-res'); if (r2) r2.innerHTML = resultadosEj();
  }, 350);
});

/* Poner un entreno en un día del plan */
function hojaElegirEntreno(f) {
  if (ENTS === undefined) cargarEntrenos(true);
  const s = sesion(f);
  openSheet({ title: 'Poner un entreno de fuerza', size: 'auto', id: 'elegir-entreno', body: () => {
    if (!Array.isArray(ENTS)) return ENTS === null ? '<p class="small">No he podido leer tus entrenos.</p>' : '<p class="small muted" role="status">Cargando tus entrenos…</p>';
    if (!ENTS.length) return '<p class="small">Aún no tienes entrenos. Pídele a Claude una sesión de fuerza y que la guarde con un nombre.</p>';
    return `<p class="small muted">${cap1(fLarga(f))}${s && s.t !== 'descanso' ? `. Sustituye: <b>${esc(s.d)}</b>` : ''}.</p>
      <div class="list">${ENTS.map(e => `<button type="button" class="li" data-a="ent-poner" data-v="${esc(e.id)}" data-f="${f}" ${s && s.entreno === e.id ? 'aria-current="true"' : ''}><span class="main"><b>${esc(e.nombre)}</b><span>${esc(resumenEntreno(e))}</span></span>${s && s.entreno === e.id ? `<span class="small muted">Ya está</span>` : ic('chev', 18, 'chev')}</button>`).join('')}</div>
      <button class="btn text" type="button" data-a="push-close" data-v="entrenos">Ver y editar tus entrenos</button>`;
  } });
}
function ponerEntreno(id, f) {
  const e = (ENTS || []).find(x => x.id === id); if (!e) return;
  const key = weekOf(f) === SEM ? 'plan' : 'next';
  closeSheet();
  commit(`${e.nombre} el ${fCorta(f)}`, () => {
    if (!S[key]) S[key] = {};
    const antes = S[key][f];
    S[key][f] = { dep: 'fuerza', t: 'otros', d: e.nombre, min: e.min_estimados || 45, entreno: e.id, ...(antes && antes.act ? { act: antes.act } : {}) };
  });
  delete FZ[f];
}

Object.assign(ACTIONS, {
  'ent-recargar': () => { ENTS = undefined; render(); },
  // Cada vez que se abre, fresco: puede haberlo cambiado Claude.
  'ent-abrir': el => { delete ENT[el.dataset.v]; push({ s: 'entreno', id: el.dataset.v }); },
  'ent-lugar': el => { const st = entAbierto(); if (!st) return; st.borrador.lugar = el.dataset.v; $$('[data-a="ent-lugar"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === el.dataset.v))); marcarSucio(st); },
  'ent-quitar': el => {
    const st = entAbierto(); if (!st) return; const i = +el.dataset.v; const quitado = st.borrador.ejercicios.splice(i, 1)[0];
    marcarSucio(st); render();
    toast(`Quitado: ${quitado.nombre}`, { undo: () => { st.borrador.ejercicios.splice(i, 0, quitado); marcarSucio(st); render(); } });
  },
  'ent-anadir': () => hojaAnadirEjercicio(),
  'ent-elegir-ej': el => {
    const st = entAbierto(); const r = busquedaEj.res && busquedaEj.res[+el.dataset.v]; if (!st || !r) return;
    st.borrador.ejercicios.push({ nombre: r.nombre, series: 3, reps: 10, descanso_s: 90, garmin: { categoria: r.categoria, ejercicio: r.ejercicio } });
    closeSheet(); marcarSucio(st); render(); toast(`Añadido: ${r.nombre}. Ajusta series, reps y kg.`);
  },
  'ent-guardar': el => guardarEntreno(el),
  'ent-descartar': () => { const st = entAbierto(); if (!st) return; st.borrador = clonar(st.original); st.sucio = false; render(); toast('Cambios descartados'); },
  'ent-duplicar': () => {
    const st = entAbierto(); if (!st) return; const base = st.sucio ? st.borrador : st.original;
    ask({ title: 'Duplicar el entreno', text: `Se crea "${base.nombre} (copia)" con los mismos ejercicios. Después puedes cambiarle el nombre y ajustarlo.`, actions: [
      { label: 'Duplicar', kind: 'fill', fn: async () => {
        try { const r = await coachCall('fuerza_entreno_guardar', { ...paraGuardar(base), id: undefined, nombre: `${base.nombre} (copia)`, nuevo: true }, true); ENTS = undefined; pop(); setTimeout(() => push({ s: 'entreno', id: r.guardado.id }), 350); toast('Duplicado'); }
        catch (err) { toast(err.message || 'No he podido duplicarlo'); }
      } },
      { label: 'Cancelar' }] });
  },
  'ent-borrar': () => {
    const st = entAbierto(); if (!st) return; const e = st.original;
    ask({ title: `¿Borrar "${e.nombre}"?`, text: 'Se borra de tu librería. Tu histórico de ejercicios se queda. Los días del plan que lo usaban siguen con su nombre, pero sin la lista de ejercicios.', actions: [
      { label: 'Borrar', kind: 'fill', fn: async () => {
        try { await coachCall('fuerza_entreno_guardar', { id: e.id, nombre: e.nombre, borrar: true }, true); ENTS = undefined; delete ENT[e.id]; pop(); toast('Entreno borrado'); }
        catch (err) { toast('No he podido borrarlo'); }
      } },
      { label: 'Cancelar' }] });
  },
  'ent-elegir': el => hojaElegirEntreno(el.dataset.v),
  'ent-poner': el => ponerEntreno(el.dataset.v, el.dataset.f),
});
