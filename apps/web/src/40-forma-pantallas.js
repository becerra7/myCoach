/* ===== FORMA: parte común + detalle por deporte ===== */
function barDim(d) {
  const pct = v => (v - 1) / 9 * 100;
  const fill = d.est ? `<i class="fill est" style="width:${pct(d.v)}%"></i>` : `<i class="fill" style="width:${pct(d.v)}%"></i>`;
  return `<span class="bar" aria-hidden="true"><i class="rail"></i>${fill}<i class="tick" style="left:${pct(7)}%"></i><i class="tick" style="left:calc(100% - 2px)"></i></span>`;
}
const dimRow = (k, x) => x.v == null ? `<button type="button" class="dim" data-a="dim" data-v="${k}"><span class="n">${esc(x.n)}</span><span class="v">—</span>${ic('chev', 18, 'chev')}<span class="u">Falta dato: ${esc(x.falta || '')}</span></button>` : `<button type="button" class="dim" data-a="dim" data-v="${k}"><span class="n">${esc(x.n)} ${x.est ? '<span class="q" title="Estimado">?</span>' : ''}</span><span class="v">${nf(x.v)}</span>${ic('chev', 18, 'chev')}${barDim(x)}<span class="u">${esc(x.u)}</span></button>`;
function sportDetail(k) {
  const all = acts().filter(x => x.dep === k); if (!all.length) return null;
  const tiles = sportStats(k); const txt = [], warn = [];
  if (k === 'bici') { const ll = all.filter(x => x.llano).sort((a, b) => b.llano.kmh - a.llano.kmh)[0]; if (ll) { tiles.push([nf(ll.llano.kmh), 'km/h', `mejor llano a ${ll.llano.fc} ppm`]); txt.push(`Mejor llano: ${nf(ll.llano.kmh)} km/h a ${ll.llano.fc} ppm (${fDia(ll.f)}, ${ll.llano.km} km).`); } const b = M.ind.best; if (b) tiles.push([nf(b.sub.wkg, 1), 'W/kg', 'subida estimada ?']); else warn.push('Sin subidas de 10 min o más en 90 días: no puedo estimar tus W/kg.'); }
  if (k === 'skimo') { const bs = all.filter(x => x.sub && !x.sub.remonte).sort((a, b) => b.sub.vam - a.sub.vam)[0]; const rem = all.filter(x => x.sub && x.sub.remonte); if (bs) txt.push(`Mejor subida: ${bs.sub.desn} m en ${dur(bs.sub.min)} a ${bs.sub.fc} ppm (${esc(bs.lugar)}, ${fDia(bs.f)}): ${bs.sub.vam} m/h.`); if (rem.length) warn.push(`${rem.length} subida${rem.length === 1 ? '' : 's'} descartada${rem.length === 1 ? '' : 's'}: ritmo imposible con ese pulso (remonte).`); const sin = all.filter(x => !x.sub).length; if (sin) warn.push(`${sin} salida${sin === 1 ? '' : 's'} sin detalle todavía.`); const vel = all.filter(x => x.g === 'SPEED' && x.fc && x.fc < 135).length; if (vel) warn.push(`Garmin etiqueta ${vel} salida${vel === 1 ? '' : 's'} suaves como "velocidad"; aquí cuentan como fondo por su pulso.`); }
  if (k === 'correr') { if (M.perfil.vo2) tiles.push([nf(M.perfil.vo2), 'VO2máx', 'Garmin']); const h = M.evo.filter(e => e.hill).slice(-1)[0]; if (h) tiles.push([h.hill, 'Hill Score', fDia(h.f)]); }
  if (k === 'raqueta') { const fc = all.filter(x => x.fc); if (fc.length) tiles.push([Math.round(fc.reduce((s, x) => s + x.fc, 0) / fc.length), 'ppm', 'pulso medio']); txt.push('Juego: suma variedad. No lo cuento como intensidad salvo que el pulso lo diga.'); }
  if (k === 'fuerza') { const sem = M.weeks.filter(([, v]) => v.fuerza).length; if (sem < M.weeks.length / 2) warn.push(`Solo ${sem} de ${M.weeks.length} semanas con fuerza. Lo recomendado son 2 sesiones por semana.`); }
  if (k === 'montana') txt.push('Volumen suave: suma fondo sin cansarte.');
  return { tiles: tiles.slice(0, 4), txt: txt.join(' '), warn: warn.join(' '), dims: k === 'bici' ? ['subida'] : [] };
}
function tabForma() {
  const d = dims(), [tipo, desc] = tipoAtleta(); const sel = S.fSport.length ? S.fSport : S.sports;
  const secs = sel.map(k => [k, sportDetail(k)]).filter(([, x]) => x).map(([k, x]) => {
    return `<section class="b-full stack" style="gap:10px"><div class="sporth"><span class="dotb" style="background:${scol(k)}">${ic(SPORTS[k].ic, 20)}</span><h2>${SPORTS[k].n}</h2></div>
      <div class="tiles">${x.tiles.map(([v, u, s]) => `<div class="tile" style="cursor:default"><span class="v">${v} <small>${u}</small></span><span class="s">${s}</span></div>`).join('')}</div>
      ${(x.dims || []).map(k2 => `<div class="card" style="padding-top:4px;padding-bottom:4px"><div class="dims">${dimRow(k2, d[k2])}</div></div>`).join('')}
      <p class="small muted" style="padding:0 4px">${esc(x.txt)}</p>${x.warn ? `<p class="small" style="padding:0 4px;color:var(--warn)">${ic('info', 14)} ${esc(x.warn)}</p>` : ''}</section>`; }).join('');
  const comunes = ['motor', 'fondo', 'volumen', 'equilibrio'];
  return { title: 'Forma', html: head('Forma', 'Parte común y detalle de cada deporte') + `<div class="content">
    ${fchips('fSport', S.sports, S.fSport, 'Todos mis deportes')}
    <div class="bento">
      ${cardPeso()}
      <div class="card hero b-side"><div class="row" style="align-items:flex-start"><span class="card-h grow">Forma general</span><button class="iconbtn" type="button" aria-label="Compartir tu ficha" data-a="push" data-v="compartir">${ic('share')}</button></div>
        <div class="bignum"><span class="v">${forma() == null ? '—' : nf(forma())}</span><span class="of">/10</span></div><span class="kind">${esc(tipo)}</span><p class="small muted">${esc(desc)}</p>
        <button class="btn tonal" type="button" data-a="push" data-v="evo">${ic('chart', 18)} Ver evolución</button></div>
      <div class="b-hero stack" style="gap:8px"><div class="section-h" style="padding-top:0"><h2>Común a todos</h2></div><div class="card" style="padding-top:4px;padding-bottom:4px"><div class="dims">${comunes.map(k => dimRow(k, d[k])).join('')}</div></div>
        <p class="xs" style="padding:0 4px">Marcas: grupeta fuerte (7) y profesional (10). Barra rayada: estimación.</p></div>
      ${secs}
      <div class="b-half">${cardObjetivo(true)}</div>
      <div class="card b-half"><div class="card-h"><span class="grow">Tests para afinar</span></div><div class="list" style="background:transparent;margin:0 -16px">
        <button type="button" class="li" data-a="push" data-v="test">${ic('mountain')}<span class="main"><b>Test de subida en bici</b><span>${S.testDone ? 'Hecho' : '20 min a tope · quita el "?"'}</span></span>${ic('chev', 18, 'chev')}</button>
        <button type="button" class="li" data-a="toast" data-v="Iría igual: instrucciones y resultado">${ic('run')}<span class="main"><b>5 km corriendo</b><span>Confirma tu VO2máx</span></span>${ic('chev', 18, 'chev')}</button></div></div>
    </div></div>` };
}
function sheetDim(k) {
  openSheet({ title: dims()[k].n, size: 'large', id: 'dim', body: () => { const x = dims()[k];
    if (x.v == null) return `<p><b>Falta dato.</b> ${esc(x.falta || '')}</p><button class="btn fill wide" type="button" data-a="dim-cta" data-v="${x.cta[1]}">${esc(x.cta[0])}</button>`;
    const hist = x.histPts ? `<div class="stack" style="gap:4px"><b class="small">${esc(x.histLbl)} ${M.fuente === 'vivo' ? '<span class="live">Real</span>' : ''}</b>${chartLine(x.histPts, { fmt: v => nf(v, k === 'motor' ? 1 : 0), bands: k === 'fondo' ? [[5800, 'Entrenado'], [6600, 'Muy entr.']] : [] })}</div>` : '';
    return `<div class="row"><div class="bignum"><span class="v" style="font-size:64px">${nf(x.v)}</span><span class="of">/10</span></div><div class="grow stack" style="gap:6px;align-items:flex-start"><span class="conf ${x.conf}">Confianza ${x.conf}</span><span class="small muted">${esc(x.u)}</span></div></div>
      <div class="stack"><b>Por qué</b><p class="muted">${esc(x.por)}</p></div>${hist}
      <div class="list"><div class="li" style="cursor:default"><span class="main"><b>Grupeta fuerte</b><span>nota 7</span></span><span class="num" style="font-size:20px">${esc(x.ref[0])}</span></div><div class="li" style="cursor:default"><span class="main"><b>Profesional</b><span>nota 10</span></span><span class="num" style="font-size:20px">${esc(x.ref[1])}</span></div></div>
      <div class="stack"><b>Cómo mejorar</b><p class="muted">${esc(x.mejora)}</p></div>
      <button class="btn fill wide" type="button" data-a="dim-cta" data-v="${x.cta[1]}">${esc(x.cta[0])}</button>`; } });
  markFlow('forma');
}

/* ===== EVOLUCIÓN (datos reales) ===== */
function scrEvo() {
  const sel = S.fSport.length ? S.fSport : SPORT_ORDER.filter(k => k !== 'otros');
  const n = S.evoRange === 3 ? 13 : S.evoRange === 6 ? 26 : 52; const weeks = M.weeks.slice(-n);
  const cols = weeks.map(([w, m]) => { const v = {}; for (const k of sel) if (m[k]) v[k] = m[k] / 60; return { l: fDia(w).replace(' ', ' '), v, tip: `Semana del ${fDia(w)}: ${Object.entries(v).map(([k, h]) => `${SPORTS[k].n} ${nf(h)} h`).join(', ') || 'nada'}` }; });
  const keys = SPORT_ORDER.filter(k => sel.includes(k) && cols.some(c => c.v[k]));
  const tot = cols.reduce((a, c) => a + Object.values(c.v).reduce((x, y) => x + y, 0), 0);
  const dom = (m0, m1) => { const h = {}; weeks.forEach(([w, v]) => { const mo = dte(w).getMonth(); if (mo >= m0 && mo <= m1) for (const [k, x] of Object.entries(v)) if (sel.includes(k)) h[k] = (h[k] || 0) + x; }); const t = Object.entries(h).sort((a, b) => b[1] - a[1])[0]; return t && SPORTS[t[0]].n.toLowerCase(); };
  const lim = addDays(HOY, -S.evoRange * 31); const evo = M.evo.filter(e => e.f >= lim);
  const txtLine = (arr, key, fmt) => { const v = arr.filter(e => e[key] != null); if (v.length < 2) return 'Aún no hay suficientes meses con este dato.'; const last = v[v.length - 1], mx = v.reduce((a, b) => b[key] > a[key] ? b : a), mn = v.reduce((a, b) => b[key] < a[key] ? b : a); return `<b>Último: ${fmt(last[key])}</b> (${fDia(last.f)}). Máximo ${fmt(mx[key])} en ${MS[dte(mx.f).getMonth()]}; mínimo ${fmt(mn[key])} en ${MS[dte(mn.f).getMonth()]}.`; };
  const z4 = weeks.slice(-6).map(([w]) => { const z = actsDe(w).filter(a => a.z).reduce((z, a) => z.map((v, i) => v + a.z[i]), [0, 0, 0]); const t = z[0] + z[1] + z[2]; return { l: fDia(w), v: t > 60 ? Math.round(z[0] / t * 100) : null }; });
  const card = (t, body, wide) => `<div class="card ${wide ? 'b-full' : 'b-half'}"><div class="card-h"><span class="grow">${t}</span></div>${body}</div>`;
  const tabla = `<details class="tbl"><summary>Ver datos</summary><table><thead><tr><th>Mes</th><th>VO2máx</th><th>Endurance</th><th>Hill</th></tr></thead><tbody>${M.evo.map(e => `<tr><td>${fDia(e.f)}</td><td>${e.vo2 ? nf(e.vo2) : '—'}</td><td>${e.es ? nf(e.es, 0) : '—'}</td><td>${e.hill ?? '—'}</td></tr>`).join('')}</tbody></table></details>`;
  return { title: 'Evolución', html: head('Evolución', `${M.fuente === 'vivo' ? 'Datos de Garmin en vivo' : 'Datos de demo'} · desde ${fDia(M.weeks[0]?.[0] || HOY)}`) + `<div class="content">
    <div class="seg" role="group" aria-label="Periodo"><button type="button" data-a="evo-range" data-v="3" aria-pressed="${S.evoRange === 3}">3 meses</button><button type="button" data-a="evo-range" data-v="6" aria-pressed="${S.evoRange === 6}">6 meses</button><button type="button" data-a="evo-range" data-v="12" aria-pressed="${S.evoRange === 12}">1 año</button></div>
    ${fchips('fSport', SPORT_ORDER.filter(k => acts().some(a => a.dep === k)), S.fSport)}
    <div class="bento">
    ${card('Horas por semana', `<p><b>${nf(tot / Math.max(1, weeks.length))} h de media</b> en ${weeks.length} semanas${S.fSport.length ? ` con ${S.fSport.map(k => SPORTS[k].n.toLowerCase()).join(' y ')}` : ''}.${dom(11, 11) || dom(0, 2) ? ` En invierno domina ${dom(0, 2) || dom(11, 11)}` : ''}${dom(5, 8) ? `; en verano, ${dom(5, 8)}` : ''}.</p>${keys.length ? chartStacked(cols, keys, { unit: 'h', fmt: v => nf(v, 1), labelsEvery: weeks.length > 20 ? 6 : 3 }) + `<div class="legend2">${keys.map(k => `<span>${sportDot(k)}${SPORTS[k].n}</span>`).join('')}</div>` : '<p class="muted">Sin actividades en este periodo.</p>'}`, true)}
    ${card('Endurance Score', `<p>${txtLine(evo, 'es', v => nf(v, 0))}</p>${evo.filter(e => e.es).length > 1 ? chartLine(evo.map(e => ({ l: MC[dte(e.f).getMonth()], v: e.es })), { fmt: v => nf(v, 0), bands: [[5800, 'Entrenado'], [6600, 'Muy entr.']] }) : ''}`)}
    ${card('VO2máx (correr)', `<p>${txtLine(evo, 'vo2', v => nf(v, 1))}</p>${evo.filter(e => e.vo2).length > 1 ? chartLine(evo.map(e => ({ l: MC[dte(e.f).getMonth()], v: e.vo2 })), { fmt: v => nf(v, 1) }) : ''}`)}
    ${card('Minutos suaves (actividades con detalle)', z4.some(x => x.v != null) ? `<p>Objetivo: 75-80 %.</p>${chartLine(z4, { fmt: v => `${Math.round(v)} %`, min: 0, max: 100, bands: [[75, 'objetivo']] })}` : '<p class="muted">Falta el detalle de pulso de las actividades recientes.</p>')}
    ${card('Hill Score (Garmin, correr)', `<p>${txtLine(evo, 'hill', v => nf(v, 0))}</p>${evo.filter(e => e.hill).length > 1 ? chartLine(evo.map(e => ({ l: MC[dte(e.f).getMonth()], v: e.hill })), { fmt: v => nf(v, 0) }) : ''}`)}
    <div class="b-full">${tabla}</div></div></div>` };
}

/* ===== OBJETIVO: modos simples, ajustes pro opcionales ===== */
function scrObjetivo(scr) {
  const g = scr.g || (scr.g = clone(S.goal)); const m = MODOS[g.modo] || MODOS.forma; const pro = scr.pro;
  const val = (k, d) => g[k] ?? d;
  return { title: 'Objetivo', html: head('Tu objetivo', 'Elige un modo. Lo demás lo pongo yo.') + `<div class="content" style="max-width:680px">
    <div class="stack" style="gap:10px">${Object.entries(MODOS).map(([k, x]) => `<button type="button" class="choice" aria-pressed="${g.modo === k}" data-a="goal-modo" data-v="${k}"><span class="ico">${ic(k === 'reto' ? 'flag' : k === 'mejorar' ? 'chart' : k === 'volver' ? 'heart' : 'target')}</span><span><b>${x.n}</b><span>${x.s} ${x.h[0]}-${x.h[1]} h/sem.</span></span></button>`).join('')}</div>
    ${g.modo === 'reto' ? `<div class="card"><b>¿Qué reto y cuándo?</b><div class="filters" style="flex-wrap:wrap">${['Marcha en bici', 'Carrera de montaña', 'Travesía de skimo', 'Otra'].map(t => `<button type="button" class="fchip" data-a="goal-set" data-k="reto" data-v="${t}" aria-pressed="${g.reto === t}">${t}</button>`).join('')}</div>
      <label class="stack" for="goal-f"><span class="small muted">Fecha</span><input id="goal-f" type="date" class="card" style="border:0;font:16px var(--font-ui);color:var(--label)" value="${esc(g.fecha || '2027-04-18')}" data-a="goal-date"></label></div>` : ''}
    ${g.modo === 'mejorar' ? `<div class="card"><b>¿En qué deporte?</b><div class="filters" style="flex-wrap:wrap">${S.sports.filter(k => SPORTS[k].cardio).map(k => `<button type="button" class="fchip" data-a="goal-set" data-k="dep" data-v="${k}" aria-pressed="${g.dep === k}">${sportDot(k)}${SPORTS[k].n}</button>`).join('')}</div></div>` : ''}
    <div class="card"><div class="card-h"><span class="grow">Cada semana te pediré</span></div>
      <div class="fields"><div class="field"><span class="l">Horas</span><span class="v">${val('h', m.h).join('-')}</span></div><div class="field"><span class="l">Intensos</span><span class="v">${val('int', m.int).join('-')}</span></div><div class="field"><span class="l">Fuerza</span><span class="v">${val('fuerza', m.fuerza)}</span></div><div class="field"><span class="l">Juego</span><span class="v">libre</span></div></div>
      ${pro ? `<label class="stack" for="gp-h"><span class="row"><b class="grow small">Horas por semana (máximo)</b><span class="num" style="font-size:22px">${val('h', m.h)[1]}</span></span><input id="gp-h" class="range" type="range" min="3" max="15" step="1" value="${val('h', m.h)[1]}" data-a="goal-pro" data-k="h"></label>
        <label class="stack" for="gp-i"><span class="row"><b class="grow small">Días intensos (máximo)</b><span class="num" style="font-size:22px">${val('int', m.int)[1]}</span></span><input id="gp-i" class="range" type="range" min="0" max="3" step="1" value="${val('int', m.int)[1]}" data-a="goal-pro" data-k="int"></label>
        <label class="stack" for="gp-f"><span class="row"><b class="grow small">Sesiones de fuerza</b><span class="num" style="font-size:22px">${val('fuerza', m.fuerza)}</span></span><input id="gp-f" class="range" type="range" min="0" max="4" step="1" value="${val('fuerza', m.fuerza)}" data-a="goal-pro" data-k="fuerza"></label>`
      : `<button class="btn text" type="button" data-a="goal-pro-on" style="align-self:flex-start">Ajustar a mano (modo pro)</button>`}</div>
    <button class="btn fill wide" type="button" data-a="goal-save">Guardar</button>
    <p class="xs">Puedes cambiarlo cuando quieras. El plan y los avisos de cada semana se adaptan solos.</p></div>` };
}
/* ===== TEST DE SUBIDA (resumido) ===== */
function scrTest(scr) {
  const t = scr.t || (scr.t = { km: '', desn: '', min: '', fc: '' }); const P = M.perfil;
  const ok = +t.km > 0 && +t.desn > 0 && +t.min > 0; const w = ok ? wkgFisica(+t.km, +t.desn, +t.min, P.peso) : null; const ftp = w ? w * 0.95 : null;
  const inp = (k, l, u, st) => `<label class="stack" for="t-${k}" style="gap:4px"><span class="small muted">${l}</span><span class="row"><input id="t-${k}" class="search" inputmode="decimal" value="${esc(t[k])}" data-a="test-in" data-k="${k}" placeholder="${st}"><span class="small">${u}</span></span></label>`;
  return { title: 'Test de subida', html: head('Test de subida', 'Bici · 20 minutos a tope') + `<div class="content" style="max-width:640px">
    <p class="muted">Sube 20 min a tope en una subida constante del 5-7 %. Después pon aquí los datos del tramo (los tienes en Garmin). Con tu peso${P.peso ? ` (${P.peso} kg)` : ''} calculo tus vatios reales.</p>
    <div class="card">${inp('km', 'Distancia de la subida', 'km', '6,2')}${inp('desn', 'Desnivel', 'm', '380')}${inp('min', 'Tiempo', 'min', '20')}${inp('fc', 'Pulso medio', 'ppm', '172')}</div>
    ${ok ? `<div class="card"><div class="fields"><div class="field"><span class="l">Umbral</span><span class="v">${nf(ftp, 2)} <small>W/kg</small></span></div><div class="field"><span class="l">Vatios</span><span class="v">${Math.round(ftp * (P.peso || 75))} <small>W</small></span></div><div class="field"><span class="l">Nota subida</span><span class="v">${nf(half(wkgScore(ftp)))}</span></div>${+t.fc ? `<div class="field"><span class="l">Umbral pulso</span><span class="v">${Math.round(+t.fc * 0.95)} <small>ppm</small></span></div>` : ''}</div></div>` : ''}
    <button class="btn fill wide" type="button" data-a="test-save" ${ok ? '' : 'disabled'}>Guardar resultado</button>
    <p class="xs">Cálculo por física: gravedad, rodadura y aire, con ${P.peso ? P.peso : 75} kg más 9 kg de bici. Error típico: ±5-10 %.</p></div>` };
}

/* ===== ACTIVIDAD ===== */
/* Responde "¿cómo ha ido y cuenta como lo que tocaba?": cifras, plan frente a lo hecho, lo mejor
   de la salida (o los ejercicios si es fuerza), el mapa y los pueblos nuevos. */
function scrActividad(scr) {
  const a = actById(scr.id);
  if (!a) return { title: 'Actividad', html: head('Actividad', '') + '<div class="content"><p>No encuentro esta actividad. Puede que se haya borrado en Garmin; vuelve a Hoy y actualiza.</p></div>' };
  const k = tipoAct(a); const cardio = SPORTS[a.dep].cardio;
  detalleAlAbrir(a); const pidiendo = DET_PIDIENDO.has(a.id);
  const s = sesion(a.f); const plan = s && s.a && s.a.id === a.id && s.t !== 'descanso' ? s : null;
  const cifra = (v, u, l) => `<div class="field"><span class="l">${l}</span><span class="v">${v}${u ? ` <small>${u}</small>` : ''}</span></div>`;
  const cifras = [a.km && cardio ? cifra(nf(a.km), 'km', 'Distancia') : '', cifra(dur(a.min), '', 'Tiempo'), a.desn ? cifra(a.desn, 'm', 'Desnivel') : '', a.fc ? cifra(a.fc, 'ppm', 'Pulso medio') : ''].join('');
  // Plan frente a lo hecho, en una línea: el color acompaña al texto, nunca va solo.
  const cumple = plan && (!cardio || plan.t === 'otros' || plan.t === k || S.overrides[a.id]);
  const vsPlan = plan ? `<p class="act-plan ${cumple ? 'ok' : 'dev'}">${ic(cumple ? 'check' : 'info', 16)}<span>${cumple ? 'Lo que tocaba' : 'Distinto del plan'}: ${esc(plan.d)}</span></p>` : '';
  const semana = cardio ? `<section class="card" aria-labelledby="act-sem"><div class="act-h"><h2 class="card-t" id="act-sem">Cómo cuenta en tu semana</h2>${chip(k)}</div>
      ${vsPlan}
      ${a.z ? distBar(a.z) + `<div class="row xs"><span class="grow">Suave ${a.z[0]} min</span><span class="grow">Medio ${a.z[1]} min</span><span>Duro ${a.z[2]} min</span></div>` : ''}
      <div class="row" style="justify-content:space-between"><span class="xs">${S.overrides[a.id] ? 'Corregido por ti' : a.analizada ? 'Por tus minutos de pulso' : 'Según Garmin'}</span><button class="btn text" type="button" data-a="fix-type" data-v="${a.id}" style="white-space:nowrap">Corregir</button></div></section>` : '';
  const mejor = [
    a.llano ? `<li><b>${nf(a.llano.kmh)} km/h en llano</b><span>${nf(a.llano.km)} km a ${a.llano.fc} ppm</span></li>` : '',
    a.sub && !a.sub.remonte ? `<li><b>Subida de ${a.sub.desn} m en ${dur(a.sub.min)}</b><span>${nf(a.sub.km)} km a ${a.sub.fc} ppm · ${a.sub.vam} m/h${a.sub.wkg ? ` · ≈${nf(a.sub.wkg, 1)} W/kg estimado` : ''}</span></li>` : '',
  ].join('');
  const fuerza = a.dep === 'fuerza' ? `<section class="card" aria-labelledby="act-fz"><h2 class="card-t" id="act-fz">${plan ? 'El plan frente a lo que hiciste' : 'Tus ejercicios'}</h2>${bloqueFuerza(a.f, true)}</section>` : '';
  return { title: a.lugar, html: head(a.lugar, `${cap1(fLarga(a.f))} · ${SPORTS[a.dep].n}${a.sim ? ' · ' + simTag() : ''}`) + `<div class="content" style="max-width:760px">
    <div class="card"><div class="fields">${cifras}</div>${cardio ? '' : vsPlan}</div>
    ${pidiendo ? '<p class="small muted" role="status">Leyendo el detalle de Garmin (zonas, llano, subidas y mapa)…</p>' : ''}
    ${semana}${fuerza}
    ${mejor ? `<section class="card" aria-labelledby="act-mejor"><h2 class="card-t" id="act-mejor" style="margin:0">Lo mejor de la salida</h2><ul class="act-mejor">${mejor}</ul></section>` : ''}
    ${(DSET.rutas || {})[a.id] ? `<div class="trackmap">${trackSvg(a.id)}</div>` : ''}
    ${a.nuevos.length ? `<section class="card" aria-labelledby="act-pue"><h2 class="card-t" id="act-pue" style="margin:0">${a.nuevos.length} pueblo${a.nuevos.length === 1 ? '' : 's'} nuevo${a.nuevos.length === 1 ? '' : 's'}</h2><div class="towns">${a.nuevos.map(n => `<span class="town new">${esc(n)}</span>`).join('')}</div></section>` : ''}</div>` };
}
/* ===== COMPARTIR ===== */
function scrCompartir() {
  const d = dims(), [tipo] = tipoAtleta(), sh = S.share;
  const bars = ['motor', 'fondo', 'volumen', 'equilibrio'].map(k => `<div class="mb"><div class="l"><span>${d[k].n.split(' ')[0]}</span><b>${nf(d[k].v)}</b></div><div class="t"><i style="width:${(d[k].v - 1) / 9 * 100}%"></i></div></div>`).join('');
  const row = (k, t, s) => `<label class="toggle-row" for="sh-${k}"><span class="main"><b>${t}</b>${s ? `<br><span class="xs">${s}</span>` : ''}</span><input class="switch" type="checkbox" id="sh-${k}" data-a="share-t" data-v="${k}" ${sh[k] ? 'checked' : ''}></label>`;
  return { title: 'Compartir', html: head('Compartir ficha', 'Así la verán tus amigos') + `<div class="content" style="max-width:640px"><div class="share-card" role="img" aria-label="Vista previa">
    <div class="row"><span style="font:700 15px var(--font-ui);opacity:.8">myCoach</span><span class="grow"></span><span class="small" style="opacity:.8">${MC[dte(HOY).getMonth()]} ${dte(HOY).getFullYear()}</span></div>${sh.nombre && S.nombre ? `<b style="font-size:22px">${esc(S.nombre)}</b>` : ''}
    <div class="bignum"><span class="v" style="font-size:72px">${forma() == null ? '—' : nf(forma())}</span><span class="of" style="color:rgba(255,255,255,.7)">/10</span></div>${sh.tipo ? `<b style="font-size:19px;line-height:1.2">${esc(tipo)}</b>` : ''}${sh.notas ? `<div class="minibars">${bars}</div>` : ''}<span class="grow"></span>${sh.pueblos ? `<span class="small">${ic('pueblos', 16)} ${Object.keys(M.towns).length} pueblos recorridos</span>` : ''}</div>
    <div class="list">${row('nombre', 'Tu nombre')}${row('tipo', 'Tu tipo de deportista')}${row('notas', 'Notas')}${row('pueblos', 'Pueblos', 'Solo el número')}</div><p class="xs">Nunca se comparten readiness, sueño, pulso ni recorridos.</p>
    <button class="btn fill wide" type="button" data-a="do-share">${ic('share', 20)} Compartir</button></div>` };
}
/* ===== AJUSTES ===== */
/* Ajustes, agrupados por lo que viene a hacer el usuario: conectar, su entrenador,
   sus deportes y sus preferencias. Cada grupo con su encabezado (h2) para lectores de pantalla. */
function scrAjustes() {
  const sec = (t, cuerpo, nota) => `<section class="aj-sec"><h2 class="aj-h">${t}</h2>${nota ? `<p class="small muted aj-nota">${nota}</p>` : ''}${cuerpo}</section>`;
  // Una elección corta: control segmentado con su explicación debajo (cambia con la opción).
  const seg = (k, t, opts, cur, nota) => `<div class="stack" style="gap:8px" role="group" aria-labelledby="seg-${k}"><b id="seg-${k}">${t}</b><div class="seg">${opts.map(([v, l]) => `<button type="button" data-a="set-seg" data-k="${k}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div><span class="small muted">${nota}</span></div>`;
  const horas = horasPorDeporte();
  const otros = Object.entries(horas).filter(([k]) => !ENTRENABLES.includes(k));
  return { title: 'Ajustes', html: head('Ajustes', M.fuente === 'vivo' ? 'Garmin conectado en vivo' : 'Modo demo') + `<div class="content aj" style="max-width:640px">
    ${cardCuenta() ? sec('Tu cuenta', cardCuenta()) : ''}
    ${sec('Conexiones', LIVE && S.modo === 'vivo'
      ? `<div class="stack" style="gap:12px">${cardGarmin()}${cardIntervals()}${calDisponible() ? cardCalendario() : ''}</div>`
      : cardGarmin(), LIVE && S.modo === 'vivo' ? '' : 'Intervals.icu y tu calendario se conectan cuando entres.')}
    ${sec('Tú y tu entrenador', `<div class="card stack" style="gap:14px">
      <label class="stack" for="coach-nombre" style="gap:6px"><b>Nombre del entrenador</b><input id="coach-nombre" class="search" value="${esc(S.coachNombre || '')}" data-a="coach-nombre" placeholder="myCoach" maxlength="24" aria-describedby="coach-nombre-h"><span class="small muted" id="coach-nombre-h">Así se presenta en la app y en tu Claude.</span></label>
      <label class="stack" for="nombre-in" style="gap:6px"><b>Tu nombre</b><input id="nombre-in" class="search" value="${esc(S.nombre)}" data-a="nombre-in" placeholder="Opcional" autocomplete="given-name"><span class="small muted">Sus iniciales salen arriba, y el nombre en la ficha que compartes.</span></label></div>`)}
    ${sec('Deportes que entreno', `<div class="list">${ENTRENABLES.map(k => `<label class="toggle-row" for="sp-${k}"><span class="main"><b>${sportDot2(k)} ${SPORTS[k].n}</b><br><span class="small muted">${horas[k] ? `${nf(horas[k])} h en tu Garmin` : 'Sin actividades todavía'}${k === 'fuerza' ? ' · complemento' : ''}</span></span><input class="switch" type="checkbox" id="sp-${k}" data-a="sport-t" data-v="${k}" ${S.sports.includes(k) ? 'checked' : ''}></label>`).join('')}</div>
      ${otros.length ? `<p class="small muted aj-nota">${cap1(otros.map(([k]) => SPORTS[k].n.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' y $1'))}: cuentan como carga, pero no los planifico.</p>` : ''}`,
      'Los planifico con pulso, ritmo, velocidad, potencia y cadencia. La fuerza entra como complemento.')}
    ${sec('Preferencias', `<div class="card stack" style="gap:16px">
      <label class="toggle-row" for="hoy-forma" style="padding:0"><span class="main"><b>Tu forma en Hoy</b><br><span class="small muted">Tu nota y tu tipo de deportista, debajo de la semana.</span></span><input class="switch" type="checkbox" id="hoy-forma" data-a="hoy-forma" ${S.hoyForma ? 'checked' : ''}></label>
      <label class="toggle-row" for="ver-peso" style="padding:0"><span class="main"><b>Tu peso en Forma</b><br><span class="small muted">La gráfica con tus pesajes de Garmin.</span></span><input class="switch" type="checkbox" id="ver-peso" data-a="ver-peso" ${S.verPeso !== false ? 'checked' : ''}></label>
      ${seg('ai', 'Inteligencia artificial', [['claude', 'Con mi Claude'], ['off', 'Sin IA']], S.ai, S.ai === 'off' ? 'Todo funciona con reglas; sin fotos de comida ni chat.' : 'Usa tu cuenta de Claude: la app no paga otra IA.')}
      ${seg('clasif', 'Cómo se clasifican los días', [['min', 'Por mi pulso'], ['garmin', 'Por Garmin']], S.clasif, S.clasif === 'garmin' ? 'Con la etiqueta que pone Garmin a cada actividad.' : 'Por tus minutos en cada zona de pulso. Recomendado.')}
      ${LIVE ? seg('modo', 'De dónde salen tus datos', [['vivo', 'Mi Garmin'], ['demo', 'Demo']], S.modo, S.modo === 'demo' ? 'Datos de ejemplo para probar la app.' : 'Tus datos, en vivo.') : ''}</div>`)}
    <p class="small muted aj-nota">myCoach · versión ${esc(APP_VERSION.commit)} · ${esc(APP_VERSION.fecha)}${window.PLATFORM && PLATFORM.name === 'claude-app' ? ' · dentro de Claude' : ''}</p>
  </div>` };
}
