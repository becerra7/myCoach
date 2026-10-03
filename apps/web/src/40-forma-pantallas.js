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
