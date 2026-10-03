/* ===== v1 · Progreso: ¿estoy mejorando? =====
   Forma (frescura y lo que dice Garmin) y, por deporte, gráficas que relacionan dos cosas:
   velocidad frente a pulso, disciplina en los fondos, zonas y volumen por semana, y la misma ruta
   comparada consigo misma. Lo que aún no guarda el conector (stamina, combustible, desacople) se dice. */

const DEP_PROG = ['bici', 'correr', 'skimo'];
const kmh = a => a.km && a.min ? a.km / (a.min / 60) : null;
const ritmo = v => { if (!v) return '—'; const s = Math.round(3600 / v); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min/km`; };
/* Lo que mide el rendimiento en cada deporte: velocidad en bici y correr, metros de subida por hora en skimo */
const REND = {
  bici: { n: 'Velocidad', u: 'km/h', v: a => a.llano?.kmh || kmh(a), fc: a => a.llano?.fc || a.fc, tip: v => `${nf(v, 1)} km/h`, nota: 'En llano cuando la salida tiene un tramo llano; si no, la media.' },
  correr: { n: 'Velocidad', u: 'km/h', v: a => kmh(a), fc: a => a.fc, tip: v => `${nf(v, 1)} km/h (${ritmo(v)})`, nota: 'Velocidad media de la carrera.' },
  skimo: { n: 'Subida por hora', u: 'm/h', v: a => a.desn && a.min ? a.desn / (a.min / 60) : null, fc: a => a.fc, tip: v => `${nf(v, 0)} m/h`, nota: 'Metros de desnivel por hora de actividad.' },
};
/* Dos salidas son "la misma ruta" si empiezan a menos de 500 m y la distancia se parece (±8 %) */
function mismaRuta(dep) {
  const rutas = (DSET && DSET.rutas) || {}; const pt = a => { const p = rutas[a.id]; if (!p) return null; try { const d = decodePoly(p); return d && d[0]; } catch (e) { return null; } };
  const as = acts().filter(a => a.dep === dep && a.km > 3 && rutas[a.id]).slice(0, 40);
  for (let i = 0; i < as.length; i++) { const a = as[i], pa = pt(a); if (!pa) continue;
    for (let j = i + 1; j < as.length; j++) { const b = as[j], pb = pt(b); if (!pb) continue;
      if (Math.abs(a.km - b.km) / a.km < .08 && hav(pa, pb) < .5) return [b, a]; } }
  return null;
}
function bloqueMismaRuta(dep) {
  const par = mismaRuta(dep); if (!par) return '';
  const [a, b] = par, mpl = x => x.fc && x.min ? x.km * 1000 / (x.min * x.fc) : null;
  const filas = [
    ['FC media', 'ppm', a.fc, b.fc, v => nf(v, 0), (x, y) => y < x],
    ['Metros por latido', '', mpl(a), mpl(b), v => nf(v, 2), (x, y) => y > x],
    [REND[dep].n, REND[dep].u, REND[dep].v(a), REND[dep].v(b), v => nf(v, dep === 'skimo' ? 0 : 1), (x, y) => y > x],
    ['Tiempo', '', a.min, b.min, v => dur(v), (x, y) => y < x],
  ].filter(f => f[2] != null && f[3] != null);
  return blk(`${blkH(`Misma ruta: ${fDia(a.f)} y ${fDia(b.f)}`, info('misma', 'Misma ruta', 'Comparar una salida con otra por el mismo recorrido es la forma más honesta de ver si mejoras: mismo terreno, distinta forma. Ojo con el viento, el calor o ir en grupo, que también cuentan.'))}
    <p class="small muted" style="margin:-8px 0 12px">${esc(b.lugar)}, ${nf(b.km)} km</p>
    <div class="tot">${filas.map(([n, u, x, y, fmt, mejor]) => `<div><span class="n">${n}${u ? ` (${u})` : ''}</span><b>${fmt(x)} <span class="muted" style="font-weight:500">→</span> ${fmt(y)}</b>${mejor(x, y) ? '<span class="d si">↑ Mejor</span>' : x === y ? '<span class="d">Igual</span>' : '<span class="d">Peor</span>'}</div>`).join('')}</div>`);
}

function progDep(dep) {
  const hace = addDays(HOY, -120), as = acts().filter(a => a.dep === dep && a.f > hace && a.min >= 15).sort((x, y) => x.f.localeCompare(y.f));
  const R = REND[dep], col = scol(dep);
  if (as.length < 3) return blk(pendiente(`Aún hay pocas salidas de ${SPORTS[dep].n.toLowerCase()}`, 'Con tres salidas en los últimos cuatro meses empiezo a enseñarte tendencias. Si ya las tienes en Garmin, actualiza los datos.') + '<div class="btns"><button class="btn tonal" type="button" data-a="v-sync">Actualizar con Garmin</button></div>', 'first');
  const L = ((M.perfil && M.perfil.lthr) || 170) - (dep === 'bici' ? 5 : 0), techo = Math.round(L * .86), z2 = Math.round(L * .81);
  const out = [];
  // Velocidad frente a esfuerzo
  const pts = as.map(a => [fDia(a.f), R.fc(a), R.v(a)]).filter(p => p[1] && p[2]);
  if (pts.length >= 3) { const [xa, xb] = rango(pts.map(p => p[1])), [ya, yb] = rango(pts.map(p => p[2])); const n = pts.length;
    const mejor = pts.reduce((m, p, i) => p[2] / p[1] > pts[m][2] / pts[m][1] ? i : m, 0);
    out.push(blk(`${vizT(`${R.n} frente a esfuerzo`, info(`ve-${dep}`, `${R.n} frente a esfuerzo`, `Cada punto es una salida: a la derecha, más pulso; arriba, más ${R.n.toLowerCase()}. Más oscuro, más reciente. Mejoras si los puntos recientes quedan arriba y a la izquierda: lo mismo con menos pulso. ${R.nota}`))}
      <div class="viz">${vPuntos({ datos: pts, x0: xa, x1: xb, y0: ya, y1: yb, xt: vTicks(xa, xb, 4).filter(t => t >= xa && t <= xb), yt: vTicks(ya, yb, 4).filter(t => t >= ya && t <= yb), xl: 'FC media (ppm)', yl: R.u,
        fill: (d, i) => `color-mix(in srgb,${col} ${30 + i / Math.max(1, n - 1) * 70}%,var(--paper))`, tip: d => `${d[0]}: ${R.tip(d[2])} a ${d[1]} ppm`, aria: `${R.n} frente a FC media en las últimas ${n} salidas`, etiquetas: [n - 1, mejor], fmtX: v => nf(v, 0), fmtY: v => nf(v, dep === 'skimo' ? 0 : 1) })}</div>
      <p class="lee">Tu mejor relación: ${pts[mejor][0]}, ${R.tip(pts[mejor][2])} a ${pts[mejor][1]} ppm.</p>`));
  }
  // Disciplina: FC media por salida, con el techo de los fondos
  const ult = as.slice(-12).filter(a => a.fc);
  if (ult.length >= 3) { const fcs = ult.map(a => a.fc), y0 = Math.floor(Math.min(...fcs, z2) / 10) * 10 - 5, y1 = Math.ceil(Math.max(...fcs, techo) / 10) * 10 + 5;
    const fondos = ult.filter(a => ['rec', 'fondo'].includes(tipoAct(a))), dentro = fondos.filter(a => a.fc <= techo).length;
    out.push(blk(`${vizT('Disciplina en los fondos', info(`dis-${dep}`, 'Disciplina en los fondos', `FC media de cada salida. En los fondos (en color) el objetivo es quedarte por debajo del techo de ${techo} ppm; ${z2} ppm es el centro de tu zona 2. Salen de tu umbral de Garmin (${L} ppm). En gris, las salidas de otro tipo.`))}
      <div class="viz">${vBarras({ datos: ult.map(a => [fDia(a.f), a.fc, ['rec', 'fondo'].includes(tipoAct(a))]), y0, y1, ticks: vTicks(y0, y1, 4).filter(t => t >= y0 && t <= y1), h: 190, cada: Math.ceil(ult.length / 6),
        color: d => d[2] ? col : 'var(--line-3)', tip: d => `${d[0]}: ${d[1]} ppm${d[2] ? ', fondo' : ''}`, refs: [{ v: techo, t: `Techo ${techo}` }, { v: z2, t: `Z2 ${z2}`, cls: 'ref2' }], aria: 'FC media por salida', fmt: v => nf(v, 0) })}</div>
      <p class="lee">${fondos.length ? `${dentro} de ${fondos.length} fondos por debajo del techo.` : 'En estas salidas no hay fondos.'}</p>`));
  }
  // Zonas por semana (suave, medio, duro) y volumen
  const sems = Array.from({ length: 8 }, (_, i) => addDays(SEM, (i - 7) * 7));
  const zon = sems.map(w => { const z = [0, 0, 0]; acts().filter(a => a.dep === dep && weekOf(a.f) === w && a.z).forEach(a => a.z.forEach((v, k) => { z[k] += v; })); return [fDia(w), z.map(v => v / 60)]; });
  if (zon.filter(c => c[1].some(Boolean)).length >= 3) out.push(blk(`${vizT('Suave, medio y duro por semana', info(`zon-${dep}`, 'Suave, medio y duro por semana', 'Horas de cada semana según tu pulso: suave (por debajo del 90 % de tu umbral), medio y duro. En los aficionados que mejoran, cerca del 80 % es suave.'))}
    <div class="viz">${vApiladas({ cols: zon, claves: ['suave', 'medio', 'duro'], colores: [`color-mix(in srgb,${col} 35%,var(--paper))`, `color-mix(in srgb,${col} 65%,var(--paper))`, col], tip: c => `Semana del ${c[0]}: ${nf(c[1][0])} h suaves, ${nf(c[1][1])} h medias, ${nf(c[1][2])} h duras`, aria: 'Horas suaves, medias y duras por semana', fmt: v => nf(v, 1) })}</div>
    <div class="leyenda"><span><i style="background:color-mix(in srgb,${col} 35%,var(--paper))"></i>Suave</span><span><i style="background:color-mix(in srgb,${col} 65%,var(--paper))"></i>Medio</span><span><i style="background:${col}"></i>Duro</span></div>`));
  const vol = sems.map(w => { const wk = (M.weeks || []).find(x => x[0] === w); return [fDia(w), ((wk && wk[1][dep]) || 0) / 60, w === SEM]; });
  out.push(blk(`${vizT('Volumen por semana', info(`vol-${dep}`, 'Volumen por semana', `Horas de ${SPORTS[dep].n.toLowerCase()} cada semana. La de esta semana va más clara porque aún no ha acabado.`))}
    <div class="viz">${vBarras({ datos: vol, y0: 0, y1: niceMax(Math.max(...vol.map(v => v[1]), 1)), ticks: vTicks(0, niceMax(Math.max(...vol.map(v => v[1]), 1))), h: 160, color: d => d[2] ? `color-mix(in srgb,${col} 45%,var(--paper))` : col,
      tip: d => `Semana del ${d[0]}: ${nf(d[1])} h${d[2] ? ' (en curso)' : ''}`, etiqueta: d => d[1] ? nf(d[1]) : '', aria: 'Horas por semana', fmt: v => nf(v, 0) })}</div>`));
  // Subidas en bici: VAM
  if (dep === 'bici') { const subs = as.filter(a => a.sub && !a.sub.remonte && a.sub.min >= 8).slice(-10);
    if (subs.length >= 3) { const y1 = niceMax(Math.max(...subs.map(a => a.sub.vam)));
      out.push(blk(`${vizT('VAM en tus subidas', info('vam', 'VAM en tus subidas', 'Metros de desnivel por hora en la subida más larga de cada salida (de más de 8 minutos). Sirve para comparar puertos parecidos.'))}
        <div class="viz">${vBarras({ datos: subs.map(a => [fDia(a.f), a.sub.vam, a]), y0: 0, y1, ticks: vTicks(0, y1), h: 170, color: () => col, tip: d => `${d[0]}: ${d[1]} m/h, ${nf(d[2].sub.km)} km y ${d[2].sub.desn} m a ${d[2].sub.fc} ppm`, aria: 'VAM en la subida principal de cada salida', fmt: v => nf(v, 0) })}</div>`)); } }
  out.push(blk(`${blkH('Durabilidad, combustible y desacople', info('pend', 'Lo que falta por guardar', 'La stamina mínima de cada salida larga, los gramos de hidrato por hora que tomaste y el desacople del pulso (cuánto sube al final a igual ritmo) los calcula tu Claude al analizar una salida, pero aún no se guardan en myCoach. Cuando el conector los guarde, saldrán aquí con su gráfica.'))}
    <p class="muted">Aún no se guardan. Mientras, pídeselos a tu Claude.</p><div class="btns"><button class="btn tonal" type="button" data-a="v-encargo" data-v="4">Preguntárselo a Claude</button></div>`));
  return `${bloqueMismaRuta(dep)}<div class="grid2">${out.join('')}</div>`;
}

function progForma() {
  const c = coachHoy(), f = c && (c.forma || (c.demo ? { forma_ctl: 48, fatiga_atl: 56, frescura_tsb: -8 } : null)), P = M.perfil || {}, g = S.goal || {}, m = MODOS[g.modo] || MODOS.forma;
  const tsb = f && f.frescura_tsb != null ? Math.round(f.frescura_tsb) : null;
  const zona = tsb == null ? null : tsb < -30 ? ['bad', '!', 'Muy cargado', 'Llevas mucha carga: unos días suaves te harán bien.'] : tsb < -10 ? ['good', '↑', 'Cargado, ganando forma', 'Entrenas lo suficiente para mejorar. Cargado no quiere decir fresco: antes de una prueba, toca bajar.'] : tsb <= 10 ? ['neutral', '=', 'En equilibrio', 'Ni cargado ni fresco: buena base para meter una semana fuerte.'] : ['good', '✓', 'Fresco', 'Llegas descansado: buen momento para una prueba o una salida exigente.'];
  const gar = [['VO2máx', P.vo2, v => nf(v, 0)], ['Endurance Score', P.es, v => nf(v, 0)], ['Hill Score', P.hill, v => nf(v, 0)]].filter(x => x[1] != null);
  return `${blk(`${blkH('Tu frescura', info('fres', 'Tu frescura', 'Es tu forma (la carga media de las últimas 6 semanas) menos tu fatiga (la de los últimos 7 días). La carga de cada actividad sale de su pulso y su duración. Más negativo, más cargado.'))}
      ${tsb == null ? '<p class="muted">Aún no tengo tu frescura: la calcula el entrenador con tus actividades.</p>' : `<p><b style="font-size:44px;font-stretch:72%;font-weight:800;line-height:1">${tsb > 0 ? '+' : tsb < 0 ? '−' : ''}${Math.abs(tsb)}</b> ${tag(zona[0], zona[1], zona[2])}</p><p style="margin-top:8px">${zona[3]}</p>
      <div style="margin-top:12px">${escalaFrescura(tsb)}</div><p class="xs muted" style="margin-top:8px">${Math.round(f.forma_ctl)} de forma menos ${Math.round(f.fatiga_atl)} de fatiga.</p>`}`, 'first')}
    <div class="grid2">
    ${blk(`${blkH('Lo que dice Garmin', '<button class="link" type="button" data-a="push" data-v="evo">Ver evolución</button>')}${gar.length ? `<div class="tot">${gar.map(([n, v, fmt]) => `<div><span class="n">${n}</span><b>${fmt(v)}</b></div>`).join('')}</div>` : '<p class="muted">Aún no hay datos de Garmin.</p>'}`)}
    ${blk(`${blkH('Tu objetivo', '<button class="link" type="button" data-a="push" data-v="objetivo">Cambiar</button>')}<p><b>${esc(g.titulo || m.n)}</b>${g.fecha ? `, ${fDia(g.fecha)}` : ''}</p><p class="small muted" style="margin-top:4px">${(() => { const o = objetivos(); return `${o.h[0]}-${o.h[1]} h por semana, ${o.int[0]}-${o.int[1]} sesiones intensas y ${o.fuerza} de fuerza.`; })()}</p>`)}
    </div>`;
}

function tabProgresoV1() {
  const hace = addDays(HOY, -120); const deps = DEP_PROG.filter(d => S.sports.includes(d) || acts().some(a => a.dep === d && a.f > hace));
  if (!V.prog || (V.prog !== 'forma' && !deps.includes(V.prog))) V.prog = deps[0] || 'forma';
  const segs = [['forma', 'Forma'], ...deps.map(d => [d, SPORTS[d].n])];
  return { title: 'Progreso', html: `<div class="v1"><header class="v1-h"><h1>Progreso</h1></header>
    ${segs.length > 1 ? `<div class="seg-row"><div class="seg2" role="group" aria-label="Qué ver">${segs.map(([k, l]) => `<button type="button" data-a="v-prog" data-v="${k}" aria-pressed="${V.prog === k}">${l}</button>`).join('')}</div></div>` : ''}
    ${V.prog === 'forma' ? progForma() : progDep(V.prog)}</div>` };
}
Object.assign(ACTIONS, { 'v-sync': () => sync(true) });
