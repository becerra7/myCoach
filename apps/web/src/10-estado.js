/* ===== Datos, estado y utilidades (v2) ===== */
const HOY_REAL = (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); })();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n, d = 1) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const clone = o => JSON.parse(JSON.stringify(o));
const DS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DC = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DL = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const MS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dte = iso => new Date(iso + 'T12:00:00');
const isoOf = d => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = dte(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const weekOf = iso => { const d = dte(iso); const wd = (d.getDay() + 6) % 7; return addDays(iso, -wd); };
const days7 = w => [0, 1, 2, 3, 4, 5, 6].map(i => addDays(w, i));
const fLarga = iso => { const d = dte(iso); return `${DS[d.getDay()]} ${d.getDate()} de ${MS[d.getMonth()]}`; };
const fCorta = iso => { const d = dte(iso); return `${DC[d.getDay()]} ${d.getDate()} ${MC[d.getMonth()]}`; };
const fDia = iso => { const d = dte(iso); return `${d.getDate()} ${MC[d.getMonth()]}`; };
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
const dur = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(Math.round(m % 60)).padStart(2, '0') : ''}` : `${Math.round(m)} min`;
const half = v => Math.round(v * 2) / 2;
let HOY = HOY_REAL, SEM = weekOf(HOY), PROX = addDays(SEM, 7);
const rdy = () => S.readiness ?? (typeof COACH !== 'undefined' && COACH?.datos_hoy?.readiness != null ? COACH.datos_hoy.readiness : M && M.perfil && M.perfil.ready ? M.perfil.ready.score : null);
function setHoy(d) { HOY = d; SEM = weekOf(d); PROX = addDays(SEM, 7); }

/* Deportes: color = ranura fija de la paleta categórica validada (nunca por rango) */
const SPORTS = {
  bici: { n: 'Bici', ic: 'bike', cardio: true }, correr: { n: 'Correr', ic: 'run', cardio: true }, skimo: { n: 'Skimo', ic: 'skimo', cardio: true },
  montana: { n: 'Montaña', ic: 'mountain', cardio: true }, raqueta: { n: 'Pádel y tenis', ic: 'racket' }, fuerza: { n: 'Fuerza', ic: 'dumbbell' },
  esqui: { n: 'Esquí', ic: 'ski' }, caminar: { n: 'Caminar', ic: 'walk' }, otros: { n: 'Otros', ic: 'dot' },
};
const SPORT_ORDER = ['bici', 'correr', 'skimo', 'montana', 'raqueta', 'fuerza', 'esqui', 'caminar', 'otros'];
/* Lo que el entrenador planifica: deportes que se miden con pulso, ritmo, potencia o cadencia, y la fuerza
   como complemento. El resto (montaña, pádel, esquí de pista…) cuenta como carga, pero no se elige ni se planifica. */
const ENTRENABLES = ['bici', 'correr', 'skimo', 'fuerza'];
const scol = k => `var(--s-${k})`;
const TIPOS = {
  rec: { n: 'Recuperación', c: 'Recup.', k: 'k-rec' }, fondo: { n: 'Fondo', k: 'k-fondo' }, tempo: { n: 'Tempo', k: 'k-tempo' },
  int: { n: 'Intenso', k: 'k-int' }, otros: { n: 'Otros', k: 'k-otros' }, descanso: { n: 'Descanso', k: 'k-descanso' }, sin: { n: 'Sin etiqueta', k: 'k-descanso' },
};
const GARMIN_MAP = { AEROBIC_BASE: 'fondo', RECOVERY: 'rec', TEMPO: 'tempo', LACTATE_THRESHOLD: 'tempo', VO2MAX: 'int', ANAEROBIC_CAPACITY: 'int', SPEED: 'int' };

/* Detalle de septiembre (analizado por minutos de pulso, umbral bici ≈167 ppm) */
const SIM_RIDE = { id: 'sim1', dep: 'bici', f: '2026-09-26', km: 45.2, min: 108, fc: 128, g: 'RECOVERY', lugar: 'Salida de demo', tipo: 'fondo', z: [104, 4, 0], desn: 310, llano: { km: 30, kmh: 23.4, fc: 127 }, nuevos: ['Palau-solità i Plegamans', 'Polinyà', 'Santa Perpètua de Mogoda'], sim: true, analizada: true };

/* Plan de ejemplo (solo demo) con deporte y tipo */
function planInicial() {
  return {
    '2026-09-21': { dep: 'bici', t: 'fondo', d: '1 h 15 suave, <150 ppm', min: 75, act: '24446137313' },
    '2026-09-22': { dep: 'raqueta', t: 'otros', d: 'Pádel', min: 60, act: '24460806926' },
    '2026-09-23': { dep: 'fuerza', t: 'otros', d: 'Fuerza 45 min', min: 45 },
    '2026-09-24': { dep: 'bici', t: 'fondo', d: '2 h 30 por la Cerdanya, <150 ppm', min: 150, act: '24481090107' },
    '2026-09-25': { dep: 'bici', t: 'fondo', d: '1 h 15 suave', min: 75, act: '24496018479' },
    '2026-09-26': { dep: 'bici', t: 'fondo', d: 'Fondo largo 3 h, <150 ppm', min: 180, ruta: 'Cerdanya llana, 80 km' },
    '2026-09-27': { dep: 'correr', t: 'rec', d: 'Correr 40 min muy suave', min: 40 },
  };
}
/* Objetivo en "modos": simple por defecto, ajustable en modo pro */
const MODOS = {
  forma: { n: 'Estar en forma y sano', s: 'Lo recomendado para salud y rendimiento general.', h: [5, 7], int: [1, 2], fuerza: 2, juego: [0, 2] },
  reto: { n: 'Preparar un reto', s: 'Una marcha, una carrera o una travesía con fecha.', h: [7, 10], int: [1, 2], fuerza: 2, juego: [0, 1] },
  mejorar: { n: 'Mejorar en un deporte', s: 'Más intensidad específica en el que elijas.', h: [6, 9], int: [2, 2], fuerza: 2, juego: [0, 1] },
  volver: { n: 'Volver tras un parón', s: 'Recuperar la rutina sin lesionarte.', h: [3, 5], int: [0, 1], fuerza: 2, juego: [0, 2] },
};
const DIMS_META = {
  motor: { n: 'Motor aeróbico', mejora: 'Se mueve despacio: volumen suave y una sesión intensa corta a la semana.', cta: ['Ver evolución', 'evo'], hist: 'vo2', histLbl: 'VO2máx mensual' },
  subida: { n: 'Subida en bici', dep: 'bici', mejora: 'Una sesión de umbral a la semana. El test de 20 min te da tu punto de partida real.', cta: ['Hacer el test de subida', 'test'] },
  fondo: { n: 'Fondo', mejora: 'Horas suaves y salidas largas, en cualquier deporte de resistencia.', cta: ['Ver evolución', 'evo'], hist: 'es', histLbl: 'Endurance Score mensual' },
  volumen: { n: 'Volumen y constancia', mejora: 'Constancia antes que picos: sin semanas en blanco.', cta: ['Ver mi plan', 'plan'] },
  equilibrio: { n: 'Equilibrio de intensidad', mejora: 'Salidas largas de verdad suaves y lo duro en 1-2 días.', cta: ['Ver mi semana', 'plan'] },
};
function dims() {
  const out = {}; for (const [k, meta] of Object.entries(DIMS_META)) { const x = (M.ind || {})[k] || { falta: 'Sin datos todavía.' }; out[k] = { ...meta, ...x, u: x.dato || 'Falta dato', v: x.v ?? null };
    if (meta.hist) { const h = M.evo.filter(e => e[meta.hist]); if (h.length > 1) out[k].histPts = M.evo.map(e => ({ l: MC[dte(e.f).getMonth()], v: e[meta.hist] })); } }
  if (S.testRes) out.subida = { ...out.subida, v: S.testRes.v, est: false, conf: 'alta', u: `${nf(S.testRes.wkg, 2)} W/kg medido (test del ${fDia(S.testRes.f)})`, por: `Test de subida: ${S.testRes.km} km y ${S.testRes.desn} m en ${S.testRes.min} min a ${S.testRes.fc} ppm. Umbral estimado: ${nf(S.testRes.wkg, 2)} W/kg.` };
  return out;
}
/* Comidas simuladas de esta semana (porciones de plato en cuartos + proteína) */
function comidasIniciales() {
  const m = (f, h, tipo, c, p, v, txt) => ({ id: f + h, f, h, tipo, c, p, v, txt, sim: true });
  return [
    m('2026-09-24', '08:10', 'Desayuno', 2, 1, 0, 'Tostadas con tomate y huevos'), m('2026-09-24', '14:30', 'Comida', 1, 1, 2, 'Ensalada con pollo y un poco de arroz'), m('2026-09-24', '21:00', 'Cena', 1, 1, 2, 'Verdura con salmón'),
    m('2026-09-25', '08:00', 'Desayuno', 2, 1, 0, 'Avena con yogur'), m('2026-09-25', '14:00', 'Comida', 2, 1, 1, 'Pasta con atún'), m('2026-09-25', '21:15', 'Cena', 1, 2, 1, 'Tortilla y ensalada'),
    m('2026-09-26', '08:30', 'Desayuno', 2, 1, 1, 'Pan, huevos y fruta'),
  ];
}
const DEFAULTS = () => ({
  v: 6, onboarded: false, obStep: 0, obConn: false, variant: 'semana', hoyForma: false, os: null, theme: 'system', framed: null, modo: 'vivo',
  sports: [], fSport: [], pSport: [], pLevel: 'ccaa', townQ: '',
  tab: 'hoy', stack: [], plan: {}, next: null, nextDraft: null, week: null, readiness: null, adapt: null, otro: null,
  goal: { modo: 'forma' }, clasif: 'min', ai: 'claude', testRes: null, overrides: {}, share: { nombre: false, tipo: true, notas: true, pueblos: true }, nombre: '',
  meals: [], simRide: false, seenSim: true, lastSync: null, evoRange: 12, flows: {}, notes: [], activeFlow: null,
});
let S;
try { S = Object.assign(DEFAULTS(), JSON.parse(localStorage.getItem('trazo-v3') || 'null') || {}); if (S.v !== 6) S = DEFAULTS(); } catch (e) { S = DEFAULTS(); }
S.sports = S.sports.filter(k => ENTRENABLES.includes(k));
let saveTimer; function save() { try { localStorage.setItem('trazo-v3', JSON.stringify(S)); } catch (e) { } S.savedAt = Date.now(); clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (typeof DB !== 'undefined' && DB && S.modo === 'vivo') { const { plan, next, meals, goal, sports, overrides, testRes, nombre } = S; DB.doc('estado/app').set({ plan, next: next || null, meals: meals.map(m => ({ ...m, img: null })), goal, sports, overrides, testRes, nombre, at: S.savedAt }, { version: S.serverAt || 0 })
  .then(r => {
    // Otro (tu Claude, el entrenador) ha cambiado el plan después de que la app lo leyera: no se pisa, se recarga.
    if (r && r.conflicto) { S.serverAt = r.at; cargarDeDB(true).then(() => toast('Tu plan ha cambiado desde tu Claude: lo he recargado')); }
    else if (r && typeof r.at === 'number') { S.serverAt = r.at; try { localStorage.setItem('trazo-v3', JSON.stringify(S)); } catch (e) { } }
  }).catch(() => { }); } }, 1500); }
/* Plan y comidas de ejemplo: solo en modo demo */
function demoSeed() { S.plan = planInicial(); S.meals = comidasIniciales(); }
if (!S.os) S.os = /Android/i.test(navigator.userAgent) ? 'android' : 'ios';
// El marco de móvil es cosa del prototipo (?proto): la app usa la pantalla entera.
if (!/[?&]proto\b/.test(location.search)) S.framed = false; else if (S.framed === null) S.framed = matchMedia('(min-width: 900px)').matches;

/* ===== Cálculos ===== */
function acts() { return actsAll(); }
function actById(id) { return acts().find(a => a.id === id); }
function tipoAct(a) { if (S.overrides[a.id]) return S.overrides[a.id]; if (S.clasif === 'garmin' && SPORTS[a.dep].cardio) return GARMIN_MAP[a.g] || 'sin'; return a.tipo; }
function actsAll() { return [...(S.simRide && M.fuente === 'demo' ? [SIM_RIDE] : []), ...(M.acts || [])]; }
function actsDe(w) { const ds = days7(w); return acts().filter(a => ds.includes(a.f)); }
function planAll() { return { ...(S.next || {}), ...S.plan }; }
function planDe(w) { const all = planAll(), o = {}; days7(w).forEach(f => { if (all[f]) o[f] = all[f]; }); return Object.keys(o).length ? o : null; }
function sesion(f) {
  const p = planAll()[f]; if (!p) return null;
  let a = p.act ? actById(p.act) : null;
  if (!a && p.t !== 'descanso' && f <= HOY) a = acts().find(x => x.f === f && (x.dep === p.dep || (SPORTS[x.dep].cardio && SPORTS[p.dep]?.cardio))) || null;
  return { ...p, f, a };
}
function tipoSes(s) { return s.a ? tipoAct(s.a) : s.t; }
/* Resumen de una semana: lo hecho, por deporte, intensidad y salud */
function resumen(w) {
  const as = actsDe(w); const r = { min: 0, n: as.length, dep: {}, tipos: { rec: 0, fondo: 0, tempo: 0, int: 0 }, fuerza: 0, juego: 0, cardioMin: 0, dias: new Set(), z: [0, 0, 0], zKnown: 0 };
  for (const a of as) {
    r.min += a.min; r.dep[a.dep] = (r.dep[a.dep] || 0) + a.min; r.dias.add(a.f);
    const k = tipoAct(a); if (k in r.tipos) r.tipos[k]++;
    if (a.dep === 'fuerza') r.fuerza++; if (a.dep === 'raqueta') r.juego++;
    if (SPORTS[a.dep].cardio) r.cardioMin += a.min;
    if (a.z) { r.z = r.z.map((v, i) => v + a.z[i]); r.zKnown += a.min; }
  }
  const p = planDe(w);
  if (p) { const pl = Object.entries(p).filter(([f, s]) => s.t !== 'descanso'); const hasta = pl.filter(([f]) => f <= HOY); r.plan = pl.length; r.hechas = pl.filter(([f]) => sesion(f)?.a).length; r.pendientes = pl.filter(([f]) => f >= HOY && !sesion(f)?.a).length; r.debidas = hasta.length; }
  r.plan = r.plan || 0; r.hechas = r.hechas || 0; r.pendientes = r.pendientes || 0; r.debidas = r.debidas || 0;
  return r;
}
const rangoSem = w => { const a = dte(w), b = dte(addDays(w, 6)); return a.getMonth() === b.getMonth() ? `${a.getDate()}-${b.getDate()} ${MC[a.getMonth()]}` : `${a.getDate()} ${MC[a.getMonth()]} - ${b.getDate()} ${MC[b.getMonth()]}`; };
function objetivos() { const m = MODOS[S.goal.modo] || MODOS.forma; const g = S.goal; return { h: g.h || m.h, int: g.int || m.int, fuerza: g.fuerza ?? m.fuerza, juego: m.juego }; }
function insightsSemana(w) {
  const r = resumen(w), o = objetivos(), out = [];
  const top = Object.entries(r.dep).sort((a, b) => b[1] - a[1])[0];
  if (!r.n) return [['warn', 'info', 'Semana sin actividad registrada.']];
  if (r.fuerza < o.fuerza) out.push(['warn', 'dumbbell', `Fuerza: ${r.fuerza} de ${o.fuerza}. Dos sesiones cortas a la semana te vendrían bien.`]);
  else out.push(['good', 'dumbbell', `Fuerza cumplida: ${r.fuerza} sesiones.`]);
  if (top && r.min && top[1] / r.min >= 0.7 && r.n > 2) out.push(['warn', SPORTS[top[0]].ic, `El ${Math.round(top[1] / r.min * 100)} % fue ${SPORTS[top[0]].n.toLowerCase()}. Varía un poco: otro deporte suave cuenta.`]);
  if (r.tipos.int > o.int[1]) out.push(['bad', 'flame', `${r.tipos.int} días intensos: más de los ${o.int[1]} recomendados.`]);
  else if (r.tipos.int >= o.int[0]) out.push(['good', 'flame', `Intensidad bien dosificada: ${r.tipos.int} día${r.tipos.int === 1 ? '' : 's'} intenso${r.tipos.int === 1 ? '' : 's'}.`]);
  if (r.zKnown > 120) { const pct = Math.round(r.z[0] / (r.z[0] + r.z[1] + r.z[2]) * 100); out.push([pct >= 75 ? 'good' : pct >= 60 ? 'warn' : 'bad', 'heart', `${pct} % de tus minutos fueron suaves (objetivo: 75-80 %).`]); }
  const h = r.min / 60; if (h < o.h[0]) out.push(['warn', 'clock', `${nf(h)} h: por debajo de tus ${o.h[0]}-${o.h[1]} h.`]); else if (h > o.h[1] * 1.15) out.push(['warn', 'clock', `${nf(h)} h: por encima de tus ${o.h[0]}-${o.h[1]} h.`]);
  if (r.juego) out.push(['good', 'racket', `${r.juego} partido${r.juego === 1 ? '' : 's'}: suma variedad y lo pasas bien.`]);
  return out;
}
function wkgScore(w) { const A = [[0, 1], [2.2, 3], [3.2, 5], [4.1, 7], [5.0, 9], [5.7, 10]]; if (w >= 5.7) return 10; for (let i = 1; i < A.length; i++) if (w <= A[i][0]) { const [x0, y0] = A[i - 1], [x1, y1] = A[i]; return Math.max(1, y0 + (w - x0) / (x1 - x0) * (y1 - y0)); } return 10; }
function forma() { const d = dims(); const ks = ['motor', 'fondo', 'volumen', S.sports.includes('bici') ? 'subida' : 'equilibrio']; const vs = ks.map(k => d[k].v).filter(v => v != null); return vs.length ? half(vs.reduce((a, b) => a + b, 0) / vs.length) : null; }
function tipoAtleta() {
  const horas = {}; for (const a of acts()) if (SPORTS[a.dep].cardio) horas[a.dep] = (horas[a.dep] || 0) + a.min / 60;
  const top = Object.entries(horas).filter(([, h]) => h >= 8).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const est = (m0, m1) => { const h = {}; for (const a of acts()) { const m = dte(a.f).getMonth(); if ((m0 <= m1 ? m >= m0 && m <= m1 : m >= m0 || m <= m1) && SPORTS[a.dep].cardio) h[a.dep] = (h[a.dep] || 0) + a.min; } return Object.entries(h).sort((a, b) => b[1] - a[1])[0]?.[0]; };
  const inv = est(11, 2), ver = est(5, 8); const d = dims();
  if (top.length >= 3) return ['Multideporte', `Tus deportes con más horas: ${top.slice(0, 3).map(k => SPORTS[k].n.toLowerCase()).join(', ')}.${inv && ver && inv !== ver ? ` En invierno manda ${SPORTS[inv].n.toLowerCase()}; en verano, ${SPORTS[ver].n.toLowerCase()}.` : ''}`];
  if (d.motor.v != null && d.subida.v != null && d.motor.v - d.subida.v >= 2) return ['Motor grande, vatios por despertar', 'Tu motor aeróbico está por encima de lo que rindes subiendo en bici.'];
  if (top.length) return [`Deportista de ${SPORTS[top[0]].n.toLowerCase()}`, 'Tu base aeróbica viene de ahí.'];
  return ['Empezando', 'Aún hay pocas actividades para describirte.'];
}
function horasPorDeporte() { const h = {}; for (const a of acts()) h[a.dep] = (h[a.dep] || 0) + a.min / 60; return Object.fromEntries(Object.entries(h).filter(([k]) => k !== 'otros').sort((a, b) => b[1] - a[1])); }
function pueblosDe(sel) { return Object.values(M.towns || {}).filter(t => !sel.length || sel.some(s => t.dep[s])).sort((a, b) => b.km - a.km); }
function fitHoy() {
  const s = sesion(HOY); const r = rdy();
  if (!s || s.a || s.t === 'descanso') return { ok: true };
  const pesada = (s.t === 'fondo' && s.min >= 150) || s.t === 'int' || s.t === 'tempo';
  if (r < 50 && pesada) return { ok: false, nivel: 'no' };
  if (r < 75 && pesada) return { ok: true, nivel: 'suave' };
  return { ok: true, nivel: 'ok' };
}
/* Generador determinista de semana (sin IA) */
function generarSemana(deps, horas, modo, w = PROX) {
  const D = days7(w), m = MODOS[modo] || MODOS.forma, tot = horas * 60;
  const cardio = deps.filter(d => SPORTS[d].cardio); const main = cardio[0] || 'bici', sec = cardio[1] || main;
  const plan = {}; const set = (i, dep, t, d, min, ruta) => { plan[D[i]] = { dep, t, d, min: Math.round(min / 5) * 5, ruta }; };
  const fu = deps.includes('fuerza'), ju = deps.includes('raqueta');
  set(0, fu ? 'fuerza' : main, fu ? 'otros' : 'descanso', fu ? 'Fuerza 45 min: piernas y core' : 'Descanso', fu ? 45 : 0);
  if (!fu) plan[D[0]] = { dep: main, t: 'descanso', d: 'Descanso', min: 0 };
  set(1, main, 'fondo', `${dur(tot * 0.18)} suave, <150 ppm`, tot * 0.18);
  if (m.int[1] >= 1) set(2, main, 'int', main === 'bici' ? 'Umbral: 3 × 10 min a 160-166 ppm' : main === 'skimo' ? 'Subida a ritmo fuerte: 3 × 12 min' : 'Series: 5 × 4 min fuertes', tot * 0.14);
  else set(2, main, 'fondo', `${dur(tot * 0.14)} suave`, tot * 0.14);
  if (fu && ju) set(3, 'fuerza', 'otros', 'Fuerza 40 min: tren superior y core', 40); else set(3, sec, 'rec', `${SPORTS[sec].n} muy suave`, Math.min(50, tot * 0.08));
  if (fu && ju) set(4, 'raqueta', 'otros', 'Pádel o tenis', 60); else if (fu) set(4, 'fuerza', 'otros', 'Fuerza 40 min: tren superior', 40); else if (ju) set(4, 'raqueta', 'otros', 'Pádel o tenis', 60); else plan[D[4]] = { dep: main, t: 'descanso', d: 'Descanso', min: 0 };
  set(5, main, 'fondo', `Fondo largo ${dur(tot * 0.32)}, <150 ppm`, tot * 0.32, main === 'bici' ? '80 km por el Vallès' : null);
  set(6, sec, 'fondo', `${SPORTS[sec].n} ${dur(tot * 0.15)} suave`, tot * 0.15);
  if (fu && ju) plan[D[0]] = { dep: 'fuerza', t: 'otros', d: 'Fuerza 45 min: piernas y core', min: 45 };
  return plan;
}

/* ===== Iconos (24 px, trazo 1,75) ===== */
const ICP = {
  hoy: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  plan: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>',
  forma: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/><circle cx="12" cy="17" r="1.2"/>',
  comer: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 3c-2 0-3 3-3 6s1 4 3 4v8"/>',
  progreso: '<path d="M3 20h18M6 16l4-5 3 3 5-7"/>',
  pueblos: '<path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  claude: '<path d="M12 3.5l1.9 5.2 5.1 1.8-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.8z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>', chev: '<path d="M9 5l7 7-7 7"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v5.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V13"/>',
  bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9.5h6l3.5 7M12 16.5 9 9.5M15 9.5 14 6.5h-2"/>',
  run: '<circle cx="14.5" cy="4.5" r="1.8"/><path d="M7 21l3.2-5.5 3.3 2V22M10.2 15.5l1.3-6 3.5 3 3.5-1M11.5 9.5 8 10.5l-2 3"/>',
  skimo: '<path d="M3 19l18-6M5 21l17-6"/><path d="M9 11l3-6 4 5"/><circle cx="12" cy="4" r="1.5"/>',
  mountain: '<path d="M2.5 19.5 9 8.5l4 6.5 2.5-3.5 6 8z"/>', ski: '<path d="M4 20 20 6M7 21l14-12"/><circle cx="16" cy="4" r="1.5"/>',
  racket: '<ellipse cx="10" cy="9" rx="6" ry="6.5"/><path d="M14.2 13.8 20 20"/><circle cx="18.5" cy="5.5" r="1.5"/>',
  dumbbell: '<path d="M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12"/>', walk: '<circle cx="13" cy="4" r="1.8"/><path d="M9 21l2-6 3 2v4M11 15l1-6 3 3 3 1M12 9l-3 2-1 3"/>',
  dot: '<circle cx="12" cy="12" r="3"/>', move: '<path d="M7 7 3 11l4 4M3 11h13M17 9l4 4-4 4M21 13H8"/>',
  watch: '<rect x="6.5" y="6" width="11" height="12" rx="3.5"/><path d="M9 6l.8-3h4.4l.8 3M9 18l.8 3h4.4l.8-3M12 10v2.5l1.5 1"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  battery: '<rect x="3" y="7" width="15.5" height="10" rx="2.5"/><path d="M21 10.5v3"/><path d="M6 10v4"/>',
  send: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>', stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  sync: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.7 5.6L4 15M4 20v-5h5"/>',
  flame: '<path d="M12 21c-4 0-6.5-2.8-6.5-6.3 0-3.6 3-5.6 3.8-9.7 2.2 1.4 3.3 3.3 3.5 5.2 1-.8 1.6-2 1.8-3.4 2.3 2 3.9 4.9 3.9 7.9 0 3.5-2.5 6.3-6.5 6.3z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', food: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M16 3c-2 1.5-2.5 4-2.5 7h3V21"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6.5 7S5 18 5 15v-2.5a1.5 1.5 0 0 1 3 0"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  mountain2: '<path d="M2.5 19.5 9 8.5l4 6.5 2.5-3.5 6 8z"/>',
};
const ic = (n, s = 24, cls = '') => `<svg class="${cls}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICP[n] || ''}</svg>`;
const chip = (k, extra = '') => `<span class="chip ${TIPOS[k].k}">${TIPOS[k].n}${extra}</span>`;
const simTag = (txt = 'Simulado') => `<span class="sim" title="Dato simulado para el prototipo">${txt}</span>`;
const aiTag = (txt = 'IA') => `<span class="ai" title="Usa IA: tu Claude">${ic('sparkle', 12)}${txt}</span>`;
ICP.sparkle = '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/>';
const labTag = (txt = 'En investigación') => `<span class="lab">${txt}</span>`;
const sportDot = k => `<i style="background:${scol(k)}"></i>`;
function distBar(z) { const t = z[0] + z[1] + z[2] || 1; return `<div class="dist" role="img" aria-label="${Math.round(z[0] / t * 100)} % suave, ${Math.round(z[1] / t * 100)} % medio, ${Math.round(z[2] / t * 100)} % duro"><i style="width:${z[0] / t * 100}%;background:var(--fondo)"></i><i style="width:${z[1] / t * 100}%;background:var(--tempo)"></i><i style="width:${z[2] / t * 100}%;background:var(--int)"></i></div>`; }
function sportBar(dep) { const tot = Object.values(dep).reduce((a, b) => a + b, 0) || 1; return `<div class="sportbar" role="img" aria-label="${Object.entries(dep).map(([k, v]) => `${SPORTS[k].n} ${Math.round(v / tot * 100)} %`).join(', ')}">${SPORT_ORDER.filter(k => dep[k]).map(k => `<i style="width:${dep[k] / tot * 100}%;background:${scol(k)}" title="${SPORTS[k].n}: ${dur(dep[k])}"></i>`).join('')}</div><div class="legend2">${SPORT_ORDER.filter(k => dep[k]).map(k => `<span>${sportDot(k)}${SPORTS[k].n} ${dur(dep[k])}</span>`).join('')}</div>`; }
function decodePoly(s) { let i = 0, lat = 0, lon = 0; const o = []; while (i < s.length) { for (const k of [0, 1]) { let r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k) lon += d; else lat += d; } o.push([lon / 1e5, lat / 1e5]); } return o; }
function trackSvg(id) {
  const p = (DSET.rutas || {})[id]; if (!p) return '';
  const pts = decodePoly(p); const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  const k = Math.cos(ys[0] * Math.PI / 180); const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const W = 400, H = 220, pad = 16; const s = Math.min((W - 2 * pad) / ((maxx - minx) * k || 1), (H - 2 * pad) / ((maxy - miny) || 1));
  const ox = (W - (maxx - minx) * k * s) / 2, oy = (H - (maxy - miny) * s) / 2;
  const P = pts.map(([x, y]) => `${(ox + (x - minx) * k * s).toFixed(1)},${(oy + (maxy - y) * s).toFixed(1)}`);
  const [sx0, sy0] = P[0].split(',');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Recorrido"><polyline points="${P.join(' ')}" fill="none" stroke="var(--card)" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${P.join(' ')}" fill="none" stroke="var(--tint)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${sx0}" cy="${sy0}" r="6" fill="var(--good)" stroke="var(--card)" stroke-width="2"/></svg>`;
}
