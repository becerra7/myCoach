/* myCoach · prototipo v1. Vanilla JS, sin dependencias. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = (n, d = 0) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dte = f => new Date(f + 'T12:00:00');
const fLarga = f => { const d = dte(f); return `${DIAS_L[d.getDay()][0].toUpperCase() + DIAS_L[d.getDay()].slice(1)} ${d.getDate()} de ${MESES[d.getMonth()]}`; };
const DEP = { bici: 'Bici', correr: 'Correr', skimo: 'Skimo', fuerza: 'Fuerza' };
const col = dep => dep ? `var(--${dep})` : 'var(--descanso)';

const ST = { tab: 'hoy', prog: 'bici', pueblos: 'año', pesoR: '3m', sesion: { ...ESTADO.sesion }, aplicada: { ...ESTADO.sesion } };

const ICO = {
  hoy: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  plan: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  comer: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 3c-2 0-3 3-3 6s1 4 3 4v8"/>',
  progreso: '<path d="M3 20h18M6 16l4-5 3 3 5-7"/>',
  pueblos: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>',
};
const ic = (k, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg>`;
const TABS = [['hoy', 'Hoy'], ['plan', 'Plan'], ['comer', 'Comer'], ['progreso', 'Progreso'], ['pueblos', 'Pueblos']];

/* ===== Gráficas SVG (una sola escala por gráfica; tooltip con data-tip) ===== */
const W = 340;
function ejeY(y0, y1, ticks, h, pad, fmt = v => v) {
  return ticks.map(t => { const y = pad.t + (1 - (t - y0) / (y1 - y0)) * (h - pad.t - pad.b);
    return `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${fmt(t)}</text>`; }).join('');
}
function barras({ datos, y0 = 0, y1, ticks, refs = [], h = 180, color = () => 'var(--bici)', tip, fmt, labelEvery = 1, aria, etiqueta }) {
  const pad = { t: 10, r: 6, b: 24, l: 32 }, n = datos.length, bw = (W - pad.l - pad.r) / n, gap = Math.max(2, bw * .28);
  const Y = v => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b), base = Y(Math.max(y0, 0));
  const bars = datos.map((d, i) => { const x = pad.l + i * bw + gap / 2, w = bw - gap, y = Y(d[1]), hh = Math.max(1, base - y);
    return `<g data-tip="${esc(tip(d))}"><rect class="hit" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${h - pad.t - pad.b}"/>
      <path class="mk" d="M${x},${base}V${y + 3}q0,-3 3,-3h${w - 6}q3,0 3,3V${base}z" fill="${color(d, i)}"/></g>
      ${i % labelEvery === 0 ? `<text x="${x + w / 2}" y="${h - 8}" text-anchor="middle">${esc(d[0])}</text>` : ''}
      ${etiqueta && etiqueta(d, i) ? `<text class="lbl" x="${x + w / 2}" y="${y - 5}" text-anchor="middle">${etiqueta(d, i)}</text>` : ''}`; }).join('');
  const rf = refs.map(r => `<line class="${r.cls || 'ref'}" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(r.v)}" y2="${Y(r.v)}"/><text x="${W - pad.r}" y="${Y(r.v) - 4}" text-anchor="end" class="lbl">${esc(r.t)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(aria)}">${ejeY(y0, y1, ticks, h, pad, fmt)}${bars}${rf}</svg>`;
}
function puntos({ datos, x0, x1, y0, y1, xt, yt, h = 220, xl, yl, r = () => 6, fill, tip, aria, etiquetas = [] }) {
  const pad = { t: 12, r: 10, b: 38, l: 36 };
  const X = v => pad.l + (v - x0) / (x1 - x0) * (W - pad.l - pad.r), Y = v => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b);
  const gx = xt.map(t => `<line class="grid" x1="${X(t)}" x2="${X(t)}" y1="${pad.t}" y2="${h - pad.b}"/><text x="${X(t)}" y="${h - pad.b + 14}" text-anchor="middle">${t}</text>`).join('');
  const pts = datos.map((d, i) => `<g data-tip="${esc(tip(d))}"><circle class="hit" cx="${X(d[1])}" cy="${Y(d[2])}" r="14"/><circle class="mk" cx="${X(d[1])}" cy="${Y(d[2])}" r="${r(d)}" fill="${fill(d, i)}" stroke="var(--paper)" stroke-width="2"/></g>`).join('');
  const lb = etiquetas.map(i => { const d = datos[i]; return `<text class="lbl" x="${X(d[1]) + r(d) + 4}" y="${Y(d[2]) + 4}">${esc(d[0])}</text>`; }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(aria)}">${ejeY(y0, y1, yt, h, pad, v => nf(v, Number.isInteger(v) ? 0 : 1))}${gx}
    <text x="${(pad.l + W - pad.r) / 2}" y="${h - 4}" text-anchor="middle">${esc(xl)}</text>
    <text transform="translate(10 ${(pad.t + h - pad.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yl)}</text>${pts}${lb}</svg>`;
}
function linea({ serie, y0, y1, ticks, h = 180, pts = [], bandas = [], aria, xlabels = [], tipPts, fmt }) {
  const pad = { t: 10, r: 8, b: 24, l: 32 }, n = serie.length;
  const X = i => pad.l + i / (n - 1) * (W - pad.l - pad.r), Y = v => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b);
  const bd = bandas.map(b => `<rect x="${pad.l}" width="${W - pad.l - pad.r}" y="${Y(b.hi)}" height="${Y(b.lo) - Y(b.hi)}" fill="${b.c}"/><text x="${pad.l + 6}" y="${Y(b.hi) + 13}" class="lbl">${esc(b.t)}</text>`).join('');
  const d = serie.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const p = pts.map(([i, v, t]) => `<g data-tip="${esc(t)}"><circle class="hit" cx="${X(i)}" cy="${Y(v)}" r="12"/><circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="var(--paper)" stroke="var(--ink-2)" stroke-width="1.5"/></g>`).join('');
  const xl = xlabels.map(([i, t]) => `<text x="${X(i)}" y="${h - 8}" text-anchor="middle">${esc(t)}</text>`).join('');
  const last = serie.length - 1;
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(aria)}">${bd}${ejeY(y0, y1, ticks, h, pad, fmt)}${xl}${p}
    <path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${X(last)}" cy="${Y(serie[last])}" r="5" fill="var(--ink)" stroke="var(--paper)" stroke-width="2"/></svg>`;
}

/* ===== Hoy ===== */
const CARGA = (min, int) => Math.min(98, Math.round(min / 240 * 70 + ({ suave: 4, moderado: 18, fuerte: 32 }[int])));
function franjaHtml() {
  const [a, b] = ESTADO.franja, s = ST.sesion, ap = ST.aplicada, c = CARGA(s.min, s.int || s.intensidad), c0 = CARGA(ap.min, ap.intensidad);
  const entra = c >= a && c <= b, cambiado = s.min !== ap.min || s.intensidad !== ap.intensidad;
  const ver = entra ? '<span class="tag good"><i>✓</i>Entra en lo que te pide hoy el cuerpo</span>'
    : c > b ? '<span class="tag warn"><i>!</i>Se pasa: hoy te conviene menos</span>' : '<span class="tag neutral"><i>·</i>Se queda corto, pero es válido</span>';
  return `<section class="blk franja" aria-labelledby="fr-t">
    <div class="blk-h"><h2 id="fr-t">Carga de hoy</h2></div>
    <p class="small muted">La zona marcada es lo que tu estado aguanta hoy. La raya negra es tu sesión.</p>
    <div class="fr-bar" role="img" aria-label="Carga de la sesión ${c} sobre 100; tu zona de hoy va de ${a} a ${b}">
      <div class="fr-rail"></div><div class="fr-ok" style="left:${a}%;width:${b - a}%"></div>
      ${cambiado ? `<div class="fr-mark antes" style="left:${c0}%" title="Antes"></div>` : ''}
      <div class="fr-mark" style="left:${c}%"></div></div>
    <div class="fr-esc" aria-hidden="true"><span>Descanso</span><span>Suave</span><span>Moderado</span><span>Duro</span></div>
    <div class="fr-ctl">
      <div class="step"><button type="button" data-a="min" data-v="-15" aria-label="Quitar 15 minutos">−</button><b class="num" aria-live="polite">${s.min} min</b><button type="button" data-a="min" data-v="15" aria-label="Añadir 15 minutos">+</button></div>
      <div class="seg" role="group" aria-label="Intensidad">${['suave', 'moderado', 'fuerte'].map(k => `<button type="button" data-a="int" data-v="${k}" aria-pressed="${s.intensidad === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    </div>
    <p class="fr-veredicto">${ver}</p>
    ${cambiado ? `<p class="small muted" style="margin-top:6px">Antes: ${ap.min} min ${ap.intensidad}. Ahora: ${s.min} min ${s.intensidad}.</p>
      <div class="btns" style="margin-top:12px"><button class="btn fill" type="button" data-a="aplicar">Aplicar el cambio</button><button class="link" type="button" data-a="deshacer">Dejarlo como estaba</button></div>` : ''}
  </section>`;
}
function metricasHtml() {
  return `<section class="blk" aria-labelledby="met-t"><div class="blk-h"><h2 id="met-t">Tus datos de esta noche</h2><span class="xs muted">Garmin, 07:12</span></div>
    <div class="mets">${ESTADO.metricas.map(m => `<button class="met" type="button" data-a="met" data-v="${m.id}" aria-label="${m.n}: ${m.v}${m.u ? ' ' + m.u : ''}, ${m.palabra}. Ver qué es">
      <span class="n">${m.n}</span><b class="v num">${m.v}${m.u ? `<small>${m.u}</small>` : ''}</b>
      <span class="trk" aria-hidden="true"><span class="nb" style="left:${m.normal[0] * 100}%;width:${(m.normal[1] - m.normal[0]) * 100}%"></span><span class="dot" style="left:${m.pos * 100}%"></span></span>
      <span class="tag ${m.tono}"><i>${m.tono === 'good' ? '↑' : m.tono === 'warn' ? '!' : '='}</i>${m.palabra}</span></button>`).join('')}</div>
    <p class="xs muted" style="margin-top:8px">La franja gris es tu normal de las últimas 4 semanas; el punto, hoy.</p></section>`;
}
function macroFila(n, m, unidad = 'g') {
  const max = m.max * 1.15, falta = m.min - m.llevas;
  return `<span class="small" style="font-weight:650">${n}</span>
    <span class="mb" role="img" aria-label="${n}: llevas ${m.llevas} ${unidad}; objetivo de ${m.min} a ${m.max}"><span class="zona" style="left:${m.min / max * 100}%;width:${(m.max - m.min) / max * 100}%"></span><span class="ya" style="width:${Math.min(100, m.llevas / max * 100)}%"></span></span>
    <span class="small num" style="font-size:16px">${falta > 0 ? `faltan ${falta} g` : 'en objetivo'}</span>`;
}
function diaHtml(compacto) {
  return `<section class="blk" aria-labelledby="dia-t"><div class="blk-h"><h2 id="dia-t">Tu día</h2>${compacto ? '<button class="link" type="button" data-a="tab" data-v="comer">Ver Comer</button>' : ''}</div>
    <div class="macro">${macroFila('Hidrato', COMER_HOY.hidrato)}${macroFila('Proteína', COMER_HOY.proteina)}</div>
    <ol class="dia">${COMER_HOY.comidas.map(c => c.tipo === 'entreno'
      ? `<li><span class="h">${c.h}</span><span class="eje"><i class="dep"></i></span><div class="c"><b>${esc(ESTADO.decision)}</b><div class="small muted">${esc(COMER_HOY.durante)}</div></div></li>`
      : `<li><span class="h">${c.h}</span><span class="eje"><i class="${c.hecha ? 'ok' : ''}"></i></span><div class="c"><b>${c.tipo}</b><span class="nivel">Hidrato ${c.nivel.toLowerCase()}</span>
        <div class="small ${c.hecha ? '' : 'muted'}">${c.hecha ? `✓ ${esc(c.hecha)}, ${c.g} g de hidrato` : `Idea: ${esc(c.idea)}`}</div></div></li>`).join('')}</ol>
    <p class="xs muted">Objetivos estimados según la sesión de hoy y tu peso.</p></section>`;
}
function semanaHtml() {
  return `<section class="blk" aria-labelledby="sem-t"><div class="blk-h"><h2 id="sem-t">Esta semana</h2><button class="link" type="button" data-a="tab" data-v="plan">Ver el plan</button></div>
    <div class="sem7">${SEMANA.map(d => { const x = dte(d.f), cls = d.estado === 'Hoy' ? 'hoy pend' : d.estado === 'Más corto' ? 'cambio' : '';
      return `<button class="d7 ${cls}" type="button" style="--c:${col(d.dep)}" data-a="dia" data-v="${d.f}" aria-label="${fLarga(d.f)}: ${esc(d.t)}, ${d.estado}">
        <small>${DIAS[x.getDay()]}</small><b class="num">${x.getDate()}</b><em>${{ Hecho: '✓', Descansado: 'Libre', 'Más corto': 'Corto', Hoy: 'Hoy' }[d.estado] || d.estado}</em></button>`; }).join('')}</div>
    <p class="xs muted" style="margin-top:8px">Franja llena: hecho. Rayada: cambiado. Hueca: pendiente.</p></section>`;
}
function tabHoy() {
  const tono = { verde: ['good', '✓', 'Verde'], ambar: ['warn', '!', 'Ámbar'], rojo: ['bad', '✕', 'Rojo'] }[ESTADO.color];
  return `<div class="cols"><div class="col">
    <section class="decision" aria-labelledby="dec-t">
      <p class="fecha">${fLarga(HOY)}<span class="demo">Datos de ejemplo</span></p>
      <h1 id="dec-t">${esc(ESTADO.decision)}</h1>
      <p class="tag ${tono[0]}"><i>${tono[1]}</i>${tono[2]}: adelante con el plan</p>
      <p class="porque" style="margin-top:10px">${esc(ESTADO.porque)}</p>
      <div class="ruta-l"><svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true"><path d="M2 18 C8 18 10 8 16 9 S26 18 30 13 38 6 38 6" fill="none" stroke="var(--bici)" stroke-width="2.5" stroke-linecap="round"/></svg>
        <div><b>${esc(ESTADO.ruta.nombre)}</b>, <span class="num">${ESTADO.ruta.km} km</span> y <span class="num">${ESTADO.ruta.desn} m</span><div class="small muted">${esc(ESTADO.ruta.nota)}</div></div></div>
      <div class="btns" style="margin-top:16px"><button class="btn fill" type="button" data-a="reloj">Enviar al reloj</button><button class="link" type="button" data-a="no100">No estoy al 100 %</button></div>
    </section>
    ${metricasHtml()}
    ${franjaHtml()}
  </div><div class="col">
    ${diaHtml(true)}
    ${semanaHtml()}
  </div></div>`;
}

/* ===== Plan ===== */
function listaDias(dias, conEstado) {
  return `<ul class="dias">${dias.map(d => { const x = dte(d.f), hoy = d.f === HOY;
    return `<li class="${hoy ? 'es-hoy' : ''}"><button type="button" style="--c:${col(d.dep)}" data-a="dia" data-v="${d.f}">
      <span class="fd"><small>${DIAS[x.getDay()]}</small><b class="num">${x.getDate()}</b></span>
      <span class="t"><b>${esc(d.t)}</b>${d.brief ? `<span class="small muted">${esc(d.brief)}</span>` : ''}</span>
      ${conEstado ? `<span class="st ${hoy ? 'hoy' : ''}">${hoy ? 'Hoy' : d.estado === 'Hecho' ? '✓ Hecho' : d.estado}</span>` : `<span class="st muted">${d.dep ? DEP[d.dep] : ''}</span>`}</button></li>`; }).join('')}</ul>`;
}
function tabPlan() {
  const hechas = SEMANA.filter(d => d.estado === 'Hecho').length, plan = SEMANA.filter(d => d.dep).length;
  return `<div class="screen-h"><h1>Plan</h1><p class="muted">Objetivo: llegar fuerte a la marcha del Montseny, 15 de noviembre</p></div>
  <div class="cols"><div class="col">
    <section class="blk"><div class="blk-h"><h2>Esta semana</h2><span class="small muted">${hechas} de ${plan} sesiones hechas</span></div>${listaDias(SEMANA, true)}</section>
    <section class="blk"><div class="blk-h"><h2>Semana que viene</h2></div>
      <p class="small muted" style="margin-bottom:12px">Te la propone tu entrenador con tus horas, tu calendario y cómo vienes. Antes de guardarla la ves entera.</p>
      ${listaDias(PROXIMA, false)}
      <div class="btns" style="margin-top:16px"><button class="btn fill" type="button" data-a="preparar">Guardar esta semana</button><button class="link" type="button" data-a="claude">Cambiarla con Claude</button></div></section>
  </div><div class="col">
    <section class="blk"><div class="blk-h"><h2>Tus rutas</h2><button class="link" type="button" data-a="claude">Trazar una nueva</button></div>
      <ul class="rutas">${RUTAS.map(r => `<li><svg width="64" height="36" viewBox="0 0 64 36" aria-hidden="true"><path d="M2 30 L14 ${30 - r.desn / 80} L26 ${24 - r.desn / 120} L38 ${28 - r.desn / 70} L50 ${20 - r.desn / 140} L62 30" fill="none" stroke="var(--bici)" stroke-width="2" stroke-linejoin="round"/></svg>
        <div><b>${esc(r.n)}</b><div class="small muted"><span class="num" style="font-size:15px">${r.km} km</span>, <span class="num" style="font-size:15px">${nf(r.desn)} m</span> de desnivel. ${esc(r.uso)}</div></div></li>`).join('')}</ul></section>
    <section class="blk"><div class="blk-h"><h2>Fuerza: Pierna A</h2><span class="small muted">Lunes</span></div>
      <ul class="ejs">${FUERZA_A.map(e => `<li><b>${esc(e.n)}</b><div>${esc(e.hoy)}${e.mas ? ' <span class="ejs mas">· sube</span>' : ''}</div><div class="ult">La última vez: ${esc(e.ultima)}</div></li>`).join('')}</ul>
      <p class="xs muted" style="margin-top:8px">Las series las cuenta el reloj. Al acabar, aquí verás lo hecho frente a lo previsto.</p></section>
  </div></div>`;
}

/* ===== Comer ===== */
function tabComer() {
  const h = COMER_HOY.hidrato, falta = h.min - h.llevas;
  const hist = COMER_HIST.slice(0, -1);
  const DUR = { descanso: 'Descanso', suave: 'Suave', moderado: 'Moderado', duro: 'Duro' };
  const pesoChart = () => {
    const serie = PESO.map(p => p[1]); const media = serie.map((v, i) => { const s = serie.slice(Math.max(0, i - 3), i + 1); return s.reduce((a, b) => a + b, 0) / s.length; });
    return linea({ serie: media, y0: 78, y1: 85, ticks: [78, 80, 82, 84], h: 170, aria: 'Peso: media de 7 días de 84 a 79,5 kg entre el 25 de agosto y el 1 de octubre', fmt: v => v,
      pts: serie.map((v, i) => [i, v, `${dte(PESO[i][0]).getDate()} ${MESES[dte(PESO[i][0]).getMonth()].slice(0, 3)}: ${nf(v, 1)} kg`]),
      xlabels: [[0, '25 ago'], [2, '15 sep'], [6, '22 sep'], [10, '1 oct']] });
  };
  return `<div class="screen-h"><h1>Comer</h1><p class="muted">Hoy, día de carga suave. Sin calorías: hidrato y proteína, que es lo que cambia cómo rindes.</p></div>
  <div class="cols"><div class="col">
    <section class="decision" style="padding-top:0">
      <p class="fecha">${fLarga(HOY)}</p>
      <h1 style="font-size:clamp(36px,10vw,56px)">Te faltan ${falta} g de hidrato</h1>
      <p class="porque">Para un día suave con 75 min de bici, entre ${h.min} y ${h.max} g. Llevas ${h.llevas} g del desayuno. La proteína, a mitad.</p>
    </section>
    ${diaHtml(false)}
    <section class="blk"><div class="blk-h"><h2>Durante el entreno</h2></div><p>${esc(COMER_HOY.durante)}</p><p class="small muted" style="margin-top:4px">El sábado, con 3 h 30, toca 60 g por hora desde la primera hora.</p></section>
    <section class="blk"><div class="btns"><button class="btn fill" type="button" data-a="claude">Registrar con Claude</button><button class="link" type="button" data-a="peso">Apuntar peso</button></div>
      <p class="xs muted" style="margin-top:8px">Mándale una foto o cuéntale qué has comido. Lo que registre aparece aquí.</p></section>
  </div><div class="col">
    <section class="blk"><div class="viz-t">Hidrato por día frente a lo que pedía el entreno</div>
      <p class="small muted viz-s">Barra: lo que comiste. Marca: el mínimo de ese día según su carga.</p>
      <div class="viz">${barrasObjetivo(hist)}</div>
      <div class="leyenda"><span><i style="background:var(--ink-2)"></i>Comido</span><span><i class="ln"></i>Mínimo del día</span><span><i style="background:var(--warn)"></i>Por debajo</span></div>
      <p class="lee">En los dos días duros te quedaste corto: 380 y 400 g pedidos, 300 y 320 comidos. En los suaves, bien.</p></section>
    <section class="blk"><div class="blk-h"><h2>Peso</h2><span class="small muted">Media de 7 días: <b class="num" style="font-size:18px;color:var(--ink)">79,5 kg</b></span></div>
      <div class="viz">${pesoChart()}</div>
      <div class="leyenda"><span><i style="background:var(--ink);height:2px"></i>Media de 7 días</span><span><i style="border:1.5px solid var(--ink-2);border-radius:50%;background:none"></i>Pesaje</span></div>
      <p class="lee">−4,5 kg en 30 días. Desde el 22 sep, estable: con los días duros bien comidos debería seguir así.</p></section>
  </div></div>`;
}
function barrasObjetivo(hist) {
  const h = 200, pad = { t: 10, r: 6, b: 34, l: 32 }, n = hist.length, bw = (W - pad.l - pad.r) / n, gap = bw * .3, y1 = 500;
  const Y = v => pad.t + (1 - v / y1) * (h - pad.t - pad.b);
  const body = hist.map(([f, carga, g, min], i) => { const x = pad.l + i * bw + gap / 2, w = bw - gap, corto = g < min * .9, d = dte(f);
    return `<g data-tip="${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}, ${carga}: ${g} g de ${min} g mínimos"><rect class="hit" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${h - pad.t - pad.b}"/>
      <path class="mk" d="M${x},${Y(0)}V${Y(g) + 3}q0,-3 3,-3h${w - 6}q3,0 3,3V${Y(0)}z" fill="${corto ? 'var(--warn)' : 'var(--ink-2)'}"/>
      <line x1="${x - 2}" x2="${x + w + 2}" y1="${Y(min)}" y2="${Y(min)}" stroke="var(--ink)" stroke-width="2"/></g>
      <text x="${x + w / 2}" y="${h - 20}" text-anchor="middle">${d.getDate()}</text>
      <text x="${x + w / 2}" y="${h - 6}" text-anchor="middle" class="${carga === 'duro' ? 'lbl' : ''}">${{ descanso: '·', suave: 'S', moderado: 'M', duro: 'D' }[carga]}</text>`; }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Hidrato comido por día frente al mínimo de cada día, del 21 de septiembre al 3 de octubre">${ejeY(0, y1, [0, 100, 200, 300, 400, 500], h, pad)}${body}</svg>
    <p class="xs muted">Debajo de cada día: D duro, M moderado, S suave, punto descanso.</p>`;
}

/* ===== Progreso ===== */
function tabProgreso() {
  const segs = [['forma', 'Forma'], ['bici', 'Bici'], ['correr', 'Correr'], ['skimo', 'Skimo']];
  const cuerpo = { forma: progForma, bici: progBici, correr: () => vacio('Correr'), skimo: () => vacio('Skimo') }[ST.prog]();
  return `<div class="screen-h"><h1>Progreso</h1><p class="muted">¿Estás mejorando? Cada gráfica dice qué mirar.</p></div>
    <div class="seg" role="group" aria-label="Qué ver" style="margin-bottom:8px">${segs.map(([k, l]) => `<button type="button" data-a="prog" data-v="${k}" aria-pressed="${ST.prog === k}">${l}</button>`).join('')}</div>
    ${cuerpo}`;
}
const vacio = dep => `<section class="blk"><h2 style="font-size:20px">Aún no hay salidas suficientes de ${dep.toLowerCase()}</h2>
  <p class="muted" style="margin-top:6px">Con 4 salidas en las últimas 6 semanas empezamos a enseñarte tendencias. Si ya las tienes en Garmin, sincroniza.</p>
  <div class="btns" style="margin-top:12px"><button class="btn" type="button" data-a="toast" data-v="Sincronizando con Garmin">Sincronizar con Garmin</button></div></section>`;
function progForma() {
  return `<section class="blk"><div class="viz-t">Frescura de las últimas 6 semanas</div>
    <p class="small muted viz-s">Tu forma menos tu fatiga. Más abajo, más cargado.</p>
    <div class="viz">${linea({ serie: FORMA, y0: -30, y1: 15, ticks: [-30, -20, -10, 0, 10], h: 200, aria: 'Frescura diaria de las últimas 6 semanas, ahora en −10, zona óptima',
      bandas: [{ lo: 5, hi: 15, c: 'color-mix(in srgb,var(--skimo) 14%,transparent)', t: 'Fresco: listo para competir' }, { lo: -30, hi: -10, c: 'color-mix(in srgb,var(--bici) 10%,transparent)', t: 'Óptimo: estás ganando forma' }],
      xlabels: [[0, '23 ago'], [21, '13 sep'], [41, 'hoy']] })}</div>
    <p class="lee">Llevas 5 semanas en la zona óptima: entrenas lo suficiente para mejorar. "Óptimo" no quiere decir fresco: para la marcha del 15 de noviembre bajaremos carga la semana antes.</p></section>
    <section class="blk"><div class="blk-h"><h2>Tu objetivo</h2></div><p><b>Marcha del Montseny</b>, 15 de noviembre. 96 km y 1.650 m.</p>
    <p class="small muted" style="margin-top:4px">Quedan 6 semanas: 4 de carga y 2 de afinar.</p></section>`;
}
function progBici() {
  const B = BICI, m = B.misma;
  const fc = barras({ datos: B.fc, y0: 120, y1: 160, ticks: [120, 130, 140, 150, 160], h: 190, labelEvery: 2, aria: 'FC media por salida, con líneas en 135 (Z2) y 144 (techo)',
    color: d => d[2] ? 'var(--bici)' : 'var(--line-3)', tip: d => `${d[0]}: ${d[1]} ppm${d[2] ? ', fondo' : ''}`, refs: [{ v: 144, t: 'Techo 144' }, { v: 135, t: 'Z2 135', cls: 'ref2' }] });
  const ve = puntos({ datos: B.velEsfuerzo, x0: 125, x1: 160, y0: 23, y1: 27, xt: [130, 140, 150, 160], yt: [23, 24, 25, 26, 27], xl: 'FC media (ppm)', yl: 'km/h en llano',
    fill: (d, i) => `color-mix(in srgb,var(--bici) ${30 + i / (B.velEsfuerzo.length - 1) * 70}%,var(--paper))`, tip: d => `${d[0]}: ${nf(d[2], 1)} km/h a ${d[1]} ppm`,
    aria: 'Velocidad en llano frente a FC media por salida', etiquetas: [10, 0] });
  const st = puntos({ datos: B.stamina.map(d => [d[0], d[2], d[1]]), x0: 2.5, x1: 4, y0: 0, y1: 60, xt: [2.5, 3, 3.5, 4], yt: [0, 20, 40, 60], xl: 'Duración (h)', yl: 'Stamina mínima (%)',
    r: d => { const g = (B.combustible.find(c => c[0] === d[0]) || [0, 0])[1]; return 5 + g / 6; },
    fill: d => d[0] === '3 oct' ? 'var(--bici)' : 'var(--line-3)', tip: d => { const g = (B.combustible.find(c => c[0] === d[0]) || [0, null])[1]; return `${d[0]}: ${nf(d[1], 1)} h, stamina mínima ${d[2]} %${g != null ? `, ${g} g/h` : ', sin dato de comida'}`; },
    aria: 'Duración frente a stamina mínima en salidas largas; el tamaño es lo que comiste por hora', etiquetas: [5, 3] });
  const cb = barras({ datos: B.combustible, y0: 0, y1: 70, ticks: [0, 20, 40, 60], h: 170, aria: 'Gramos de hidrato por hora en ruta frente a 60 del plan',
    tip: d => `${d[0]}: ${d[1]} g/h`, refs: [{ v: 60, t: 'Plan 60 g/h' }], etiqueta: d => d[1] });
  const vol = barras({ datos: B.volumen, y0: 0, y1: 8, ticks: [0, 2, 4, 6, 8], h: 160, aria: 'Horas de bici por semana',
    color: d => d[2] ? 'color-mix(in srgb,var(--bici) 45%,var(--paper))' : 'var(--bici)', tip: d => `Semana del ${d[0]}: ${nf(d[1], 1)} h${d[2] ? ' (incompleta)' : ''}`, etiqueta: d => nf(d[1], 1) });
  const dc = puntos({ datos: B.desacople.map(d => [d[0], { '19 sep': 1, '30 sep': 2, '3 oct': 3 }[d[0]], d[1]]), x0: .5, x1: 3.5, y0: 0, y1: 10, xt: [], yt: [0, 5, 10], xl: 'Salidas por La Roca', yl: 'Desacople (%)', h: 170,
    fill: () => 'var(--bici)', tip: d => `${d[0]}: ${nf(d[2], 1)} %`, aria: 'Desacople en el tramo de La Roca: 7,8, 5,6 y 4,9 %', etiquetas: [0, 1, 2] });
  const blk = (t, s, viz, lee, ley = '') => `<section class="blk"><div class="viz-t">${t}</div><p class="small muted viz-s">${s}</p><div class="viz">${viz}</div>${ley}<p class="lee">${lee}</p></section>`;
  return `<section class="blk"><div class="blk-h"><h2>Misma ruta: ${m.de} y ${m.a}</h2></div><p class="small muted" style="margin-bottom:10px">${esc(m.ruta)}. La comparación más honesta de tu motor.</p>
      <div class="cmp">${m.filas.map(([n, a, b, u, d, si]) => `<div><span class="n">${n}${u ? ` (${u})` : ''}</span><div class="v num">${a} <span>→</span> ${b}</div><span class="d ${si ? 'si' : ''}">${si ? '↑ ' : ''}${d}</span></div>`).join('')}</div>
      <p class="xs muted" style="margin-top:8px">El 3 sep fue con otra bici y las FC máximas salen del sensor óptico: no entran en la comparación.</p></section>
    <div class="grid2">
    ${blk('Velocidad frente a esfuerzo', 'Cada punto es una salida; más oscuro, más reciente. Mejoras si los puntos van hacia arriba y a la izquierda.', ve, 'El 30 sep, 25,1 km/h a 129 ppm: tu mejor relación en llano.')}
    ${blk('Disciplina: FC media por salida', 'En los fondos (azul) el objetivo es quedarte por debajo del techo de 144.', fc, 'Los cuatro últimos fondos, por debajo de 144. Antes del 17 sep ibas por encima casi siempre.',
      '<div class="leyenda"><span><i style="background:var(--bici)"></i>Fondo</span><span><i style="background:var(--line-3)"></i>Otra salida</span></div>')}
    ${blk('Duración frente a stamina', 'Salidas de más de 2 h 30. Más alto, más entero acabas. Tamaño: g de hidrato por hora.', st, 'El 3 oct, 3 h 10 sin vaciarte (51 %) comiendo 39 g/h. Sin dato de comida, el círculo es el más pequeño.')}
    ${blk('Combustible en ruta', 'Gramos de hidrato por hora. El plan pide 60.', cb, 'Vas mejorando, pero sigues por debajo: el próximo fondo, un gel o barrita cada 30 min.')}
    ${blk('Desacople en La Roca', 'Cuánto sube el pulso al final a igual ritmo. Por debajo de 5 %, buena base (confianza media).', dc, 'De 7,8 a 4,9 % en dos semanas: tu base aeróbica responde.')}
    ${blk('Volumen semanal', 'Horas de bici por semana.', vol, 'La semana actual va incompleta: falta hoy.')}
    </div>`;
}

/* ===== Pueblos ===== */
function tabPueblos() {
  const R = { año: { h: 286, km: 7480, desn: 68400, n: 214, t: 'En 2026' }, mes: { h: 6.2, km: 141, desn: 1120, n: 3, t: 'En octubre' }, todo: { h: 1240, km: 31800, desn: 296000, n: 905, t: 'Desde 2021' } }[ST.pueblos];
  // Calendario de calor: determinista
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ini = new Date('2026-01-05T12:00:00'), dias = Math.round((dte(HOY) - ini) / 864e5) + 1;
  const cells = Array.from({ length: Math.ceil(dias / 7) * 7 }, (_, i) => { if (i >= dias) return '<i style="visibility:hidden"></i>'; const r = rnd(), l = r < .42 ? 0 : r < .7 ? 1 : r < .9 ? 2 : 3; return `<i class="${l ? 'l' + l : ''}" title=""></i>`; }).join('');
  return `<div class="screen-h"><h1>Pueblos</h1><p class="muted">Todo lo que has hecho y por dónde has pasado.</p></div>
    <div class="seg" role="group" aria-label="Periodo" style="margin-bottom:8px">${[['mes', 'Este mes'], ['año', 'Este año'], ['todo', 'Desde el inicio']].map(([k, l]) => `<button type="button" data-a="pueblos" data-v="${k}" aria-pressed="${ST.pueblos === k}">${l}</button>`).join('')}</div>
    <section class="blk"><div class="blk-h"><h2>${R.t}</h2><span class="demo">Ejemplo</span></div>
      <div class="tot"><div><b class="num">${nf(R.h, R.h < 10 ? 1 : 0)}</b><span>horas</span></div><div><b class="num">${nf(R.km)}</b><span>kilómetros</span></div><div><b class="num">${nf(R.desn)}</b><span>metros de desnivel</span></div><div><b class="num">${nf(R.n)}</b><span>actividades</span></div></div>
      <div class="reparto" role="img" aria-label="Reparto de horas: bici 68 %, correr 14 %, fuerza 12 %, skimo 6 %"><i style="flex:68;background:var(--bici)"></i><i style="flex:14;background:var(--correr)"></i><i style="flex:12;background:var(--fuerza)"></i><i style="flex:6;background:var(--skimo)"></i></div>
      <div class="leyenda"><span><i style="background:var(--bici)"></i>Bici 68 %</span><span><i style="background:var(--correr)"></i>Correr 14 %</span><span><i style="background:var(--fuerza)"></i>Fuerza 12 %</span><span><i style="background:var(--skimo)"></i>Skimo 6 %</span></div></section>
    <div class="grid2">
    <section class="blk"><div class="viz-t">Tu año, día a día</div><p class="small muted viz-s">Cada cuadro es un día; más oscuro, más horas.</p>
      <div class="heat viz" role="img" aria-label="Calendario de 2026 con las horas entrenadas cada día">${cells}</div>
      <div class="leyenda"><span><i style="background:var(--fill)"></i>Nada</span><span><i style="background:color-mix(in srgb,var(--bici) 30%,var(--fill))"></i>Menos de 1 h</span><span><i style="background:color-mix(in srgb,var(--bici) 60%,var(--fill))"></i>1-2 h</span><span><i style="background:var(--bici)"></i>Más de 2 h</span></div>
      <p class="lee">Tu racha más larga este año: 9 semanas seguidas con al menos 4 días.</p></section>
    <section class="blk"><div class="blk-h"><h2>${PUEBLOS.total} de ${PUEBLOS.de} pueblos de ${PUEBLOS.zona}</h2></div>
      <div class="mapa-ph"><div><b>Aquí va el mapa de pueblos</b><p class="small" style="margin-top:4px">El de la app actual, con el mismo estilo de esta pantalla.</p></div></div>
      <p class="small" style="margin:12px 0 4px"><b>${PUEBLOS.nuevos} nuevos</b> en los últimos 30 días. Por kilómetros:</p>
      <ul class="plist">${PUEBLOS.lista.map(([n, km]) => `<li><span>${esc(n)}</span><span class="num">${nf(km)} km</span></li>`).join('')}</ul></section>
    </div>`;
}

/* ===== Hojas, avisos y acciones ===== */
let ultimoFoco = null;
function hoja(html) {
  ultimoFoco = document.activeElement;
  $('#capa').innerHTML = `<div class="scrim" data-a="cerrar"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t"><div class="grab"></div><button class="link cerrar" type="button" data-a="cerrar">Cerrar</button>${html}</div>`;
  requestAnimationFrame(() => { $('.scrim').classList.add('on'); $('.sheet').classList.add('on'); $('.sheet h2')?.setAttribute('tabindex', '-1'); $('.sheet h2')?.focus(); });
}
function cerrar() { const c = $('#capa'); if (!c.innerHTML) return; c.innerHTML = ''; ultimoFoco?.focus?.(); }
let tTimer;
function toast(txt, deshacer) {
  document.querySelector('.toast')?.remove(); clearTimeout(tTimer);
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(txt)}</span>${deshacer ? '<button class="link" type="button" data-a="undo">Deshacer</button>' : ''}`;
  document.body.append(t); tTimer = setTimeout(() => t.remove(), 5000);
}
let undo = null;
const ACC = {
  tab: v => { ST.tab = v; render(true); },
  prog: v => { ST.prog = v; render(); }, pueblos: v => { ST.pueblos = v; render(); },
  min: v => { ST.sesion.min = Math.max(30, Math.min(240, ST.sesion.min + +v)); render(); },
  int: v => { ST.sesion.intensidad = v; render(); },
  aplicar: () => { const antes = { ...ST.aplicada }; ST.aplicada = { ...ST.sesion }; undo = () => { ST.aplicada = antes; ST.sesion = { ...antes }; render(); }; render(); toast('Sesión cambiada', true); },
  deshacer: () => { ST.sesion = { ...ST.aplicada }; render(); },
  undo: () => { undo?.(); undo = null; document.querySelector('.toast')?.remove(); },
  met: v => { const m = ESTADO.metricas.find(x => x.id === v);
    hoja(`<h2 id="sh-t">${m.n}: ${m.v}${m.u ? ' ' + m.u : ''}</h2><p class="tag ${m.tono}"><i>${m.tono === 'good' ? '↑' : m.tono === 'warn' ? '!' : '='}</i>${m.palabra}</p>
      <p style="margin-top:12px">${esc(m.que)}</p><p class="muted">${esc(m.lee)}</p>`); },
  no100: () => hoja(`<h2 id="sh-t">¿Qué te pasa?</h2><p class="muted">Te enseño cómo queda el plan antes de cambiar nada.</p>
    <div class="opts" role="group" aria-label="Motivo">${[['enfermo', 'Estoy enfermo', 'Descanso hasta que estés bien; el plan te espera'], ['molestia', 'Tengo una molestia', 'Quitamos impacto e intensidad unos días'], ['cargado', 'Voy cargado de semana', 'Más corto y suave, sin perder el fondo del sábado']]
      .map(([k, t, s]) => `<button class="opt" type="button" data-a="motivo" data-v="${k}" aria-pressed="false"><b>${t}</b><span class="small muted">${s}</span></button>`).join('')}</div><div id="ad"></div>`),
  motivo: v => { document.querySelectorAll('.opt').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
    const despues = { enfermo: 'Descanso. Mañana vemos cómo estás.', molestia: 'Bici muy suave, 45 min, sin cuestas.', cargado: 'Rodaje suave, 45 min.' }[v];
    $('#ad').innerHTML = `<div class="antes-despues"><div><span class="xs muted">Antes</span><p><b>${esc(ESTADO.decision)}</b></p></div><div class="ahora"><span class="xs muted">Después</span><p><b>${despues}</b></p></div></div>
      ${v === 'molestia' ? '<p class="small muted">Si en dos o tres días no mejora, consulta a un profesional.</p>' : ''}
      <button class="btn fill wide" type="button" data-a="aplicarMotivo" style="margin-top:12px">Aplicar el cambio</button>`; },
  aplicarMotivo: () => { cerrar(); toast('Plan de hoy cambiado', true); undo = () => toast('Plan restaurado'); },
  dia: v => { const d = [...SEMANA, ...PROXIMA].find(x => x.f === v); if (!d) return;
    hoja(`<h2 id="sh-t">${esc(d.t)}</h2><p class="muted">${fLarga(d.f)}${d.dep ? `, ${DEP[d.dep].toLowerCase()}` : ''}</p>${d.brief ? `<p style="margin-top:10px">${esc(d.brief)}</p>` : ''}
      ${d.dep === 'fuerza' ? `<ul class="ejs" style="margin-top:8px">${FUERZA_A.map(e => `<li><b>${esc(e.n)}</b><div>${esc(e.hoy)}</div><div class="ult">La última vez: ${esc(e.ultima)}</div></li>`).join('')}</ul>` : ''}
      ${d.f >= HOY && d.dep ? `<div class="btns" style="margin-top:16px"><button class="btn fill" type="button" data-a="reloj">Enviar al reloj</button><button class="link" type="button" data-a="toast" data-v="Elige el día al que moverla">Mover a otro día</button></div>` : ''}
      ${d.estado === 'Hecho' ? `<p style="margin-top:12px" class="tag good"><i>✓</i>Hecho</p><p class="small muted" style="margin-top:6px">En la app completa, aquí va la actividad: cómo fue, qué comiste antes y durante, y si cuadró con el plan.</p>` : ''}`); },
  reloj: () => { cerrar(); toast('Enviado a tu Garmin'); },
  preparar: () => toast('Semana guardada', true),
  peso: () => hoja(`<h2 id="sh-t">Apuntar peso</h2><p class="muted">En ayunas, mejor siempre a la misma hora.</p>
    <label class="small" for="kg" style="display:block;margin-top:12px;font-weight:600">Kilos</label><input id="kg" inputmode="decimal" value="79,4" style="width:100%;min-height:48px;margin-top:4px;padding:0 12px;border:1px solid var(--ink);border-radius:var(--r);background:var(--surface);color:var(--ink);font:700 22px var(--font);font-stretch:80%">
    <button class="btn fill wide" type="button" data-a="pesoOk" style="margin-top:16px">Guardar el peso</button>`),
  pesoOk: () => { cerrar(); toast('Peso guardado', true); },
  claude: () => hoja(`<h2 id="sh-t">Hacerlo con tu Claude</h2><p class="muted">Abre tu Claude con el encargo preparado. Lo que haga se ve aquí.</p>
    <div class="opts">${['Prepárame la semana que viene', 'Registra lo que he comido', 'Trázame una ruta de 80 km con 1.000 m', '¿Cómo me ha ido la salida de ayer?'].map(t => `<button class="opt" type="button" data-a="toast" data-v="Encargo copiado: ${esc(t)}"><b>${esc(t)}</b></button>`).join('')}</div>`),
  ajustes: () => hoja(`<h2 id="sh-t">Ajustes</h2><p class="muted">En el prototipo no están: son los de la app actual, agrupados por conexiones, entrenador, deportes y preferencias.</p>`),
  toast: v => { cerrar(); toast(v); },
  cerrar,
};
document.addEventListener('click', e => { const el = e.target.closest('[data-a]'); if (!el) return; const f = ACC[el.dataset.a]; if (f) { e.preventDefault(); f(el.dataset.v, el); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });

/* Tooltip para las marcas de las gráficas (ratón y foco táctil) */
const tip = $('#tip');
document.addEventListener('pointermove', e => { const g = e.target.closest?.('[data-tip]');
  if (!g) { tip.style.opacity = 0; return; } tip.textContent = g.dataset.tip; tip.style.opacity = 1;
  const x = Math.min(innerWidth - tip.offsetWidth - 8, e.clientX + 12); tip.style.left = x + 'px'; tip.style.top = (e.clientY - tip.offsetHeight - 10) + 'px'; });

/* ===== Render ===== */
const SCR = { hoy: tabHoy, plan: tabPlan, comer: tabComer, progreso: tabProgreso, pueblos: tabPueblos };
function render(cambioTab) {
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="tab" type="button" data-a="tab" data-v="${k}" ${ST.tab === k ? 'aria-current="page"' : ''}>${ic(k)}<span>${l}</span></button>`).join('');
  const y = scrollY; $('#view').innerHTML = SCR[ST.tab]();
  document.querySelectorAll('.heat').forEach(h => { h.scrollLeft = h.scrollWidth; });
  if (cambioTab) { scrollTo(0, 0); $('#view').focus({ preventScroll: true }); } else scrollTo(0, y);
}
addEventListener('scroll', () => $('#top').classList.toggle('scrolled', scrollY > 4), { passive: true });
const q = new URLSearchParams(location.search); if (q.get('tab')) ST.tab = q.get('tab'); if (q.get('prog')) ST.prog = q.get('prog');
render();
