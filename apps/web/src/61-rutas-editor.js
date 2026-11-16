/* ===== EDITOR DE RUTAS: crear una ruta o cambiarle solo un tramo, por donde ese deporte puede pasar =====
   El trazado, el firme y las medidas los da el conector (ruta_abrir, ruta_editar, ruta_guardar); aquí se elige y se dibuja.
   Cambiar un tramo: se marcan su principio y su final sobre la ruta, se toca por dónde pasar y se ve antes → después.
   Lo que queda fuera del tramo no se vuelve a trazar: sigue punto por punto como estaba.
   Con teclado se eligen el tramo (dos controles en el perfil) y todas las acciones; poner puntos de paso pide tocar el mapa. */

const ED = { map: null, dep: 'bici', nombre: '', P: [], total: null, hist: [], modo: 'alargar', tramo: null, cual: 0, vias: [], prev: null, busy: false, salida: null, avisos: [], sucia: false, marcas: [], foco: null, centro: null };
const ED_DEP = [['bici', 'Bici'], ['correr', 'Correr'], ['skimo', 'Skimo']];
// Qué actividades tuyas se pintan como "por donde ya has pasado" en cada deporte.
const ED_HUELLA = { bici: ['bici'], correr: ['correr', 'caminar', 'montana'], skimo: ['skimo', 'esqui', 'montana'] };
const ED_SENAL = { bici: ['https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png', 'Rutas ciclistas señalizadas', 'Rutas © Waymarked Trails (CC-BY-SA)'],
  correr: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', 'Senderos señalizados', 'Senderos © Waymarked Trails (CC-BY-SA)'],
  skimo: ['https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png', 'Pistas y remontes', 'Pistas © OpenSnowMap (CC-BY-SA)'] };
const edOpc = k => S[k] !== false; // las capas, encendidas mientras no se apaguen
const edMano = () => ED.dep !== 'bici' && !!S.edMano;
const edRuta = (P = ED.P) => P.map(p => [p[0], p[1], p[12], p[13]]);
const edLinea = (P, a = 0, b = P.length - 1) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: P.slice(a, b + 1).map(p => [p[0], p[1]]) } });
const ED_NADA = { type: 'FeatureCollection', features: [] };
const edKm = v => nf(v, v < 10 ? 2 : 1);

/* Abrir: de cero ({ dep }), una ruta de Garmin ({ course_id, nombre }) o una actividad ({ activity_id, dep, nombre }). */
function abrirEditor(origen) {
  if (fuenteDatos() !== 'vivo') { toast('Conecta tu Garmin para crear rutas aquí.'); return; }
  cerrarEditor(true); closeSheet(true);
  Object.assign(ED, { dep: origen.dep || 'bici', nombre: origen.nombre || '', P: [], total: null, hist: [], modo: 'alargar', tramo: null, cual: 0, vias: [], prev: null, busy: false, error: '', salida: null, avisos: [], sucia: false, marcas: [], foco: document.activeElement, centro: null });
  const el = document.createElement('div'); el.className = 'mapfull relieve editor'; el.id = 'editor'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Editor de rutas');
  el.innerHTML = `<div class="mf-top"><button class="close" type="button" aria-label="Cerrar el editor" data-a="ed-cerrar">${ic('close', 18)}</button>
      <h2 class="rel-titulo" id="ed-titulo"></h2>
      <button class="btn text ed-top" type="button" data-a="ed-deshacer" id="ed-deshacer" disabled>Deshacer</button>
      <button class="btn text ed-top" type="button" data-a="ed-opciones">Opciones</button></div>
    <div class="rel-view"><div class="rel-map" id="ed-map"></div>
      <p class="rel-estado" id="ed-estado" role="status">Cargando el mapa…</p>
      <div class="mf-zoom rel-zoom" hidden><button type="button" aria-label="Acercar" data-a="ed-zoom" data-v="1">${ic('plus', 22)}</button><button type="button" aria-label="Alejar" data-a="ed-zoom" data-v="-1">${ic('minus', 22)}</button><button type="button" aria-label="Ver la ruta entera" data-a="ed-entera">${ic('sync', 20)}</button></div>
      <div class="seg rel-tipo" id="ed-tipo" role="group" aria-label="Tipo de mapa" hidden></div>
      <p class="ed-pista" id="ed-pista" role="status" hidden></p></div>
    <div class="rel-panel ed-panel" id="ed-panel" hidden></div>`;
  app.append(el); requestAnimationFrame(() => el.classList.add('in')); el.querySelector('.close').focus();
  const datos = origen.course_id || origen.activity_id ? coachCall('ruta_abrir', origen.course_id ? { course_id: String(origen.course_id) } : { activity_id: String(origen.activity_id) }, true) : Promise.resolve(null);
  Promise.all([datos, cargarMapLibre()]).then(([r]) => {
    if (!$('#editor')) return;
    if (r) { edPoner(r); ED.modo = 'tramo'; if (!origen.dep && r.deporte) ED.dep = r.deporte; if (!ED.nombre && r.nombre) ED.nombre = r.nombre; }
    else ED.centro = edCentroPorDefecto();
    edMontar();
  }, e => edFallo(e));
}
function edFallo(e) {
  const est = $('#ed-estado'); if (!est) return; est.hidden = false; est.classList.add('fallo');
  est.innerHTML = e && e.message === 'mapa' ? '<b>No se ha podido descargar el mapa</b><span>Comprueba la conexión y vuelve a abrir el editor.</span>'
    : `<b>No he podido abrir esa ruta</b><span>${esc((e && e.message) || 'Garmin no ha devuelto el trazado.')} Cierra y vuelve a probar.</span>`;
}
function cerrarEditor(instant) {
  const el = $('#editor'); if (!el) return;
  if (ED.map) { try { ED.map.remove(); } catch (e) { } ED.map = null; }
  if (instant) el.remove(); else { el.classList.remove('in'); setTimeout(() => el.remove(), 250); }
  if (ED.foco && ED.foco.isConnected) ED.foco.focus(); ED.foco = null;
}
function edSalir() {
  if (!ED.sucia) { cerrarEditor(); return; }
  ask({ title: '¿Salir sin guardar?', text: 'La ruta que has hecho aquí se pierde. Lo que tienes en Garmin no cambia.', actions: [{ label: 'Seguir editando' }, { label: 'Salir sin guardar', kind: 'tonal', fn: () => cerrarEditor() }] });
}
/* Dónde abrir el mapa vacío: donde empezó tu última salida de ese deporte (o de cualquiera). */
function edCentroPorDefecto() {
  const rutas = DSET.rutas || {}, lista = [...acts()].reverse(), de = ED_HUELLA[ED.dep];
  const a = lista.find(x => rutas[x.id] && de.includes(x.dep)) || lista.find(x => rutas[x.id]);
  try { const p = a && decodePoly(rutas[a.id])[0]; if (p) return p; } catch (e) { }
  return [-3.7, 40.4];
}
/* Guarda lo que devuelve el conector como la ruta actual. */
function edPoner(r) { ED.P = r.puntos || []; ED.total = r.total || null; }
function edFoto() { return { P: ED.P, total: ED.total, salida: ED.salida, avisos: ED.avisos }; }

function edMontar() {
  let map;
  try {
    const caja = edCaja(ED.P);
    map = ED.map = new maplibregl.Map({ container: 'ed-map', style: relEstilo(), ...(caja ? { bounds: caja, fitBoundsOptions: { padding: 48 } } : { center: ED.centro, zoom: 12.5 }), maxPitch: 0, dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: { compact: true } });
    map.touchZoomRotate.disableRotation();
  } catch (e) {
    const est = $('#ed-estado'); est.classList.add('fallo'); est.innerHTML = '<b>Este navegador no puede dibujar el mapa</b><span>Abre myCoach en el navegador del móvil o del ordenador para crear rutas.</span>'; return;
  }
  map.on('error', () => { });
  map.on('load', () => {
    const rotulos = (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
    map.addSource('relieve', { type: 'raster-dem', url: REL_DEM }); map.addSource('sombras', { type: 'raster-dem', url: REL_DEM });
    map.addLayer({ id: 'sombras', type: 'hillshade', source: 'sombras', paint: { 'hillshade-exaggeration': .3, 'hillshade-shadow-color': '#4a5560', 'hillshade-highlight-color': '#ffffff' } }, rotulos);
    map.addSource('sat', { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics' });
    map.addSource('topo', { type: 'raster', tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)' });
    map.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' }, paint: { 'raster-brightness-min': .06, 'raster-saturation': .12 } });
    map.addLayer({ id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } });
    const simbolos = map.getStyle().layers.filter(l => l.type === 'symbol'); simbolos.forEach(l => map.moveLayer(l.id));
    ED.rotulos = simbolos.map(l => ({ id: l.id, color: map.getPaintProperty(l.id, 'text-color'), halo: map.getPaintProperty(l.id, 'text-halo-color') }));
    const col = k => `rgb(${relRgb(k).join(',')})`, redondo = { 'line-cap': 'round', 'line-join': 'round' };
    map.addSource('senal', { type: 'raster', tiles: ['about:blank'], tileSize: 256, maxzoom: 17 });
    for (const k of ['huella', 'ruta', 'tierra', 'viejo', 'nuevo']) map.addSource(k, { type: 'geojson', data: ED_NADA });
    map.addLayer({ id: 'huella', type: 'line', source: 'huella', layout: redondo, paint: { 'line-color': col('--huella'), 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 3.5],
      // Estas líneas tienen un punto cada varios cientos de metros: de lejos dicen por dónde sueles ir; de cerca atajarían por medio de las manzanas, así que se apagan.
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, .55, 13.2, .3, 14.2, 0] } });
    map.addLayer({ id: 'ruta-borde', type: 'line', source: 'ruta', layout: redondo, paint: { 'line-color': '#ffffff', 'line-width': 8 } });
    // Los colores de las líneas no siguen al tema: el mapa es claro con la app en claro o en oscuro (como en el relieve).
    map.addLayer({ id: 'ruta', type: 'line', source: 'ruta', layout: redondo, paint: { 'line-color': '#1D4FA0', 'line-width': 4.5 } });
    // Sin asfaltar: a rayas claras sobre la línea (no depende solo del color).
    map.addLayer({ id: 'tierra', type: 'line', source: 'tierra', paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [1.2, 1.6] } });
    // El tramo que se va a cambiar se apaga (gris, a rayas) y el nuevo va encima, más grueso.
    map.addLayer({ id: 'viejo-borde', type: 'line', source: 'viejo', layout: redondo, paint: { 'line-color': '#ffffff', 'line-width': 8 } });
    map.addLayer({ id: 'viejo', type: 'line', source: 'viejo', paint: { 'line-color': '#5F6670', 'line-width': 4.5, 'line-dasharray': [1, 1.2] } });
    map.addLayer({ id: 'nuevo-borde', type: 'line', source: 'nuevo', layout: redondo, paint: { 'line-color': '#ffffff', 'line-width': 10 } });
    map.addLayer({ id: 'nuevo', type: 'line', source: 'nuevo', layout: redondo, paint: { 'line-color': '#15191E', 'line-width': 5.5 } });
    map.on('click', e => edToque(e));
    $('#ed-estado').hidden = true; $('#editor .rel-zoom').hidden = false;
    const atr = $('#ed-map .maplibregl-ctrl-attrib'); if (atr) atr.classList.remove('maplibregl-compact-show');
    edCapas(); edTipo(); edTerreno(); edPintar();
  });
}
/* A mano (fuera de sendero) la altitud se lee del relieve del mapa: solo entonces se carga, aunque el mapa se vea plano.
   Con el relieve puesto, el mapa guarda lo ya dibujado y no repinta una línea que cambia: por eso edPintar se lo pide. */
function edTerreno() { const map = ED.map; if (!map || !map.getSource('relieve')) return; try { if (edMano() !== !!map.terrain) map.setTerrain(edMano() ? { source: 'relieve', exaggeration: 1 } : null); } catch (e) { } }
function edCaja(P) { if (!P || P.length < 2) return null; const xs = P.map(p => p[0]), ys = P.map(p => p[1]); return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]]; }

/* Las dos capas de ayuda: por donde ya has pasado tú y lo señalizado para ese deporte. */
function edCapas() {
  const map = ED.map; if (!map || !map.getSource('huella')) return;
  const rutas = DSET.rutas || {}, de = ED_HUELLA[ED.dep], lineas = [];
  if (edOpc('edHuella')) for (const a of acts()) { if (!rutas[a.id] || !de.includes(a.dep)) continue; try { const l = decodePoly(rutas[a.id]); if (l.length > 1) lineas.push(l); } catch (e) { } }
  map.getSource('huella').setData({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lineas } });
  const [url, , atr] = ED_SENAL[ED.dep];
  if (map.getLayer('senal')) map.removeLayer('senal'); map.removeSource('senal');
  map.addSource('senal', { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 17, attribution: atr });
  if (edOpc('edSenal')) map.addLayer({ id: 'senal', type: 'raster', source: 'senal', paint: { 'raster-opacity': .85 } }, 'huella');
}
function edTipo() {
  const map = ED.map, k = REL_MAPAS.some(m => m[0] === S.edMapa) ? S.edMapa : 'mapa'; if (!map || !map.getLayer('sat')) return;
  map.setLayoutProperty('sat', 'visibility', k === 'sat' ? 'visible' : 'none'); map.setLayoutProperty('topo', 'visibility', k === 'topo' ? 'visible' : 'none');
  map.getStyle().layers.filter(l => l.type === 'fill-extrusion').forEach(l => map.setLayoutProperty(l.id, 'visibility', 'none'));
  (ED.rotulos || []).forEach(({ id, color, halo }) => { map.setLayoutProperty(id, 'visibility', k === 'topo' ? 'none' : 'visible');
    map.setPaintProperty(id, 'text-color', k === 'sat' ? '#ffffff' : color); map.setPaintProperty(id, 'text-halo-color', k === 'sat' ? 'rgba(0,0,0,.75)' : halo); });
  const el = $('#ed-tipo'); el.hidden = false;
  el.innerHTML = REL_MAPAS.map(([v, l]) => `<button type="button" data-a="ed-mapa" data-v="${v}" aria-pressed="${k === v}">${l}</button>`).join('');
}

/* ===== Lo que se ve: la línea, las marcas, la pista de qué hacer y el panel ===== */
function edMarca(cls, p, txt, extra) {
  const d = document.createElement(extra && extra.boton ? 'button' : 'div'); d.className = cls; if (extra && extra.boton) d.type = 'button'; else d.setAttribute('role', 'img'); d.setAttribute('aria-label', txt);
  if (extra && extra.texto) d.textContent = extra.texto;
  const m = new maplibregl.Marker({ element: d, draggable: !!(extra && extra.mover) }).setLngLat([p[0], p[1]]).addTo(ED.map); ED.marcas.push(m); return m;
}
function edPintar() {
  const map = ED.map; if (!map || !map.getSource('ruta')) return;
  const P = ED.P, prev = ED.prev, Q = prev ? prev.puntos : P;
  map.getSource('ruta').setData(P.length > 1 ? edLinea(P) : ED_NADA);
  // Sin asfaltar (solo importa en bici de carretera): los trozos de la ruta que el conector marca como tierra.
  const tierra = [];
  if (ED.dep === 'bici' && S.edFirme !== 'gravel') for (let i = 1, ini = -1; i <= Q.length; i++) { const es = i < Q.length && Q[i][13] === 'tierra'; if (es && ini < 0) ini = i - 1; if (!es && ini >= 0) { tierra.push(edLinea(Q, ini, i - 1)); ini = -1; } }
  map.getSource('tierra').setData({ type: 'FeatureCollection', features: tierra });
  const t = ED.tramo;
  map.getSource('viejo').setData(t && t.b != null && t.b > t.a ? edLinea(P, t.a, t.b) : ED_NADA);
  map.getSource('nuevo').setData(prev ? edLinea(prev.puntos, prev.nuevo[0], prev.nuevo[1]) : ED_NADA);
  ED.marcas.forEach(m => m.remove()); ED.marcas = [];
  if (ED.salida && !P.length) edMarca('rel-salida', ED.salida, 'Salida');
  if (P.length) { edMarca('rel-salida', P[0], 'Salida'); const f = P[P.length - 1]; if (Math.hypot(f[0] - P[0][0], f[1] - P[0][1]) > 2e-4) edMarca('rel-ext ed-meta', f, 'Final de la ruta'); }
  if (t) { edMarca('rel-ext', P[t.a], 'Principio del tramo que cambias'); if (t.b != null) edMarca('rel-ext', P[t.b], 'Final del tramo que cambias'); }
  ED.vias.forEach((v, i) => { const m = edMarca('ed-via', v, `Punto de paso ${i + 1}. Arrástralo para moverlo o tócalo para quitarlo`, { boton: true, mover: true, texto: String(i + 1) });
    let movido = 0; // al soltar un punto arrastrado llega también un clic: ese no lo quita
    m.on('dragend', () => { movido = Date.now(); const ll = m.getLngLat(); ED.vias[i] = edConAltitud([ll.lng, ll.lat]); edPedirTramo(); });
    m.getElement().addEventListener('click', e => { e.stopPropagation(); if (ED.busy || Date.now() - movido < 400) return; ED.vias.splice(i, 1); if (ED.vias.length) edPedirTramo(); else { ED.prev = null; edPintar(); } }); });
  if (map.terrain) { try { map.terrain.sourceCache.freeRtt(); } catch (e) { } map.triggerRepaint(); }
  edPanel();
}
function edPista() {
  const t = ED.tramo, n = ED.P.length;
  if (ED.busy) return 'Trazando…';
  if (ED.error) return ED.error;
  if (ED.modo === 'tramo' && n > 1) {
    if (!t) return 'Toca la ruta donde empieza lo que quieres cambiar';
    if (t.b == null) return 'Ahora toca la ruta donde acaba';
    return ED.prev ? 'Arrastra un punto para afinar, o toca el mapa para añadir otro' : 'Toca el mapa por donde quieres pasar';
  }
  if (!n) return ED.salida ? 'Toca el siguiente punto: la ruta sigue el camino' : 'Toca el mapa donde quieres salir';
  return 'Toca el mapa para alargar la ruta';
}
function edPanel() {
  const pan = $('#ed-panel'); if (!pan) return; pan.hidden = ED.P.length < 2 && !ED.prev; // sin ruta todavía no hay nada que contar: todo el sitio para el mapa
  const P = ED.P, prev = ED.prev, Q = prev ? prev.puntos : P, tot = prev ? prev.total : ED.total, t = ED.tramo;
  $('#ed-titulo').textContent = ED.nombre || 'Ruta nueva';
  const des = $('#ed-deshacer'); des.disabled = ED.busy || !(ED.hist.length || ED.vias.length || t || ED.salida && !P.length);
  const pista = $('#ed-pista'); pista.hidden = false; pista.textContent = edPista(); pista.classList.toggle('fallo', !!ED.error && !ED.busy);
  const campo = (l, v, u) => `<div class="field"><span class="l">${l}</span><span class="v">${v}${u ? ` <small>${u}</small>` : ''}</span></div>`;
  let cifras;
  if (prev && prev.tramo.antes) {
    // Antes → después: lo que cambia en el tramo y en la ruta entera, antes de aplicarlo.
    const a = prev.tramo.antes, d = prev.tramo.despues;
    cifras = `<h3 class="rel-tramo-h">Del km ${nf(P[t.a][2], 1)} al ${nf(P[t.b][2], 1)}, antes → después</h3>
      <div class="fields ed-ad">${campo('Tramo', `${edKm(a.km)} → ${edKm(d.km)}`, 'km')}${campo('Subida del tramo', `${nf(a.subida, 0)} → ${nf(d.subida, 0)}`, 'm')}${campo('Ruta entera', `${nf(prev.total_antes.km, 1)} → ${nf(tot.km, 1)}`, 'km')}</div>`;
  } else cifras = `<div class="fields ed-cifras">${campo('Distancia', tot ? edKm(tot.km) : '0', 'km')}${campo('Subida', tot ? nf(tot.subida, 0) : '0', 'm')}${campo('Bajada', tot ? nf(tot.bajada, 0) : '0', 'm')}</div>`;
  // Perfil de altitud; al cambiar un tramo, la banda y las dos asas dicen cuál es (y se mueven con el dedo o el teclado).
  let perfil = '';
  if (Q.length > 1) {
    const W = 1000, H = 100, kmT = Q[Q.length - 1][2] || 1, alts = Q.map(p => p[3]).filter(v => v != null), a0 = alts.length ? Math.min(...alts) : 0, a1 = alts.length ? Math.max(...alts) : 1;
    const y = v => v == null ? H * .55 : 6 + (1 - (v - a0) / ((a1 - a0) || 1)) * (H - 10), asas = ED.modo === 'tramo' && t && t.b != null && !prev;
    perfil = `<div class="rel-perfil ed-perfil${asas ? ' tramo' : ''}" id="ed-perfil"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="M0,${H} ${Q.map(p => `L${(p[2] / kmT * W).toFixed(1)},${y(p[3]).toFixed(1)}`).join(' ')} L${W},${H}Z"/></svg>
        ${prev ? `<div class="rel-banda" style="left:${Q[prev.nuevo[0]][2] / kmT * 100}%;width:${(Q[prev.nuevo[1]][2] - Q[prev.nuevo[0]][2]) / kmT * 100}%"></div>` : ''}
        ${asas ? `<div class="rel-banda" id="ed-banda"></div><div class="rel-asa" id="ed-asa0"></div><div class="rel-asa" id="ed-asa1"></div>
          <input class="vh" type="range" id="ed-t0" min="0" max="${P.length - 1}" step="1" aria-label="Principio del tramo que cambias"><input class="vh" type="range" id="ed-t1" min="0" max="${P.length - 1}" step="1" aria-label="Final del tramo que cambias">` : ''}</div>
      <div class="rel-eje"><span>0 km</span><span>${alts.length ? `De ${nf(a0, 0)} a ${nf(a1, 0)} m` : 'Sin altitud'}</span><span>${nf(kmT, 1)} km</span></div>`;
  }
  const avisos = (prev ? prev.avisos : ED.avisos) || [];
  const hayTierra = Q.some(p => p[13] === 'tierra') && ED.dep === 'bici' && S.edFirme !== 'gravel';
  const notas = `${avisos.map(a => `<p class="ed-aviso"><b>Ojo:</b> ${esc(a.texto)}</p>`).join('')}${hayTierra ? '<p class="ed-ley"><i aria-hidden="true"></i>A rayas, lo que no está asfaltado</p>' : ''}`;
  let botones;
  if (prev && t) botones = `<button class="btn fill" type="button" data-a="ed-aplicar" ${ED.busy ? 'disabled' : ''}>Aplicar el cambio</button><button class="btn text" type="button" data-a="ed-descartar">Descartar</button>`;
  else if (t) botones = '<button class="btn text" type="button" data-a="ed-descartar">Dejar el tramo como estaba</button>';
  else {
    const cerrada = P.length > 1 && Math.hypot(P[P.length - 1][0] - P[0][0], P[P.length - 1][1] - P[0][1]) < 2e-4;
    botones = `${P.length > 1 ? `<button class="btn fill" type="button" data-a="ed-resumen" ${ED.busy ? 'disabled' : ''}>Ver el resumen</button>` : ''}
      ${ED.modo === 'alargar' && P.length > 1 && !cerrada ? `<button class="btn text" type="button" data-a="ed-volver" ${ED.busy ? 'disabled' : ''}>Volver a la salida</button>` : ''}`;
  }
  const modos = P.length > 1 && !t ? `<div class="seg" role="group" aria-label="Qué hace un toque en el mapa">${[['tramo', 'Cambiar un tramo'], ['alargar', 'Alargar la ruta']].map(([k, l]) => `<button type="button" data-a="ed-modo" data-v="${k}" aria-pressed="${ED.modo === k}">${l}</button>`).join('')}</div>` : '';
  pan.innerHTML = `${modos}${cifras}${perfil}${notas}${botones.trim() ? `<div class="btns">${botones}</div>` : ''}`;
  if ($('#ed-banda')) { edAsas(); edAsasDedo($('#ed-perfil')); }
}

/* ===== El tramo que se cambia: se marca tocando la ruta o con las asas del perfil ===== */
function edAsas() {
  const t = ED.tramo, P = ED.P; if (!t || t.b == null || !$('#ed-banda')) return;
  const kmT = P[P.length - 1][2] || 1, x = i => P[i][2] / kmT * 100;
  $('#ed-banda').style.cssText = `left:${x(t.a)}%;width:${x(t.b) - x(t.a)}%`; $('#ed-asa0').style.left = `${x(t.a)}%`; $('#ed-asa1').style.left = `${x(t.b)}%`;
  const km = P[t.b][2] - P[t.a][2], voz = `Tramo de ${edKm(km)} km, del km ${nf(P[t.a][2], 1)} al ${nf(P[t.b][2], 1)}`;
  [['#ed-t0', t.a], ['#ed-t1', t.b]].forEach(([id, i]) => { const r = $(id); r.value = i; r.setAttribute('aria-valuetext', voz); });
  const map = ED.map; if (map && map.getSource('viejo')) map.getSource('viejo').setData(edLinea(P, t.a, t.b));
  const m = ED.marcas.filter(x => x.getElement().classList.contains('rel-ext') && !x.getElement().classList.contains('ed-meta'));
  if (m[0]) m[0].setLngLat([P[t.a][0], P[t.a][1]]); if (m[1]) m[1].setLngLat([P[t.b][0], P[t.b][1]]);
}
function edAsasDedo(perfil) {
  let cual = null; const P = ED.P, n = P.length - 1, kmT = P[n][2] || 1, T = { puntos: P };
  const idx = e => { const r = perfil.getBoundingClientRect(); return relKmIdx(T, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * kmT); };
  const px = i => { const r = perfil.getBoundingClientRect(); return r.left + P[i][2] / kmT * r.width; };
  const pon = (k, i) => { const t = ED.tramo; if (k === 0) t.a = Math.max(0, Math.min(i, t.b - 1)); else t.b = Math.min(n, Math.max(i, t.a + 1)); edAsas(); };
  perfil.addEventListener('pointerdown', e => { perfil.setPointerCapture(e.pointerId); const t = ED.tramo; cual = Math.abs(e.clientX - px(t.a)) <= Math.abs(e.clientX - px(t.b)) ? 0 : 1; pon(cual, idx(e)); });
  perfil.addEventListener('pointermove', e => { if (cual != null) pon(cual, idx(e)); });
  const fin = () => { cual = null; }; perfil.addEventListener('pointerup', fin); perfil.addEventListener('pointercancel', fin);
  [['#ed-t0', 0], ['#ed-t1', 1]].forEach(([id, k]) => $(id).addEventListener('input', e => pon(k, +e.target.value)));
}
/* El punto de la ruta más cercano a un toque (en píxeles): solo cuenta si está a menos de 28 px. */
function edCerca(punto) {
  const map = ED.map, P = ED.P; let mejor = -1, d2 = 28 * 28;
  for (let i = 0; i < P.length; i++) { const q = map.project([P[i][0], P[i][1]]), d = (q.x - punto.x) ** 2 + (q.y - punto.y) ** 2; if (d < d2) { d2 = d; mejor = i; } }
  return mejor;
}
/* A mano: la altitud de un punto sale del relieve del mapa (lo único que la app lee por su cuenta). */
function edConAltitud(p) {
  if (!edMano()) return [p[0], p[1]];
  let e = null; try { e = ED.map.queryTerrainElevation({ lng: p[0], lat: p[1] }); } catch (x) { }
  return [p[0], p[1], e == null ? null : Math.round(e)];
}
/* A mano, entre punto y punto va una recta: se le ponen puntos cada 60 m para que el perfil tenga altitud. */
function edRellenar(lista) {
  if (!edMano()) return lista; const out = [];
  lista.forEach((p, i) => { if (i) { const a = lista[i - 1], m = Math.hypot((p[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), p[1] - a[1]) * 111320, n = Math.min(60, Math.floor(m / 60)); for (let k = 1; k <= n; k++) out.push(edConAltitud([a[0] + (p[0] - a[0]) * k / (n + 1), a[1] + (p[1] - a[1]) * k / (n + 1)])); } out.push(p); });
  return out;
}

function edToque(e) {
  if (ED.busy || ED.prev && !ED.tramo) return;
  ED.error = '';
  const p = [e.lngLat.lng, e.lngLat.lat], P = ED.P, t = ED.tramo;
  if (ED.modo === 'tramo' && P.length > 1) {
    if (!t || t.b == null) {
      const i = edCerca(e.point);
      if (i < 0) { $('#ed-pista').textContent = 'Toca encima de la ruta, no fuera'; return; }
      if (!t) ED.tramo = { a: i, b: null };
      else if (i === t.a) return; else ED.tramo = { a: Math.min(t.a, i), b: Math.max(t.a, i) };
      edPintar(); if (ED.tramo.b != null) edEncuadrar(ED.P.slice(ED.tramo.a, ED.tramo.b + 1)); return;
    }
    if (ED.vias.length >= 12) { $('#ed-pista').textContent = 'Ya hay 12 puntos en este tramo: aplica el cambio y sigue'; return; }
    ED.vias.push(edConAltitud(p)); edPintar(); edPedirTramo(); return;
  }
  // Alargar: el primer toque es la salida; cada toque siguiente, un trozo más hasta ahí.
  if (!P.length && !ED.salida) { ED.salida = edConAltitud(p); edPintar(); return; }
  edAlargar([edConAltitud(p)]);
}
function edEncuadrar(P) { const c = edCaja(P); if (c && ED.map) ED.map.fitBounds(c, { padding: { top: 90, bottom: 60, left: 50, right: 70 }, maxZoom: 15, duration: reduced ? 0 : 500 }); }

function edPeticion(extra) {
  return { deporte: ED.dep, firme: S.edFirme === 'gravel' ? 'gravel' : 'carretera', evitar_trafico: !!S.edTrafico, a_mano: edMano(), ...extra };
}
async function edLlamar(args) {
  ED.busy = true; ED.error = ''; edPanel();
  try { return await coachCall('ruta_editar', edPeticion(args), true); }
  // El porqué va en la pista del mapa, donde se está mirando (los mensajes del conector que empiezan así están escritos para leerlos).
  catch (e) { const m = (e && e.message) || ''; ED.error = /^(Por ahí|Ahí|El trazador)/.test(m) ? m : 'No he podido trazar ese tramo. Prueba otra vez.'; return null; }
  finally { ED.busy = false; }
}
/* Vista previa del tramo nuevo (no cambia la ruta hasta "Aplicar el cambio"). */
async function edPedirTramo() {
  const t = ED.tramo; if (!t || t.b == null || !ED.vias.length) return;
  const r = await edLlamar({ ruta: edRuta(), desde: t.a, hasta: t.b, por: edRellenar([ED.P[t.a], ...ED.vias, ED.P[t.b]]).slice(1, -1) });
  if (!$('#editor')) return;
  if (r) ED.prev = r; else if (!ED.prev) ED.vias.pop(); // si el punto nuevo no vale, se quita y se queda lo que había
  edPintar();
  // Si el tramo nuevo se sale de lo que se ve, se encuadra junto con el viejo: hay que poder compararlos.
  if (r && ED.map) { const N = r.puntos.slice(r.nuevo[0], r.nuevo[1] + 1), v = ED.map.getBounds(); if (N.some(p => !v.contains([p[0], p[1]]))) edEncuadrar([...ED.P.slice(t.a, t.b + 1), ...N]); }
}
async function edAlargar(por) {
  const P = ED.P, base = P.length ? [P[P.length - 1]] : [ED.salida];
  const lista = edRellenar([...base, ...por]).slice(P.length ? 1 : 0);
  const r = await edLlamar(P.length ? { ruta: edRuta(), desde: P.length - 1, hasta: P.length - 1, por: lista } : { por: lista });
  if (!$('#editor')) return;
  if (r) { ED.hist.push(edFoto()); edPoner(r); ED.avisos = r.avisos || []; ED.salida = null; ED.sucia = true; }
  edPintar();
}

/* ===== Resumen (el mapa en relieve) y guardar en Garmin ===== */
function edResumen() {
  if (ED.P.length < 2) return;
  const t = { puntos: ED.P, tiene: { alt: ED.P.some(p => p[3] != null), vel: false, fc: false, t: false, w: false } };
  REL_TRAZAS.set('ruta-editor', relFrac(t));
  abrirRelieve('ruta-editor', { id: 'ruta-editor', lugar: ED.nombre || 'Ruta nueva', dep: ED.dep, ruta: true });
}
function edGuardarHoja() {
  const tot = ED.total; if (!tot) return;
  openSheet({ title: 'Guardar en Garmin', size: 'medium', id: 'ed-guardar', body: () => `<form class="stack" style="gap:12px" id="ed-form">
      <label class="stack" style="gap:6px"><span class="small">Nombre de la ruta</span><input class="search" type="text" id="ed-nombre" autocomplete="off" maxlength="80" value="${esc(ED.nombre || `Ruta de ${nf(tot.km, 0)} km`)}" required></label>
      <p class="small muted">${edKm(tot.km)} km y ${nf(tot.subida, 0)} m de subida. Se guarda como ruta nueva: las que ya tienes en Garmin no cambian. Para quitarla, bórrala en Garmin Connect.</p>
      <div class="btns"><button class="btn fill" type="submit" id="ed-guardar-btn">Guardar en Garmin</button><button class="btn text" type="button" data-a="sheet-close">Ahora no</button></div></form>` });
  const f = $('#ed-form'); if (f) f.addEventListener('submit', e => { e.preventDefault(); edGuardar(($('#ed-nombre').value || '').trim()); });
}
async function edGuardar(nombre) {
  if (!nombre) return; const b = $('#ed-guardar-btn'); if (b) { b.disabled = true; b.textContent = 'Guardando…'; }
  try {
    const r = await coachCall('ruta_guardar', { nombre, deporte: ED.dep, firme: S.edFirme === 'gravel' ? 'gravel' : 'carretera', ruta: edRuta(), confirm: true }, true);
    ED.nombre = nombre; ED.sucia = false; RUT.datos = undefined; closeSheet(); cerrarRelieve(true); cerrarEditor(); render();
    const g = r && r.segun_garmin; toast(g && g.distancia_km ? `Guardada en Garmin: ${nf(g.distancia_km, 1)} km. Envíala al dispositivo desde Garmin Connect.` : 'Guardada en Garmin. Envíala al dispositivo desde Garmin Connect.', { ms: 7000 });
  } catch (e) { if (b) { b.disabled = false; b.textContent = 'Guardar en Garmin'; } toast('No he podido guardarla: ' + ((e && e.message) || 'error'), { ms: 7000 }); }
}

/* ===== Opciones: cómo se traza y qué se ve en el mapa ===== */
function edOpciones() {
  const sw = (k, l, sub, on) => `<label class="li ed-sw" for="ed-o-${k}"><span class="main"><b>${l}</b>${sub ? `<span>${sub}</span>` : ''}</span><input class="switch" type="checkbox" id="ed-o-${k}" data-a="ed-opc" data-v="${k}" ${on ? 'checked' : ''}></label>`;
  openSheet({ title: 'Opciones de la ruta', size: 'large', id: 'ed-opc', body: () => `<div class="stack" style="gap:16px">
      <section class="stack" style="gap:8px"><h4 class="ed-h">Por dónde trazar</h4>
        <div class="seg" role="group" aria-label="Deporte">${ED_DEP.map(([k, l]) => `<button type="button" data-a="ed-dep" data-v="${k}" aria-pressed="${ED.dep === k}">${l}</button>`).join('')}</div>
        ${ED.dep === 'bici' ? `<div class="seg" role="group" aria-label="Tipo de bici">${[['carretera', 'Carretera'], ['gravel', 'Gravel']].map(([k, l]) => `<button type="button" data-a="ed-firme" data-v="${k}" aria-pressed="${(S.edFirme === 'gravel' ? 'gravel' : 'carretera') === k}">${l}</button>`).join('')}</div>
          <div class="list">${sw('edTrafico', 'Evitar carreteras con tráfico', 'Da algo de rodeo para ir por secundarias', !!S.edTrafico)}</div>`
        : `<div class="list">${sw('edMano', 'Trazar a mano', 'Rectas entre tus puntos, para ir fuera de sendero. No mira si se puede pasar', !!S.edMano)}</div>`}
        <p class="small muted">${ED.dep === 'bici' ? `Nunca traza por autopistas, autovías, escaleras ni ferris. ${S.edFirme === 'gravel' ? 'En gravel entra por pistas y caminos.' : 'En carretera evita lo que no está asfaltado y, si no hay otra, te lo marca a rayas.'}` : 'Sigue senderos, pistas y calles que constan en OpenStreetMap; no dice nada de la nieve ni del riesgo de aludes.'} Lo que ya está trazado no cambia.</p></section>
      <section class="stack" style="gap:8px"><h4 class="ed-h">Ver en el mapa</h4>
        <div class="list">${sw('edHuella', 'Por donde ya has pasado', 'Tus salidas, en lila. Es aproximado: al acercar el mapa se apaga', edOpc('edHuella'))}${sw('edSenal', ED_SENAL[ED.dep][1], 'Lo que está marcado sobre el terreno', edOpc('edSenal'))}</div></section></div>` });
}

Object.assign(ACTIONS, {
  'ed-abrir': el => abrirEditor({ course_id: el.dataset.v || undefined, activity_id: el.dataset.act || undefined, dep: el.dataset.dep || undefined, nombre: el.dataset.n || '' }),
  'ed-nueva': () => edNuevaHoja(),
  'ed-cerrar': () => edSalir(),
  'ed-zoom': el => { if (ED.map) ED.map.easeTo({ zoom: ED.map.getZoom() + +el.dataset.v, duration: reduced ? 0 : 300 }); },
  'ed-entera': () => edEncuadrar(ED.prev ? ED.prev.puntos : ED.P),
  'ed-mapa': el => { S.edMapa = el.dataset.v; save(); edTipo(); const b = $(`#ed-tipo [data-v="${S.edMapa}"]`); if (b) b.focus(); },
  'ed-modo': el => { ED.modo = el.dataset.v; edPintar(); const b = $(`#ed-panel [data-a="ed-modo"][data-v="${ED.modo}"]`); if (b) b.focus(); },
  'ed-opciones': () => edOpciones(),
    'ed-dep': el => { ED.dep = el.dataset.v; fillSheet(); edCapas(); edTerreno(); edPintar(); if (ED.vias.length) edPedirTramo(); },
  'ed-firme': el => { S.edFirme = el.dataset.v; save(); fillSheet(); edPintar(); if (ED.vias.length) edPedirTramo(); },
  'ed-volver': () => { const P = ED.P; if (P.length > 1) edAlargar([[P[0][0], P[0][1], P[0][12]]]); },
  'ed-aplicar': () => { const r = ED.prev; if (!r) return; ED.hist.push(edFoto()); edPoner(r); ED.avisos = r.avisos || []; ED.prev = null; ED.tramo = null; ED.vias = []; ED.sucia = true; edPintar();
    toast('Tramo cambiado', { undo: () => edDeshacer() }); const b = $('#ed-panel .btn'); if (b) b.focus(); },
  'ed-descartar': () => { ED.prev = null; ED.tramo = null; ED.vias = []; edPintar(); edEncuadrar(ED.P); },
  'ed-deshacer': () => edDeshacer(),
  'ed-resumen': () => edResumen(),
  'ed-guardar': () => edGuardarHoja(),
});
/* Deshacer va de lo más reciente a lo más antiguo: el último punto de paso, el tramo marcado, la salida o el último cambio aplicado. */
function edDeshacer() {
  if (ED.busy) return;
  if (ED.vias.length) { ED.vias.pop(); if (ED.vias.length) { edPintar(); edPedirTramo(); return; } ED.prev = null; }
  else if (ED.tramo) ED.tramo = ED.tramo.b != null ? { a: ED.tramo.a, b: null } : null;
  else if (ED.salida && !ED.P.length) ED.salida = null;
  else if (ED.hist.length) { const h = ED.hist.pop(); ED.P = h.P; ED.total = h.total; ED.salida = h.salida; ED.avisos = h.avisos; }
  edPintar();
}
/* Crear una ruta: el deporte y de dónde partir (de cero o de una salida tuya). */
function edNuevaHoja() {
  const dep = () => ED_DEP.some(d => d[0] === S.edDep) ? S.edDep : 'bici';
  openSheet({ title: 'Crear una ruta', size: 'large', id: 'ed-nueva', body: () => {
    const d = dep(), rutas = DSET.rutas || {}, mias = [...acts()].reverse().filter(a => rutas[a.id] && a.dep === d && a.km > 1).slice(0, 8);
    return `<div class="stack" style="gap:14px"><div class="seg" role="group" aria-label="Deporte">${ED_DEP.map(([k, l]) => `<button type="button" data-a="ed-nueva-dep" data-v="${k}" aria-pressed="${d === k}">${l}</button>`).join('')}</div>
      <div class="list"><button class="li" type="button" data-a="ed-abrir" data-dep="${d}"><span class="main"><b>Empezar de cero</b><span>Tocas el mapa y la ruta sigue ${d === 'bici' ? 'las carreteras' : 'los caminos'}</span></span>${ic('chev', 18)}</button></div>
      ${mias.length ? `<section class="stack" style="gap:8px"><h4 class="ed-h">A partir de una salida tuya</h4><div class="list">${mias.map(a => `<button class="li" type="button" data-a="ed-abrir" data-act="${a.id}" data-dep="${d}" data-n="${esc(a.lugar)}"><span class="main"><b>${esc(a.lugar)}</b><span>${cap1(fLarga(a.f))} · ${nf(a.km, 1)} km</span></span>${ic('chev', 18)}</button>`).join('')}</div></section>` : ''}</div>`; } });
}
ACTIONS['ed-nueva-dep'] = el => { S.edDep = el.dataset.v; save(); fillSheet(); };
// Los interruptores de Opciones (el reparto de clics de la app no atiende a los <input>).
document.addEventListener('change', e => { const el = e.target; if (!el.dataset || el.dataset.a !== 'ed-opc') return; S[el.dataset.v] = el.checked; save(); if (el.dataset.v === 'edHuella' || el.dataset.v === 'edSenal') edCapas(); else { edTerreno(); if (ED.vias.length) edPedirTramo(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#editor') && !$('#relieve') && !sheetState && !$('.dialog')) { e.stopPropagation(); edSalir(); } }, true);
