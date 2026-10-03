/* ===== v1 · Pueblos: ¿cuánto he hecho y por dónde he pasado? =====
   Arriba, el resumen de lo hecho (este mes, este año o desde el inicio) y tu año día a día.
   Debajo, el mapa de pueblos y la lista de siempre. */

function resumenPeriodo(p) {
  const y = HOY.slice(0, 4), m = HOY.slice(0, 7);
  const as = acts().filter(a => p === 'todo' || (p === 'año' ? a.f.startsWith(y) : a.f.startsWith(m)));
  const dep = {}; as.forEach(a => { dep[a.dep] = (dep[a.dep] || 0) + a.min; });
  return { n: as.length, h: as.reduce((s, a) => s + a.min, 0) / 60, km: as.reduce((s, a) => s + (SPORTS[a.dep]?.cardio ? a.km || 0 : 0), 0), desn: as.reduce((s, a) => s + (a.desn || 0), 0), dep,
    desde: as.length ? as[as.length - 1].f : null };
}
function calendarioAño() {
  const ini = weekOf(addDays(HOY, -364)), minDia = {};
  acts().forEach(a => { if (a.f >= ini) minDia[a.f] = (minDia[a.f] || 0) + a.min; });
  const dias = Math.round((dte(HOY) - dte(ini)) / 864e5) + 1;
  const celdas = Array.from({ length: Math.ceil(dias / 7) * 7 }, (_, i) => { const f = addDays(ini, i); if (f > HOY) return '<i class="x"></i>';
    const mn = minDia[f] || 0, l = !mn ? '' : mn < 60 ? 'l1' : mn < 120 ? 'l2' : 'l3'; return `<i class="${l}" ${mn ? `data-tip="${esc(`${fDia(f)}: ${dur(mn)}`)}"` : ''}></i>`; }).join('');
  // Racha: semanas seguidas (hasta la actual) con al menos 3 días activos
  let racha = 0; for (let w = SEM; ; w = addDays(w, -7)) { const d = new Set(acts().filter(a => weekOf(a.f) === w).map(a => a.f)); if (d.size >= 3) racha++; else if (w !== SEM) break; if (racha > 104) break; }
  const activos = Object.keys(minDia).length;
  return { celdas, racha, activos };
}

function tabPueblosV1() {
  const p = V.pueb, r = resumenPeriodo(p), cal = calendarioAño();
  const deps = Object.entries(r.dep).sort((a, b) => b[1] - a[1]); const tot = deps.reduce((s, [, v]) => s + v, 0) || 1;
  const titulo = { mes: `En ${MS[dte(HOY).getMonth()]}`, año: `En ${HOY.slice(0, 4)}`, todo: r.desde ? `Desde ${MC[dte(r.desde).getMonth()]} de ${r.desde.slice(0, 4)}` : 'Desde el inicio' }[p];
  // El mapa y la lista de siempre, sin su cabecera
  const mapa = tabPueblos().html.replace(/^<header class="bigtitle">[\s\S]*?<\/header>/, '');
  return { title: 'Pueblos', html: `<div class="v1"><header class="v1-h"><h1>Pueblos</h1><p>Todo lo que has hecho y por dónde has pasado.</p></header>
    <div class="seg-row"><div class="seg2" role="group" aria-label="Periodo">${[['mes', 'Este mes'], ['año', 'Este año'], ['todo', 'Desde el inicio']].map(([k, l]) => `<button type="button" data-a="v-pueb" data-v="${k}" aria-pressed="${p === k}">${l}</button>`).join('')}</div></div>
    ${blk(`${blkH(titulo, M.fuente === 'demo' ? '<span class="demo-tag">Ejemplo</span>' : '')}
      <div class="tot x4"><div><b>${nf(r.h, r.h < 10 ? 1 : 0)}</b><span class="n">horas</span></div><div><b>${nf(r.km, 0)}</b><span class="n">kilómetros</span></div><div><b>${nf(r.desn, 0)}</b><span class="n">metros de desnivel</span></div><div><b>${r.n}</b><span class="n">actividades</span></div></div>
      ${deps.length ? `<div class="reparto" role="img" aria-label="Reparto de horas: ${deps.map(([k, v]) => `${SPORTS[k].n} ${Math.round(v / tot * 100)} %`).join(', ')}">${deps.map(([k, v]) => `<i style="flex:${v};background:${scol(k)}"></i>`).join('')}</div>
      <div class="leyenda">${deps.map(([k, v]) => `<span><i style="background:${scol(k)}"></i>${SPORTS[k].n} ${Math.round(v / tot * 100)} %</span>`).join('')}</div>` : ''}`, 'first')}
    <div class="grid2">
    ${blk(`${vizT('Tu año, día a día', info('cal', 'Tu año, día a día', 'Cada cuadro es un día de los últimos doce meses; más oscuro, más horas: menos de 1 h, de 1 a 2 h y más de 2 h. Las columnas son semanas, de lunes a domingo.'))}
      <div class="heat viz" role="img" aria-label="Los últimos doce meses día a día: ${cal.activos} días con actividad">${cal.celdas}</div>
      <div class="leyenda"><span><i style="background:var(--fill)"></i>Nada</span><span><i style="background:color-mix(in srgb,var(--s-bici) 30%,var(--fill))"></i>Menos de 1 h</span><span><i style="background:color-mix(in srgb,var(--s-bici) 60%,var(--fill))"></i>1-2 h</span><span><i style="background:var(--s-bici)"></i>Más de 2 h</span></div>
      <p class="lee">${cal.activos} días con actividad en un año.${cal.racha >= 2 ? ` Llevas ${cal.racha} semanas seguidas con al menos 3 días.` : ''}</p>`)}
    ${blk(`${blkH('Por dónde has pasado')}${mapa}`)}
    </div></div>` };
}
