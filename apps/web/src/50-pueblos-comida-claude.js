/* ===== PUEBLOS: niveles (tu comunidad · España · mundo) y filtro por deporte ===== */
function visitedSet() { const sel = S.pSport; return new Set(pueblosDe(sel).map(t => t[0])); }
function applyMapFilter(svg) {
  if (!svg.dataset.map || svg.dataset.map === 'world') return;
  const vs = visitedSet();
  svg.querySelectorAll('path[data-m]').forEach(p => p.classList.toggle('on', !!p.dataset.m && vs.has(p.dataset.m)));
  svg.querySelectorAll('.tr').forEach(t => t.classList.toggle('hide', !!S.pSport.length && !S.pSport.includes(t.dataset.t)));
}
function tabPueblos() {
  const lv = S.pLevel, sel = S.pSport; const lista = pueblosDe(sel); const zona = M.ccaa || 'Tu comunidad';
  const deps = ['bici', 'correr', 'montana', 'skimo'].filter(k => Object.values(M.towns).some(t => t.dep[k]));
  const enZona = lista.filter(t => PROV_CCAA[t.id.slice(0, 2)] === M.ccaa); const totZona = GEO.ready && M.ccaa ? GEO.munis.filter(m => PROV_CCAA[m.id.slice(0, 2)] === M.ccaa).length : null;
  const count = lv === 'world' ? M.paises.length : lv === 'es' ? lista.length : enZona.length;
  const mes = addDays(HOY, -30); const nuevosMes = lista.filter(t => t.primera > mes).length;
  const q = (S.townQ || '').toLowerCase();
  return { title: 'Pueblos', html: head('Pueblos', `Municipios que has cruzado · ${M.fuente === 'vivo' ? '<span class="live">En vivo</span>' : '<span class="sim">Demo</span>'}`) + `<div class="content">
    <div class="seg" role="group" aria-label="Nivel"><button type="button" data-a="plevel" data-v="ccaa" aria-pressed="${lv === 'ccaa'}">${esc(zona)}</button><button type="button" data-a="plevel" data-v="es" aria-pressed="${lv === 'es'}">España</button><button type="button" data-a="plevel" data-v="world" aria-pressed="${lv === 'world'}">Mundo</button></div>
    ${lv !== 'world' && deps.length > 1 ? fchips('pSport', deps, sel) : ''}
    <div class="bento">
      <div class="b-full stats"><div class="stat"><span class="v">${count}</span><span class="l">${lv === 'world' ? 'países' : lv === 'es' ? 'de 8.131 en España' : `de ${totZona ?? '—'} en ${esc(zona)}`}</span></div><div class="stat"><span class="v">${nuevosMes}</span><span class="l">nuevos en 30 días</span></div><div class="stat"><span class="v">${Object.keys(DSET.rutas || {}).filter(k => DSET.rutas[k]).length}</span><span class="l">trazados leídos</span></div></div>
      <div class="b-hero stack" style="gap:10px">
        <button type="button" class="mapbox mapprev" data-a="open-map" aria-label="Abrir el mapa a pantalla completa">${mapSvg(lv)}<span class="mp-cta">${ic('pueblos', 18)} Abrir mapa</span></button>
        <p class="xs">${lv === 'world' ? esc(M.paises.join(', ')) + '.' : 'Toca el mapa: pellizca para acercar y toca un pueblo para ver su ficha.'}</p></div>
      <div class="b-side stack" style="gap:10px"><div class="section-h"><h2>Por kilómetros</h2></div>
        <label class="vh" for="town-q">Buscar pueblo</label><input id="town-q" class="search" type="search" placeholder="Buscar pueblo" value="${esc(S.townQ || '')}" data-a="town-q" autocomplete="off">
        <div class="list" id="town-list">${lista.filter(t => !q || t.n.toLowerCase().includes(q)).slice(0, 80).map(t => `<button type="button" class="li" style="min-height:44px" data-a="town-focus" data-v="${t.id}"><span class="main"><b>${esc(t.n)}</b><span>desde ${fDia(t.primera)}</span></span><span class="stack" style="align-items:flex-end;gap:2px"><span class="num" style="font-size:18px">${nf(sel.length ? sel.reduce((a, s) => a + (t.dep[s] || 0), 0) : t.km)} km</span><span style="display:flex;gap:3px">${Object.keys(t.dep).map(k => `<i class="dot" style="width:8px;height:8px;background:${scol(k)}" title="${SPORTS[k].n}"></i>`).join('')}</span></span></button>`).join('') || '<p class="small muted" style="padding:12px 16px">Sin pueblos todavía: actualiza para leer tus trazados.</p>'}</div>
        <p class="xs">Cuento municipios (IGN). Los núcleos pequeños de cada municipio necesitan datos de OpenStreetMap: llegarán con la versión web.</p></div>
    </div></div>` };
}

/* ===== COMIDA: cuartos de plato según la carga del día (sin calorías) ===== */
function cargaDia(f) {
  const s = sesion(f); const as = acts().filter(a => a.f === f && SPORTS[a.dep].cardio); const min = as.reduce((a, x) => a + x.min, 0) || (s && s.t !== 'descanso' && SPORTS[s.dep]?.cardio ? s.min : 0);
  const int = as.some(a => tipoAct(a) === 'int') || (s && s.t === 'int');
  if (min >= 120 || int) return { k: 'duro', n: 'Día duro', c: 2, txt: min >= 120 ? `${dur(min)} de entreno` : 'sesión intensa' };
  if (min >= 60) return { k: 'medio', n: 'Día moderado', c: 1.5, txt: `${dur(min)} de entreno` };
  return { k: 'suave', n: 'Día suave', c: 1, txt: min ? `${dur(min)} suave` : 'descanso' };
}
function nutriInsights(rows) {
  const con = rows.filter(r => r.ms.length); if (!con.length) return [['warn', 'Aún no has registrado comidas esta semana. Con 2-3 al día ya vemos si cuadra con tu entreno.']];
  const out = []; const bajos = con.filter(r => r.real < r.c.c - .4); const altos = con.filter(r => r.c.k === 'suave' && r.real > r.c.c + .9);
  for (const r of bajos.slice(0, 2)) out.push(['warn', `El ${fCorta(r.f).toLowerCase()} (${r.c.txt}) comiste poco carbohidrato: ${nf(r.real)} de 4 cuartos, tocaban ${nf(r.c.c)}.`]);
  for (const r of altos.slice(0, 1)) out.push(['warn', `El ${fCorta(r.f).toLowerCase()} fue un día suave y el carbohidrato llegó a ${nf(r.real)} cuartos: con 1 basta.`]);
  const tot = con.reduce((a, r) => a + r.ms.length, 0), prot = con.reduce((a, r) => a + r.prot, 0), veg = con.reduce((a, r) => a + r.ms.filter(m => m.v >= 1).length, 0);
  out.push([prot === tot ? 'good' : 'warn', prot === tot ? `Proteína en las ${tot} comidas registradas.` : `Proteína en ${prot} de ${tot} comidas: intenta un cuarto en cada una.`]);
  if (veg < tot) out.push(['warn', `Verdura en ${veg} de ${tot} comidas.`]);
  if (!bajos.length && !altos.length) out.push(['good', 'El carbohidrato ha ido acorde con tu entreno.']);
  return out;
}
/* Qué comer según el plan de los próximos días (cuartos de plato + avituallamiento) */
function cardComerSemana() {
  const ds = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(HOY, i)).filter(f => sesion(f) || acts().some(a => a.f === f)).slice(0, 7);
  if (!ds.length) return `<div class="card"><div class="card-h"><span class="grow">Qué comer los próximos días</span></div><p class="small muted">Planifica tu semana y aquí te digo cuánto carbohidrato, proteína y verdura toca cada día.</p></div>`;
  return `<div class="card"><div class="card-h"><span class="grow">Qué comer los próximos días</span><span class="small muted">según tu plan</span></div><div class="list">${ds.map(f => { const c = cargaDia(f); const s = sesion(f); const min = s && SPORTS[s.dep]?.cardio ? s.min : 0;
    return `<div class="li" style="min-height:44px"><span class="main"><b>${cap1(fCorta(f))} · ${esc(c.n.toLowerCase())}</b><span>C ${nf(c.c)} · P 1 · V ${nf(4 - c.c - 1)} cuartos${min >= 120 ? ` · en ruta ${Math.round((min - 60) / 60 * 75)} g de carbohidrato (60-90 g/h desde la 2.ª hora)` : ''}</span></span></div>`; }).join('')}</div></div>`;
}
function scrNutri() {
  const ds = days7(SEM).filter(f => f <= HOY); const hoy = S.meals.filter(m => m.f === HOY); const cg = cargaDia(HOY);
  const avg = (ms, k) => ms.length ? ms.reduce((a, m) => a + m[k], 0) / ms.length : 0;
  const rows = ds.map(f => { const ms = S.meals.filter(m => m.f === f); const c = cargaDia(f); return { f, ms, c, real: avg(ms, 'c'), prot: ms.filter(m => m.p >= 1).length }; });
  const W = 600, H = 150, pl = 34, pb = 22, n = rows.length, X = i => pl + (i + .5) * (W - pl - 8) / n, Y = v => 8 + (H - 8 - pb) * (1 - v / 4);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cuartos de plato de carbohidrato por día frente a lo recomendado">`;
  for (const t of [0, 2, 4]) svg += `<line class="g" x1="${pl}" x2="${W - 8}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${pl - 6}" y="${Y(t) + 4}" text-anchor="end">${t}/4</text>`;
  rows.forEach((r, i) => { const bw = 22; if (r.ms.length) svg += `<path d="M${X(i) - bw / 2},${Y(0)}V${Y(r.real) + 4}q0,-4 4,-4h${bw - 8}q4,0 4,4V${Y(0)}z" fill="var(--s-montana)"/>`; svg += `<line x1="${X(i) - 16}" x2="${X(i) + 16}" y1="${Y(r.c.c)}" y2="${Y(r.c.c)}" stroke="var(--label)" stroke-width="2"/><text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="middle">${DL[dte(r.f).getDay()]}</text><rect class="hit" x="${X(i) - 30}" y="8" width="60" height="${H - 30}" data-tip="${esc(`${fCorta(r.f)} · ${r.c.n}: ${r.ms.length ? nf(r.real) + ' de 4 cuartos de carbohidrato' : 'sin registros'} (toca ${nf(r.c.c)})`)}"/>`; });
  svg += '</svg>';
  return { title: 'Comida', html: head('Comida', `${labTag()} · sin calorías: cuartos de plato`) + `<div class="content" style="max-width:760px">
    <div class="card hero"><div class="card-h"><span class="grow">Hoy · ${cg.n.toLowerCase()} (${esc(cg.txt)})</span>${M.fuente === 'demo' ? simTag('Comidas de ejemplo') : ''}</div>
      <p>En un día así, <b>${cg.c === 2 ? 'la mitad' : cg.c === 1.5 ? 'algo más de un tercio' : 'un cuarto'} de cada plato</b> debería ser carbohidrato, un cuarto proteína y el resto verdura.</p>
      <div class="plate">${[['Carbohidrato', 'c', cg.c], ['Proteína', 'p', 1], ['Verdura', 'v', 4 - cg.c - 1]].map(([n, k, t]) => { const v = avg(hoy, k); const ok = hoy.length && Math.abs(v - t) <= .5; return `<div class="pp"><span class="v">${hoy.length ? nf(v) : '—'}</span><span class="l">${n}</span><span class="t" style="color:${!hoy.length ? 'var(--label-2)' : ok ? 'var(--good)' : 'var(--warn)'}">toca ${nf(t)}/4</span></div>`; }).join('')}<div class="pp"><span class="v">${hoy.length}</span><span class="l">Comidas</span><span class="t">hoy</span></div></div>
      ${cg.k === 'duro' ? `<p class="say">Para el fondo largo: 60-90 g de carbohidratos por hora a partir de la segunda hora (una barrita o un gel cada 30-40 min).</p>` : ''}
      <div class="btns"><button class="btn fill" type="button" data-a="meal-add">${ic('plus', 18)} Añadir comida</button></div></div>
    <div class="card"><div class="card-h"><span class="grow">Esta semana: carbohidrato por día</span></div>
      <p class="small">Barra: tu media de cuartos de carbohidrato por plato. Raya: lo que tocaba por tu entreno de ese día.</p><div class="chart">${svg}<div class="tip"></div></div>
      <ul class="insights">${nutriInsights(rows).map(([k, t]) => `<li class="ins-${k}"><span class="ic">${ic(k === 'good' ? 'check' : 'food', 16)}</span><span>${esc(t)}</span></li>`).join('')}</ul></div>
    ${cardComerSemana()}
    <div class="card"><div class="card-h"><span class="grow">Registradas</span></div>${S.meals.slice().reverse().map(m => `<div class="meal"><span class="ph">${m.img ? `<img src="${m.img}" alt="">` : ic('food', 22)}</span><div class="grow stack" style="gap:2px"><b>${esc(m.tipo)} · ${fCorta(m.f)} ${esc(m.h)}</b><span class="small muted">${esc(m.txt)} · C ${m.c} · P ${m.p} · V ${m.v}</span></div>${m.sim ? simTag() : m.ia ? aiTag('Claude') : ''}</div>`).join('')}</div>
    <p class="xs">Por qué cuartos y no calorías: las apps de fotos fallan un 30-40 % en gramos y calorías. Contar porciones es más fiable y más rápido. Referencias: Athlete's Plate (fácil, moderado, duro) y ACSM (carbohidrato según la carga).</p></div>` };
}
function sheetMeal() {
  const st = S.mealDraft || (S.mealDraft = { tipo: horaTipo(), c: 2, p: 1, v: 1, txt: '', img: null, ia: false });
  openSheet({ title: 'Añadir comida', size: 'large', id: 'meal', body: () => `
    <div class="btns"><label class="btn tonal" for="meal-foto" style="cursor:pointer">${ic('camera', 18)} Foto ${S.ai === 'claude' ? aiTag() : ''}</label><input id="meal-foto" type="file" accept="image/*" data-a="meal-foto" class="vh">
      <button class="btn plain" type="button" data-a="meal-claude">${ic('claude', 18)} Desde Claude</button></div>
    ${st.img ? `<div class="meal"><span class="ph" style="width:88px;height:88px"><img src="${st.img}" alt="Tu foto"></span><p class="small muted grow" id="meal-st">${esc(st.estado || '')}</p></div>` : '<p class="small muted">Con foto, tu Claude propone los cuartos y tú confirmas. Sin foto, ponlos a mano: son 5 segundos.</p>'}
    <div class="filters">${['Desayuno', 'Comida', 'Merienda', 'Cena', 'Tentempié', 'Durante el entreno'].map(t => `<button type="button" class="fchip" data-a="meal-set" data-k="tipo" data-v="${t}" aria-pressed="${st.tipo === t}">${t}</button>`).join('')}</div>
    <div class="portions">${[['c', 'Carbohidrato', 'pan, pasta, arroz, patata, fruta'], ['p', 'Proteína', 'carne, pescado, huevo, legumbre'], ['v', 'Verdura', 'ensalada, verdura cocinada']].map(([k, n, s]) => `<div class="pstep"><b class="small">${n}</b><span class="xs">${s}</span><div class="row"><button type="button" aria-label="Menos ${n}" data-a="meal-step" data-k="${k}" data-v="-1">−</button><b>${st[k]}</b><button type="button" aria-label="Más ${n}" data-a="meal-step" data-k="${k}" data-v="1">+</button><span class="xs">/4</span></div></div>`).join('')}
      <div class="pstep"><b class="small">Total del plato</b><span class="xs">en cuartos</span><div class="row"><b style="color:${st.c + st.p + st.v === 4 ? 'var(--good)' : 'var(--warn)'}">${st.c + st.p + st.v}</b><span class="xs">/4</span></div></div></div>
    <label class="stack" for="meal-t"><b class="small">Qué era (opcional)</b><input id="meal-t" class="card" style="border:0;min-height:44px;font:15px var(--font-ui);color:var(--label)" value="${esc(st.txt)}" data-a="meal-txt" placeholder="Pasta con atún"></label>
    <button class="btn fill wide" type="button" data-a="meal-save">Guardar</button>` });
}
function horaTipo() { const h = new Date().getHours(); return h < 11 ? 'Desayuno' : h < 16 ? 'Comida' : h < 19 ? 'Merienda' : 'Cena'; }
async function mealFoto(file) {
  const st = S.mealDraft; const rd = new FileReader();
  rd.onload = async () => {
    const img = new Image(); img.onload = async () => { const c = document.createElement('canvas'); const s = Math.min(1, 480 / Math.max(img.width, img.height)); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); st.img = c.toDataURL('image/jpeg', .7);
      if (S.ai !== 'claude' || !SAMPLE) { st.estado = S.ai !== 'claude' ? 'IA desactivada: pon los cuartos a mano.' : 'Aquí no puedo usar Claude: pon los cuartos a mano o hazlo desde tu Claude.'; fillSheet(); return; }
      st.estado = 'Claude está mirando la foto…'; fillSheet();
      try {
        const lim = await SAMPLE.limits().catch(() => null); if (!lim || !lim.images) throw { code: 'images_unavailable' };
        const blob = await (await fetch(st.img)).blob();
        const r = await SAMPLE.json('Mira la foto de comida. Responde solo con JSON {"es_comida":bool,"tipo":"Desayuno|Comida|Merienda|Cena|Tentempié|Durante el entreno","carbohidrato":0-4,"proteina":0-4,"verdura":0-4,"descripcion":"máx 6 palabras en español"}. Los tres cuartos deben sumar 4 (cuartos de plato). Si no es comida, es_comida=false.', { images: blob, modelTier: 'quick' });
        if (!r || r.es_comida === false) { st.estado = 'No parece comida. Pon los cuartos a mano.'; }
        else { st.c = Math.max(0, Math.min(4, Math.round(+r.carbohidrato || 0))); st.p = Math.max(0, Math.min(4, Math.round(+r.proteina || 0))); st.v = Math.max(0, Math.min(4, Math.round(+r.verdura || 0))); if (r.tipo) st.tipo = String(r.tipo); st.txt = String(r.descripcion || '').slice(0, 60); st.ia = true; st.estado = 'Propuesta de Claude. Corrige lo que no cuadre y guarda.'; }
      } catch (e) { st.estado = e && e.code === 'not_granted' ? 'No has dado permiso a Claude. Ponlo a mano.' : 'No he podido usar Claude aquí. Ponlo a mano.'; }
      fillSheet(); };
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
}

/* ===== CLAUDE ===== */
var firstOpen = true; try { firstOpen = !sessionStorage.getItem('trazo-sync'); sessionStorage.setItem('trazo-sync', '1'); } catch (e) { }
const cap = name => (window.claude && typeof window.claude.use === 'function') ? window.claude.use(name).catch(() => null) : Promise.resolve(null);
let SAMPLE = undefined, DB = undefined;
/* Mientras se mira si ya usas myCoach, ni onboarding ni pantallas vacías: "Abriendo tu myCoach…" */
let COMPROBANDO = !S.onboarded && !!(window.claude && typeof window.claude.use === 'function');
/* Tu estado (plan, objetivo, deportes…) vive en el conector: el mismo en la web, en Claude y en el chat.
   Si hay conector, se lee y se guarda allí, también desde un artefacto de Claude (antes usaba su propio almacén). */
const dbConector = m => ({
  doc: path => ({
    get: () => m.callTool('Garmin', 'app_leer', { doc: path }).then(r => r.payload),
    set: (datos, opts = {}) => m.callTool('Garmin', 'app_guardar', { doc: path, datos, ...(typeof opts.version === 'number' ? { version: opts.version } : {}) }).then(r => r.payload),
  }),
  collection: c => ({ add: datos => m.callTool('Garmin', 'app_guardar', { doc: c, datos, anadir: true }).then(r => r.payload) }),
});
const capMcp = cap('mcp');
cap('sample').then(s => { SAMPLE = s; renderProtoStatus(); if (sheetState && sheetState.id === 'claude') fillSheet(); });
cap('db').then(async d => { const m = await capMcp; DB = m ? dbConector(m) : d; renderProtoStatus(); if (DB) cargarDeDB(); });
let LIVE = undefined; const capListo = capMcp.then(async m => {
  LIVE = m; renderProtoStatus();
  // ¿Ya usas myCoach? Si el conector tiene tu estado, entras directo: el onboarding es solo para quien empieza.
  if (!S.onboarded && m) {
    const st = await m.callTool('Garmin', 'app_leer', { doc: 'estado/app' }).then(r => r.payload).catch(() => null);
    if (st && (Object.keys(st.plan || {}).length || st.next || (st.sports || []).length || st.goal)) {
      S.onboarded = true; S.modo = 'vivo'; if (!DB) DB = dbConector(m);
      COMPROBANDO = false; await cargarDeDB(true); save();
    }
  }
  COMPROBANDO = false;
  if (!S.onboarded && m) { S.obConn = true; S.modo = 'vivo'; if (S.obStep <= 1 && !enWeb()) S.obStep = 2; save(); renderOnboarding(); sync(false); return; }
  if (S.onboarded && m && S.modo === 'vivo' && (firstOpen || !DSET || !DSET.acts.length || Date.now() - (S.lastSync || 0) > 15 * 60e3)) sync(false); else render();
});
// Sin conector (o si no contesta), se deja de esperar: onboarding o demo, como siempre.
setTimeout(() => { if (COMPROBANDO) { COMPROBANDO = false; render(); } }, 8000);
// El panel de prototipo (flujos y notas) solo con ?proto en la URL, en todas las versiones de la app.
if (!/[?&]proto\b/.test(location.search)) { const st = document.createElement('style'); st.textContent = '#proto-fab,#task{display:none!important}'; document.head.append(st); }
setTimeout(() => { if (SAMPLE === undefined) SAMPLE = null; if (DB === undefined) DB = null; renderProtoStatus(); }, 11000);
const CHAT = { turns: [], busy: false, ctl: null, pending: null, draft: '', fallback: !!(window.PLATFORM && PLATFORM.name === 'web') };
const SUGS = ['¿Cómo voy esta semana?', 'Prepárame la semana que viene', '¿Qué me falta para estar más sano?', '¿Qué como antes del largo?'];
const claudeReal = () => !!SAMPLE && !CHAT.fallback && S.ai === 'claude';
// Dentro de Claude (MCP Apps) la conversación está al lado: lo que escribes va allí y Claude contesta con tus datos.
const enConversacion = () => !!(window.PLATFORM && PLATFORM.enClaude) && S.ai === 'claude';
function openClaude(pre) {
  if (S.ai === 'off') { openSheet({ title: 'Claude', size: 'auto', id: 'claude-off', body: () => `<p>Tienes la IA desactivada. Todo lo básico funciona con reglas. Si la activas, se usa tu propia cuenta de Claude: la app no paga nada.</p><button class="btn fill" type="button" data-a="ai-on">Activar con mi Claude</button>` }); return; }
  openSheet({ title: enConversacion() ? `Pregúntale a ${S.coachNombre || 'myCoach'}` : 'Claude', size: enConversacion() ? 'auto' : 'large', id: 'claude', body: bodyClaude }); if (pre) setTimeout(() => claudeSend(pre), 250);
}
function bodyClaude() {
  if (enConversacion()) return `<p class="small muted">Te contesta aquí mismo, en la conversación, con tus datos y tu plan. Si propone cambios, te los enseña antes de guardarlos.</p>
    <div class="sugs">${SUGS.map(s => `<button type="button" class="sug" data-a="chat-sug" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <div class="composer" style="position:sticky;bottom:-20px;margin:0 -20px -20px"><label class="vh" for="chat-in">Mensaje</label><textarea id="chat-in" rows="1" placeholder="Pregunta o pide un cambio" data-a="chat-draft">${esc(CHAT.draft)}</textarea><button class="send" type="button" aria-label="Enviar a la conversación" data-a="chat-send">${ic('send', 20)}</button></div>`;
  const msgs = CHAT.turns.map((t, i) => `<div class="msg ${t.role === 'user' ? 'me' : 'cl'}" ${i === CHAT.turns.length - 1 && t.role === 'assistant' ? 'id="last-cl"' : ''}>${esc(t.content)}</div>`).join('');
  return `<div class="claude-mode ${claudeReal() ? 'real' : ''}"><i></i>${SAMPLE === undefined ? 'Conectando…' : claudeReal() ? 'Tu Claude, con tus datos de la app' : 'Respuestas de ejemplo (aquí no hay Claude)'}</div>
    <div class="chat">${!CHAT.turns.length ? '<div class="msg cl">Veo tu plan, tus deportes, tu forma, tu comida y tus pueblos. Pregúntame o pídeme cambios: nunca toco nada sin tu sí.</div>' : ''}${msgs}${CHAT.busy && CHAT.turns[CHAT.turns.length - 1]?.role === 'user' ? '<div class="msg cl think" id="last-cl">Pensando…</div>' : ''}${CHAT.pending ? propCard() : ''}</div>
    ${!claudeReal() && SAMPLE !== undefined ? `<button class="btn plain" type="button" data-a="claude-ext">${ic('copy', 18)} Hacerlo en mi Claude (copia el encargo)</button>` : ''}
    ${CHAT.busy ? '' : `<div class="sugs">${SUGS.map(s => `<button type="button" class="sug" data-a="chat-sug" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>`}
    <div class="composer" style="position:sticky;bottom:-20px;margin:0 -20px -20px"><label class="vh" for="chat-in">Mensaje</label><textarea id="chat-in" rows="1" placeholder="Pregunta o pide un cambio" data-a="chat-draft">${esc(CHAT.draft)}</textarea>${CHAT.busy ? `<button class="send" type="button" aria-label="Parar" data-a="chat-stop">${ic('stop', 20)}</button>` : `<button class="send" type="button" aria-label="Enviar" data-a="chat-send">${ic('send', 20)}</button>`}</div>`;
}
function propCard() {
  const p = CHAT.pending; const ok = p.items.filter(i => !i.bloq);
  return `<div class="prop"><div class="card-h">${ic('edit', 18)}<span class="grow">Cambios propuestos</span></div>
    ${p.items.map(i => `<div class="ch ${i.bloq ? 'blocked' : ''}"><b style="width:72px;flex:none">${fCorta(i.fecha)}</b><div class="grow stack" style="gap:4px"><span class="small">${sportDot2(i.dep)} <b>${SPORTS[i.dep].n}</b> · ${esc(i.detalle)}${i.minutos ? ` · ${dur(i.minutos)}` : ''}</span>${i.bloq ? `<span class="small" style="color:var(--bad)">${esc(i.bloq)}</span>` : ''}</div></div>`).join('')}
    <div class="btns"><button class="btn fill" type="button" data-a="prop-apply" ${ok.length ? '' : 'disabled'}>Aplicar ${ok.length}</button><button class="btn text" type="button" data-a="prop-discard">Descartar</button></div></div>`;
}
function validarPropuesta(cambios) {
  const items = []; const np = { ...S.plan, ...(S.next || {}) };
  for (const c of (Array.isArray(cambios) ? cambios : []).slice(0, 14)) {
    const fecha = String(c.fecha || ''), tipo = ['rec', 'fondo', 'tempo', 'int', 'otros', 'descanso'].includes(c.tipo) ? c.tipo : 'fondo', dep = SPORTS[c.deporte] ? c.deporte : 'bici';
    const it = { fecha, tipo, dep, detalle: String(c.detalle || TIPOS[tipo].n).slice(0, 80), minutos: Math.max(0, Math.min(400, Number(c.minutos) || 0)) };
    const wk = weekOf(fecha);
    if (wk !== SEM && wk !== PROX) it.bloq = 'Fuera de las dos semanas del plan.';
    else if (fecha < HOY) it.bloq = 'Ese día ya pasó.';
    else if (np[fecha] && np[fecha].act) it.bloq = 'Ese día ya está hecho.';
    else { const ints = days7(wk).filter(d => d !== fecha).reduce((n, d) => n + ((np[d] && np[d].t) === 'int' ? 1 : 0), 0) + (tipo === 'int' ? 1 : 0); const o = objetivos();
      if (tipo === 'int' && ints > o.int[1]) it.bloq = `Serían ${ints} intensos: tu objetivo permite ${o.int[1]}.`; else if (tipo === 'int' && fecha === HOY && rdy() < 40) it.bloq = 'Readiness baja: hoy nada intenso.'; else np[fecha] = { t: tipo, dep, min: it.minutos }; }
    items.push(it);
  }
  return { items };
}
function aplicarPropuesta() {
  const ok = CHAT.pending.items.filter(i => !i.bloq); CHAT.pending = null;
  commit(`${ok.length} cambios aplicados`, () => { for (const i of ok) { const key = weekOf(i.fecha) === SEM ? 'plan' : 'next'; if (!S[key]) S[key] = {}; S[key][i.fecha] = { dep: i.dep, t: SPORTS[i.dep].cardio ? i.tipo : 'otros', d: i.detalle, min: i.minutos }; } if (S.next) days7(PROX).forEach(f => { if (!S.next[f]) S.next[f] = { dep: 'bici', t: 'descanso', d: 'Descanso', min: 0 }; }); });
  CHAT.turns.push({ role: 'user', content: '(He aplicado los cambios.)' }); markFlow('planificar'); fillSheet();
}
function estadoParaClaude() {
  const dia = f => { const s = sesion(f); if (!s) return null; const o = { fecha: f, deporte: s.dep, tipo: s.t, detalle: s.d, minutos: s.min }; if (s.a) o.hecho = { tipo: tipoAct(s.a), km: s.a.km, minutos: s.a.min, pulso: s.a.fc }; return o; };
  return { hoy: HOY, readiness: rdy(), deportes: S.sports, objetivo: { modo: S.goal.modo, ...objetivos() }, forma: forma(), notas: Object.fromEntries(Object.entries(dims()).map(([k, x]) => [k, { nota: x.v, dato: x.u }])),
    semana_actual: days7(SEM).map(dia), semana_que_viene: S.next ? days7(PROX).map(dia) : 'sin planificar', resumen_semana: insightsSemana(SEM).map(x => x[2]),
    desde: M.acts.length ? M.acts[M.acts.length - 1].f : null, horas_por_deporte: Object.fromEntries(Object.entries(horasPorDeporte()).map(([k, v]) => [k, Math.round(v * 10) / 10])), perfil: { edad: M.perfil.edad, peso: M.perfil.peso, vo2max: M.perfil.vo2, endurance: M.perfil.es, hill: M.perfil.hill }, fuente: M.fuente,
    agenda: CAL ? Object.fromEntries(Object.entries(CAL).filter(([f]) => f >= HOY && f < addDays(PROX, 7)).map(([f, e]) => [f, e.map(x => x.todoDia ? `todo el día: ${x.t}` : `${x.de}-${x.a}`)])) : 'sin calendario conectado', comida_hoy: S.meals.filter(m => m.f === HOY).map(m => ({ tipo: m.tipo, cuartos_carbohidrato: m.c, proteina: m.p, verdura: m.v })) };
}
function guion(q) {
  q = q.toLowerCase();
  if (/c[oó]mo voy/.test(q)) return { text: insightsSemana(SEM).map(x => x[2]).join(' ') };
  if (/sano|salud|falta/.test(q)) { const h = horasPorDeporte(); const fz = acts().filter(a => a.dep === 'fuerza').length; const ds = Object.keys(h).slice(0, 4).map(k => SPORTS[k].n.toLowerCase()); return { text: `${fz < 8 ? `Lo que más te falta es fuerza: ${fz} sesiones en tu histórico. Dos de 30-45 min por semana.` : 'Haces fuerza con regularidad: mantenla.'} ${ds.length > 2 ? `Buena variedad (${ds.join(', ')}).` : ''}` }; }
  if (/como|comer|largo/.test(q)) return { text: 'Hoy toca día duro: la mitad de cada plato, carbohidrato. En el largo, a partir de la segunda hora, 60-90 g por hora: un gel o una barrita cada 30-40 min.' };
  if (/semana que viene|prep[aá]r|revisa/.test(q)) { const p = generarSemana(S.sports.filter(k => ['bici', 'correr', 'fuerza', 'raqueta'].includes(k)), 7.5, S.goal.modo); return { text: 'Te propongo 1 intenso (miércoles), fondo largo el sábado, 2 de fuerza (lunes y viernes) y correr suave. Unas 7 h 30.', cambios: Object.entries(p).map(([f, s]) => ({ fecha: f, deporte: s.dep, tipo: s.t, detalle: s.d, minutos: s.min })) }; }
  return { text: 'Estoy en modo ejemplo y solo respondo a las sugerencias. Con tu Claude de verdad puedes preguntar lo que quieras.' };
}
async function claudeSend(text) {
  text = String(text || '').trim(); if (!text || CHAT.busy) return;
  if (enConversacion()) {
    PLATFORM.enClaude(text).then(() => { CHAT.draft = ''; closeSheet(); toast('Enviado. Te contesto en la conversación'); }, () => toast('No he podido enviarlo a la conversación. Escríbelo directamente en Claude'));
    return;
  }
  CHAT.turns.push({ role: 'user', content: text }); CHAT.draft = ''; CHAT.busy = true; CHAT.pending = null; fillSheet(); scrollChat();
  if (!claudeReal()) { await new Promise(r => setTimeout(r, 600)); const g = guion(text); if (g.cambios) CHAT.pending = validarPropuesta(g.cambios); CHAT.turns.push({ role: 'assistant', content: g.text }); CHAT.busy = false; fillSheet(); scrollChat(); return; }
  const RULES = `Eres el asistente de myCoach, una app que lee el Garmin de ${S.nombre || 'un deportista'}${M.perfil.edad ? ` (${M.perfil.edad} años` + (M.perfil.peso ? `, ${M.perfil.peso} kg` : '') + ')' : ''}, deportes: ${S.sports.join(', ')}. ${M.fuente === 'vivo' ? 'Datos reales de Garmin' : 'Modo demo con datos de ejemplo'}. Responde en español de España, tuteando, frases cortas, máximo 90 palabras, sin markdown. Usa solo los DATOS. Nunca cambies el plan por tu cuenta: si pide cambios o una semana, llama UNA vez a proponer_cambios con todos los días que cambian y explica en 1-2 frases; la app pide confirmación. Topes: intensos por semana según el objetivo, nada intenso hoy con readiness < 40, fuerza 2 veces por semana recomendada. Tipos: rec, fondo, tempo, int, otros, descanso. Deportes: bici, correr, skimo, montana, raqueta, fuerza. Hoy es ${HOY}, ${DS[dte(HOY).getDay()]}.\n\nDATOS:\n${JSON.stringify(estadoParaClaude())}`;
  CHAT.ctl = new AbortController(); let started = false;
  const tools = [{ name: 'proponer_cambios', description: 'Propone cambios al plan (esta semana desde hoy, o la que viene). No los aplica: la app pide confirmación. Devuelve los válidos y los bloqueados por topes.',
    inputSchema: { type: 'object', properties: { cambios: { type: 'array', items: { type: 'object', properties: { fecha: { type: 'string' }, deporte: { type: 'string', enum: ['bici', 'correr', 'skimo', 'montana', 'raqueta', 'fuerza'] }, tipo: { type: 'string', enum: ['rec', 'fondo', 'tempo', 'int', 'otros', 'descanso'] }, detalle: { type: 'string' }, minutos: { type: 'number' } }, required: ['fecha', 'deporte', 'tipo', 'detalle', 'minutos'] } } }, required: ['cambios'] },
    execute(input) { const r = validarPropuesta(input && input.cambios); CHAT.pending = r; return { validos: r.items.filter(i => !i.bloq).length, bloqueados: r.items.filter(i => i.bloq).map(i => ({ fecha: i.fecha, motivo: i.bloq })) }; } }];
  try {
    const res = await SAMPLE([{ role: 'user', content: RULES }, ...CHAT.turns.slice(-10)], { modelTier: 'quick', signal: CHAT.ctl.signal, tools, onText: ({ text }) => { if (!started) { started = true; CHAT.turns.push({ role: 'assistant', content: text }); fillSheet(); } else { CHAT.turns[CHAT.turns.length - 1].content = text; const el = $('#last-cl'); if (el) el.textContent = text; } scrollChat(); } });
    if (!started) CHAT.turns.push({ role: 'assistant', content: res.text }); else CHAT.turns[CHAT.turns.length - 1].content = res.text;
  } catch (e) {
    if (started) CHAT.turns[CHAT.turns.length - 1].content = (e && e.text) || '(Interrumpida)';
    else if (e && ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'tools_unavailable'].includes(e.code)) { CHAT.fallback = true; const g = guion(text); if (g.cambios) CHAT.pending = validarPropuesta(g.cambios); CHAT.turns.push({ role: 'assistant', content: g.text + '\n\n(Ejemplo: Claude no está disponible aquí.)' }); }
    else CHAT.turns.push({ role: 'assistant', content: e && e.code === 'cancelled' ? '(Parado)' : e && e.code === 'rate_limited' ? 'Demasiadas preguntas seguidas. Prueba en un rato.' : 'No he podido responder.' });
  }
  CHAT.busy = false; CHAT.ctl = null; fillSheet(); scrollChat();
}
function scrollChat() { const b = sheetState && sheetState.sh.querySelector('.sheet-b'); if (b) b.scrollTop = b.scrollHeight; }
const PROMPT_EXT = () => `Usa mi conector de Garmin . Lee mi semana actual, mi objetivo (${(MODOS[S.goal.modo] || MODOS.forma).n.toLowerCase()}) y mi readiness de hoy. Prepárame la semana del ${fDia(PROX)} al ${fDia(addDays(PROX, 6))} con los deportes ${S.sports.join(', ')}: 1-2 días intensos, 2 de fuerza, un fondo largo el sábado y el resto suave. Enséñamela y, cuando te diga que sí, guárdala en myCoach con app_guardar (doc "estado/app", fusionar: true, en el campo "next" como { "AAAA-MM-DD": { dep, t: rec|fondo|tempo|int|otros|descanso, d, min } }).`;

/* ===== Sincronización ===== */
/* n llamadas a la vez: la primera lectura pasa de minutos a segundos */
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); })); }
let syncing = false;
/* Sincroniza con el conector de Garmin del usuario (en vivo). Sin conector: modo demo. */
async function sync(manual, live = !!LIVE && S.modo === 'vivo') {
  if (syncing) return; syncing = true;
  const bar = document.createElement('div'); bar.className = 'syncbar'; app.append(bar); const msg = t => { bar.innerHTML = `${ic('sync', 18, 'spin')} ${esc(t)}`; }; msg('Sincronizando con Garmin…');
  $('#refresh svg')?.classList.add('spin');
  const fin = () => { bar.remove(); $('#refresh svg')?.classList.remove('spin'); syncing = false; };
  if (!live) {
    await new Promise(r => setTimeout(r, 900)); fin(); S.lastSync = Date.now(); save();
    if (manual && S.modo === 'demo' && !S.simRide) { S.simRide = true; S.seenSim = false; save(); render(); toast('Demo: 1 actividad simulada · +3 pueblos'); markFlow('sync'); }
    else { render(); toast(S.modo === 'demo' ? 'Modo demo' : 'Aquí no hay conector de Garmin: activa el modo demo en Ajustes o ábrelo en claude.ai'); } return;
  }
  const call = (tool, input, fresh) => LIVE.callTool('Garmin', tool, input, { cache: fresh ? { refresh: true } : { staleTime: 6 * 3600e3 } }).then(r => r.payload);
  const ds = (DSET && DSET.fuente === 'vivo') ? DSET : { fuente: 'vivo', perfil: {}, acts: [], det: {}, rutas: {}, evo: [], geo: {} };
  const errs = []; let nuevas = 0;
  try {
    msg('Leyendo tu readiness…');
    const rd = await call('garmin_training_readiness', {}, true); const pg = rd.perfil_garmin || {}, pe = pg.persona || {};
    ds.perfil = { edad: pe.edad, sexo: pe.sexo, peso: pe.peso_kg, lthr: pe.umbral_lactato_ppm, vo2: pg.vo2max, es: pg.endurance?.puntos, hill: pg.hill_score, balance: pg.balance_carga_mes, ready: { score: rd.score, level: rd.level, sleep: rd.sleep_score, hrv: rd.hrv_factor, rec: rd.recovery_time_hours, fecha: rd.date } };
    S.readiness = null;
  } catch (e) { errs.push(e); }
  try {
    msg('Leyendo tu histórico…');
    const list = await call('garmin_activities', { limit: 300 }, manual || !ds.acts.length);
    if (Array.isArray(list)) { const prev = new Set(ds.acts.map(a => String(a.id))); ds.acts = list.map(x => ({ id: String(x.id), t: x.t, d: x.d, km: x.km, min: x.min, fc: x.fc, te: x.te, n: x.n })); nuevas = ds.acts.filter(a => !prev.has(a.id)).length; }
  } catch (e) { errs.push(e); }
  // Detalle (pulso, subidas, llano) de lo reciente y del skimo; trazados para pueblos. Por tandas.
  const d60 = addDays(HOY, -60);
  const needDet = ds.acts.filter(a => !ds.det[a.id] && ((a.d > d60 && ['bici', 'correr', 'skimo', 'montana'].includes(FAM[a.t])) || FAM[a.t] === 'skimo')).slice(0, 15);
  let i = 0; await pool(needDet, 4, async a => { msg(`Analizando actividades (${++i}/${needDet.length})…`); try { const r = await call('garmin_activity_detail', { activity_id: a.id }); const an = r.analisis || {}; const sb = (an.subidas || [])[0];
      ds.det[a.id] = { h: an.histograma_fc_min || null, desn: r.elevation_gain_m ?? null, sub: sb ? [sb.largo_km, sb.desnivel_m, sb.minutos, sb.fc_media] : null, llano: an.llano ? [an.llano.km, an.llano.vel_media_kmh, an.llano.fc_media] : null }; } catch (e) { ds.det[a.id] = { err: e.code || 'error' }; } });
  const needRuta = ds.acts.filter(a => !(a.id in ds.rutas) && a.km > 0.5 && ['bici', 'correr', 'skimo', 'montana', 'esqui', 'caminar'].includes(FAM[a.t])).slice(0, 25);
  i = 0; await pool(needRuta, 4, async a => { msg(`Buscando pueblos (${++i}/${needRuta.length})…`); try { const r = await call('garmin_activity_route', { activity_id: a.id, puntos: 5 }); ds.rutas[a.id] = r.polilinea || null; } catch (e) { ds.rutas[a.id] = null; } });
  // Evolución mensual (VO2máx, Endurance, Hill): un punto por mes; el mes en curso se refresca
  if (ds.acts.length) { const first = ds.acts.reduce((m, a) => a.d < m ? a.d : m, HOY); let f = first.slice(0, 8) + '15'; const have = new Set(ds.evo.map(e => e[0])); const pend = [];
    while (f <= HOY) { if (!have.has(f)) pend.push(f); f = addDays(f.slice(0, 8) + '01', 32).slice(0, 8) + '15'; }
    const hoyKey = HOY; ds.evo = ds.evo.filter(e => e[0] !== hoyKey); pend.push(hoyKey);
    i = 0; await pool(pend.slice(-13), 4, async d => { msg(`Tu evolución (${++i}/${Math.min(13, pend.length)})…`); try { const r = await call('garmin_training_readiness', { date: d }, d === hoyKey); const g = r.perfil_garmin || {}; ds.evo.push([d, g.vo2max ?? null, g.endurance?.puntos ?? null, g.hill_score ?? null]); } catch (e) { } });
    ds.evo.sort((a, b) => a[0].localeCompare(b[0])); }
  fin(); ds.at = Date.now(); construir(ds); guardarCache(ds);
  if (!S.sports.length) S.sports = Object.keys(horasPorDeporte()).filter(k => ENTRENABLES.includes(k));
  S.lastSync = Date.now(); S.liveOk = errs.length < 2; save(); render(); markFlow('sync'); cargarCoach(manual);
  const pendientes = ds.acts.filter(a => !ds.det[a.id] && a.d > d60 && ['bici', 'correr', 'skimo'].includes(FAM[a.t])).length + ds.acts.filter(a => !(a.id in ds.rutas) && a.km > 0.5 && FAM[a.t] && FAM[a.t] !== 'fuerza' && FAM[a.t] !== 'raqueta').length;
  if (!errs.length) toast(`${nuevas ? `${nuevas} actividad${nuevas === 1 ? '' : 'es'} nueva${nuevas === 1 ? '' : 's'}. ` : ''}${pendientes ? `Faltan ${pendientes} por analizar: vuelve a actualizar.` : 'Todo al día con Garmin.'}`, { ms: 6000 });
  else { const e = errs[0] || {}; const m = { needs_reauth: 'Vuelve a conectar Garmin en claude.ai → Ajustes → Conectores', server_not_connected: 'Añade el conector de Garmin en claude.ai → Conectores', not_in_manifest: 'No has dado permiso a esta página para usar Garmin', selection_required: 'Elige qué conector de Garmin usar', server_unavailable: 'Garmin no responde ahora; prueba en un rato', tool_error: 'Garmin ha devuelto un error: ' + (e.message || '') }[e.code] || 'No he podido leer Garmin (' + (e.code || 'error') + ')'; toast(m, { ms: 8000 }); }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (DB) cargarDeDB(); cargarCalendario(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.onboarded && LIVE && Date.now() - (S.lastSync || 0) > 15 * 60e3) sync(false); });

/* ===== Acciones ===== */
const ACTIONS = {
  tab: el => { const tb = $('#tabbar'); if (tb.classList.contains('mini') && el.closest('#tabbar') && S.tab === el.dataset.v && !S.stack.length) { tb.classList.remove('mini'); return; } go(el.dataset.v); },
  push: el => { const v = el.dataset.v; push(v === 'test' ? { s: 'test', step: 0 } : { s: v, id: el.dataset.id }); },
  'push-close': el => { closeSheet(); ACTIONS.push(el); },
  toast: el => toast(el.dataset.v),
  fsel: el => { const k = el.dataset.k, v = el.dataset.v; if (!v) S[k] = []; else S[k] = S[k].includes(v) ? S[k].filter(x => x !== v) : [...S[k], v]; save(); render(); markFlow(k === 'pSport' ? 'pueblos' : 'deportes'); const mf = $('#mapfull'); if (mf) { mf.querySelector('.mf-chips').innerHTML = fchips('pSport', ['bici', 'correr', 'montana', 'skimo'], S.pSport); applyMapFilter(mf.querySelector('#mf-view svg')); } },
  sportsel: el => { S.fSport = [el.dataset.v]; S.tab = 'forma'; S.stack = []; save(); vt(() => render(true)); markFlow('deportes'); },
  adapt: el => { const v = el.dataset.v; markFlow('ajustar'); if (v === 'mantener') { S.adapt = 'mantener'; save(); render(); toast('Mantienes el plan: por debajo de 150 ppm.', { undo: () => { S.adapt = null; save(); render(); } }); return; }
    commit(v === 'suave' ? 'Hoy suave; el largo, mañana' : 'Hoy descansas; el largo, mañana', () => { const largo = { ...S.plan[HOY] }; S.plan[HOY] = v === 'suave' ? { dep: 'bici', t: 'rec', d: '1 h muy suave, <130 ppm', min: 60 } : { dep: 'bici', t: 'descanso', d: 'Descanso', min: 0 }; S.plan[addDays(HOY, 1)] = largo; S.adapt = v; }); },
  otro: el => { closeSheet(true); sheetOtro(el.dataset.v || HOY); },
  'otro-set': el => { const st = S.otroDraft; st[el.dataset.k] = el.dataset.k === 'min' ? +el.dataset.v : el.dataset.v; fillSheet(); },
  'otro-save': () => saveOtro(),
  'seen-sim': () => { S.seenSim = true; save(); go('pueblos'); },
  week: el => { S.week = el.dataset.v; save(); render(); markFlow(el.dataset.v < SEM ? 'revision' : el.dataset.v === PROX ? 'planificar' : 'semana'); },
  day: el => sheetDia(el.dataset.v), move: el => sheetMover(el.dataset.v), 'move-to': el => doMove(el.dataset.v, el.dataset.to),
  'mark-done': el => { closeSheet(); toast('Marcada como hecha (sin datos del reloj)'); },
  watch: () => toast('Enviado al calendario del reloj (simulado)'),
  'draft-dep': el => { const d = S.nextDraft; const v = el.dataset.v; d.deps = d.deps.includes(v) ? d.deps.filter(x => x !== v) : [...d.deps, v]; save(); render(); },
  'gen-week': () => { const d = S.nextDraft; if (!d.deps.some(k => SPORTS[k].cardio)) { ask({ title: 'Elige un deporte de resistencia', text: 'Bici, correr, skimo o montaña.', actions: [{ label: 'Vale', kind: 'fill' }] }); return; }
    const w = semSel(); const p = generarSemana(d.deps, d.h, S.goal.modo, w); if (w === SEM) for (const f of Object.keys(p)) if (f < HOY) delete p[f];
    const notas = aplicarAgenda(p);
    commit(`${w === SEM ? 'Semana preparada desde hoy' : 'Semana propuesta'}${notas.length ? `. Por tu agenda: ${notas.join('; ')}` : '. Revísala y cámbiala a tu gusto'}.`, () => { if (w === SEM) S.plan = { ...S.plan, ...p }; else S.next = p; }); markFlow('planificar'); },
  'plan-sem': el => { S.tab = 'plan'; S.week = el.dataset.v; S.stack = []; save(); vt(() => render(true)); },
  'cal-guardar': async el => { const u = ($('#cal-url') || {}).value || ''; if (!u.trim()) { toast('Pega el enlace de tu calendario'); return; } el.disabled = true; el.textContent = 'Leyendo tu calendario…';
    try { const r = await PLATFORM.calendario.guardar(u.trim()); await cargarCalendario(); toast(`Calendario conectado: ${r.eventos} eventos en 14 días`); } catch (e) { toast(e.message || 'No he podido leer ese calendario', { ms: 7000 }); el.disabled = false; el.textContent = 'Conectar calendario'; } },
  'cal-quitar': async () => { try { await PLATFORM.calendario.quitar(); } catch (e) { } CAL = null; S.calOk = false; save(); render(); toast('Calendario quitado'); },
  replan: () => { commit('Plan de la próxima semana borrado', () => { S.next = null; }); },
  'goal-edit': () => push({ s: 'objetivo' }),
  claude: el => { closeSheet(true); openClaude(el.dataset.v); },
  'claude-ext': () => enClaude(PROMPT_EXT()), 'ai-on': () => { S.ai = 'claude'; save(); closeSheet(); openClaude(); },
  dim: el => sheetDim(el.dataset.v),
  'dim-cta': el => { const v = el.dataset.v; closeSheet(); if (v === 'test') push({ s: 'test', step: 0 }); else if (v === 'plan') go('plan'); else if (v === 'evo') push({ s: 'evo' }); },
  'evo-range': el => { S.evoRange = +el.dataset.v; save(); render(); },
  'test-next': () => { const s = S.stack[S.stack.length - 1]; s.step = 1; save(); vt(() => render(true)); },
  'test-save': () => { const t = S.stack[S.stack.length - 1].t; const w = wkgFisica(+t.km, +t.desn, +t.min, M.perfil.peso); if (!w) return; const ftp = w * 0.95; const old = dims().subida.v; S.testRes = { v: half(wkgScore(ftp)), wkg: ftp, km: +t.km, desn: +t.desn, min: +t.min, fc: +t.fc || null, f: HOY }; S.stack = []; S.tab = 'forma'; save(); vt(() => render(true)); toast(`Subida: ${old == null ? 'sin nota' : nf(old)} → ${nf(S.testRes.v)}`); },
  'goal-modo': el => { const s = S.stack[S.stack.length - 1]; s.g = { modo: el.dataset.v }; save(); render(); },
  'goal-set': el => { const s = S.stack[S.stack.length - 1]; s.g[el.dataset.k] = el.dataset.v; save(); render(); },
  'goal-pro-on': () => { const s = S.stack[S.stack.length - 1]; s.pro = true; save(); render(); },
  'goal-save': () => { const s = S.stack[S.stack.length - 1]; const g = s.g; const m = MODOS[g.modo]; g.titulo = g.modo === 'reto' && g.reto ? `${g.reto}${g.fecha ? ' · ' + fDia(g.fecha) : ''}` : g.modo === 'mejorar' && g.dep ? `Mejorar en ${SPORTS[g.dep].n.toLowerCase()}` : m.n; S.goal = g; S.stack.pop(); save(); vt(() => render(true)); toast('Objetivo guardado: tu plan y tus avisos se adaptan'); markFlow('objetivo'); },
  'open-map': () => { if (S.pLevel === 'world') { toast('El mapa del mundo solo marca países'); return; } openMapa(); },
  'town-focus': el => { const id = el.dataset.v; openMapa(PROV_CCAA[id.slice(0, 2)] === M.ccaa ? 'ccaa' : 'es', id); },
  'map-close': () => closeMapa(), 'map-key': el => openMapa(el.dataset.v), 'map-card-close': () => { $('#mf-card').hidden = true; $$('#mapfull path.sel').forEach(x => x.classList.remove('sel')); },
  'map-zoom': el => zoomAt($('#mf-view svg'), +el.dataset.v), 'map-reset': () => setVB($('#mf-view svg'), [...MAPA.vb0]),
  plevel: el => { S.pLevel = el.dataset.v; save(); render(); markFlow('pueblos'); }, pzoom: el => { S.pZoom = el.dataset.v; save(); render(); },
  'fix-type': el => { const id = el.dataset.v; openSheet({ title: 'Cómo cuenta', size: 'auto', body: () => `<div class="opts">${['rec', 'fondo', 'tempo', 'int'].map(k => `<button type="button" class="radio" style="border:0;font:inherit;color:inherit;text-align:left" data-a="fix-to" data-v="${id}" data-k="${k}">${chip(k)}</button>`).join('')}</div>` }); },
  'fix-to': el => { closeSheet(); S.overrides[el.dataset.v] = el.dataset.k; save(); render(); toast(`Ahora cuenta como ${TIPOS[el.dataset.k].n.toLowerCase()}`); },
  'do-share': () => { toast('En la app real se abre el menú de compartir con la imagen'); markFlow('compartir'); },
  'meal-add': () => { S.mealDraft = null; sheetMeal(); markFlow('comida'); },
  'meal-set': el => { S.mealDraft[el.dataset.k] = el.dataset.v; fillSheet(); },
  'meal-step': el => { const st = S.mealDraft, k = el.dataset.k; st[k] = Math.max(0, Math.min(4, st[k] + +el.dataset.v)); fillSheet(); },
  'meal-claude': () => enClaude('Te paso una foto de mi comida. Dime si es desayuno, comida, merienda, cena o tentempié y cuántos cuartos del plato son carbohidrato, proteína y verdura (que sumen 4). Cuando te confirme, guárdalo en myCoach con app_guardar (doc "estado/app", fusionar: true, campo "meals").'),
  'meal-save': () => { const st = S.mealDraft; const d = new Date(); S.meals.push({ id: 'm' + Date.now(), f: HOY, h: d.toTimeString().slice(0, 5), tipo: st.tipo, c: st.c, p: st.p, v: st.v, txt: st.txt || st.tipo, img: st.img, ia: st.ia }); S.mealDraft = null; save(); closeSheet(); render(); toast('Comida guardada'); },
  'sheet-close': () => closeSheet(), 'web-login': () => PLATFORM.login(), 'web-logout': () => PLATFORM.logout(),
  'sheet-detent': () => { if (!sheetState) return; const sh = sheetState.sh; if (sh.classList.contains('large')) { sh.classList.remove('large'); sh.classList.add('medium'); } else { sh.classList.remove('medium', 'auto'); sh.classList.add('large'); } },
  'chat-send': () => { const t = $('#chat-in'); claudeSend(t ? t.value : ''); }, 'chat-sug': el => claudeSend(el.dataset.v), 'chat-stop': () => CHAT.ctl && CHAT.ctl.abort(),
  'prop-apply': () => aplicarPropuesta(), 'prop-discard': () => { CHAT.pending = null; fillSheet(); },
  'ob-next': () => { S.obStep++; save(); vt(() => renderOnboarding()); },
  'ob-conn': async el => { el.disabled = true; el.textContent = 'Conectando…'; if (LIVE === undefined) await capListo; if (!LIVE && window.PLATFORM && PLATFORM.login) { PLATFORM.login(); return; } if (LIVE) { S.modo = 'vivo'; sync(false); } else { S.modo = 'demo'; cargarModo(); } S.obConn = true; save(); renderOnboarding(); },
  'ob-sport': el => { const v = el.dataset.v; S.sports = S.sports.includes(v) ? S.sports.filter(x => x !== v) : [...S.sports, v]; save(); renderOnboarding(); },
  'ob-var': el => { S.variant = el.dataset.v; save(); renderOnboarding(); }, 'ob-ai': el => { S.ai = el.dataset.v; save(); renderOnboarding(); },
  'ob-done': () => { S.onboarded = true; S.tab = 'hoy'; S.stack = []; save(); markFlow('primer-uso'); vt(() => render(true)); sync(false); },
};
document.addEventListener('click', e => { const el = e.target.closest('[data-a]'); if (!el || el.matches('input,textarea') || el.closest('#proto')) return; const f = ACTIONS[el.dataset.a]; if (f) { e.preventDefault(); f(el); } });
document.addEventListener('input', e => {
  const el = e.target, a = el.dataset && el.dataset.a; if (!a) return;
  if (a === 'chat-draft') { CHAT.draft = el.value; }
  if (a === 'otro-txt') { S.otroDraft.txt = el.value; }
  if (a === 'town-q') { S.townQ = el.value; render(); const i = $('#town-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  if (a === 'meal-txt') { S.mealDraft.txt = el.value; }
  if (a === 'draft-h') { S.nextDraft.h = +el.value; save(); render(); $('#draft-h')?.focus(); }
  if (a === 'test-in') { const t = S.stack[S.stack.length - 1].t; t[el.dataset.k] = el.value.replace(',', '.'); const id = el.id, p = el.selectionStart; render(); const i = document.getElementById(id); if (i) { i.focus(); try { i.setSelectionRange(p, p); } catch (e) { } } }
  if (a === 'nombre-in') { S.nombre = el.value; save(); }
  if (a === 'test-w') { S.stack[S.stack.length - 1].w = +el.value; render(); $('#t-w')?.focus(); }
  if (a === 'goal-pro') { const s = S.stack[S.stack.length - 1]; const m = MODOS[s.g.modo]; const v = +el.value; const k = el.dataset.k; if (k === 'fuerza') s.g.fuerza = v; else s.g[k] = [Math.min((s.g[k] || m[k])[0], v), v]; render(); document.getElementById(el.id)?.focus(); }
});
document.addEventListener('change', e => {
  const el = e.target, a = el.dataset && el.dataset.a; if (!a) return;
  if (a === 'share-t') { S.share[el.dataset.v] = el.checked; save(); render(); }
  if (a === 'sport-t') { const v = el.dataset.v; S.sports = el.checked ? [...new Set([...S.sports, v])] : S.sports.filter(x => x !== v); S.fSport = S.fSport.filter(x => S.sports.includes(x)); save(); render(); markFlow('deportes'); }
  if (a === 'set') { S[el.dataset.k] = el.value; if (el.dataset.k === 'modo') { cargarModo(); if (S.modo === 'vivo' && LIVE) sync(false); } save(); render(); document.getElementById(el.id)?.focus(); toast('Guardado'); }
  if (a === 'goal-date') { S.stack[S.stack.length - 1].g.fecha = el.value; save(); }
  if (a === 'otro-txt') { fillSheet(); }
  if (a === 'meal-foto' && el.files && el.files[0]) mealFoto(el.files[0]);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#mapfull')) { closeMapa(); return; } if (e.key === 'Escape') { if ($('#proto').classList.contains('in')) toggleProto(false); else closeSheet(); } if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'chat-in') { e.preventDefault(); claudeSend(e.target.value); } });
$('#topback').addEventListener('click', () => pop());
$('#avatar').addEventListener('click', () => push({ s: 'ajustes' }));
$('#refresh').addEventListener('click', () => sync(true));
$('#claude-btn').addEventListener('click', () => openClaude());

/* ===== ONBOARDING ===== */
// En la web, el primer paso es tu cuenta de myCoach y luego vincular Garmin.
function obCuentaWeb(steps, nA, desde) {
  const titulo = `${steps}<h1>Entra en myCoach</h1><p class="lead">Con tu cuenta ves tu plan aquí y en tu Claude. Después vinculas tu Garmin: leemos actividades, sueño y readiness, y no publicamos nada.</p>`;
  if (!S.obConn) return `${titulo}<div class="card"><button class="btn fill" type="button" data-a="ob-conn">Entrar o crear cuenta</button></div><span class="spacer"></span>`;
  if (CUENTA === undefined) { cargarCuenta(); return `${titulo}<p class="small muted" role="status">Comprobando tu cuenta…</p>`; }
  const vinculado = CUENTA && CUENTA.garmin.vinculado;
  const tarjeta = vinculado
    ? `<div class="row">${ic('check', 28)}<div class="grow"><b>Garmin vinculado</b><p class="small muted">${nA ? `${nA} actividades desde el ${desde}` : 'Leyendo tu histórico…'}</p></div></div>`
    : `<div class="stack" style="gap:10px"><p class="small"><b>Cuenta lista.</b> Ahora vincula tu Garmin para que tu entrenador vea tus datos.</p><button class="btn fill" type="button" data-a="garmin-vincular">Vincular Garmin</button></div>`;
  return `${titulo}<div class="card">${tarjeta}</div><span class="spacer"></span><button class="btn ${vinculado ? 'fill' : 'text'} wide" type="button" data-a="ob-next">${vinculado ? 'Seguir' : 'Ahora no'}</button>`;
}

function renderOnboarding() {
  let ob = $('#ob'); if (S.onboarded) { ob && ob.remove(); return; }
  if (!ob) { ob = document.createElement('div'); ob.id = 'ob'; ob.className = 'ob'; app.append(ob); }
  if (COMPROBANDO) { ob.innerHTML = `<span class="card-h">myCoach</span><p class="lead" role="status">${ic('sync', 20, 'spin')} Abriendo tu myCoach…</p>`; return; }
  const st = S.obStep; const steps = `<div class="steps">${[0, 1, 2, 3, 4, 5].map(i => `<i class="${i <= st ? 'on' : ''}"></i>`).join('')}</div>`; let h = '';
  const horas = horasPorDeporte(); const nA = M.acts.length, desde = nA ? fDia(M.acts[nA - 1].f) : '';
  if (st === 0) h = `<span class="card-h">myCoach</span><h1>Tu forma, fácil de entender</h1><p class="lead">Lee tu Garmin y te lo cuenta en claro: tu semana, tu forma y qué hacer, en todos tus deportes.</p><span class="spacer"></span><button class="btn fill wide" type="button" data-a="ob-next">Empezar</button>`;
  if (st === 1 && enWeb()) h = obCuentaWeb(steps, nA, desde);
  else if (st === 1) h = `${steps}<h1>Conecta tu Garmin</h1><p class="lead">Leemos actividades, sueño y readiness. No publicamos nada.</p><div class="card">${S.obConn ? `<div class="row">${ic('check', 28)}<div class="grow"><b>Conectado</b><p class="small muted">${nA ? `${nA} actividades desde el ${desde}` : 'Leyendo tu histórico…'}</p></div></div>` : `<button class="btn fill" type="button" data-a="ob-conn">Conectar con Garmin</button>`}</div><span class="spacer"></span><button class="btn fill wide" type="button" data-a="ob-next" ${S.obConn ? '' : 'disabled'}>Seguir</button>`;
  if (st === 2) h = `${steps}<h1>¿Qué deportes analizo?</h1><p class="lead">He encontrado estos en tu Garmin. La app se adapta: parte común y detalle de cada uno.</p><div class="stack" style="gap:8px">${(Object.keys(horas).length ? '' : (syncing ? '<p class="small muted">Leyendo tus actividades de Garmin… aparecerán aquí en unos segundos. Puedes elegir ya o esperar.</p>' : '<p class="small muted">Aún no he leído tus actividades. Elige a mano o sigue y actualiza luego.</p>'))}${ENTRENABLES.map(k => [k, horas[k] || 0]).map(([k, v]) => `<button type="button" class="choice" aria-pressed="${S.sports.includes(k)}" data-a="ob-sport" data-v="${k}"><span class="ico" style="background:${scol(k)};color:#fff">${ic(SPORTS[k].ic)}</span><span><b>${SPORTS[k].n}</b><span>${nf(v)} h desde el ${desde}</span></span></button>`).join('')}</div><button class="btn fill wide" type="button" data-a="ob-next" ${S.sports.length ? '' : 'disabled'}>Seguir</button>`;
  if (st === 3) h = `${steps}<h1>¿Qué quieres ver primero?</h1><div class="stack" style="gap:10px">${[['semana', 'plan', 'Mi semana', 'Plan, % cumplido y qué toca hoy.'], ['forma', 'forma', 'Mi forma', 'Una nota clara y en qué flojeo.'], ['objetivo', 'target', 'Mi objetivo', 'Si voy en camino.']].map(([v, i, t, s]) => `<button type="button" class="choice" aria-pressed="${S.variant === v}" data-a="ob-var" data-v="${v}"><span class="ico">${ic(i)}</span><span><b>${t}</b><span>${s}</span></span></button>`).join('')}</div><span class="spacer"></span><button class="btn fill wide" type="button" data-a="ob-next">Seguir</button>`;
  if (st === 4) h = `${steps}<h1>¿Usamos IA?</h1><p class="lead">Lo básico funciona sin IA. Con IA, usa tu propia cuenta de Claude: no pagas nada extra a la app.</p><div class="stack" style="gap:10px">${[['claude', 'claude', 'Sí, con mi Claude', 'Chat, fotos de comida y planes afinados. Necesitas Claude con el conector de Garmin.'], ['off', 'check', 'No, solo reglas', 'Plan, balance y avisos funcionan igual.']].map(([v, i, t, s]) => `<button type="button" class="choice" aria-pressed="${S.ai === v}" data-a="ob-ai" data-v="${v}"><span class="ico">${ic(i)}</span><span><b>${t}</b><span>${s}</span></span></button>`).join('')}</div><span class="spacer"></span><button class="btn fill wide" type="button" data-a="ob-next">Seguir</button>`;
  if (st === 5) h = `${steps}<h1>Preparando tu app</h1><ul class="checks" id="ob-checks">${[`Leyendo ${nA} actividades`, 'Clasificando tus días por pulso', `Analizando ${S.sports.length} deportes`, 'Buscando tus pueblos'].map(t => `<li><span class="ck">${ic('check', 16)}</span>${t}</li>`).join('')}</ul><div class="skel" style="height:120px"></div><span class="spacer"></span><button class="btn fill wide" type="button" data-a="ob-done" disabled id="ob-go">Entrar</button>`;
  ob.innerHTML = `<div class="ob-in">${h}</div>`;
  if (st === 5 && !ob.dataset.anim) { ob.dataset.anim = 1; const lis = $$('#ob-checks li', ob); lis.forEach((li, i) => setTimeout(() => li.classList.add('done'), 400 + i * 450)); setTimeout(() => { const b = $('#ob-go'); if (b) b.disabled = false; }, 400 + lis.length * 450); }
  if (st !== 5) delete ob.dataset.anim;
}
const TABSCR = { hoy: tabHoy, plan: tabPlan, forma: tabForma, pueblos: tabPueblos };
const SCREENS = { actividad: scrActividad, test: scrTest, objetivo: scrObjetivo, compartir: scrCompartir, ajustes: scrAjustes, evo: scrEvo, nutri: scrNutri };

/* ===== Panel de prototipo ===== */
const FLOWS = [
  { id: 'primer-uso', t: 'Primer uso con tus deportes', task: 'Configura la app como si fuera la primera vez: deportes, qué ver primero e IA.', setup() { S.onboarded = false; S.obStep = 0; S.obConn = false; } },
  { id: 'semana', t: 'Ver tu semana', task: '¿Cuánto llevas cumplido esta semana y qué te toca hoy?', setup() { S.tab = 'hoy'; S.variant = 'semana'; } },
  { id: 'sync', t: 'Actualizar tras una actividad', task: 'Acabas de volver de una salida: actualiza los datos y mira qué ha cambiado.', setup() { S.simRide = false; S.tab = 'hoy'; } },
  { id: 'ajustar', t: 'Ajustar el día', task: 'Has dormido fatal y tu plan dice fondo largo. Usa "Otro" para decir que sales a correr 45 min suave.', setup() { S.readiness = 39; S.adapt = null; if (!sesion(HOY)) S.plan[HOY] = { dep: 'bici', t: 'fondo', d: 'Fondo largo', min: 180 }; S.tab = 'hoy'; } },
  { id: 'revision', t: 'Revisar una semana pasada', get task() { return `Mira la semana del ${fDia(semanaRevision())}: ¿qué te faltó?`; }, setup() { S.tab = 'plan'; S.week = semanaRevision(); } },
  { id: 'planificar', t: 'Planificar la semana que viene', task: 'Planifica la próxima semana con bici, correr, fuerza y pádel. Luego afínala con Claude.', setup() { S.tab = 'plan'; S.week = PROX; S.next = null; S.nextDraft = null; } },
  { id: 'deportes', t: 'Filtrar por deporte', task: 'En Forma, mira solo la bici; luego bici y skimo juntos.', setup() { S.tab = 'forma'; S.fSport = []; } },
  { id: 'forma', t: 'Ver tu evolución', task: 'Averigua cuándo estuviste más en forma este año.', setup() { S.tab = 'forma'; } },
  { id: 'objetivo', t: 'Objetivo moldeable', task: 'Pon un objetivo de reto para primavera y ajusta a mano las horas.', setup() { S.goal = { modo: 'forma' }; S.tab = 'hoy'; } },
  { id: 'comida', t: 'Registrar una comida', task: 'Registra lo que has comido (con foto si quieres) y mira si cuadra con tu entreno.', setup() { S.tab = 'hoy'; } },
  { id: 'pueblos', t: 'Pueblos por deporte y nivel', task: 'Mira tus pueblos solo de skimo y luego a nivel España.', setup() { S.tab = 'pueblos'; S.pSport = []; S.pLevel = 'ccaa'; } },
  { id: 'ia', t: 'IA sin coste: hacerlo en Claude', task: 'Sin Claude en la app, pide la semana a tu Claude de siempre.', setup() { S.ai = 'claude'; CHAT.fallback = true; }, after() { openClaude(); } },
];
function markFlow(id) { if (!S.flows[id]) { S.flows[id] = 'visto'; save(); syncProgress(); } }
function startFlow(id) { const f = FLOWS.find(x => x.id === id); closeSheet(true); if (id !== 'primer-uso') S.onboarded = true; S.stack = []; f.setup(); S.activeFlow = id; save(); toggleProto(false); vt(() => render(true)); renderTask(); f.after && setTimeout(f.after, 300); }
function renderTask() {
  const el = $('#task'); const f = FLOWS.find(x => x.id === S.activeFlow); if (!f) { el.hidden = true; return; } el.hidden = false;
  el.innerHTML = `<div class="tt"><b>Flujo ${FLOWS.indexOf(f) + 1} · ${esc(f.t)}</b>${esc(f.task)}</div><button type="button" id="task-done">Hecho</button><button type="button" class="x" id="task-close" aria-label="Cerrar tarea">${ic('close', 18)}</button>`;
  $('#task-done').addEventListener('click', () => { S.flows[f.id] = 'hecho'; save(); syncProgress(); toggleProto(true, f.id); });
  $('#task-close').addEventListener('click', () => { S.activeFlow = null; save(); renderTask(); });
}
let noteFeel = null, noteFlow = null;
function screenName() { const scr = S.stack[S.stack.length - 1]; if (!S.onboarded) return 'onboarding-' + S.obStep; return (scr ? scr.s : S.tab) + (sheetState ? ' › ' + sheetState.id : ''); }
function toggleProto(open, flowId) { const p = $('#proto'); const o = open ?? !p.classList.contains('in'); if (o) { noteFlow = flowId || S.activeFlow || null; noteFeel = null; renderProto(); } p.classList.toggle('in', o); p.setAttribute('aria-hidden', String(!o)); }
const pseg = (key, opts, cur) => `<div class="pseg" role="group">${opts.map(([v, l]) => `<button type="button" data-p="${key}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
function renderProto() {
  const fl = noteFlow ? FLOWS.find(f => f.id === noteFlow) : null;
  $('#proto .pb').innerHTML = `<section><h4>Nota ${fl ? `sobre "${esc(fl.t)}"` : 'sobre esta pantalla'}</h4><p class="status" style="margin-bottom:8px">Pantalla: ${esc(screenName())} · ${S.os === 'ios' ? 'iOS' : 'Android'}</p>
      <div class="feel">${[['bien', 'Me sirve'], ['regular', 'Con dudas'], ['mal', 'No me sirve']].map(([v, l]) => `<button type="button" data-p="feel" data-v="${v}" aria-pressed="${noteFeel === v}">${l}</button>`).join('')}</div>
      <label class="vh" for="note-t">Comentario</label><textarea id="note-t" placeholder="Qué cambiarías, qué no entiendes, qué falta…" style="margin-top:8px"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="pbtn" data-p="note-save">Guardar nota</button><span class="status" id="note-st" style="align-self:center"></span></div></section>
    <section><h4>Flujos a validar · ${Object.values(S.flows).filter(v => v === 'hecho').length}/${FLOWS.length}</h4>${FLOWS.map((f, i) => `<div class="flow ${S.flows[f.id] === 'hecho' ? 'done' : ''}"><span class="n">${S.flows[f.id] === 'hecho' ? '✓' : i + 1}</span><span class="t">${esc(f.t)}</span><button type="button" class="pbtn ghost" data-p="flow" data-v="${f.id}">Empezar</button></div>`).join('')}</section>
    <section><h4>Lo primero en Hoy</h4>${pseg('variant', [['semana', 'Semana'], ['forma', 'Forma'], ['objetivo', 'Objetivo']], S.variant)}</section>
    <section><h4>Plataforma</h4>${pseg('os', [['ios', 'iOS 26'], ['android', 'Android M3']], S.os)}</section>
    <section><h4>Tema</h4>${pseg('theme', [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']], S.theme)}</section>
    <section><h4>Vista</h4>${pseg('framed', [[true, 'Marco de móvil'], [false, 'Pantalla completa']], S.framed)}</section>
    <section><h4>Simular</h4><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="pbtn ghost" data-p="sim-ready">Readiness ${S.readiness == null ? 'baja (39)' : 'real'}</button><button type="button" class="pbtn ghost" data-p="sim-ai">IA en la app: ${CHAT.fallback ? 'no' : 'sí'}</button><button type="button" class="pbtn ghost" data-p="reset">Reiniciar prototipo</button></div></section>
    <section><h4>Tus notas (${S.notes.length})</h4>${S.notes.slice(-6).reverse().map(n => `<div class="note">${esc(n.texto || '(sin texto)')}<small>${esc(n.sentimiento)} · ${esc(n.flujo || n.pantalla)}</small></div>`).join('') || '<p class="status">Aún no hay notas.</p>'}${S.notes.length ? '<button type="button" class="pbtn ghost" data-p="copy-notes" style="margin-top:8px">Copiar todas</button>' : ''}</section>
    <section><p class="status" id="proto-status"></p></section>`;
  renderProtoStatus();
}
function renderProtoStatus() { const el = $('#proto-status'); if (!el) return; el.innerHTML = `Garmin en vivo: ${LIVE === undefined ? 'comprobando…' : LIVE ? (S.liveOk ? 'sí, conectado' : 'disponible') : 'no (modo demo)'}.<br>Claude en la app: ${SAMPLE === undefined ? 'comprobando…' : claudeReal() ? 'sí (tu cuenta)' : 'no, modo ejemplo'}.<br>Notas: ${DB === undefined ? 'comprobando…' : DB ? 'se guardan para que Claude las lea' : 'solo en este navegador'}.<br>Hoy = ${fLarga(HOY)}. ${M.fuente === 'vivo' ? 'Datos en vivo de tu Garmin' + (M.sincro ? ` (leídos ${new Date(M.sincro).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })})` : ' (aún sin leer)') : 'Modo demo: instantánea de ejemplo'}. Lo marcado como "simulado" es inventado.`; }
async function saveNote() {
  const t = $('#note-t').value.trim(); const st = $('#note-st'); if (!t && !noteFeel) { st.textContent = 'Escribe algo o valora.'; return; }
  const n = { v: 2, pantalla: screenName(), flujo: noteFlow || '', variante: S.variant, os: S.os, sentimiento: noteFeel || '', texto: t, creada: new Date().toISOString() };
  S.notes.push(n); save(); let ok = false; if (DB) { try { await DB.collection('notas').add(n); ok = true; } catch (e) { } }
  st.textContent = ok ? 'Guardada. Claude la leerá.' : 'Guardada en este navegador.'; $('#note-t').value = ''; noteFeel = null; setTimeout(renderProto, 900);
}
let progTimer; function syncProgress() { if (!DB) return; clearTimeout(progTimer); progTimer = setTimeout(() => { DB.doc('validacion/progreso-v2').set({ flujos: S.flows, actualizado: new Date().toISOString() }).catch(() => { }); }, 1500); }
$('#proto').addEventListener('click', e => {
  const b = e.target.closest('[data-p]'); if (!b) return; const p = b.dataset.p, v = b.dataset.v;
  if (p === 'feel') { noteFeel = v; $$('#proto .feel button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === v))); return; }
  if (p === 'note-save') return saveNote(); if (p === 'flow') return startFlow(v);
  if (['variant', 'os', 'theme'].includes(p)) { S[p] = v; save(); render(); renderProto(); return; }
  if (p === 'framed') { S.framed = v === 'true'; save(); render(); renderProto(); return; }
  if (p === 'sim-ready') { S.readiness = S.readiness == null ? 39 : null; S.adapt = null; save(); render(); renderProto(); return; }
  if (p === 'sim-ai') { CHAT.fallback = !CHAT.fallback; renderProto(); return; }
  if (p === 'reset') { const keep = { notes: S.notes, flows: S.flows, os: S.os, framed: S.framed, modo: S.modo }; S = Object.assign(DEFAULTS(), keep); cargarModo(); save(); CHAT.turns = []; CHAT.pending = null; closeSheet(true); render(true); renderTask(); renderProto(); return; }
  if (p === 'copy-notes') navigator.clipboard?.writeText(S.notes.map(n => `- [${n.sentimiento || '-'}] ${n.flujo || n.pantalla}: ${n.texto}`).join('\n')).then(() => { b.textContent = 'Copiadas'; }, () => { b.textContent = 'No se pudo copiar'; });
});
$('#proto-fab').addEventListener('click', () => toggleProto());
$('#proto-close').addEventListener('click', () => toggleProto(false));

/* ===== Arranque ===== */
/* Carga el dataset según el modo: vivo = caché local (y luego Garmin); demo = instantánea incluida */
function cargarModo() {
  if (S.modo === 'demo') { setHoy(DEMO.hoy); construir(DEMO); if (!Object.keys(S.plan).length) demoSeed(); }
  else { setHoy(HOY_REAL); const c = cargarCache(); construir(c && c.fuente === 'vivo' ? c : { fuente: 'vivo', perfil: {}, acts: [], det: {}, rutas: {}, evo: [], geo: {} }); if (S.meals.some(m => m.sim)) { S.meals = []; S.plan = {}; } }
}
/* Base de datos: si este navegador no tiene nada, recupera tus datos y tu estado de la última vez */
/* forzar: lo del servidor manda (p. ej. tras un conflicto: tu Claude cambió el plan mientras la app estaba abierta) */
async function cargarDeDB(forzar) {
  try {
    if (S.modo === 'vivo' && (!DSET || !DSET.acts.length)) { const [d, r] = await Promise.all([DB.doc('vivo/datos').get(), DB.doc('vivo/rutas').get()]); const dd = d && (d.data ?? d); if (dd && dd.acts && dd.acts.length) { const ds = { ...dd, rutas: ((r && (r.data ?? r)) || {}).rutas || {} }; construir(ds); try { localStorage.setItem('trazo-vivo', JSON.stringify(ds)); } catch (e) { } } }
    const e = await DB.doc('estado/app').get(); const st = e && (e.data ?? e);
    if (st && S.modo === 'vivo' && (forzar || (st.at || 0) > (S.savedAt || 0))) { for (const k of ['plan', 'next', 'meals', 'goal', 'sports', 'overrides', 'testRes', 'nombre']) if (st[k] !== undefined) S[k] = st[k]; S.sports = (S.sports || []).filter(k => ENTRENABLES.includes(k)); S.savedAt = st.at; }
    // La versión que la app ha visto: con ella guarda, y si otro ha escrito después, el conector no deja pisarlo.
    if (st && typeof st.at === 'number') S.serverAt = st.at;
    try { localStorage.setItem('trazo-v3', JSON.stringify(S)); } catch (x) { }
    render();
  } catch (e) { }
}
/* Semana a revisar: la última semana pasada con actividades */
function semanaRevision() { const past = acts().filter(a => a.f < SEM).map(a => weekOf(a.f)).sort(); return past.length ? past[past.length - 1] : addDays(SEM, -7); }
