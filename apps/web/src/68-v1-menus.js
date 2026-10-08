/* ===== v1 · Comer: la semana de comidas, como la de entrenos =====
   La decide el conector (comida_plan): la carga de cada día sale del plan de entrenos y da el
   código de hidrato de cada comida. La web lo enseña; los menús los propone tu Claude y se
   guardan con tu sí (comida_proponer). Sin calorías: cuartos de plato. */

const MENUS = { off: 0, datos: {} }; // datos[lunes]: undefined · 'cargando' · null (error) · respuesta de comida_plan
const COMPRA = { datos: {} };
const MOMENTOS_W = [['desayuno', 'Desayuno'], ['comida', 'Comida'], ['merienda', 'Merienda'], ['cena', 'Cena']];
const NIVEL_TXT = { alto: 'Hidrato alto', medio: 'Hidrato medio', bajo: 'Hidrato bajo' };
const CARGA_TXT = { duro: 'Día duro', moderado: 'Día moderado', suave: 'Día suave' };

async function cargarMenus(lunes, fresco) {
  if (MENUS.datos[lunes] === 'cargando') return;
  const fuente = fuenteDatos(); if (fuente === 'espera') { cuandoHayaConector(); return; }
  if (fuente === 'demo') { MENUS.datos[lunes] = menusDemo(lunes); return; }
  MENUS.datos[lunes] = 'cargando';
  try { MENUS.datos[lunes] = await coachCall('comida_plan', { semana: lunes }, fresco); } catch (e) { MENUS.datos[lunes] = null; }
  render(); if (sheetState?.id === 'menu-dia') fillSheet();
}
/* El plan de comidas de un día ya leído, o null */
function menuDelDia(f) { const d = MENUS.datos[weekOf(f)]; return d && typeof d === 'object' ? d.dias.find(x => x.fecha === f) || null : null; }

/* Modo demo: la misma forma que comida_plan, con unos platos de ejemplo */
function menusDemo(lunes) {
  const ej = { comida: ['Lentejas con verduras', 'Arroz con pollo', 'Macarrones con atún', 'Garbanzos con espinacas', 'Merluza con patata'], cena: ['Tortilla y ensalada', 'Salmón con verduras', 'Pasta con tomate y huevo', 'Pisto con huevo', 'Crema de calabaza y pollo'] };
  const dias = days7(lunes).map((f, i) => {
    const cg = cargaDia(f), k = cg.k === 'medio' ? 'moderado' : cg.k, cod = { duro: 'alto', moderado: 'medio', suave: 'bajo' }[k];
    const vispera = cargaDia(addDays(f, 1)).k === 'duro';
    const comidas = Object.fromEntries(MOMENTOS_W.map(([m]) => {
      const h = m === 'merienda' ? (k === 'duro' ? 'medio' : 'bajo') : m === 'cena' && vispera ? 'alto' : cod;
      const plato = i < 5 && ej[m] ? ej[m][i] : null;
      return [m, { hidrato: h, texto: NIVEL_TXT[h], por_que: m === 'cena' && vispera ? 'mañana es día duro' : `día ${k}`, cuartos_hidrato: h === 'alto' ? '2' : h === 'medio' ? '1-2' : m === 'merienda' ? '0-1' : '1', plan: plato ? { descripcion: plato, carbohidrato: h === 'alto' ? 2 : 1, proteina: 1, verdura: h === 'alto' ? 1 : 2 } : null }];
    }));
    return { fecha: f, carga: { nivel: k, texto: cg.txt }, comidas };
  });
  return { demo: true, lunes, dias, avisos: [], antes_de_proponer: [] };
}

const nPlaneadas = d => MOMENTOS_W.filter(([m]) => d.comidas[m]?.plan).length;
const cuartosTxt = p => `${qTxt(p.carbohidrato)} de hidrato, ${qTxt(p.proteina)} de proteína, ${qTxt(p.verdura)} de verdura`;

function filaMenu(d) {
  const f = d.fecha, dt = dte(f), n = nPlaneadas(d);
  const principales = ['comida', 'cena'].map(m => d.comidas[m]).filter(x => x?.plan).map(x => x.plan.descripcion);
  const nivel = d.comidas.comida?.hidrato;
  const lineaPlan = principales.length ? principales.join(' · ') : n ? `${n} de 4 comidas` : 'Sin menú';
  return `<li class="${f === HOY ? 'es-hoy' : ''}"><button type="button" data-a="menu-dia" data-v="${f}" aria-label="${cap1(fLarga(f))}: ${CARGA_TXT[d.carga.nivel]}, ${esc(lineaPlan)}, ${n} de 4 comidas planeadas">
    <span class="fd" aria-hidden="true"><small>${DC[dt.getDay()]}</small><b>${dt.getDate()}</b></span>
    <span class="t"><b class="sin-marca">${CARGA_TXT[d.carga.nivel]}<span class="nivel">${NIVEL_TXT[nivel] || ''}</span></b><span class="small ${principales.length ? '' : 'muted'}">${esc(lineaPlan)}</span></span>
    <span class="st"></span></button></li>`;
}

/* El bloque de Comer: la semana (esta o la siguiente), con su lista de la compra */
function bloqueMenus() {
  const w = addDays(SEM, 7 * MENUS.off);
  if (MENUS.datos[w] === undefined) cargarMenus(w, true);
  const d = MENUS.datos[w];
  const nav = `<div class="blk-h"><button class="iconbtn" type="button" data-a="menu-sem" data-v="-1" aria-label="Esta semana" ${MENUS.off <= 0 ? 'disabled' : ''}>${ic('back', 22)}</button>
    <h2 style="text-align:center">${MENUS.off ? 'Menús de la semana que viene' : 'Menús de esta semana'}</h2><button class="iconbtn" type="button" data-a="menu-sem" data-v="1" aria-label="Semana que viene" ${MENUS.off >= 1 ? 'disabled' : ''}><span style="display:inline-block;transform:scaleX(-1)">${ic('back', 22)}</span></button></div>`;
  let cuerpo;
  if (d === undefined || d === 'cargando') cuerpo = '<p class="muted" role="status">Leyendo tus menús…</p>';
  else if (d === null) cuerpo = '<p>No he podido leer tus menús.</p><div class="btns"><button class="btn tonal" type="button" data-a="menu-recargar">Volver a probar</button></div>';
  else {
    const total = d.dias.reduce((a, x) => a + nPlaneadas(x), 0);
    const avisos = (d.avisos || []).filter(a => a.regla !== 'alergia_sin_saber').slice(0, 3);
    cuerpo = `${d.demo ? '<p class="small muted" style="margin:-4px 0 12px"><span class="demo-tag">Ejemplo</span></p>' : ''}
      ${total ? '' : `<p class="muted" style="margin:-4px 0 12px">Aún no hay menús. Tu Claude los reparte según tus entrenos (más hidrato el día duro y la víspera del fondo) y te los enseña antes de guardarlos.</p>`}
      <ul class="dias">${d.dias.map(filaMenu).join('')}</ul>
      ${avisos.length ? `<div class="avisos-menu">${avisos.map(a => `<p class="small">${ic('info', 16)}<span>${esc(a.texto)}</span></p>`).join('')}</div>` : ''}
      <div class="btns"><button class="btn tonal" type="button" data-a="menu-claude" data-v="${w}">${total ? 'Cambiarlos con Claude' : 'Prepararlos con Claude'}</button>${total ? `<button class="link" type="button" data-a="menu-compra" data-v="${w}">Lista de la compra</button>` : ''}</div>`;
  }
  return blk(`${nav}${cuerpo}`);
}

/* La hoja de un día: cada comida con su código de hidrato y lo que hay planeado */
function sheetMenuDia(f) {
  openSheet({ title: cap1(fLarga(f)), size: 'auto', id: 'menu-dia', body: () => {
    const d = menuDelDia(f); if (!d) return '<p class="muted">Leyendo el menú…</p>';
    const hechas = (S.meals || []).filter(m => m.f === f);
    const filas = MOMENTOS_W.map(([m, n]) => {
      const x = d.comidas[m], p = x.plan, hecha = hechas.find(r => tipoMeal(r) === m);
      const estado = hecha ? `<span class="small" style="display:block">✓ Registrada: ${esc(hecha.txt || n)}</span>`
        : p && f === HOY ? `<button class="link" type="button" data-a="menu-comido" data-v="${f}" data-k="${m}">Me lo he comido</button>` : '';
      // El porqué solo cuando no es la carga del día, que ya está arriba (la víspera del fondo, por ejemplo).
      const propio = x.por_que && !/^d[ií]a /i.test(x.por_que);
      return `<li><div class="menu-c"><span class="menu-h"><b>${n}</b><span class="nivel">${esc(x.texto)}${x.cuartos_hidrato ? `: ${x.cuartos_hidrato} ${x.cuartos_hidrato === '1' ? 'cuarto' : 'cuartos'}` : ''}</span></span>
        ${propio ? `<span class="small muted" style="display:block">Porque ${esc(x.por_que)}</span>` : ''}
        ${x.fuera ? `<span class="agenda-l small">${ic('lock', 14)}<span>Fuera: ${esc(x.fuera)}</span></span>` : ''}
        <p style="margin:6px 0 0">${p ? `<b>${esc(p.descripcion)}</b><span class="small muted" style="display:block">${cuartosTxt(p)}</span>` : '<span class="muted">Sin menú</span>'}</p>${estado}</div></li>`;
    }).join('');
    return `<p class="dia-t" style="margin-top:0">${CARGA_TXT[d.carga.nivel]}<span class="small muted" style="display:block;font-weight:400">${esc(cap1(d.carga.texto))}${d.sesion ? `: ${esc(d.sesion)}` : ''}</span></p>
      <ul class="filas">${filas}</ul>
      ${f >= HOY ? `<div class="btns"><button class="btn tonal" type="button" data-a="menu-claude-dia" data-v="${f}">Cambiar este día con Claude</button></div>` : ''}`;
  } });
}

/* La lista de la compra de lo que queda de la semana, por pasillo */
async function sheetCompra(w) {
  openSheet({ title: 'Lista de la compra', size: 'large', id: 'compra', body: () => {
    const c = COMPRA.datos[w];
    if (c === undefined || c === 'cargando') return '<p class="muted" role="status">Haciendo la lista…</p>';
    if (c === null) return '<p>No he podido hacer la lista.</p><div class="btns"><button class="btn tonal" type="button" data-a="menu-compra" data-v="' + w + '">Volver a probar</button></div>';
    const sin = c.sin_ingredientes || [];
    return `<p class="small muted">Lo que queda de la semana, sacado de los platos con ingredientes guardados.</p>
      ${c.pasillos.length ? c.pasillos.map(p => `<h3 class="met-h" style="margin-top:16px">${esc(cap1(p.pasillo))}</h3><ul class="filas">${p.ingredientes.map(i => `<li><b>${esc(i.nombre)}</b><span class="small muted" style="display:block">${i.cantidades ? `${esc(i.cantidades.join(' + '))} · ` : ''}${esc(i.platos.join(', '))}</span></li>`).join('')}</ul>`).join('')
        : '<p>Ningún plato de lo que queda tiene ingredientes guardados todavía.</p>'}
      ${sin.length ? `<h3 class="met-h" style="margin-top:16px">Sin ingredientes guardados</h3><p class="small muted">${esc(sin.join('; '))}. Pídele a tu Claude que guarde esos platos con sus ingredientes.</p>` : ''}
      ${c.pasillos.length ? '<div class="btns"><button class="btn fill" type="button" data-a="compra-copiar">Copiar la lista</button></div>' : ''}`;
  } });
  if (COMPRA.datos[w] === 'cargando') return;
  if (fuenteDatos() === 'demo') { COMPRA.datos[w] = { pasillos: [{ pasillo: 'despensa', ingredientes: [{ nombre: 'Lentejas', cantidades: ['80 g', '80 g'], platos: ['Lentejas con verduras'] }, { nombre: 'Macarrones', cantidades: ['90 g'], platos: ['Macarrones con atún'] }] }, { pasillo: 'fruta y verdura', ingredientes: [{ nombre: 'Espinacas', cantidades: ['1 bolsa'], platos: ['Garbanzos con espinacas'] }] }], sin_ingredientes: [] }; fillSheet(); return; }
  COMPRA.datos[w] = 'cargando'; fillSheet();
  try { COMPRA.datos[w] = (await coachCall('comida_plan', { semana: w, lista_compra: true }, true)).lista_compra; } catch (e) { COMPRA.datos[w] = null; }
  if (sheetState?.id === 'compra') fillSheet();
}
function textoCompra(c) { return c.pasillos.map(p => `${cap1(p.pasillo)}:\n${p.ingredientes.map(i => `- ${i.nombre}${i.cantidades ? ` (${i.cantidades.join(' + ')})` : ''}`).join('\n')}`).join('\n\n'); }

Object.assign(ACTIONS, {
  'menu-sem': el => { MENUS.off = Math.max(0, Math.min(1, MENUS.off + +el.dataset.v)); render(); },
  'menu-recargar': () => { const w = addDays(SEM, 7 * MENUS.off); MENUS.datos[w] = undefined; cargarMenus(w, true); },
  'menu-dia': el => sheetMenuDia(el.dataset.v),
  'menu-compra': el => { COMPRA.datos[el.dataset.v] = undefined; sheetCompra(el.dataset.v); },
  'compra-copiar': () => { const c = Object.values(COMPRA.datos).find(x => x && typeof x === 'object'); if (!c) return;
    const t = textoCompra(c); (navigator.clipboard?.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Lista copiada'), () => toast('No he podido copiarla')); },
  'menu-claude': el => enClaude(`${el.dataset.v === SEM ? 'Prepárame los menús de lo que queda de esta semana' : 'Prepárame los menús de la semana que viene'} con myCoach: mira comida_plan (la carga de cada día, el hidrato que toca en cada comida y lo que aún no sabes de mí), usa mis platos guardados (comida_platos) y propónmelos con comida_proponer. Enséñamelos antes de guardarlos.`),
  'menu-claude-dia': el => { closeSheet(); enClaude(`Cambia el menú del ${fLarga(el.dataset.v)} con myCoach: mira comida_plan para ese día, propónmelo con comida_proponer y enséñamelo antes de guardarlo.`); },
  // Registra lo previsto como en "Añadir comida": se guarda en tu estado y lo ve tu Claude. Se puede deshacer.
  'menu-comido': el => { const f = el.dataset.v, k = el.dataset.k, x = menuDelDia(f)?.comidas[k]?.plan; if (!x) return;
    const n = MOMENTOS_W.find(([m]) => m === k)[1], m = { id: 'm' + Date.now(), f, h: new Date().toTimeString().slice(0, 5), tipo: n, c: x.carbohidrato, p: x.proteina, v: x.verdura, txt: x.descripcion, img: null, ia: false };
    S.meals.push(m); save(); render(); fillSheet();
    toast(`${n} registrada`, { undo: () => { S.meals = S.meals.filter(r => r !== m); save(); render(); fillSheet(); } }); },
});
