/* ===== Agenda: tu calendario (iCal) y huecos para entrenar =====
   Solo en la web: el Worker lee tu calendario y devuelve cuándo estás ocupado.
   El plan pone cada sesión en un hueco libre (6:00-22:00, con 15 min de margen). */
let CAL = null; // { 'AAAA-MM-DD': [{ de, a, t } | { todoDia, t }] } o null sin calendario
const calDisponible = () => !!(window.PLATFORM && PLATFORM.calendario);
async function cargarCalendario() {
  if (!calDisponible()) return;
  try {
    const r = await PLATFORM.calendario.leer(SEM, 14);
    const o = {}; for (const e of r.eventos || []) (o[e.f] ||= []).push(e);
    CAL = r.configurado ? o : null; S.calOk = !!r.configurado; render();
  } catch (e) { }
}
const aMin = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const aHora = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function huecos(f) {
  const ev = ((CAL && CAL[f]) || []).filter(e => !e.todoDia).map(e => [Math.max(0, aMin(e.de) - 15), Math.min(1440, aMin(e.a) + 15)]).sort((a, b) => a[0] - b[0]);
  let t = 6 * 60; const fin = 22 * 60;
  if (f === HOY) { const d = new Date(); t = Math.max(t, Math.ceil((d.getHours() * 60 + d.getMinutes() + 15) / 15) * 15); }
  const out = [];
  for (const [a, b] of ev) { if (a > t) out.push([t, Math.min(a, fin)]); t = Math.max(t, b); if (t >= fin) break; }
  if (t < fin) out.push([t, fin]);
  return out.filter(([a, b]) => b - a >= 20);
}
/* Hora para una sesión: primero tus horas habituales; si no, el primer hueco donde quepa; si no, la recorta */
function encajar(f, min) {
  const hs = huecos(f); const finde = [0, 6].includes(dte(f).getDay());
  const pref = (finde ? ['09:00', '10:00', '17:00', '08:00'] : ['07:00', '18:30', '19:30', '14:00', '06:30', '20:00']).map(aMin);
  for (const p of pref) if (hs.some(([a, b]) => p >= a && p + min <= b)) return { h: aHora(p), min };
  const h1 = hs.find(([a, b]) => b - a >= min); if (h1) return { h: aHora(h1[0]), min };
  const big = hs.reduce((m, x) => (!m || x[1] - x[0] > m[1] - m[0] ? x : m), null);
  if (big && big[1] - big[0] >= 30) return { h: aHora(big[0]), min: Math.floor((big[1] - big[0]) / 5) * 5, recortada: true };
  return null;
}
/* Coloca cada sesión del plan en tu agenda. Devuelve los cambios que ha tenido que hacer. */
function aplicarAgenda(plan) {
  const notas = []; if (!CAL) return notas;
  for (const [f, s] of Object.entries(plan)) {
    if (f < HOY || s.t === 'descanso' || !s.min) continue;
    const e = encajar(f, s.min);
    if (!e) {
      // Sin hueco: pruebo a cambiarla por un día de descanso libre de la misma semana
      const cerca = g => Math.abs(dte(g) - dte(f)); const otro = Object.keys(plan).sort((x, y) => cerca(x) - cerca(y)).find(g => g !== f && g >= HOY && weekOf(g) === weekOf(f) && plan[g].t === 'descanso' && encajar(g, s.min));
      plan[f] = { dep: s.dep, t: 'descanso', d: 'Descanso: día lleno en tu agenda', min: 0 };
      if (otro) { const e2 = encajar(otro, s.min); plan[otro] = { ...s, h: e2.h, min: e2.min }; notas.push(`${fCorta(f)} → ${fCorta(otro)}`); }
      else notas.push(`${fCorta(f)}: sin hueco, descanso`);
      continue;
    }
    s.h = e.h; if (e.recortada) { notas.push(`${fCorta(f)}: ${dur(s.min)} → ${dur(e.min)}`); s.min = e.min; }
  }
  return notas;
}
const agendaDia = f => ((CAL && CAL[f]) || []);
const resumenAgenda = f => { const ev = agendaDia(f); if (!ev.length) return ''; const td = ev.find(e => e.todoDia); const h = ev.filter(e => !e.todoDia); return td ? esc(td.t) : `ocupado ${h[0].de}-${h[h.length - 1].a}`; };

/* Aviso en Hoy: semana sin plan, o (de viernes a domingo) la siguiente sin preparar */
function cardAvisoPlan() {
  const dow = dte(HOY).getDay(); let w = null, t = '', s = '';
  if (!planDe(SEM)) { w = SEM; t = 'Aún no has preparado esta semana'; s = `Te la preparo desde hoy con tus deportes${CAL ? ' y respetando tu agenda' : ''}. Tarda un segundo.`; }
  else if ([5, 6, 0].includes(dow) && !planDe(PROX)) { w = PROX; t = 'Prepara la semana que viene'; s = `Del ${fDia(PROX)} al ${fDia(addDays(PROX, 6))}${CAL ? ', encajada en tu agenda' : ''}.`; }
  if (!w) return '';
  return `<div class="adapt b-full"><div class="row">${ic('plan', 26)}<div class="grow"><b style="font-size:17px">${t}</b><p class="small muted">${s}</p></div></div>
    <div class="btns"><button class="btn fill" type="button" data-a="plan-sem" data-v="${w}">Prepararla</button><button class="btn text" type="button" data-a="claude" data-v="${w === SEM ? 'Prepárame el resto de esta semana' : 'Prepárame la semana que viene'}">${ic('claude', 18)} Con Claude</button></div></div>`;
}

/* Ajustes: conectar el calendario */
function cardCalendario() {
  const tit = estado => `<div class="card-h">${ic('plan', 18)}<span class="grow">Calendario</span>${estado || ''}</div>`;
  if (S.calOk) { const n = Object.values(CAL || {}).flat().length; return `<div class="card stack" style="gap:12px">${tit('<span class="live">Conectado</span>')}<p class="small">${n} evento${n === 1 ? '' : 's'} en los próximos 14 días. Pongo tus sesiones en los huecos libres.</p><div class="btns"><button class="btn plain" type="button" data-a="cal-quitar">Quitar calendario</button></div></div>`; }
  return `<div><div class="card stack" style="gap:10px">${tit()}
    <p class="small">Conecta tu calendario y no te pondré entrenos cuando estés ocupado.</p>
    <label class="vh" for="cal-url">Enlace privado iCal</label><input id="cal-url" class="search" inputmode="url" autocomplete="off" placeholder="https://calendar.google.com/…/basic.ics">
    <div class="btns"><button class="btn fill" type="button" data-a="cal-guardar">Conectar calendario</button></div>
    <details><summary class="small">Dónde encuentro el enlace</summary><ul class="small" style="padding-left:18px;margin:8px 0">
      <li><b>Google Calendar</b> (desde el ordenador): Configuración → tu calendario → Integrar el calendario → <i>Dirección secreta en formato iCal</i>.</li>
      <li><b>Outlook</b>: Configuración → Calendario → Calendarios compartidos → Publicar un calendario → enlace ICS.</li>
      <li><b>iCloud</b>: app Calendario → (i) junto al calendario → Calendario público → Compartir enlace (ojo: lo hace público).</li></ul>
      <p class="xs">Solo uso cuándo estás ocupado. El enlace se guarda en tu sesión de esta web y no se comparte.</p></details></div></div>`;
}
