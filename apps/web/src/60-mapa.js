/* ===== MAPA TÁCTIL: pantalla completa, pellizco, arrastre y ficha del pueblo ===== */

const MAPA = { key: 'cat', vb0: null, vb: null, ptrs: new Map(), start: null, moved: 0, lastTap: 0, sel: null };
function mapKeyActual() { return S.pLevel === 'es' ? 'es' : S.pLevel === 'world' ? 'world' : 'ccaa'; }
function openMapa(key = mapKeyActual(), focusId = null) {
  closeMapa(true); MAPA.key = key; MAPA.sel = null;
  const el = document.createElement('div'); el.className = 'mapfull'; el.id = 'mapfull'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Mapa de pueblos');
  el.innerHTML = `<div class="mf-top"><button class="close" type="button" aria-label="Cerrar mapa" data-a="map-close">${ic('close', 18)}</button>
      <div class="seg" role="group" aria-label="Zona" style="flex:1">${[['ccaa', M.ccaa || 'Comunidad'], ['es', 'España']].map(([k, l]) => `<button type="button" data-a="map-key" data-v="${k}" aria-pressed="${key === k}">${l}</button>`).join('')}</div></div>
    <div class="mf-chips">${fchips('pSport', ['bici', 'correr', 'montana', 'skimo'], S.pSport)}</div>
    <button type="button" class="fchip mf-rutas" data-a="p-rutas-btn" aria-pressed="${!!S.pRutas}">${ic('bike', 16)} Rutas</button>
    <div class="mf-view" id="mf-view">${mapSvg(key)}</div>
    <div class="mf-zoom"><button type="button" aria-label="Acercar" data-a="map-zoom" data-v="1.6">${ic('plus', 22)}</button><button type="button" aria-label="Alejar" data-a="map-zoom" data-v="0.625">${ic('minus', 22)}</button><button type="button" aria-label="Ver todo" data-a="map-reset">${ic('sync', 20)}</button></div>
    <div class="mf-card" id="mf-card" hidden></div>
    <p class="mf-hint" id="mf-hint">Pellizca o toca dos veces para acercar · arrastra para moverte · toca un pueblo</p>`;
  app.append(el);
  const svg = el.querySelector('#mf-view svg'); svg.removeAttribute('width'); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  MAPA.vb0 = svg.getAttribute('viewBox').split(' ').map(Number); MAPA.vb = [...MAPA.vb0];
  applyMapFilter(svg); bindMapa(el.querySelector('#mf-view'), svg);
  requestAnimationFrame(() => el.classList.add('in'));
  if (focusId) setTimeout(() => focusMuni(focusId), 60);
  markFlow('pueblos');
}
function closeMapa(instant) { const el = $('#mapfull'); if (!el) return; if (instant) el.remove(); else { el.classList.remove('in'); setTimeout(() => el.remove(), 250); } }
function setVB(svg, vb) {
  const [x0, y0, w0, h0] = MAPA.vb0; const w = Math.min(w0, Math.max(w0 / 40, vb[2])), h = w * h0 / w0;
  const x = Math.min(x0 + w0 - w * .2, Math.max(x0 - w * .8, vb[0])), y = Math.min(y0 + h0 - h * .2, Math.max(y0 - h * .8, vb[1]));
  MAPA.vb = [x, y, w, h]; svg.setAttribute('viewBox', MAPA.vb.map(v => v.toFixed(2)).join(' '));
  svg.style.setProperty('--z', (w0 / w).toFixed(2));
}
function toSvg(svg, cx, cy) { const r = svg.getBoundingClientRect(); const [x, y, w, h] = MAPA.vb; const s = Math.min(r.width / w, r.height / h); const ox = (r.width - w * s) / 2, oy = (r.height - h * s) / 2; return [x + (cx - r.left - ox) / s, y + (cy - r.top - oy) / s, s]; }
function zoomAt(svg, f, cx, cy) {
  const r = svg.getBoundingClientRect(); if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
  const [px, py] = toSvg(svg, cx, cy); const [x, y, w, h] = MAPA.vb; const nw = w / f, nh = h / f;
  setVB(svg, [px - (px - x) / f, py - (py - y) / f, nw, nh]);
}
function bindMapa(view, svg) {
  view.addEventListener('pointerdown', e => { view.setPointerCapture(e.pointerId); MAPA.ptrs.set(e.pointerId, [e.clientX, e.clientY]); MAPA.moved = 0; MAPA.start = { vb: [...MAPA.vb], pts: new Map(MAPA.ptrs) }; $('#mf-hint') && ($('#mf-hint').hidden = true); });
  view.addEventListener('pointermove', e => {
    if (!MAPA.ptrs.has(e.pointerId)) return; MAPA.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    const st = MAPA.start; const cur = [...MAPA.ptrs.values()], ini = [...st.pts.values()];
    if (cur.length === 1 && ini.length === 1) {
      const dx = cur[0][0] - ini[0][0], dy = cur[0][1] - ini[0][1]; MAPA.moved = Math.max(MAPA.moved, Math.hypot(dx, dy));
      const r = svg.getBoundingClientRect(); const s = Math.min(r.width / st.vb[2], r.height / st.vb[3]);
      setVB(svg, [st.vb[0] - dx / s, st.vb[1] - dy / s, st.vb[2], st.vb[3]]);
    } else if (cur.length >= 2 && ini.length >= 2) {
      MAPA.moved = 99; const d0 = Math.hypot(ini[0][0] - ini[1][0], ini[0][1] - ini[1][1]), d1 = Math.hypot(cur[0][0] - cur[1][0], cur[0][1] - cur[1][1]);
      const f = d1 / (d0 || 1); const mx = (cur[0][0] + cur[1][0]) / 2, my = (cur[0][1] + cur[1][1]) / 2;
      MAPA.vb = [...st.vb]; svg.setAttribute('viewBox', st.vb.join(' ')); zoomAt(svg, f, mx, my);
    }
  });
  const end = e => {
    if (!MAPA.ptrs.has(e.pointerId)) return; MAPA.ptrs.delete(e.pointerId);
    if (MAPA.ptrs.size) { MAPA.start = { vb: [...MAPA.vb], pts: new Map(MAPA.ptrs) }; return; }
    if (MAPA.moved < 8 && e.type === 'pointerup') {
      const now = Date.now(); if (now - MAPA.lastTap < 300) { zoomAt(svg, 2, e.clientX, e.clientY); MAPA.lastTap = 0; return; }
      MAPA.lastTap = now; const t = document.elementFromPoint(e.clientX, e.clientY); const p = t && t.closest && t.closest('path'); if (p && svg.contains(p)) selMuni(p);
    }
  };
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
  view.addEventListener('wheel', e => { e.preventDefault(); zoomAt(svg, e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY); }, { passive: false });
}
function selMuni(p) {
  const svg = $('#mf-view svg'); svg.querySelectorAll('path.sel').forEach(x => x.classList.remove('sel')); p.classList.add('sel');
  const name = p.querySelector('title')?.textContent || ''; const id = p.dataset.m; const t = id && M.towns[id]; const card = $('#mf-card');
  const nuc = null;
  card.hidden = false;
  card.innerHTML = t ? `<div class="row"><div class="grow"><b style="font-size:19px">${esc(t.n)}</b><p class="small muted">${nf(t.km)} km · primera vez el ${fDia(t.primera)}</p></div><button class="close" type="button" aria-label="Cerrar ficha" data-a="map-card-close">${ic('close', 16)}</button></div>
      <div class="legend2">${Object.entries(t.dep).map(([k, km]) => `<span>${sportDot(k)}${SPORTS[k].n} ${nf(km)} km</span>`).join('')}</div>
      ${nuc ? `<p class="small">Núcleos por los que pasaste: <b>${esc(nuc.join(', '))}</b> ${simTag('Ejemplo')}</p>` : `<p class="xs">Núcleos del municipio: pendiente de datos de OpenStreetMap (versión web).</p>`}`
    : `<div class="row"><div class="grow"><b style="font-size:19px">${esc(name)}</b><p class="small muted">${S.pLevel === 'world' || MAPA.key === 'world' ? '' : 'Aún no has pasado por aquí.'}</p></div><button class="close" type="button" aria-label="Cerrar ficha" data-a="map-card-close">${ic('close', 16)}</button></div>`;
}
function focusMuni(id) {
  const svg = $('#mf-view svg'); if (!svg) return; const p = svg.querySelector(`path[data-m="${id}"]`); if (!p) return;
  const b = p.getBBox(); if (!b.width) return; const r = svg.getBoundingClientRect(); if (!r.width || !r.height) { setTimeout(() => focusMuni(id), 80); return; }
  // Encuadre: el pueblo ocupa ~40 % del ancho y queda en el tercio de arriba, por encima de la ficha
  const ar = r.height / r.width, pad = Math.max(b.width, b.height) * 0.75 + 4; const w = Math.max(b.width + pad * 2, (b.height + pad * 2) / ar), h = w * ar;
  setVB(svg, [b.x + b.width / 2 - w / 2, b.y + b.height / 2 - h * 0.38, w, h]); selMuni(p);
}

/* ===== Mapas dibujados en el navegador desde tus datos (sin imágenes fijas) ===== */
const MAPCACHE = {};
function projector(bb, W) { const k = Math.cos((bb[1] + bb[3]) / 2 * Math.PI / 180); const sx = W / ((bb[2] - bb[0]) * k); const H = Math.round((bb[3] - bb[1]) * sx); return { H, f: ([x, y]) => [((x - bb[0]) * k * sx), ((bb[3] - y) * sx)] }; }
const r1m = v => Math.round(v * 10) / 10;
function pathD(polys, P) { let d = ''; for (const p of polys) for (const ring of p) d += 'M' + ring.map(c => P.f(c).map(r1m).join(',')).join('L') + 'Z'; return d; }
function mapSvg(key) {
  geoInit(); const ck = key + ':' + (M.sincro || 0) + ':' + M.fuente; if (MAPCACHE[ck]) return MAPCACHE[ck];
  const W = 560; let s = '';
  if (key === 'world') {
    const Wd = 560, H = 260, px = ([x, y]) => [(x + 180) / 360 * Wd, (83 - y) / 141 * H]; const vis = new Set(M.paisesId);
    s = `<svg viewBox="0 0 ${Wd} ${H}" class="map map-world" data-map="world" role="img" aria-label="Países"><rect width="${Wd}" height="${H}" class="m-bg"/>`;
    for (const c of GEO.countries) { let d = ''; for (const p of c.polys) { if (p[0].some(([, y]) => y < -58)) continue; d += 'M' + p[0].map(q => px(q).map(r1m).join(',')).join('L') + 'Z'; } if (d) s += `<path d="${d}" class="${vis.has(c.name) ? 'm-off on' : 'm-off'}"><title>${esc(c.name)}</title></path>`; }
    return MAPCACHE[ck] = s + '</svg>';
  }
  const visited = new Set(Object.keys(M.towns));
  if (key === 'es') {
    const bb = [-9.6, 35.8, 4.5, 43.9]; const P = projector(bb, W);
    s = `<svg viewBox="0 0 ${W} ${P.H}" class="map" data-map="es" role="img" aria-label="España"><rect width="${W}" height="${P.H}" class="m-bg"/>`;
    for (const f of GEO.provs) s += `<path d="${pathD(f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates, P)}" class="m-prov"><title>${esc(f.properties.name)}</title></path>`;
    for (const id of visited) { const m = GEO.byId.get(id); if (m) s += `<path d="${pathD(m.polys, P)}" class="m-off" data-m="${id}"><title>${esc(m.name)}</title></path>`; }
    return MAPCACHE[ck] = s + '</svg>';
  }
  const feats = GEO.munis.filter(m => PROV_CCAA[m.id.slice(0, 2)] === M.ccaa); if (!feats.length) return '<p class="muted" style="padding:16px">Aún no hay pueblos: actualiza para leer tus trazados.</p>';
  const bb = feats.reduce((b, m) => [Math.min(b[0], m.bb[0]), Math.min(b[1], m.bb[1]), Math.max(b[2], m.bb[2]), Math.max(b[3], m.bb[3])], [180, 90, -180, -90]); const P = projector(bb, W);
  s = `<svg viewBox="0 0 ${W} ${P.H}" class="map" data-map="ccaa" role="img" aria-label="${esc(M.ccaa)}"><rect width="${W}" height="${P.H}" class="m-bg"/>`;
  for (const m of feats) s += `<path d="${pathD(m.polys, P)}" class="m-off" data-m="${visited.has(m.id) ? m.id : ''}"><title>${esc(m.name)}</title></path>`;
  for (const a of acts()) { const r = (DSET.rutas || {})[a.id]; if (!r || !['bici', 'correr', 'skimo', 'montana'].includes(a.dep)) continue; const pts = decodePoly(r).filter(([x, y]) => x > bb[0] && x < bb[2] && y > bb[1] && y < bb[3]); if (pts.length < 2) continue; s += `<polyline class="tr" data-t="${a.dep}" points="${pts.map(c => P.f(c).map(r1m).join(',')).join(' ')}"/>`; }
  return MAPCACHE[ck] = s + '</svg>';
}
