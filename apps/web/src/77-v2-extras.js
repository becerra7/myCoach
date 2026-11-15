/* ===== v2 · Seguir una molestia y buscar =====
   Molestia: un dolor anotado se queda a la vista en Hoy hasta que dices que ya está, en vez de perderse
   cuando pasa el día. Se lee del diario del entrenador (atleta/diario) y se anota con coach_anotar.
   Buscar: una actividad, un pueblo o un entreno por nombre, sobre lo que la app ya tiene cargado. */
const DIARIO = { datos: undefined, fuente: null };
async function cargarDiario() {
  const f = fuenteDatos(); if (f === 'espera') return; DIARIO.fuente = f;
  if (f === 'demo') { DIARIO.datos = S.sentirDemo && S.sentirDemo.dolor ? [{ fecha: S.sentirDemo.f, tipo: 'dolor', texto: S.sentirDemo.dolor.texto }] : []; return; }
  DIARIO.datos = 'cargando';
  try { DIARIO.datos = (await coachCall('app_leer', { doc: 'atleta/diario' }, true)) || []; } catch (e) { DIARIO.datos = null; }
  render();
}
function molestiaAbierta() {
  if (fuenteDatos() === 'demo') { const d = S.sentirDemo; return d && d.dolor && d.f !== S.molestiaOk ? { fecha: d.f, texto: d.dolor.texto } : null; }
  if (DIARIO.datos !== undefined && DIARIO.datos !== 'cargando' && fuenteDatos() !== 'espera' && DIARIO.fuente !== fuenteDatos()) DIARIO.datos = undefined;
  if (DIARIO.datos === undefined) cargarDiario();
  if (!Array.isArray(DIARIO.datos)) return null;
  const desde = addDays(HOY, -10), m = DIARIO.datos.filter(n => n && n.tipo === 'dolor' && n.texto && n.fecha >= desde && n.fecha <= HOY).sort((a, b) => a.fecha < b.fecha ? 1 : -1)[0];
  return m && m.fecha !== S.molestiaOk ? m : null;
}
function tarjetaMolestia() {
  const m = molestiaAbierta(); if (!m) return '';
  const dias = Math.round((dte(HOY) - dte(m.fecha)) / 864e5), cuando = dias === 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`;
  return `<section class="card" aria-labelledby="mol-t"><h2 class="g-h" id="mol-t" style="padding:0"><span>Molestia anotada ${cuando}</span></h2>
    <p>${esc(m.texto)}</p>${dias >= 3 ? '<p class="small muted">Lleva varios días: si no mejora, consulta a un profesional.</p>' : ''}
    <div class="btns"><button class="btn tonal" type="button" data-a="v2-mol-ok" data-v="${m.fecha}">Ya está bien</button>${dias > 0 ? `<button class="link" type="button" data-a="v2-mol-sigue">Sigue igual</button>` : ''}</div></section>`;
}
async function molestiaOk(fecha) {
  const antes = S.molestiaOk; S.molestiaOk = fecha; save();
  if (fuenteDatos() === 'vivo' && fecha === HOY) { try { await coachCall('coach_anotar', { tipo: 'dolor', borrar: true }, true); DIARIO.datos = undefined; cargarCoach(true); } catch (e) { /* queda cerrada aquí; el motor la olvida sola a las 36 h */ } }
  else if (fuenteDatos() === 'demo' && S.sentirDemo && fecha === HOY) { S.sentirDemo = { ...S.sentirDemo, dolor: null }; save(); }
  render(); toast('Me alegro. Lo quito de Hoy.', { undo: () => { S.molestiaOk = antes; save(); render(); } });
}
async function molestiaSigue() {
  const m = molestiaAbierta(); if (!m) return;
  if (fuenteDatos() !== 'vivo') { S.sentirDemo = { f: HOY, sensacion: S.sentirDemo && S.sentirDemo.f === HOY ? S.sentirDemo.sensacion : null, dolor: { texto: m.texto } }; save(); render(); toast('Anotado para hoy: bajamos la carga.'); return; }
  try { await coachCall('coach_anotar', { tipo: 'dolor', texto: m.texto }, true); DIARIO.datos = undefined; toast('Anotado para hoy: bajamos la carga. Si no mejora, consulta a un profesional.', { ms: 7000 }); cargarCoach(true); }
  catch (e) { toast('No he podido anotarlo. Vuelve a probar en un momento.'); }
}

/* Buscar */
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function resultadosBusca(q) {
  const n = norm(q).trim(); if (n.length < 2) return '<p class="muted" style="padding:0 4px">Escribe al menos dos letras: el nombre de una salida, un deporte, un pueblo o un entreno.</p>';
  const as = acts().filter(a => norm(`${a.lugar} ${SPORTS[a.dep]?.n}`).includes(n)).sort((a, b) => a.f < b.f ? 1 : -1).slice(0, 12);
  const ps = pueblosDe([]).filter(t => norm(t.n).includes(n)).slice(0, 8);
  const es = (Array.isArray(ENTS) ? ENTS : []).filter(e => norm(e.nombre).includes(n)).slice(0, 6);
  if (!as.length && !ps.length && !es.length) return `<section class="card"><b>Nada con «${esc(q.trim())}»</b><p class="small muted">Busco en tus últimas 300 actividades, en los pueblos por los que has pasado y en tus entrenos guardados.</p></section>`;
  return [as.length ? grupo2(as.map(a => fila2(esc(a.lugar), `${cap1(fLarga(a.f))} · ${esc(detalleAct(a))}`, `data-a="push" data-v="actividad" data-id="${a.id}"`, { icono: `<i class="dot" style="background:${scol(a.dep)}" aria-hidden="true"></i>` })).join(''), 'Actividades') : '',
    ps.length ? grupo2(ps.map(t => fila2(esc(t.n), `${nf(t.km)} km`, 'data-a="push" data-v="pueblos"')).join(''), 'Pueblos') : '',
    es.length ? grupo2(es.map(e => fila2(esc(e.nombre), esc(resumenEntreno(e)), `data-a="ent-abrir" data-v="${esc(e.id)}"`)).join(''), 'Entrenos') : ''].join('');
}
function scrBuscar() {
  if (LIVE && S.modo === 'vivo' && ENTS === undefined) cargarEntrenos();
  return { title: 'Buscar', html: `<div class="v2">${cab2('Buscar')}
    <label class="vh" for="busca-q">Buscar una actividad, un pueblo o un entreno</label><input id="busca-q" class="search" type="search" autocomplete="off" enterkeyhint="search" placeholder="Bellver, correr, pierna…" value="${esc(V.buscaQ || '')}">
    <div class="busca-r" id="busca-r" aria-live="polite">${resultadosBusca(V.buscaQ || '')}</div></div>` };
}
scrV2('buscar', scrBuscar);
document.addEventListener('input', e => { if (e.target && e.target.id === 'busca-q') { V.buscaQ = e.target.value; const r = document.getElementById('busca-r'); if (r) r.innerHTML = resultadosBusca(V.buscaQ); } });
Object.assign(ACTIONS, { 'v2-mol-ok': el => molestiaOk(el.dataset.v), 'v2-mol-sigue': () => molestiaSigue() });
