/* ===== Geo: municipios de España (IGN vía es-atlas) y países (Natural Earth), calculado en el navegador ===== */
const PROV_CCAA = { '01': 'País Vasco', '20': 'País Vasco', '48': 'País Vasco', '02': 'Castilla-La Mancha', '13': 'Castilla-La Mancha', '16': 'Castilla-La Mancha', '19': 'Castilla-La Mancha', '45': 'Castilla-La Mancha', '03': 'Comunitat Valenciana', '12': 'Comunitat Valenciana', '46': 'Comunitat Valenciana', '04': 'Andalucía', '11': 'Andalucía', '14': 'Andalucía', '18': 'Andalucía', '21': 'Andalucía', '23': 'Andalucía', '29': 'Andalucía', '41': 'Andalucía', '05': 'Castilla y León', '09': 'Castilla y León', '24': 'Castilla y León', '34': 'Castilla y León', '37': 'Castilla y León', '40': 'Castilla y León', '42': 'Castilla y León', '47': 'Castilla y León', '49': 'Castilla y León', '06': 'Extremadura', '10': 'Extremadura', '07': 'Illes Balears', '08': 'Cataluña', '17': 'Cataluña', '25': 'Cataluña', '43': 'Cataluña', '15': 'Galicia', '27': 'Galicia', '32': 'Galicia', '36': 'Galicia', '22': 'Aragón', '44': 'Aragón', '50': 'Aragón', '26': 'La Rioja', '28': 'Madrid', '30': 'Murcia', '31': 'Navarra', '33': 'Asturias', '35': 'Canarias', '38': 'Canarias', '39': 'Cantabria', '51': 'Ceuta', '52': 'Melilla' };
const GEO = { ready: false };
function geoInit() {
  if (GEO.ready) return; const T = TOPO_ES, W = TOPO_WORLD;
  GEO.munis = topojson.feature(T, T.objects.municipalities).features.map(f => geoPrep(f));
  GEO.provs = topojson.feature(T, T.objects.provinces).features;
  GEO.countries = topojson.feature(W, W.objects.countries).features.map(f => geoPrep(f));
  GEO.grid = new Map(); for (const m of GEO.munis) for (let x = Math.floor(m.bb[0] * 10); x <= Math.floor(m.bb[2] * 10); x++) for (let y = Math.floor(m.bb[1] * 10); y <= Math.floor(m.bb[3] * 10); y++) { const k = x + ':' + y; if (!GEO.grid.has(k)) GEO.grid.set(k, []); GEO.grid.get(k).push(m); }
  GEO.byId = new Map(GEO.munis.map(m => [m.id, m])); GEO.ready = true;
}
function geoPrep(f) { const polys = !f.geometry ? [] : f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; let bb = [180, 90, -180, -90]; for (const p of polys) for (const [x, y] of p[0]) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); } return { id: String(f.id), name: f.properties?.name || '', polys, bb, f }; }
function inRing(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
function inFeat(m, x, y) { if (x < m.bb[0] || x > m.bb[2] || y < m.bb[1] || y > m.bb[3]) return false; for (const p of m.polys) if (inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h))) return true; return false; }
function muniAt(x, y) { const c = GEO.grid.get(Math.floor(x * 10) + ':' + Math.floor(y * 10)); if (c) for (const m of c) if (inFeat(m, x, y)) return m; return null; }
function paisAt(x, y) { for (const c of GEO.countries) if (inFeat(c, x, y)) return c.name; return null; }
const hav = (a, b) => { const R = 6371, t = Math.PI / 180; const dl = (b[1] - a[1]) * t, dn = (b[0] - a[0]) * t; const h = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
/* Municipios cruzados por un trazado (muestreo cada 50 m) y país de salida */
function geoRuta(poly) {
  geoInit(); const pts = decodePoly(poly); const out = { m: {}, fuera: 0, pais: pts.length ? paisAt(pts[0][0], pts[0][1]) : null };
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const d = hav(a, b); if (d > 5) continue; const n = Math.max(1, Math.ceil(d / 0.05));
    for (let k = 0; k < n; k++) { const t = (k + .5) / n; const m = muniAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); if (m) out.m[m.id] = (out.m[m.id] || 0) + d / n; else out.fuera += d / n; } }
  for (const k of Object.keys(out.m)) { if (out.m[k] < 0.3) delete out.m[k]; else out.m[k] = Math.round(out.m[k] * 10) / 10; }
  out.fuera = Math.round(out.fuera * 10) / 10; return out;
}

const PAIS_ES = { Spain: 'España', France: 'Francia', Andorra: 'Andorra', Portugal: 'Portugal', Italy: 'Italia', Switzerland: 'Suiza', Austria: 'Austria', Germany: 'Alemania', 'United Kingdom': 'Reino Unido', Belgium: 'Bélgica', Netherlands: 'Países Bajos', Norway: 'Noruega', Sweden: 'Suecia', Morocco: 'Marruecos', 'United States of America': 'Estados Unidos', Slovenia: 'Eslovenia', Croatia: 'Croacia', Greece: 'Grecia', Ireland: 'Irlanda', Iceland: 'Islandia', Mexico: 'México', Canada: 'Canadá', Japan: 'Japón' };
/* ===== Dataset: vivo (tu conector de Garmin) o demo (instantánea) ===== */
const FAM = { road_biking: 'bici', cycling: 'bici', indoor_cycling: 'bici', gravel_cycling: 'bici', mountain_biking: 'bici', virtual_ride: 'bici', running: 'correr', trail_running: 'correr', treadmill_running: 'correr', backcountry_skiing: 'skimo', skate_skiing_ws: 'skimo', hiking: 'montana', mountaineering: 'montana', snow_shoe_ws: 'montana', resort_skiing: 'esqui', resort_skiing_snowboarding_ws: 'esqui', tennis_v2: 'raqueta', tennis: 'raqueta', paddelball: 'raqueta', padel: 'raqueta', strength_training: 'fuerza', hiit: 'fuerza', indoor_cardio: 'fuerza', walking: 'caminar' };
let DSET = null; // dataset crudo activo
let M = {};      // todo lo derivado (lo que pinta la app)
function cargarCache() { try { return JSON.parse(localStorage.getItem('trazo-vivo') || 'null'); } catch (e) { return null; } }
function guardarCache(ds) { try { localStorage.setItem('trazo-vivo', JSON.stringify(ds)); } catch (e) { } if (DB && ds.fuente === 'vivo') { const { rutas, ...resto } = ds; DB.doc('vivo/datos').set(resto).catch(() => { }); DB.doc('vivo/rutas').set({ rutas }).catch(() => { }); } }
/* Física: vatios por kilo en una subida (sin potenciómetro) */
function wkgFisica(km, desn, min, peso) { if (!km || !min) return null; const m = (peso || 75) + 9, g = 9.81, v = km * 1000 / (min * 60), th = Math.atan(desn / (km * 1000)); const P = (m * g * v * Math.sin(th) + 0.005 * m * g * v * Math.cos(th) + 0.5 * 1.2 * 0.4 * v ** 3) / 0.97; return P / (peso || 75); }
function zonasDe(h, lthr) { if (!h) return null; const lo = Math.round(lthr * 0.9), hi = Math.round(lthr * 0.99); const z = [0, 0, 0]; for (const [b, m] of Object.entries(h)) { const k = +b; z[k < lo - 2 ? 0 : k < hi - 2 ? 1 : 2] += m; } return z.map(v => Math.round(v)); }
function tipoPorZonas(z, min) { const t = z[0] + z[1] + z[2]; if (!t) return null; if (z[2] / t > .15) return 'int'; if (z[1] / t > .30) return 'tempo'; if (min < 55 && z[0] / t > .9) return 'rec'; return 'fondo'; }
function construir(ds) {
  DSET = ds; const P = ds.perfil || {}; const lthr = P.lthr || 170, peso = P.peso || 75;
  const HOYD = ds.fuente === 'demo' ? ds.hoy : HOY;
  const acts = (ds.acts || []).map(a => {
    const dep = FAM[a.t] || 'otros'; const d = (ds.det || {})[a.id] || {}; const L = dep === 'bici' ? lthr - 5 : lthr;
    const z = d.h ? zonasDe(d.h, L) : null; let tipo = z ? tipoPorZonas(z, a.min) : null;
    if (!tipo) { if (SPORTS[dep].cardio) { tipo = GARMIN_MAP[a.te] || 'fondo'; if (tipo === 'int' && a.fc && a.fc < 135) tipo = 'fondo'; } else tipo = 'otros'; }
    const sub = d.sub ? { km: d.sub[0], desn: d.sub[1], min: d.sub[2], fc: d.sub[3], vam: Math.round(d.sub[1] / (d.sub[2] / 60)), wkg: dep === 'bici' ? wkgFisica(d.sub[0], d.sub[1], d.sub[2], peso) : null } : null;
    if (sub && sub.vam > 1800 && sub.fc < 110) sub.remonte = true;
    const T = d.ter || {}; const ter = d.ter ? {
      llano: T.ll ? { km: T.ll[0], kmh: T.ll[1], fc: T.ll[2], mpl: T.ll[3] } : null,
      subida: T.su && !(sub && sub.remonte) ? { km: T.su[0], min: T.su[1], kmh: T.su[2], fc: T.su[3], pend: T.su[4], vam: T.su[5], wkg: dep === 'bici' ? wkgFisica(T.su[0], T.su[0] * T.su[4] * 10, T.su[1], peso) : null } : null,
      bajada: T.ba ? { km: T.ba[0], kmh: T.ba[1], pend: T.ba[2] } : null, pp: T.pp || [] } : null;
    return { id: String(a.id), dep, f: a.d, km: a.km, min: a.min, fc: a.fc, g: a.te, cg: a.cg ?? null, lugar: (String(a.n || '').replace(/ (Road )?(Cycling|Running|Backcountry Skiing|Hiking|Walking|Resort Skiing|Strength Training)$/, '').replace(/^[\s\-–·.]*$/, '') || SPORTS[dep].n), tipo, z, desn: d.desn, sub, llano: d.llano ? { km: d.llano[0], kmh: d.llano[1], fc: d.llano[2] } : null, ter, dc: d.dc ?? null, tc: d.tc ?? null, fs: d.fs || null, analizada: !!z, nuevos: [] };
  }).sort((a, b) => b.f.localeCompare(a.f));
  // Pueblos y países desde los trazados
  const towns = {}, paises = new Set(), geo = ds.geo || (ds.geo = {});
  for (const a of [...acts].reverse()) { const r = (ds.rutas || {})[a.id]; if (!r || !['bici', 'correr', 'skimo', 'montana', 'esqui', 'caminar'].includes(a.dep)) continue;
    if (!geo[a.id]) { try { geo[a.id] = geoRuta(r); } catch (e) { geo[a.id] = { m: {}, fuera: 0 }; } }
    const g = geo[a.id]; if (g.pais) paises.add(g.pais);
    if (!['bici', 'correr', 'skimo', 'montana'].includes(a.dep)) continue;
    for (const [id, km] of Object.entries(g.m)) { const t = towns[id] || (towns[id] = { id, n: GEO.ready ? (GEO.byId.get(id)?.name || id) : id, km: 0, dep: {}, primera: a.f, act: a.id }); if (!t.km) a.nuevos.push(t.n); t.km += km; t.dep[a.dep] = Math.round(((t.dep[a.dep] || 0) + km) * 10) / 10; }
  }
  for (const t of Object.values(towns)) t.km = Math.round(t.km * 10) / 10;
  // Semanas (min por deporte) desde la primera actividad
  const weeks = []; if (acts.length) { let w = weekOf(acts[acts.length - 1].f); const last = weekOf(HOYD); while (w <= last) { const v = {}; for (const a of acts) if (weekOf(a.f) === w) v[a.dep] = (v[a.dep] || 0) + a.min; weeks.push([w, v]); w = addDays(w, 7); } }
  // Comunidad principal (donde más km)
  const porCcaa = {}; for (const t of Object.values(towns)) { const c = PROV_CCAA[t.id.slice(0, 2)]; if (c) porCcaa[c] = (porCcaa[c] || 0) + t.km; }
  const ccaa = Object.entries(porCcaa).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  M = { fuente: ds.fuente, hoy: HOYD, perfil: P, acts, towns, paises: [...paises].map(p => PAIS_ES[p] || p), paisesId: [...paises], weeks, ccaa, evo: (ds.evo || []).map(([f, vo2, es, hill, vo2b]) => ({ f, vo2, es, hill, vo2b: vo2b ?? null })), forma: ds.forma || null, sincro: ds.at || null };
  M.ind = indicadores(); return M;
}
/* Indicadores derivados (notas 1-10 con su porqué), sin textos fijos */
function piece(v, A) { if (v == null) return null; if (v <= A[0][0]) return A[0][1]; for (let i = 1; i < A.length; i++) if (v <= A[i][0]) { const [x0, y0] = A[i - 1], [x1, y1] = A[i]; return y0 + (v - x0) / (x1 - x0) * (y1 - y0); } return A[A.length - 1][1]; }
function indicadores() {
  const P = M.perfil, hoy = M.hoy; const d28 = addDays(hoy, -28), d90 = addDays(hoy, -90);
  const rec = M.acts.filter(a => a.f > d28 && a.f <= hoy); const h4 = rec.reduce((s, a) => s + a.min, 0) / 60 / 4;
  const zs = rec.filter(a => a.z).reduce((z, a) => z.map((v, i) => v + a.z[i]), [0, 0, 0]); const zt = zs[0] + zs[1] + zs[2]; const suave = zt ? Math.round(zs[0] / zt * 100) : null;
  const subs = M.acts.filter(a => a.dep === 'bici' && a.sub && a.sub.min >= 10 && a.f > d90 && a.sub.wkg).sort((a, b) => b.sub.wkg - a.sub.wkg); const best = subs[0];
  const yr = M.weeks.length ? M.weeks.reduce((s, [, v]) => s + Object.values(v).reduce((x, y) => x + y, 0), 0) / 60 / M.weeks.length : 0;
  const semanas3 = M.weeks.filter(([, v]) => Object.values(v).reduce((x, y) => x + y, 0) >= 180).length;
  const edad = P.edad || 35; const vo2A = edad < 30 ? [[30, 2], [36, 3], [44, 5], [52, 7], [60, 9], [70, 10]] : edad < 40 ? [[28, 2], [34, 3], [42, 5], [50, 7], [58, 9], [68, 10]] : [[26, 2], [32, 3], [39, 5], [47, 7], [55, 9], [65, 10]];
  const esLv = [[3570, 'Principiante'], [5100, 'Intermedio'], [5800, 'Entrenado'], [6600, 'Muy entrenado'], [7300, 'Experto'], [8100, 'Superior'], [8800, 'Élite']];
  const nivel = P.es ? [...esLv].reverse().find(([v]) => P.es >= v) : null; const sig = P.es ? esLv.find(([v]) => v > P.es) : null;
  const vo2m = M.evo.filter(e => e.vo2); const esm = M.evo.filter(e => e.es); const esMax = esm.length ? esm.reduce((a, b) => b.es > a.es ? b : a) : null, esMin = esm.length ? esm.reduce((a, b) => b.es < a.es ? b : a) : null;
  const falta = t => ({ falta: t });
  const I = {
    motor: P.vo2 ? { v: half(piece(P.vo2, vo2A)), dato: `VO2máx ${nf(P.vo2)}`, conf: 'media', ref: [nf(vo2A[3][0], 0), `${vo2A[5][0]} o más`], por: `Garmin calcula tu VO2máx en ${nf(P.vo2)} a partir de tus carreras. Para tu edad (${edad}), 5 es un aficionado medio y 7 una grupeta fuerte.${vo2m.length > 1 ? ` Rango del año: ${nf(Math.min(...vo2m.map(e => e.vo2)))}-${nf(Math.max(...vo2m.map(e => e.vo2)))}.` : ''}` } : falta('Garmin calcula el VO2máx en carreras con pulso y GPS de al menos 10 min.'),
    fondo: P.es ? { v: half(piece(P.es, [[3570, 2], [5100, 4], [5800, 5], [6600, 6], [7300, 7], [8100, 8], [8800, 9], [10560, 10]])), dato: `Endurance Score ${nf(P.es, 0)}`, conf: 'alta', ref: ['7.300', '8.800 o más'], por: `Endurance Score de Garmin: ${nf(P.es, 0)}, nivel ${nivel ? nivel[1] : '—'}.${sig ? ` El siguiente nivel, ${sig[1]}, empieza en ${nf(sig[0], 0)}.` : ''}${esMax && esMin && esMax !== esMin ? ` Máximo del año: ${nf(esMax.es, 0)} (${MS[dte(esMax.f).getMonth()]}); mínimo: ${nf(esMin.es, 0)} (${MS[dte(esMin.f).getMonth()]}).` : ''}` } : falta('Garmin necesita unas semanas de actividades con pulso para dar el Endurance Score.'),
    volumen: !M.acts.length ? { falta: 'Tus actividades de Garmin: actualiza para leer tu histórico.' } : { v: half(piece(h4, [[0, 1], [2.5, 3], [5, 5], [10, 7], [17, 9], [20, 10]])), dato: `${nf(h4)} h/semana el último mes`, conf: 'alta', ref: ['unas 10 h', '19 h'], por: `Últimas 4 semanas: ${nf(h4)} h de media. Media desde ${fDia(M.weeks[0]?.[0] || hoy)}: ${nf(yr)} h, con ${semanas3} de ${M.weeks.length} semanas de 3 h o más.` },
    equilibrio: suave != null ? { v: half(Math.max(1, Math.min(10, 10 - (75 - suave) / 4))), dato: `${suave} % de minutos suaves (4 semanas)`, conf: zt > 600 ? 'media' : 'baja', ref: ['75 %', '80-90 %'], por: `En las últimas 4 semanas, el ${suave} % de tus minutos con pulso fueron suaves (menos del 90 % de tu umbral). Lo habitual para mejorar es un 75-80 %.`, suave } : falta('Hace falta el detalle de pulso de tus actividades recientes (se descarga al sincronizar).'),
    subida: best ? { v: half(wkgScore(best.sub.wkg * 0.95)), est: true, dato: `≈${nf(best.sub.wkg, 1)} W/kg estimado`, conf: 'baja', ref: ['4,1 W/kg', '5,7 W/kg o más'], por: `Sin potenciómetro, calculo los vatios por física. Tu mejor subida en 90 días: ${nf(best.sub.km)} km y ${best.sub.desn} m en ${dur(best.sub.min)} a ${best.sub.fc} ppm (${fDia(best.f)}), unos ${Math.round(best.sub.wkg * (P.peso || 75))} W.`, act: best.id } : falta('Una subida en bici de 10 min o más en los últimos 90 días, o el test de 20 min.'),
  };
  return { ...I, h4, suave, yr, best, nivel, sig };
}
