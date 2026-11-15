/* ===== v2 · Actividad, Más y Ajustes =====
   Actividad: primero el recorrido, las tres cifras y lo que dijo el entrenador; el detalle por terreno y el resto,
   cada uno en su pantalla. Más: tres secciones con un trozo de lo que hay dentro. Ajustes: una lista agrupada
   donde cada fila enseña su valor y abre su pantalla; lo que es método o prueba va en Avanzado. */

function scrActividadV2(scr) {
  const a = actById(scr.id); if (!a) return V1_SCR.actividad(scr);
  if (scr.det) return scrActDet(a, scr.det);
  const cardio = SPORTS[a.dep].cardio; detalleAlAbrir(a); const pidiendo = DET_PIDIENDO.has(a.id);
  const k = tipoAct(a), s = sesion(a.f), plan = s && s.a && s.a.id === a.id && s.t !== 'descanso' ? s : null;
  const cumple = plan && (!cardio || plan.t === 'otros' || plan.t === k || S.overrides[a.id]);
  const mov = a.mov && a.mov <= a.min + 1 ? a.mov : a.min;
  const filas = [
    cardio && (a.ter || a.perfil) ? fila2('Por terreno', 'Llano, subida y bajada frente a tu media', `data-a="v2-act-det" data-id="${a.id}" data-v="terreno"`) : '',
    cardio && a.subs && a.subs.length ? fila2('Subidas y esfuerzos', `${a.subs.length} subida${a.subs.length === 1 ? '' : 's'} y tus mejores tramos`, `data-a="v2-act-det" data-id="${a.id}" data-v="esfuerzos"`) : '',
    fila2(cardio ? 'Cómo cuenta en tu semana y todos los datos' : 'Todos los datos', cardio ? `${TIPOS[k]?.n || ''} · zonas de pulso, velocidad y carga` : 'Pulso, tiempo y carga', `data-a="v2-act-det" data-id="${a.id}" data-v="todo"`),
  ].join('');
  return { title: a.lugar, html: `<div class="v2">
    ${(DSET.rutas || {})[a.id] ? `<button type="button" class="trackmap mapprev" data-a="rel-abrir" data-v="${a.id}" aria-label="Abrir el recorrido en relieve">${trackSvg(a.id)}<span class="mp-atr">Foto: Esri</span><span class="mp-cta">${ic('pueblos', 18)} Ver en relieve</span></button>` : ''}
    <header class="act-cab"><h1>${esc(a.lugar)}</h1>${depL(a.dep, `${SPORTS[a.dep].n} · ${fLarga(a.f)}${a.sim ? ' · ejemplo' : ''}`)}</header>
    ${facts2([cardio && a.km ? ['Distancia', `${nf(a.km)} km`] : null, [a.mov ? 'En movimiento' : 'Tiempo', dur(Math.round(mov))], cardio && a.desn ? ['Desnivel', `${nf(a.desn, 0)} m`] : a.fc ? ['Pulso medio', `${a.fc} ppm`] : null])}
    ${plan ? `<p style="padding:0 4px">${cumple ? tag('good', '✓', 'Lo que tocaba') : tag('warn', '!', 'Distinto del plan')} <span class="small muted">${esc(plan.d)}</span></p>` : ''}
    ${pidiendo ? '<p class="small muted" role="status" style="padding:0 4px">Leyendo el detalle de Garmin…</p>' : ''}
    ${cardio ? actEntrenador(a) : a.dep === 'fuerza' ? `<section class="card" aria-labelledby="act-fz"><h2 class="card-t" id="act-fz">${plan ? 'El plan frente a lo que hiciste' : 'Tus ejercicios'}</h2>${bloqueFuerza(a.f, true)}</section>` : ''}
    ${grupo2(filas)}
    ${a.nuevos.length ? `<section class="card" aria-labelledby="act-pue"><h2 class="card-t" id="act-pue" style="margin:0">${a.nuevos.length} pueblo${a.nuevos.length === 1 ? '' : 's'} nuevo${a.nuevos.length === 1 ? '' : 's'}</h2><div class="towns">${a.nuevos.map(n => `<span class="town new">${esc(n)}</span>`).join('')}</div></section>` : ''}
  </div>` };
}
function scrActDet(a, det) {
  if (det === 'todo') { const r = V1_SCR.actividad({ id: a.id }); return { title: 'Todos los datos', html: r.html }; }
  const cuerpo = det === 'terreno' ? actPerfil(a) + actTerreno(a) : actEsfuerzos(a);
  const t = det === 'terreno' ? 'Por terreno' : 'Subidas y esfuerzos';
  return { title: t, html: `<div class="v2">${cab2(t, esc(a.lugar))}${cuerpo || '<section class="card"><p class="muted">Esta actividad no trae ese detalle.</p></section>'}</div>` };
}
scrV2('actividad', scrActividadV2);

/* ===== Más ===== */
function tabMasV2() {
  const towns = pueblosDe([]), nP = towns.length;
  if (RUT.datos === undefined) cargarRutas();
  const rutas = RUT.datos && typeof RUT.datos === 'object' ? listaRutas(RUT.datos) : null;
  const vivo = LIVE && S.modo === 'vivo'; if (vivo && ENTS === undefined) cargarEntrenos();
  const ents = Array.isArray(ENTS) ? ENTS : null;
  const lista = (items, vacio) => items && items.length ? `<span class="prev-l">${items.join('')}</span>` : `<span class="small muted">${vacio}</span>`;
  const cabT = t => `<span class="cab"><span>${t}</span>${ic('chev', 18)}</span>`;
  return { title: 'Más', html: `<div class="v2">${cab2('Más')}
    <button class="li" type="button" data-a="push" data-v="buscar" style="background:var(--surface);border-radius:999px;min-height:var(--tap)">${ic('search', 20)}<span class="main"><span style="font-size:16px">Buscar una actividad, un pueblo o un entreno</span></span></button>
    <div class="v2-cols"><div class="col">
    <button class="tap-card" type="button" data-a="push" data-v="pueblos">${cabT('Pueblos')}
      ${nP ? `<span><span class="cifra xl">${nP}</span></span><span>municipios por los que has pasado. El que más: ${esc(towns[0].n)}, ${nf(towns[0].km)} km.</span>` : '<span class="small muted">Por dónde has pasado, tu mapa y tus totales. Actualiza para leer tus trazados.</span>'}</button>
    </div><div class="col">
    <button class="tap-card" type="button" data-a="push" data-v="entrenos">${cabT('Entrenos')}
      ${lista(ents && ents.slice(0, 2).map(e => `<span><b>${esc(e.nombre)}</b><span>${esc(ultimaVez(e))}</span></span>`), vivo ? (ENTS === null ? 'No he podido leerlos.' : ents ? 'Aún no tienes entrenos guardados. Pídele uno a tu Claude.' : 'Cargando…') : 'Fuerza, bici y correr: verlos, ajustarlos y mandarlos al reloj.')}</button>
    <button class="tap-card" type="button" data-a="push" data-v="rutas">${cabT('Rutas')}
      ${lista(rutas && rutas.slice(0, 2).map(x => `<span><b>${esc(x.n)}</b>${x.km != null ? `<span>${nf(x.km)} km${x.desn != null ? ` · ${nf(x.desn, 0)} m` : ''}</span>` : ''}</span>`), RUT.datos === null ? 'No he podido leer tus rutas.' : rutas ? 'Aún no tienes rutas guardadas en Garmin.' : 'Leyendo tus rutas de Garmin…')}</button>
    </div></div></div>` };
}
tabV2('mas', tabMasV2);

/* ===== Ajustes ===== */
const AJ_SECS = { conexiones: 'Conexiones', entrenador: 'Tú y tu entrenador', deportes: 'Deportes que entreno', avisos: 'Avisos', avanzado: 'Avanzado' };
const segDiseno = () => `<div class="stack" style="gap:8px" role="group" aria-labelledby="seg-diseno"><b id="seg-diseno">Diseño</b><div class="seg">${[['v2', 'Nuevo'], ['v1', 'Anterior']].map(([v, l]) => `<button type="button" data-a="v2-diseno" data-v="${v}" aria-pressed="${S.diseno === v}">${l}</button>`).join('')}</div><span class="small muted">${esV2() ? 'El diseño nuevo. Si echas algo de menos, vuelve al anterior: no se pierde nada.' : 'Estás en el diseño anterior. Puedes pasar al nuevo cuando quieras.'}</span></div>`;
function scrAjustesV2(scr) {
  const vivo = LIVE && S.modo === 'vivo', sec = scr.id && AJ_SECS[scr.id] ? scr.id : null;
  const seg = (k, t, opts, cur, nota) => `<div class="stack" style="gap:8px" role="group" aria-labelledby="seg-${k}"><b id="seg-${k}">${t}</b><div class="seg">${opts.map(([v, l]) => `<button type="button" data-a="set-seg" data-k="${k}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div><span class="small muted">${nota}</span></div>`;
  const horas = horasPorDeporte(), otros = Object.entries(horas).filter(([k]) => !ENTRENABLES.includes(k));
  if (!sec) {
    const deps = S.sports.filter(k => SPORTS[k]).map(k => SPORTS[k].n.toLowerCase()).join(', ');
    const av = typeof secAvisos === 'function' ? secAvisos() : '';
    return { title: 'Ajustes', html: `<div class="v2">${cab2('Ajustes')}
      <section class="card cuenta-c"><span class="avatar">${String(S.nombre || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || ic('user', 24)}</span>
        <div style="min-width:0"><b style="font-size:17px">${esc(S.nombre || 'Tu cuenta')}</b><p class="small muted">${S.modo === 'demo' ? 'Datos de ejemplo' : vivo ? `Garmin conectado${S.lastSync ? ` · actualizado ${haceTxt(S.lastSync)}` : ''}` : 'Sin conectar'}</p></div></section>
      ${grupo2(fila2('Conexiones', 'Garmin, Intervals.icu y tu calendario', 'data-a="push" data-v="ajustes" data-id="conexiones"', { valor: vivo ? '✓ Conectado' : 'Sin conectar' }))}
      ${grupo2(fila2('Tú y tu entrenador', 'Cómo se llama y cómo te llamas', 'data-a="push" data-v="ajustes" data-id="entrenador"', { valor: esc(nombreCoach()) })
        + fila2('Deportes que entreno', '', 'data-a="push" data-v="ajustes" data-id="deportes"', { valor: esc(cap1(deps) || 'Ninguno') })
        + (av ? fila2('Avisos', 'El semáforo de la mañana y la semana sin plan', 'data-a="push" data-v="ajustes" data-id="avisos"') : ''))}
      ${grupo2(fila2('Avanzado', 'Diseño, cómo se clasifican los días y datos de ejemplo', 'data-a="push" data-v="ajustes" data-id="avanzado"'))}
      <p class="xs" style="padding:0 4px">myCoach · versión ${esc(APP_VERSION.commit)} · ${esc(APP_VERSION.fecha)}${window.PLATFORM && PLATFORM.name === 'claude-app' ? ' · dentro de Claude' : ''}</p></div>` };
  }
  let cuerpo = '';
  if (sec === 'conexiones') cuerpo = `${cardCuenta() || ''}${vivo ? `${cardGarmin()}${cardIntervals()}${calDisponible() ? cardCalendario() : ''}` : `${cardGarmin()}<p class="small muted" style="padding:0 4px">Intervals.icu y tu calendario se conectan cuando entres.</p>`}`;
  if (sec === 'entrenador') cuerpo = `<div class="card stack" style="gap:14px">
      <label class="stack" for="coach-nombre" style="gap:6px"><b>Nombre del entrenador</b><input id="coach-nombre" class="search" value="${esc(S.coachNombre || '')}" data-a="coach-nombre" placeholder="myCoach" maxlength="24" aria-describedby="coach-nombre-h"><span class="small muted" id="coach-nombre-h">Así se presenta en la app y en tu Claude.</span></label>
      <label class="stack" for="nombre-in" style="gap:6px"><b>Tu nombre</b><input id="nombre-in" class="search" value="${esc(S.nombre)}" data-a="nombre-in" placeholder="Opcional" autocomplete="given-name"><span class="small muted">Sus iniciales salen arriba, y el nombre en la ficha que compartes.</span></label></div>`;
  if (sec === 'deportes') cuerpo = `<p class="small muted" style="padding:0 4px">Los planifico con pulso, ritmo, velocidad, potencia y cadencia. La fuerza entra como complemento.</p>
      <div class="list">${ENTRENABLES.map(k => `<label class="toggle-row" for="sp-${k}"><span class="main"><b>${sportDot2(k)} ${SPORTS[k].n}</b><br><span class="small muted">${horas[k] ? `${nf(horas[k])} h en tu Garmin` : 'Sin actividades todavía'}${k === 'fuerza' ? ' · complemento' : ''}</span></span><input class="switch" type="checkbox" id="sp-${k}" data-a="sport-t" data-v="${k}" ${S.sports.includes(k) ? 'checked' : ''}></label>`).join('')}</div>
      ${otros.length ? `<p class="small muted" style="padding:0 4px">${cap1(otros.map(([k]) => SPORTS[k].n.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' y $1'))}: cuentan como carga, pero no los planifico.</p>` : ''}`;
  if (sec === 'avisos') cuerpo = (typeof secAvisos === 'function' && secAvisos()) || '<section class="card"><p class="muted">Los avisos se activan con tu cuenta conectada.</p></section>';
  if (sec === 'avanzado') cuerpo = `<div class="card stack" style="gap:20px">${segDiseno()}
      <label class="toggle-row" for="ver-peso" style="padding:0"><span class="main"><b>Tu peso en Insights</b><br><span class="small muted">La tesela con tus pesajes de Garmin.</span></span><input class="switch" type="checkbox" id="ver-peso" data-a="ver-peso" ${S.verPeso !== false ? 'checked' : ''}></label>
      ${seg('clasif', 'Cómo se clasifican los días', [['min', 'Por mi pulso'], ['garmin', 'Por Garmin']], S.clasif, S.clasif === 'garmin' ? 'Con la etiqueta que pone Garmin a cada actividad.' : 'Por tus minutos en cada zona de pulso. Recomendado.')}
      ${seg('ai', 'Inteligencia artificial', [['claude', 'Con mi Claude'], ['off', 'Sin IA']], S.ai, S.ai === 'off' ? 'Todo funciona con reglas; sin fotos de comida ni chat.' : 'Usa tu cuenta de Claude: la app no paga otra IA.')}
      ${LIVE ? seg('modo', 'De dónde salen tus datos', [['vivo', 'Mi Garmin'], ['demo', 'Demo']], S.modo, S.modo === 'demo' ? 'Datos de ejemplo para probar la app.' : 'Tus datos, en vivo.') : ''}</div>`;
  return { title: AJ_SECS[sec], html: `<div class="v2 aj">${cab2(AJ_SECS[sec])}${cuerpo}</div>` };
}
/* En el diseño anterior, Ajustes gana solo el interruptor para volver al nuevo */
SCREENS.ajustes = scr => { if (esV2()) return scrAjustesV2(scr); const r = V1_SCR.ajustes(scr); return { ...r, html: r.html.replace(/<\/div>\s*$/, `<section class="aj-sec"><h2 class="aj-h">Diseño</h2><div class="card">${segDiseno()}</div></section></div>`) }; };
Object.assign(ACTIONS, { 'v2-act-det': el => push({ s: 'actividad', id: el.dataset.id, det: el.dataset.v }) });
