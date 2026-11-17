/* ===== v2 · Insights: ¿dónde estoy y cómo voy? =====
   General pasa de una página con todas las gráficas a un resumen de teselas: cada una, su nombre en llano,
   la cifra, la tendencia dibujada y dicha. Tocar una abre su pantalla: la gráfica entera, qué es y cómo se mejora.
   Las pestañas por deporte siguen como en la v1 (con el estilo nuevo): ya tienen su propio orden. */

/* Lo que se sabe de cada métrica. "que" y "como" son las dos frases de su pantalla. */
const METS_V2 = {
  es: { n: 'Fondo', sub: 'Endurance Score de Garmin', fmt: v => nf(v, 0), u: 'puntos', refs: [{ v: 5800, t: 'Entrenado' }, { v: 6600, t: 'Muy entrenado' }, { v: 7300, t: 'Experto' }],
    que: 'Cuánto aguantas un esfuerzo largo. Lo calcula Garmin con todas tus actividades de resistencia, de cualquier deporte. Sus niveles: Entrenado desde 5.800, Muy entrenado desde 6.600 y Experto desde 7.300.',
    como: 'Salidas largas y suaves con regularidad. Baja si pasas semanas sin ellas.' },
  vo2: { n: 'Motor', sub: 'VO2máx', fmt: v => nf(v, 1), u: 'ml/kg/min',
    que: 'El oxígeno que tu cuerpo puede usar por minuto y kilo: el tamaño de tu motor. Garmin lo estima en carreras con pulso y GPS.',
    como: 'Constancia y algo de intensidad cada semana. Sube despacio: un punto en unos meses ya es mucho.' },
  vo2b: { n: 'Motor en bici', sub: 'VO2máx en bici', fmt: v => nf(v, 1), u: 'ml/kg/min',
    que: 'El VO2máx que estima Garmin en bici. Necesita potenciómetro.', como: 'Lo mismo que el motor: constancia y algo de intensidad cada semana.' },
  hill: { n: 'Cuestas', sub: 'Hill Score de Garmin', fmt: v => nf(v, 0), u: 'puntos',
    que: 'Fuerza y resistencia subiendo. Lo calcula Garmin con tus carreras y caminatas en cuesta; la bici no cuenta.',
    como: 'Cuestas a pie: repeticiones cortas para la fuerza y subidas largas para la resistencia.' },
};
function spark(vals) {
  const v = vals.filter(x => x != null); if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), n = v.length, Y = x => 22 - (hi === lo ? .5 : (x - lo) / (hi - lo)) * 18;
  return `<svg class="spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><polyline points="${v.map((x, i) => `${(i / (n - 1) * 100).toFixed(1)},${Y(x).toFixed(1)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
/* Tendencia en el periodo, dicha con una palabra. Subir es bueno en las de forma; bajar no se pinta de malo. */
function tend(pts, bueno = true) {
  if (pts.length < 2) return { txt: '', cls: '' }; const a = pts[0].v, b = pts[pts.length - 1].v, d = (b - a) / (Math.abs(a) || 1);
  return d > .01 ? { txt: '↑ Sube', cls: bueno ? 'good' : '' } : d < -.01 ? { txt: '↓ Baja', cls: '' } : { txt: '= Estable', cls: '' };
}
const tesela = (id, nombre, cifra, sparkHtml, tr, aria) => `<button class="tes" type="button" data-a="push" data-v="metrica" data-id="${id}" aria-label="${esc(aria || nombre)}. Ver el detalle"><span class="n">${nombre}</span><span class="cifra">${cifra}</span>${sparkHtml || ''}${tr && tr.txt ? `<span class="tnd ${tr.cls || ''}">${tr.txt}</span>` : ''}</button>`;
const teselaVacia = (id, nombre, texto) => `<button class="tes vacia" type="button" data-a="push" data-v="metrica" data-id="${id}"><span class="n">${nombre}</span><span class="cifra">${texto}</span></button>`;

function frescuraV2() {
  const c = coachHoy(), f = c && (c.forma || (c.demo ? { forma_ctl: 48, fatiga_atl: 56, frescura_tsb: -8 } : null)), tsb = f && f.frescura_tsb != null ? Math.round(f.frescura_tsb) : null;
  const zona = tsb == null ? null : tsb < -30 ? ['bad', '!', 'Muy cargado', 'Llevas mucha carga: unos días suaves te harán bien.'] : tsb < -10 ? ['good', '↑', 'Cargado, ganando forma', 'Entrenas lo suficiente para mejorar. Cargado no quiere decir fresco: antes de una prueba, toca bajar.'] : tsb <= 10 ? ['neutral', '=', 'En equilibrio', 'Ni cargado ni fresco: buena base para meter una semana fuerte.'] : ['good', '✓', 'Fresco', 'Llegas descansado: buen momento para una prueba o una salida exigente.'];
  return { f, tsb, zona };
}
function resumenGeneral() {
  const desde = insDesde(), nota = forma(), out = [];
  if (nota != null) { const d = dims(), mejor = ESC_KEYS.map(k => d[k]).filter(x => x.v != null).sort((a, b) => b.v - a.v);
    out.push(`<button class="tap-card" type="button" data-a="push" data-v="metrica" data-id="forma" style="grid-column:1/-1" aria-label="Tu forma: ${nf(nota, 1)} sobre 10. Ver el detalle"><span class="cab"><span>Tu forma</span>${ic('chev', 18)}</span>
      <span class="cifra xl">${nf(nota, 1)}<small>sobre 10</small></span>${mejor.length > 1 ? `<span>Tu punto fuerte: ${esc(mejor[0].n.toLowerCase())}. Con más margen: ${esc(mejor[mejor.length - 1].n.toLowerCase())}.</span>` : ''}</button>`); }
  for (const k of ['es', 'vo2', 'vo2b', 'hill']) { const m = METS_V2[k], todo = serieGarmin(k); if (!todo.length) { if (k !== 'vo2b') out.push(teselaVacia(k, m.n, 'Aún sin datos')); continue; }
    const pts = todo.filter(p => p.f >= desde), ps = pts.length >= 2 ? pts : todo.slice(-2), ult = todo[todo.length - 1];
    // Con qué se mide, debajo del nombre, y la unidad junto a la cifra: "Fondo 6283" a secas no decía de qué.
    const sub = String(m.sub || '').replace(/ de Garmin$/, ''), u = m.u === 'puntos' ? '<small>puntos</small>' : '';
    out.push(tesela(k, `${m.n}${sub ? `<i class="tes-sub">${esc(sub)}</i>` : ''}`, m.fmt(ult.v) + u, spark(ps.map(p => p.v)), tend(ps), `${m.n} (${sub}): ${m.fmt(ult.v)} ${m.u || ''}`)); }
  { const dias = insDias(), nSem = Math.min(52, Math.ceil(dias / 7)), sems = Array.from({ length: nSem }, (_, i) => addDays(SEM, (i - nSem + 1) * 7));
    const hs = sems.map(w => Object.values(((M.weeks || []).find(x => x[0] === w) || [w, {}])[1]).reduce((a, b) => a + (b || 0), 0) / 60), media = hs.reduce((a, b) => a + b, 0) / nSem;
    out.push(hs.some(Boolean) ? tesela('horas', 'Horas por semana', `${nf(media, 1)}<small>h</small>`, spark(hs), null, `Horas por semana: ${nf(media, 1)} de media`) : teselaVacia('horas', 'Horas por semana', 'Aún sin actividades')); }
  if (S.verPeso !== false) { if (PZ.datos !== undefined && PZ.datos !== 'cargando' && fuenteDatos() !== 'espera' && PZ.fuente !== fuenteDatos()) PZ.datos = undefined; if (PZ.datos === undefined) cargarPeso();
    const d = PZ.datos, r = d && typeof d === 'object' && d.resumen;
    if (r && d.pesajes?.length) { const ps = d.pesajes.filter(p => p.fecha >= desde), kg = r.media_7_dias || r.ultimo.kg, c = r.cambio_90_dias ?? r.cambio_30_dias;
      out.push(tesela('peso', 'Peso', `${nf(kg, 1)}<small>kg</small>`, spark((ps.length >= 2 ? ps : d.pesajes.slice(-2)).map(p => p.kg)), c != null ? { txt: `${c > 0 ? '↑ +' : c < 0 ? '↓ −' : '= '}${nf(Math.abs(c), 1)} kg`, cls: '' } : null, `Peso: ${nf(kg, 1)} kg`)); }
    else out.push(teselaVacia('peso', 'Peso', d === undefined || d === 'cargando' ? 'Leyendo…' : 'Aún sin pesajes')); }
  { const { tsb, zona } = frescuraV2();
    out.push(tsb == null ? teselaVacia('frescura', 'Frescura', 'Aún sin datos') : tesela('frescura', 'Frescura', esc(zona[2]).replace(', ', ',<br>'), '', { txt: `${tsb > 0 ? '+' : tsb < 0 ? '−' : ''}${Math.abs(tsb)}`, cls: '' }, `Frescura: ${zona[2]}`).replace('class="cifra"', 'class="cifra" style="font-size:22px;line-height:1.1"')); }
  { const g = cargaGarmin(), cg = g && g.carga;
    if (cg && cg.aguda_7d != null && Array.isArray(cg.franja_optima_cronica)) { const [lo, hi] = cg.franja_optima_cronica, v = cg.aguda_7d;
      out.push(tesela('carga', 'Carga de 7 días<i class="tes-sub">La de Garmin</i>', `${Math.round(v)}<small>puntos</small>`, '', v > hi ? { txt: '! Por encima de tu franja', cls: 'warn' } : v < lo ? { txt: '↓ Por debajo de tu franja', cls: '' } : { txt: '✓ En tu franja', cls: 'good' }, `Carga de 7 días: ${Math.round(v)}`)); } }
  return `<div class="teselas">${out.join('')}</div>
    ${grupo2(fila2('Medidas', 'Pecho, cintura, cadera y brazos', 'data-a="push" data-v="metrica" data-id="medidas"') + fila2('Umbrales y predicciones', 'Lo que Garmin calcula de ti', 'data-a="push" data-v="numeros"'))}`;
}
function tabProgresoV2() {
  const d365 = addDays(HOY, -365), deps = DEP_PROG.filter(d => S.sports.includes(d) || acts().some(a => a.dep === d && a.f > d365));
  if (acts().some(a => a.rod && a.f > d365)) deps.splice(deps.includes('bici') ? deps.indexOf('bici') + 1 : 0, 0, 'rodillo');
  if (!V.prog || (V.prog !== 'forma' && !deps.includes(V.prog))) V.prog = 'forma';
  const segs = [['forma', 'General'], ...deps.map(d => [d, d === 'rodillo' ? 'Rodillo' : SPORTS[d].n])], rg = String(insDias());
  const per = `<label class="ins-per" for="ins-per"><span class="vh">Periodo</span><select id="ins-per" aria-label="Periodo">${RANGOS_INS.map(([v, l]) => `<option value="${v}"${rg === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
  return { title: 'Insights', html: `<div class="v2 ${V.prog === 'forma' ? '' : 'ins-dep'}">${cab2('Insights', '', per)}
    ${segs.length > 1 ? `<div class="seg-row ins-ctl" style="padding:0"><div class="seg2" role="group" aria-label="Qué ver">${segs.map(([k, l]) => `<button type="button" data-a="v-prog" data-v="${k}" aria-pressed="${V.prog === k}">${l}</button>`).join('')}</div></div>` : ''}
    ${V.prog === 'forma' ? resumenGeneral() : `<div class="v1" style="padding:0">${V.prog === 'rodillo' ? progRodillo() : progDep(V.prog)}</div>`}</div>` };
}
tabV2('progreso', tabProgresoV2);

/* La pantalla de una métrica: la cifra, la gráfica del periodo, qué es y cómo se mejora */
function scrMetrica(scr) {
  const k = scr.id, desde = insDesde(), dias = insDias(), rg = String(dias);
  const per = `<div class="seg2" role="group" aria-label="Periodo">${RANGOS_INS.map(([v, l]) => `<button type="button" data-a="v2-per" data-v="${v}" aria-pressed="${rg === v}">${l}</button>`).join('')}</div>`;
  const que = (q, c) => `<section class="card">${q ? `<div class="que"><h3>Qué es</h3><p>${q}</p></div>` : ''}${c ? `<div class="que"><h3>Cómo se mejora</h3><p>${c}</p></div>` : ''}</section>`;
  const m = METS_V2[k];
  if (m) { const todo = serieGarmin(k), pts = todo.filter(p => p.f >= desde), ult = todo[todo.length - 1], prim = pts[0], ps = pts.length >= 2 ? pts : todo.slice(-2), t = tend(ps);
    return { title: m.n, html: `<div class="v2">${cab2(m.n, m.sub)}
      ${ult ? `<div style="padding:0 4px;display:flex;flex-direction:column;gap:8px;align-items:flex-start"><span class="cifra xl">${m.fmt(ult.v)}<small>${m.u}</small></span>${t.txt ? tag(t.cls || 'neutral', t.txt[0], t.txt.slice(2)) : ''}</div>${per}
        <section class="card">${ps.length >= 2 ? vSerie({ pts: ps.map(p => ({ ...p, tip: `${fDia(p.f)}: ${m.fmt(p.v)}` })), desde: pts.length >= 2 ? desde : ps[0].f, modo: 'linea', h: 190, fmt: m.fmt, refs: m.refs || [], u: m.u, aria: `${m.n} en ${INS_TXT[dias]}` }) : ''}
          <p class="lee">${pts.length >= 2 && prim !== ult ? `${m.fmt(prim.v)} el ${fDia(prim.f)}; ${m.fmt(ult.v)} ahora.` : `${m.fmt(ult.v)} el ${fDia(ult.f)}.`}</p></section>`
        : `<section class="card"><b>Aún no hay datos</b><p class="small muted">${k === 'vo2' ? 'Garmin calcula el VO2máx en carreras con pulso y GPS de al menos 10 minutos.' : 'Garmin necesita unas semanas de actividades con pulso para calcularlo.'}</p></section>`}
      ${que(m.que, m.como)}</div>` }; }
  const simple = (titulo, sub, cuerpo, q, c, conPer = true) => ({ title: titulo, html: `<div class="v2">${cab2(titulo, sub)}${conPer ? per : ''}<div class="v1" style="padding:0">${cuerpo}</div>${q || c ? que(q, c) : ''}</div>` });
  if (k === 'forma') return simple('Tu forma', 'Cuatro notas de 1 a 10', dondeEstas(), 'Cada nota te compara con otra gente: 5 es un aficionado medio de tu edad y 7, uno fuerte. Salen de lo que mide Garmin y de tus actividades.', 'Toca ⓘ en cada fila para ver de dónde sale esa nota y qué la sube.', false);
  if (k === 'horas') return simple('Horas por semana', 'Todos los deportes', horasDeportes() || '<section class="blk"><p class="muted">Aún no hay actividades en este periodo.</p></section>', 'Todo lo que haces cuenta como carga, también lo que no se planifica (pádel, montaña, fuerza).', 'Súbelas poco a poco y deja de vez en cuando una semana más suave. Tu entrenador te avisa si subes demasiado rápido.');
  if (k === 'peso') return simple('Peso', 'La media de 7 días es la que cuenta', bloquePeso(desde), 'El peso de un día sube y baja con el agua y la comida; por eso se mira la media de 7 días. Sale de tu báscula o de lo que apuntas.', '');
  if (k === 'medidas') return simple('Medidas', 'Viven en myCoach: Garmin no las guarda', bloqueMedidas(desde), '', '');
  if (k === 'carga') return simple('Tu carga', 'Según Garmin', progCarga() || '<section class="blk"><p class="muted">Aún no tengo tu carga de Garmin.</p></section>', 'Cada actividad suma su carga. La de los últimos 7 días se compara con una franja que sale de lo que vienes haciendo en 4 semanas: por debajo pierdes forma, por encima te arriesgas.', '', false);
  if (k === 'frescura') { const { f, tsb, zona } = frescuraV2();
    return simple('Frescura', 'Cómo llegas', tsb == null ? '<section class="blk"><p class="muted">Aún no tengo tu frescura: la calcula el entrenador con tus actividades.</p></section>'
      : `<section class="blk"><p><span class="cifra xl">${tsb > 0 ? '+' : tsb < 0 ? '−' : ''}${Math.abs(tsb)}</span> ${tag(zona[0], zona[1], zona[2])}</p><p style="margin-top:8px">${zona[3]}</p><div style="margin-top:12px">${escalaFrescura(tsb)}</div><p class="xs muted" style="margin-top:8px">${Math.round(f.forma_ctl)} de forma menos ${Math.round(f.fatiga_atl)} de fatiga.</p></section>`,
      'Tu forma (la carga media de las últimas 6 semanas) menos tu fatiga (la de los últimos 7 días). La carga de cada actividad sale de su pulso y su duración. Más negativo, más cargado.', '', false); }
  return { title: 'Insights', html: `<div class="v2">${cab2('Insights')}<p>No encuentro esta métrica. Vuelve a Insights.</p></div>` };
}
scrV2('metrica', scrMetrica);
Object.assign(ACTIONS, { 'v2-per': el => { S.insRango = el.dataset.v; save(); render(); $(`[data-a="v2-per"][data-v="${el.dataset.v}"]`)?.focus(); } });
