/* ===== RECORRIDO EN RELIEVE: el mapa 3D de una actividad, con el trazado pintado por pendiente, velocidad o pulso =====
   Los datos de cada punto los da el conector (garmin_activity_track); aquí solo se dibujan.
   MapLibre (el motor del mapa) pesa unos 280 kB comprimido: se descarga de la propia web la primera vez que se abre un mapa.
   Relieve: Mapterhorn. Mapa base: OpenFreeMap (datos de OpenStreetMap). Ninguno recibe el recorrido, solo la zona que se mira. */

const ORIGEN_WEB = (() => { try { const s = document.currentScript; return s && s.src ? new URL(s.src).origin : ''; } catch (e) { return ''; } })();
const REL = { a: null, t: null, modo: 'pend', map: null, punto: null, i: 0, foco: null, play: false, f: 0, vel: 1, rumbo: 0, raf: 0, ts: 0 };
const REL_TRAZAS = new Map(); // en memoria: no se guarda en el navegador (son cientos de puntos por salida)
const REL_DEM = 'https://tiles.mapterhorn.com/tilejson.json', REL_EXAG = 1.4;
// Mapa en color (bosque, agua, carreteras) también con la app en oscuro: en gris o en negro no se lee el terreno.
const relEstilo = () => 'https://tiles.openfreemap.org/styles/liberty';
// Columnas de cada punto, como las manda el conector.
const RC = { lon: 0, lat: 1, km: 2, alt: 3, pend: 4, vel: 5, fc: 6 };

let relLib = null;
function cargarMapLibre() {
  if (window.maplibregl) return Promise.resolve();
  return relLib || (relLib = new Promise((ok, mal) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = `${ORIGEN_WEB}/maplibre-gl.css`; document.head.append(css);
    const js = document.createElement('script'); js.src = `${ORIGEN_WEB}/maplibre-gl.js`; js.onload = () => ok(); js.onerror = () => { relLib = null; mal(new Error('mapa')); }; document.head.append(js);
  }));
}

/* Un color de app.css como [r, g, b]: MapLibre no entiende var(--x), así que se resuelve en el momento (y sigue al tema). */
function relRgb(token) {
  const el = document.createElement('i'); el.style.cssText = `position:absolute;visibility:hidden;color:var(${token})`; app.append(el);
  const cv = document.createElement('canvas').getContext('2d'); cv.fillStyle = getComputedStyle(el).color; cv.fillRect(0, 0, 1, 1); el.remove();
  return [...cv.getImageData(0, 0, 1, 1).data.slice(0, 3)];
}

/* Las tres maneras de pintar el trazado. Cada una: de qué valor a qué valor y con qué colores (tokens). */
function relEscala(modo, t) {
  const col = RC[modo], vals = t.puntos.map(p => p[col]).filter(v => v != null).sort((x, y) => x - y);
  const pct = q => vals[Math.min(vals.length - 1, Math.floor(q * vals.length))];
  const corre = REL.a && REL.a.dep === 'correr';
  if (modo === 'pend') return { col, cortes: [-10, 0, 5, 10], tokens: ['--fondo', '--rec', '--tempo', '--int'], extremos: ['Baja al 10 %', 'Llano', 'Sube al 10 %'] };
  const lo = pct(.03), hi = Math.max(pct(.97), lo + 1);
  if (modo === 'vel') return { col, cortes: [lo, hi], tokens: ['--tempo', '--fondo'], extremos: corre ? [`${ritmoC(lo)} min/km`, '', `${ritmoC(hi)} min/km`] : [`${nf(lo, 0)} km/h`, '', `${nf(hi, 0)} km/h`] };
  return { col, cortes: [lo, (lo + hi) / 2, hi], tokens: ['--fondo', '--tempo', '--int'], extremos: [`${nf(lo, 0)} ppm`, '', `${nf(hi, 0)} ppm`] };
}
function relColores(esc) {
  const rgb = esc.tokens.map(relRgb), sin = relRgb('--label-3');
  return v => {
    if (v == null) return `rgb(${sin.join(',')})`;
    const c = esc.cortes; let k = 0; while (k < c.length - 2 && v > c[k + 1]) k++;
    const f = Math.max(0, Math.min(1, (v - c[k]) / (c[k + 1] - c[k])));
    return `rgb(${rgb[k].map((x, j) => Math.round(x + (rgb[k + 1][j] - x) * f)).join(',')})`;
  };
}
/* Paradas del degradado a lo largo del trazado: [fracción de la distancia, color]. Sirven al mapa y al perfil. */
function relParadas(t, modo) {
  const esc = relEscala(modo, t), color = relColores(esc), n = t.puntos.length, paso = Math.max(1, Math.floor(n / 300)), out = [];
  for (let i = 0; i < n; i += paso) { const f = t.frac[i]; if (!out.length || f > out[out.length - 1][0]) out.push([f, color(t.puntos[i][esc.col])]); }
  return out;
}

/* El trazado: del conector si hay datos en vivo; en el ejemplo, la línea guardada y la altitud del propio relieve. */
async function relTraza(a) {
  if (REL_TRAZAS.has(a.id)) return REL_TRAZAS.get(a.id);
  let t;
  if (LIVE && S.modo === 'vivo' && !a.sim) t = await coachCall('garmin_activity_track', { activity_id: a.id });
  else {
    const linea = decodePoly((DSET.rutas || {})[a.id] || ''); if (linea.length < 2) throw new Error('sin trazado');
    t = { puntos: linea.map(([lon, lat]) => [lon, lat, 0, null, null, null, null]), tiene: { alt: false, vel: false, fc: false }, ejemplo: true };
  }
  // Distancia sobre el mapa de cada punto (0 a 1): es lo que usa el degradado de la línea.
  const R = Math.PI / 180; let d = 0; const acum = [0];
  for (let i = 1; i < t.puntos.length; i++) { const p = t.puntos[i - 1], q = t.puntos[i]; d += Math.hypot((q[0] - p[0]) * Math.cos(p[1] * R), q[1] - p[1]) * 111.32; acum.push(d); }
  t.frac = acum.map(x => x / (d || 1));
  if (t.ejemplo) t.puntos.forEach((p, i) => { p[2] = Math.round(acum[i] * 100) / 100; });
  REL_TRAZAS.set(a.id, t); return t;
}
/* Solo en el ejemplo: la altitud se lee del relieve ya cargado y la pendiente sale de ahí (en vivo lo calcula el conector). */
function relAltitudDeEjemplo(map, t) {
  try {
    const z = Math.min(12, Math.round(map.getZoom()));
    for (const p of t.puntos) { const e = map.terrain.getElevationForLngLatZoom(new maplibregl.LngLat(p[0], p[1]), z); p[3] = e == null ? null : Math.round(e / REL_EXAG); }
    const P = t.puntos;
    for (let i = 0; i < P.length; i++) { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], m = (b[2] - a[2]) * 1000; P[i][4] = m > 50 && a[3] != null && b[3] != null ? Math.max(-30, Math.min(30, Math.round((b[3] - a[3]) / m * 1000) / 10)) : null; }
    t.tiene.alt = P.some(p => p[3] != null); return t.tiene.alt;
  } catch (e) { return false; }
}

function abrirRelieve(id) {
  const a = actById(id); if (!a) return;
  cerrarRelieve(true); REL.a = a; REL.t = null; REL.i = 0; REL.f = 0; REL.vel = 1; REL.play = false; REL.modo = 'pend'; REL.foco = document.activeElement;
  const el = document.createElement('div'); el.className = 'mapfull relieve'; el.id = 'relieve'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', `Recorrido en relieve: ${a.lugar}`);
  el.innerHTML = `<div class="mf-top"><button class="close" type="button" aria-label="Cerrar el mapa" data-a="rel-cerrar">${ic('close', 18)}</button>
      <div class="seg" role="group" aria-label="Pintar el recorrido según" id="rel-seg" style="flex:1" hidden></div><h2 class="rel-titulo" id="rel-titulo">${esc(a.lugar)}</h2></div>
    <div class="rel-view"><div class="rel-map" id="rel-map"></div>
      <p class="rel-estado" id="rel-estado" role="status">Cargando el relieve…</p>
      <div class="mf-zoom rel-zoom" hidden><button type="button" aria-label="Acercar" data-a="rel-zoom" data-v="1">${ic('plus', 22)}</button><button type="button" aria-label="Alejar" data-a="rel-zoom" data-v="-1">${ic('minus', 22)}</button><button type="button" aria-label="Ver el recorrido entero" data-a="rel-entero">${ic('sync', 20)}</button></div>
      <div class="rel-play" id="rel-play" hidden></div></div>
    <div class="rel-panel" id="rel-panel" hidden></div>`;
  app.append(el); requestAnimationFrame(() => el.classList.add('in')); el.querySelector('.close').focus();
  Promise.all([relTraza(a), cargarMapLibre()]).then(([t]) => { if (REL.a !== a || !$('#relieve')) return; REL.t = t; relMontar(t); }, e => relFallo(e));
}
function relFallo(e) {
  const est = $('#rel-estado'); if (!est) return;
  const sinRed = e && e.message === 'mapa';
  est.innerHTML = `<b>${sinRed ? 'No se ha podido descargar el mapa' : 'No hay recorrido que enseñar'}</b><span>${sinRed ? 'Comprueba la conexión y vuelve a abrirlo.' : 'Garmin no ha devuelto el trazado de esta actividad. Vuelve a Hoy, actualiza y ábrela otra vez.'}</span>`;
  est.classList.add('fallo');
}
function cerrarRelieve(instant) {
  const el = $('#relieve'); if (!el) return;
  REL.play = false; cancelAnimationFrame(REL.raf);
  if (REL.map) { try { REL.map.remove(); } catch (e) { } REL.map = null; REL.punto = null; }
  if (instant) el.remove(); else { el.classList.remove('in'); setTimeout(() => el.remove(), 250); }
  if (REL.foco && REL.foco.isConnected) REL.foco.focus(); REL.foco = null;
}

function relMontar(t) {
  let map;
  try {
    const xs = t.puntos.map(p => p[0]), ys = t.puntos.map(p => p[1]);
    REL.caja = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
    map = REL.map = new maplibregl.Map({ container: 'rel-map', style: relEstilo(), bounds: REL.caja, fitBoundsOptions: { padding: 48 }, pitch: 55, maxPitch: 75, attributionControl: { compact: true } });
  } catch (e) {
    // Sin WebGL (navegador viejo o un marco que no lo deja): se dice y se deja el trazado plano.
    const est = $('#rel-estado'); est.classList.add('fallo'); est.innerHTML = `<b>Este navegador no puede dibujar el relieve</b><span>Aquí tienes el recorrido en plano. Para verlo en 3D, abre myCoach en el navegador del móvil o del ordenador.</span><div class="trackmap">${trackSvg(REL.a.id)}</div>`;
    return;
  }
  map.on('error', () => { }); // una tesela que falla no rompe el mapa
  map.on('dragstart', e => { if (e.originalEvent && REL.play) relPausar(); }); // si mueves el mapa con el dedo, el repaso se para: mandas tú
  map.on('load', () => {
    const rotulos = (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
    map.addSource('relieve', { type: 'raster-dem', url: REL_DEM });
    map.addSource('sombras', { type: 'raster-dem', url: REL_DEM });
    map.addLayer({ id: 'sombras', type: 'hillshade', source: 'sombras', paint: { 'hillshade-exaggeration': .35, 'hillshade-shadow-color': '#4a5560', 'hillshade-highlight-color': '#ffffff' } }, rotulos);
    map.setTerrain({ source: 'relieve', exaggeration: REL_EXAG });
    map.addSource('ruta', { type: 'geojson', lineMetrics: true, data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: t.puntos.map(p => [p[0], p[1]]) } } });
    const borde = '#ffffff'; // el mapa es claro con la app en claro o en oscuro: el borde de la línea no sigue al tema
    map.addLayer({ id: 'ruta-borde', type: 'line', source: 'ruta', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': borde, 'line-width': 8 } });
    map.addLayer({ id: 'ruta', type: 'line', source: 'ruta', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 4.5 } });
    const marca = (cls, p, txt) => { const d = document.createElement('div'); d.className = cls; d.setAttribute('role', 'img'); d.setAttribute('aria-label', txt); return new maplibregl.Marker({ element: d }).setLngLat([p[0], p[1]]).addTo(map); };
    marca('rel-salida', t.puntos[0], 'Salida');
    REL.punto = marca('rel-punto', t.puntos[0], 'Punto que estás mirando');
    $('#rel-estado').hidden = true; $('.rel-zoom').hidden = false; $('#rel-play').hidden = false; relBotones();
    const atr = $('#rel-map .maplibregl-ctrl-attrib'); if (atr) atr.classList.remove('maplibregl-compact-show'); // los créditos, plegados tras el botón ⓘ
    relPintar();
    if (t.ejemplo) map.once('idle', () => { if (REL.map === map && relAltitudDeEjemplo(map, t)) relPintar(); });
  });
}

/* Pinta la línea, el perfil y la leyenda con el modo elegido. */
function relPintar() {
  const t = REL.t, map = REL.map; if (!t || !map) return;
  const modos = [['pend', 'Pendiente', t.tiene.alt], ['vel', REL.a.dep === 'correr' ? 'Ritmo' : 'Velocidad', t.tiene.vel], ['fc', 'Pulso', t.tiene.fc]].filter(m => m[2]);
  if (!modos.some(m => m[0] === REL.modo)) REL.modo = modos.length ? modos[0][0] : null;
  const seg = $('#rel-seg'); seg.hidden = modos.length < 2; $('#rel-titulo').hidden = !seg.hidden; // con una sola manera de pintarlo no hay nada que elegir: va el nombre
  seg.innerHTML = modos.map(([k, l]) => `<button type="button" data-a="rel-modo" data-v="${k}" aria-pressed="${REL.modo === k}">${l}</button>`).join('');
  const paradas = REL.modo ? relParadas(t, REL.modo) : null, liso = `rgb(${relRgb('--tint').join(',')})`;
  if (map.getLayer('ruta')) {
    if (paradas && paradas.length > 1) map.setPaintProperty('ruta', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], ...paradas.flat()]);
    else map.setPaintProperty('ruta', 'line-color', liso);
  }
  // Perfil de altitud con el mismo degradado; sin altitud, una banda.
  const W = 1000, H = 100, P = t.puntos, kmT = P[P.length - 1][2] || 1, alts = P.map(p => p[3]).filter(v => v != null);
  const a0 = alts.length ? Math.min(...alts) : 0, a1 = alts.length ? Math.max(...alts) : 1, y = v => v == null ? H * .55 : 6 + (1 - (v - a0) / ((a1 - a0) || 1)) * (H - 10);
  const camino = `M0,${H} ${P.map(p => `L${(p[2] / kmT * W).toFixed(1)},${y(p[3]).toFixed(1)}`).join(' ')} L${W},${H}Z`;
  const esc = REL.modo ? relEscala(REL.modo, t) : null;
  const leyenda = esc ? `<div class="rel-ley"><i style="background:linear-gradient(90deg,${esc.tokens.map((k, j) => `var(${k}) ${Math.round((esc.cortes[j] - esc.cortes[0]) / (esc.cortes[esc.cortes.length - 1] - esc.cortes[0]) * 100)}%`).join(',')})"></i><div>${esc.extremos.map(x => `<span>${x}</span>`).join('')}</div></div>` : '';
  const pan = $('#rel-panel'); pan.hidden = false;
  pan.innerHTML = `<div class="rel-cifras" id="rel-cifras" aria-live="off"></div>
    <div class="rel-perfil"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="rel-g" x1="0" x2="1" y1="0" y2="0">${(paradas || [[0, liso], [1, liso]]).map(([f, c]) => `<stop offset="${(f * 100).toFixed(2)}%" stop-color="${c}"/>`).join('')}</linearGradient></defs>
        <path d="${camino}" fill="url(#rel-g)"/><line id="rel-cursor" x1="0" x2="0" y1="0" y2="${H}"/></svg>
      <input type="range" id="rel-rango" min="0" max="${P.length - 1}" step="1" value="${REL.i}" aria-label="Recorrer la actividad"></div>
    <div class="rel-eje"><span>0 km</span><span>${alts.length ? `De ${nf(a0, 0)} a ${nf(a1, 0)} m` : 'Sin altitud'}${t.ejemplo ? ' ' + simTag('Ejemplo') : ''}</span><span>${nf(kmT, 1)} km</span></div>
    ${leyenda}`;
  $('#rel-rango').addEventListener('input', e => relIr(+e.target.value));
  relIr(REL.i);
}
/* Mueve el punto del mapa y las cifras al punto i del trazado. */
function relIr(i, enMarcha) {
  const t = REL.t; if (!t) return; REL.i = i; if (!enMarcha) REL.f = t.frac[i]; // al arrastrar por el perfil, el repaso sigue desde ahí
  const p = t.puntos[i], corre = REL.a.dep === 'correr';
  const sig = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), 1)}`;
  const c = [['', 'Km', nf(p[2], 1), ''], ['', 'Altitud', p[3] != null ? nf(p[3], 0) : '—', 'm'], ['pend', 'Pendiente', p[4] != null ? sig(p[4]) : '—', '%'],
    ['vel', corre ? 'Ritmo' : 'Velocidad', p[5] != null ? (corre ? ritmoC(p[5]) : nf(p[5], 1)) : '—', corre ? 'min/km' : 'km/h'], ['fc', 'Pulso', p[6] != null ? p[6] : '—', 'ppm']]
    .filter(x => !x[0] || (x[0] === 'pend' ? t.tiene.alt : t.tiene[x[0]]));
  $('#rel-cifras').innerHTML = c.map(([k, l, v, u]) => `<div class="field${k && k === REL.modo ? ' on' : ''}"><span class="l">${l}</span><span class="v">${v}${u ? ` <small>${u}</small>` : ''}</span></div>`).join('');
  const x = p[2] / (t.puntos[t.puntos.length - 1][2] || 1) * 1000, cur = $('#rel-cursor'); cur.setAttribute('x1', x); cur.setAttribute('x2', x);
  $('#rel-rango').setAttribute('aria-valuetext', c.map(([, l, v, u]) => `${l} ${v}${u ? ' ' + u : ''}`).join(', '));
  if (REL.punto && !enMarcha) { REL.punto.setLngLat([p[0], p[1]]); const m = REL.map; if (m && !m.getBounds().contains([p[0], p[1]])) m.easeTo({ center: [p[0], p[1]], duration: reduced ? 0 : 400 }); }
}

/* ===== Repasar la ruta: el punto recorre el trazado y la cámara lo sigue mirando hacia donde vas =====
   La ruta entera dura entre 45 s y 2 min y medio según los km (a 1×). Con "reducir movimiento", la cámara no se mueve: solo avanza el punto. */
const REL_VELS = [1, 2, 4];
const relDura = t => Math.max(45, Math.min(150, (t.puntos[t.puntos.length - 1][2] || 1) * 1.2));
/* Posición a una fracción f (0 a 1) de la distancia: entre dos puntos del trazado. */
function relEn(t, f) {
  const F = t.frac; let a = 0, b = F.length - 1; while (b - a > 1) { const m = (a + b) >> 1; if (F[m] <= f) a = m; else b = m; }
  const k = F[b] > F[a] ? Math.max(0, Math.min(1, (f - F[a]) / (F[b] - F[a]))) : 0, p = t.puntos[a], q = t.puntos[b];
  return { lon: p[0] + (q[0] - p[0]) * k, lat: p[1] + (q[1] - p[1]) * k, i: k < .5 ? a : b };
}
const relRumbo = (p, q) => (Math.atan2((q.lon - p.lon) * Math.cos(p.lat * Math.PI / 180), q.lat - p.lat) * 180 / Math.PI + 360) % 360;
/* Hacia dónde mirar: unos 400 m más adelante, para que una curva cerrada no dé un latigazo. */
function relMira(t, f) { const kmT = t.puntos[t.puntos.length - 1][2] || 1, g = Math.min(1, f + .4 / kmT); return g > f ? relRumbo(relEn(t, f), relEn(t, g)) : REL.rumbo; }
function relBotones() {
  const el = $('#rel-play'); if (!el) return;
  el.innerHTML = `<button class="btn fill" type="button" data-a="rel-play">${ic(REL.play ? 'pausa' : 'play', 18)} ${REL.play ? 'Pausar' : REL.f > 0 && REL.f < 1 ? 'Seguir' : 'Repasar la ruta'}</button>
    ${REL.play ? `<button class="rel-vel" type="button" data-a="rel-vel" aria-label="Velocidad del repaso: ${REL.vel}×. Cambiar">${REL.vel}×</button>` : ''}`;
}
function relPaso(ts) {
  const t = REL.t, map = REL.map; if (!REL.play || !t || !map) return;
  const dt = REL.ts ? Math.min(.1, (ts - REL.ts) / 1000) : 0; REL.ts = ts;
  REL.f = Math.min(1, REL.f + dt * REL.vel / relDura(t));
  const pos = relEn(t, REL.f); REL.punto.setLngLat([pos.lon, pos.lat]);
  if (pos.i !== REL.i) { relIr(pos.i, true); const r = $('#rel-rango'); if (r) r.value = pos.i; }
  if (!reduced) { REL.rumbo += ((relMira(t, REL.f) - REL.rumbo + 540) % 360 - 180) * Math.min(1, dt * 1.5); map.jumpTo({ center: [pos.lon, pos.lat], bearing: REL.rumbo }); }
  if (REL.f >= 1) { relPausar(); return; }
  REL.raf = requestAnimationFrame(relPaso);
}
function relReproducir() {
  const t = REL.t, map = REL.map; if (!t || !map) return;
  if (REL.f >= 1) REL.f = 0;
  REL.play = true; REL.ts = 0; relBotones();
  let ya = false; const arranca = () => { if (ya) return; ya = true; if (REL.play && REL.map === map) { cancelAnimationFrame(REL.raf); REL.raf = requestAnimationFrame(relPaso); } };
  if (reduced) { arranca(); return; }
  // Antes de echar a andar, la cámara baja hasta el punto y se pone mirando hacia delante.
  const pos = relEn(t, REL.f); REL.rumbo = relMira(t, REL.f);
  map.easeTo({ center: [pos.lon, pos.lat], zoom: Math.max(map.getZoom(), 13), pitch: 62, bearing: REL.rumbo, duration: 900, padding: { top: 140, bottom: 0, left: 0, right: 0 } }); // el punto, algo por debajo del centro: se ve más de lo que viene
  map.once('moveend', arranca); setTimeout(arranca, 1500); // si el aviso de fin de movimiento no llega, arranca igual
}
function relPausar() { REL.play = false; cancelAnimationFrame(REL.raf); relBotones(); }

Object.assign(ACTIONS, {
  'rel-play': () => { if (REL.play) relPausar(); else relReproducir(); const b = $('#rel-play .btn'); if (b) b.focus(); },
  'rel-vel': () => { REL.vel = REL_VELS[(REL_VELS.indexOf(REL.vel) + 1) % REL_VELS.length]; relBotones(); const b = $('#rel-play .rel-vel'); if (b) b.focus(); },
  'rel-abrir': el => abrirRelieve(el.dataset.v), 'rel-cerrar': () => cerrarRelieve(),
  'rel-modo': el => { REL.modo = el.dataset.v; relPintar(); const b = $(`#rel-seg [data-v="${REL.modo}"]`); if (b) b.focus(); },
  'rel-zoom': el => { if (REL.map) REL.map.easeTo({ zoom: REL.map.getZoom() + +el.dataset.v, duration: reduced ? 0 : 300 }); },
  'rel-entero': () => { if (REL.play) relPausar(); if (REL.map) REL.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); if (REL.map) REL.map.fitBounds(REL.caja, { padding: 48, pitch: 55, bearing: 0, duration: reduced ? 0 : 600 }); },
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#relieve')) { e.stopPropagation(); cerrarRelieve(); } }, true);
