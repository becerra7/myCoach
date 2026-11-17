/* ===== v2 · Comer: ¿qué como hoy y cuándo? =====
   Arriba, cómo es el día y cuánto llevas (en cuartos de plato, sin calorías) con una sola acción: registrar.
   La línea de tiempo del día vive aquí (en Hoy solo sale lo siguiente). Menús, lista de la compra e histórico,
   cada uno en su pantalla. */
function tabComerV2() {
  const o = objetivosComida(HOY), sum = sumaComida(HOY), falta = o.hidrato[0] - sum.c, s = sesion(HOY), menu = menuDelDia(HOY);
  const frase = !sum.ms.length ? `${o.cg.n}: aún no has registrado nada.` : falta > 0 ? `${o.cg.n}: te ${falta === 1 ? 'falta' : 'faltan'} ${qTxt(falta)} de hidrato.` : sum.c > o.hidrato[1] ? `${o.cg.n}: llevas ${qTxt(sum.c - o.hidrato[1])} de hidrato de más.` : `${o.cg.n}: vas en objetivo de hidrato.`;
  const rango = ([lo, hi]) => lo === hi ? nf(lo) : `${nf(lo)}-${nf(hi)}`;
  // En sesiones largas, lo que hay que llevar ya lo dice la línea del entreno en "Tu día": aquí solo se avisa de cuándo no hace falta nada.
  const durante = s && SPORTS[s.dep]?.cardio && s.t !== 'descanso' && !s.a && !(s.min >= 90) ? 'La sesión de hoy dura menos de 90 min: con agua basta.' : '';
  const delMenu = menu ? Object.values(menu.comidas || {}).map(c => c?.plan?.descripcion).filter(Boolean) : [];
  return { title: 'Comer', html: `<div class="v2">${cab2('Comer', `${cap1(fLarga(HOY))}${S.modo === 'demo' ? ' · <span class="demo-tag">Ejemplo</span>' : ''}`)}
    <div class="v2-cols"><div class="col">
      <section class="card" aria-label="Cómo vas hoy"><p class="frase" style="font-size:24px">${esc(frase)}</p><p class="small muted">${esc(cap1(o.cg.txt))}. La medida es el cuarto de plato.</p>
        ${barra2('Hidrato', `${nf(sum.c)} de ${rango(o.hidrato)} cuartos`, sum.c / o.hidrato[1] * 100)}
        ${barra2('Proteína', `${nf(sum.p)} de ${rango(o.proteina)} cuartos`, sum.p / o.proteina[1] * 100)}
        <button class="btn fill wide" type="button" data-a="v2-registrar">Registrar una comida</button></section>
      <div class="comer-dia">${bloqueDia(false)}</div>
    </div><div class="col">
      ${grupo2(fila2('Menús de la semana', esc(delMenu.length ? `Hoy: ${delMenu.slice(0, 2).join(' · ')}` : 'Hoy no hay menú preparado'), 'data-a="push" data-v="menus"')
        + fila2('Lista de la compra', 'Lo que queda de la semana, por pasillo', `data-a="menu-compra" data-v="${SEM}"`)
        + fila2('Cómo comes según entrenas', 'El hidrato de cada día frente a su carga', 'data-a="push" data-v="comer-hist"'))}
      ${durante ? `<section class="card" aria-labelledby="dur-t"><h2 class="g-h" id="dur-t" style="padding:0"><span>Durante el entreno</span></h2><p>${esc(durante)}</p></section>` : ''}
    </div></div></div>` };
}
tabV2('comer', tabComerV2);
scrV2('menus', () => ({ title: 'Menús', html: `<div class="v2">${cab2('Menús de la semana')}${bloqueMenus()}</div>` }));
scrV2('comer-hist', () => ({ title: 'Cómo comes', html: `<div class="v2">${cab2('Cómo comes según entrenas', 'Las dos últimas semanas')}${historicoComida()}</div>` }));
Object.assign(ACTIONS, {
  'v2-registrar': () => openSheet({ title: 'Registrar una comida', size: 'auto', id: 'v2-registrar', body: () => `<div class="list">
      ${fila2('Con tu Claude', 'Mándale una foto o cuéntaselo: lo pasa a cuartos de plato', 'data-a="v2-registrar-claude"')}
      ${fila2('A mano', 'Eliges los cuartos de hidrato y de proteína', 'data-a="meal-add"')}</div>` }),
  'v2-registrar-claude': () => { closeSheet(); enClaude(ENCARGOS[1][1]); },
});
