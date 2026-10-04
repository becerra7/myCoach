// Lector de calendarios iCal (.ics): devuelve los bloques ocupados de unos días,
// en hora local. Cubre lo que usan Google, iCloud y Outlook: zonas horarias,
// eventos de día entero, repeticiones (diarias, semanales, mensuales), excepciones
// y ediciones de una sola repetición. Los eventos "disponible" y los cancelados no ocupan.

const pad = n => String(n).padStart(2, '0');

/** Descarga un .ics (máx. 5 MB). null si no responde o no es un calendario. */
export async function descargarIcs(url) {
  try {
    const r = await fetch(url, { headers: { Accept: 'text/calendar, */*' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const t = await r.text();
    return t.length < 5e6 && t.includes('BEGIN:VCALENDAR') ? t : null;
  } catch { return null; }
}
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Minutos que la zona `tz` va por delante de UTC en el instante `ms`. */
function offsetMin(tz, ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms) / 60000;
}
/** Hora de pared en `tz` → instante UTC (ms). */
function wallToUtc(w, tz) {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
  const o1 = offsetMin(tz, guess - offsetMin(tz, guess) * 60000);
  return guess - o1 * 60000;
}
/** Instante UTC → hora de pared en `tz`. */
function utcToWall(ms, tz) {
  const t = new Date(ms + offsetMin(tz, ms) * 60000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}
const validTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

function parseFecha(prop, tzLocal) {
  if (!prop) return null;
  const v = prop.value.trim(); const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const w = { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0) };
  if (!m[4] || prop.params.VALUE === 'DATE') return { dia: true, w };
  const tz = m[7] ? 'UTC' : prop.params.TZID && validTz(prop.params.TZID) ? prop.params.TZID : tzLocal;
  return { dia: false, ms: tz === 'UTC' ? Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) : wallToUtc(w, tz), tz };
}
function parseDuracion(s) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s || '');
  if (!m) return null;
  return ((+m[2] || 0) * 7 * 1440 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0)) * 60000;
}

/** Texto .ics → lista de VEVENT como { NOMBRE: [{ value, params }] }. */
export function parseIcs(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = []; let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') { if (ev) out.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const [name, ...ps] = line.slice(0, i).split(';');
    const params = Object.fromEntries(ps.map(p => { const j = p.indexOf('='); return [p.slice(0, j).toUpperCase(), p.slice(j + 1).replace(/^"|"$/g, '')]; }));
    (ev[name.toUpperCase()] ||= []).push({ value: line.slice(i + 1), params });
  }
  return out;
}
const unescape = s => String(s || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

/**
 * Bloques ocupados entre `desde` (YYYY-MM-DD) y `dias` días después, en `tz`.
 * → [{ f, de: 'HH:MM', a: 'HH:MM', t }]  (día entero: { f, todoDia: true, t })
 */
export function ocupados(text, desde, dias = 14, tz = 'Europe/Madrid') {
  const [y, m, d] = desde.split('-').map(Number);
  const ini = wallToUtc({ y, m, d, h: 0, mi: 0 }, tz), fin = wallToUtc({ y, m, d: d + dias, h: 0, mi: 0 }, tz);
  const evs = parseIcs(text);
  // Repeticiones editadas sueltas: la original se omite y la editada va como evento propio
  const editadas = new Set();
  for (const e of evs) if (e['RECURRENCE-ID'] && e.UID) { const r = parseFecha(e['RECURRENCE-ID'][0], tz); if (r) editadas.add(e.UID[0].value + '@' + (r.dia ? `${r.w.y}${pad(r.w.m)}${pad(r.w.d)}` : r.ms)); }
  const out = [];
  const emitir = (s, e, dia, t) => {
    if (dia) { // día entero: de s a e (exclusivo), en días de calendario
      for (let k = Date.UTC(s.y, s.m - 1, s.d); k < Date.UTC(e.y, e.m - 1, e.d); k += 864e5) {
        const f = new Date(k).toISOString().slice(0, 10); if (f >= desde && k < Date.UTC(y, m - 1, d + dias)) out.push({ f, todoDia: true, t });
      }
      return;
    }
    if (e <= ini || s >= fin || e <= s) return;
    // Partir por días locales
    let a = s;
    while (a < e) {
      const w = utcToWall(a, tz); const finDia = wallToUtc({ ...w, d: w.d + 1, h: 0, mi: 0 }, tz); const b = Math.min(e, finDia);
      const f = `${w.y}-${pad(w.m)}-${pad(w.d)}`, wb = utcToWall(b, tz);
      if (a >= ini && a < fin) out.push({ f, de: `${pad(w.h)}:${pad(w.mi)}`, a: b === finDia ? '24:00' : `${pad(wb.h)}:${pad(wb.mi)}`, t });
      a = b;
    }
  };
  for (const e of evs) {
    if ((e.STATUS?.[0]?.value || '').toUpperCase() === 'CANCELLED') continue;
    if ((e.TRANSP?.[0]?.value || '').toUpperCase() === 'TRANSPARENT') continue;
    const s = parseFecha(e.DTSTART?.[0], tz); if (!s) continue;
    const t = unescape(e.SUMMARY?.[0]?.value) || 'Ocupado';
    const endP = parseFecha(e.DTEND?.[0], tz); const durP = parseDuracion(e.DURATION?.[0]?.value);
    const durMs = s.dia ? ((endP && endP.dia ? Date.UTC(endP.w.y, endP.w.m - 1, endP.w.d) - Date.UTC(s.w.y, s.w.m - 1, s.w.d) : durP) || 864e5)
      : (endP && !endP.dia ? endP.ms - s.ms : durP ?? 0);
    const uid = e.UID?.[0]?.value || '';
    const ex = new Set((e.EXDATE || []).flatMap(p => p.value.split(',').map(v => { const r = parseFecha({ value: v, params: p.params }, tz); return r ? (r.dia ? `${r.w.y}${pad(r.w.m)}${pad(r.w.d)}` : r.ms) : null; })));
    const una = (startWall, startMs) => {
      const key = s.dia ? `${startWall.y}${pad(startWall.m)}${pad(startWall.d)}` : startMs;
      if (ex.has(key) || (!e['RECURRENCE-ID'] && editadas.has(uid + '@' + key))) return;
      if (s.dia) { const e2 = new Date(Date.UTC(startWall.y, startWall.m - 1, startWall.d) + durMs); emitir(startWall, { y: e2.getUTCFullYear(), m: e2.getUTCMonth() + 1, d: e2.getUTCDate() }, true, t); }
      else emitir(startMs, startMs + durMs, false, t);
    };
    const rr = e.RRULE?.[0]?.value;
    const baseTz = s.dia ? 'UTC' : s.tz === 'UTC' ? tz : s.tz;
    const w0 = s.dia ? s.w : utcToWall(s.ms, baseTz);
    if (!rr || e['RECURRENCE-ID']) { una(w0, s.ms); continue; }
    const R = Object.fromEntries(rr.split(';').map(x => x.split('=')));
    const freq = R.FREQ, iv = Math.max(1, +R.INTERVAL || 1), count = R.COUNT ? +R.COUNT : Infinity;
    const until = R.UNTIL ? parseFecha({ value: R.UNTIL, params: {} }, tz) : null;
    const untilMs = until ? (until.dia ? Date.UTC(until.w.y, until.w.m - 1, until.w.d + 1) : until.ms) : Infinity;
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) { una(w0, s.ms); continue; }
    const byday = (R.BYDAY || '').split(',').filter(Boolean);
    if (byday.some(x => /\d/.test(x)) && freq !== 'MONTHLY') continue;
    const dias0 = Date.UTC(w0.y, w0.m - 1, w0.d) / 864e5, dow0 = new Date(dias0 * 864e5).getUTCDay();
    const lunes0 = dias0 - ((dow0 + 6) % 7);
    let n = 0;
    const finBusqueda = Math.min(untilMs, fin + 864e5);
    for (let k = dias0; k <= dias0 + 366 * 5; k++) {
      const dt = new Date(k * 864e5); const wall = { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: w0.h, mi: w0.mi };
      const ms = s.dia ? Date.UTC(wall.y, wall.m - 1, wall.d) : wallToUtc(wall, baseTz);
      if (ms > finBusqueda || n >= count) break;
      const dow = dt.getUTCDay(); let ok = false;
      if (freq === 'DAILY') ok = (k - dias0) % iv === 0 && (!byday.length || byday.includes(Object.keys(WD)[dow]));
      else if (freq === 'WEEKLY') ok = Math.floor((k - lunes0) / 7) % iv === 0 && (byday.length ? byday.includes(Object.keys(WD)[dow]) : dow === dow0);
      else if (freq === 'MONTHLY') {
        const meses = (wall.y - w0.y) * 12 + wall.m - w0.m;
        if (meses % iv === 0) {
          if (byday.length) { // p. ej. 1MO, -1FR
            ok = byday.some(x => { const mm = /^([+-]?\d)?(\w\w)$/.exec(x); if (!mm || WD[mm[2]] !== dow) return false; const nth = +mm[1] || 0; if (!nth) return true; const semana = Math.ceil(wall.d / 7); const diasMes = new Date(Date.UTC(wall.y, wall.m, 0)).getUTCDate(); return nth > 0 ? semana === nth : Math.ceil((diasMes - wall.d + 1) / 7) === -nth; });
          } else ok = wall.d === w0.d;
        }
      } else if (freq === 'YEARLY') ok = (wall.y - w0.y) % iv === 0 && wall.m === w0.m && wall.d === w0.d;
      if (!ok) continue;
      n++;
      if (ms + durMs > ini) una(wall, ms);
    }
  }
  const orden = x => x.f + (x.todoDia ? '' : x.de);
  return out.sort((a, b) => orden(a).localeCompare(orden(b)));
}
