/* ===== v2 · Hoy: ¿qué hago hoy y por qué? =====
   Nivel 1, sin desplazar: la frase del entrenador, la sesión y una acción.
   Nivel 2, a un toque: por qué (los datos de la noche), ajustar la sesión, cómo te encuentras.
   Después de entrenar la pantalla cambia: lo hecho, cómo ha ido (un toque) y lo que queda del día.
   El método lo pone el conector (coach_hoy); aquí solo se ordena y se dice en llano. */

const minus1 = t => t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
// "Hoy toca fondo largo", pero "Hoy toca Bellver": solo se pasa a minúscula lo que es una palabra de entreno, no un nombre propio.
const PAL_SESION = /^(fondo|rodillo|rodaje|series|umbral|tempo|correr|bici|fuerza|tren|salida|recuperaci[oó]n|intervalos|skimo|largo|suave|tirada|cuestas|core|pierna|sweet|subida|trote|z[1-5])\b/i;
const tituloHoy = t => PAL_SESION.test(t) ? minus1(t) : t;
/* La frase: lo que propone el motor o la sesión del plan, y su porqué (las mismas razones que da coach_hoy) */
function fraseHoy(c, s, hecho) {
  const sm = c && c.semaforo, motivos = sm ? (sm.color === 'verde' ? sm.positivos : sm.razones) || [] : [];
  const porque = motivos.length ? `${cap1(motivos.slice(0, 2).join(' y '))}.` : '';
  if (hecho) return { t: `Hecho: ${minus1(SPORTS[hecho.dep]?.n || 'entreno')}, ${dur(hecho.min)}.`, s: 'Hoy ya solo toca recuperar.' };
  if (c?.ya_entrenado_hoy?.length) return { t: 'Ya has entrenado hoy.', s: 'Ahora toca recuperar.' };
  if (c?.propuesta?.texto) return { t: c.propuesta.texto, s: porque };
  if (!s) return { t: 'Hoy tienes el día libre.', s: sm ? (sm.color === 'verde' ? `${porque} Buen día para algo suave si te apetece.`.trim() : `${porque} Hoy, mejor descansar.`.trim()) : '' };
  if (s.t === 'descanso') return { t: 'Hoy toca descanso.', s: porque };
  return { t: `Hoy toca ${tituloHoy(String(s.d).split(',')[0])}.`, s: porque };
}
const TXT_SEM = { verde: 'Vas bien', ambar: 'Mejor suave', rojo: 'Toca recuperar' };

function tarjetaSesion(c, s) {
  if (!s || s.t === 'descanso') return '';
  const resto = String(s.d).split(',').slice(1).join(',').trim();
  // Cómo hacerla (series, zonas, condiciones): unas líneas aquí y entera en "Ver la sesión".
  const como = [resto && resto.length > 12 ? cap1(resto) : '', s.detalle || ''].filter(Boolean).join('. ').replace(/\.\. /g, '. ');
  const prop = c?.propuesta?.sesion ? `<div class="cambio" role="group" aria-label="Cambio propuesto" style="margin-top:0">
      <p>${tag('warn', '!', 'Con tu estado, mejor ajustarla')}</p>
      <div class="antes-despues"><div><span class="xs muted">Antes</span><p><s>${esc(s.d)}</s></p></div><div class="ahora"><span class="xs muted">Después</span><p><b>${esc(c.propuesta.sesion.d || '')}</b></p></div></div>
      <div class="btns" style="margin-top:12px"><button class="btn fill" type="button" data-a="coach-aplicar">Aplicar el cambio</button><button class="link" type="button" data-a="coach-claude">Hablarlo con Claude</button></div></div>` : '';
  return `<section class="card" aria-label="La sesión de hoy">
    ${depL(s.dep, `${SPORTS[s.dep]?.n || ''}${s.ruta ? ` · ${esc(s.ruta)}` : ''}`)}
    ${facts2([s.min ? ['Duración', dur(s.min)] : null, TIPOS[s.t] && s.t !== 'otros' ? ['Intensidad', TIPOS[s.t].n] : null, resto && resto.length <= 12 ? ['Objetivo', esc(resto)] : null])}
    ${como ? `<p class="small muted ses-como">${esc(como)}</p>` : ''}
    ${prop}
    <div class="btns-col">${s.dep === 'fuerza' ? `<button class="btn ${prop ? 'tonal' : 'fill'} wide" type="button" data-a="fv-empezar" data-v="${HOY}">Empezar el entreno</button><button class="link" type="button" data-a="day" data-v="${HOY}">Ver los ejercicios</button>`
      : `<button class="btn ${prop ? 'tonal' : 'fill'} wide" type="button" data-a="day" data-v="${HOY}">Ver la sesión</button>`}<button class="link" type="button" data-a="v-no100">No estoy al 100 %</button></div>
  </section>`;
}

/* Después de entrenar: lo hecho y cómo ha ido, con un toque. El esfuerzo se guarda donde lo guarda tu Claude
   al analizar la salida (salida_guardar, rpe de 1 a 10), así los dos ven lo mismo. */
const RPE_OPC = [[3, 'Fácil'], [5, 'Bien'], [7, 'Duro'], [9, 'Muy duro']];
const rpeCerca = v => v == null ? null : RPE_OPC.reduce((m, o) => Math.abs(o[0] - v) < Math.abs(m[0] - v) ? o : m)[0];
function tarjetaHecho(a) {
  const an = analisisDe(a.id), sel = rpeCerca(an && an.rpe), cardio = SPORTS[a.dep]?.cardio;
  return `<section class="card" aria-label="Lo que has hecho hoy">
    ${depL(a.dep, esc(a.lugar || SPORTS[a.dep]?.n || ''))}
    ${facts2([cardio && a.km ? ['Distancia', `${nf(a.km)} km`] : null, ['Tiempo', dur(a.min)], cardio && a.desn ? ['Desnivel', `${nf(a.desn, 0)} m`] : a.fc ? ['Pulso medio', `${a.fc} ppm`] : null])}
    <button class="btn tonal wide" type="button" data-a="push" data-v="actividad" data-id="${a.id}">Ver cómo ha ido</button>
  </section>
  <section class="card" aria-labelledby="rpe-t"><h2 class="g-h" id="rpe-t" style="padding:0"><span>¿Cómo ha ido?</span>${sel ? `<span class="muted" style="font-weight:400">Esfuerzo ${an.rpe} de 10</span>` : ''}</h2>
    <div class="opc4" role="group" aria-labelledby="rpe-t">${RPE_OPC.map(([v, l]) => `<button type="button" data-a="v2-rpe" data-id="${a.id}" data-v="${v}" aria-pressed="${sel === v}">${l}</button>`).join('')}</div>
    ${sel ? '' : '<p class="xs">Un toque. Tu entrenador lo tiene en cuenta al leer la salida.</p>'}
  </section>`;
}
async function guardarRpe(id, v) {
  const a = actById(id) || acts().find(x => String(x.id) === String(id)); if (!a) return;
  const antes = analisisDe(a.id), txt = RPE_OPC.find(o => o[0] === v)[1];
  const pon = rpe => { if (SZ.datos && typeof SZ.datos === 'object') SZ.datos[a.id] = { ...(SZ.datos[a.id] || {}), fecha: a.f, rpe }; };
  if (fuenteDatos() !== 'vivo') { pon(v); render(); toast(`Anotado: ${txt.toLowerCase()} (demo)`); return; }
  pon(v); render();
  try { await coachCall('salida_guardar', { activity_id: String(a.id), fecha: a.f, rpe: v }, true); toast(`Anotado: ${txt.toLowerCase()}. Puedes cambiarlo tocando otra opción.`); }
  catch (e) { pon(antes ? antes.rpe : undefined); render(); toast('No he podido anotarlo. Vuelve a probar en un momento.'); }
}

/* Lo siguiente que toca comer: el primer hueco del día sin registrar */
function siguienteComida() {
  const o = objetivosComida(HOY), sum = sumaComida(HOY), menu = menuDelDia(HOY);
  const h = HUECOS.find(([k]) => !sum.ms.some(m => tipoMeal(m) === k));
  if (!h) return fila2('Comidas del día, registradas', `${qTxt(sum.c)} de hidrato y ${qTxt(sum.p)} de proteína`, 'data-a="tab" data-v="comer"');
  const mc = menu?.comidas?.[h[0]], nivel = mc ? mc.texto : `Hidrato ${nivelHidrato(o.cg.c, h[0] === 'merienda')}`;
  return fila2(`Después, ${h[1].toLowerCase()}`, `${h[2]} · ${esc(minus1(nivel))}${mc?.plan ? ` · ${esc(mc.plan.descripcion)}` : ''}`, 'data-a="tab" data-v="comer"');
}

function tabHoyV2() {
  const c = coachHoy(), s = sesion(HOY), hecho = s?.a || acts().find(a => a.f === HOY) || null;
  const sm = c && c.semaforo, f = fraseHoy(c, s, hecho);
  const estado = hecho ? tag('good', '✓', 'Hecho') : sm ? tag(...(TONO_SEM[sm.color] || TONO_SEM.verde), TXT_SEM[sm.color] || TXT_SEM.verde) : '';
  const sentir = resumenSentir(), sinDesc = !!(c && (c.fuentes?.sin_descanso || c.semaforo?.sin_descanso));
  const datos = sm?.datos || [], lectura = datos.filter(d => d.estado && d.estado !== 'sin_dato').slice(0, 2).map(d => `${(NOMBRE_CORTO[d.clave] || d.nombre).toLowerCase()} ${(TONO_EST[d.estado] || TONO_EST.normal)[2].toLowerCase()}`).join(' · ');
  const filas = [
    sm ? fila2(sm.color === 'verde' ? 'Por qué vas bien' : 'Por qué te lo digo', esc(lectura || 'Lo que ha medido tu Garmin esta noche'), 'data-a="v2-porque"') : '',
    s && !hecho && s.t !== 'descanso' && SPORTS[s.dep]?.cardio ? fila2('Ajustar duración o intensidad', 'Ves si sigue entrando en lo que aguantas hoy', 'data-a="v2-carga"') : '',
    fila2(sentir ? 'Cómo te encuentras' : sinDesc ? '¿Cómo te encuentras hoy?' : 'Cuéntame cómo te encuentras', esc(sentir ? sentir.replace(/^Hoy: /, '') : sinDesc ? 'Tu Garmin no mide el descanso: es lo que más pesa' : 'Ánimo, físico o una molestia'), 'data-a="coach-sentir-hoja"'),
    siguienteComida(),
  ].join('');
  const aviso = cardAvisoPlan(), r = resumen(SEM), pl = planDe(SEM);
  const extra = [typeof tarjetaMolestia === 'function' ? tarjetaMolestia() : '', typeof tarjetaResumenSemana === 'function' ? tarjetaResumenSemana() : ''].join('');
  return { title: 'Hoy', html: `<div class="v2"><div class="v2-cols"><div class="col">
      <header class="hoy-cab"><p class="fecha">${cap1(fLarga(HOY))}</p>${estado}<div><h1 class="frase">${esc(f.t)}</h1>${f.s ? `<p class="frase-2">${esc(f.s)}</p>` : ''}</div></header>
      ${hecho ? tarjetaHecho(hecho) : tarjetaSesion(c, s)}
      ${!hecho && !s && sm ? '<div class="btns" style="padding:0 4px"><button class="link" type="button" data-a="v-no100">No estoy al 100 %</button></div>' : ''}
      ${extra}
    </div><div class="col">
      ${grupo2(filas)}
      ${grupo2(`<div style="padding:12px 12px 14px">${semana7(SEM)}</div>`, 'Esta semana', pl ? `<button class="link" type="button" data-a="tab" data-v="plan">${r.hechas} de ${r.plan} hechas</button>` : '')}
      ${aviso ? `<div class="card">${aviso}</div>` : ''}
      ${estadoDatos()}
    </div></div></div>` };
}
tabV2('hoy', tabHoyV2);

/* Por qué: los datos que explican el semáforo, cada uno con su lectura delante */
function hojaPorque() {
  openSheet({ title: 'Por qué', size: 'auto', id: 'v2-porque', body: () => {
    const c = coachHoy(), sm = c && c.semaforo, datos = sm?.datos || [];
    if (!datos.length) return `<p class="muted">${LIVE === undefined ? 'Abriendo tu myCoach…' : 'Garmin aún no tiene tus datos de esta noche. Necesita que duermas con el reloj puesto.'}</p>`;
    const sinDesc = !!(c.fuentes?.sin_descanso || sm.sin_descanso);
    return `<p class="muted">${sinDesc ? 'Tu Garmin no mide el sueño ni la variabilidad, así que tu entrenador decide con tu carga y con lo que le cuentes.' : 'Cada dato se compara con tu normal: tu media de las últimas 4 semanas. Toca uno para ver qué es.'}</p>
      <div class="mets2">${datos.map(d => { const [tono, ico, pal] = TONO_EST[d.estado] || TONO_EST.normal, nombre = NOMBRE_LLANO[d.clave] || NOMBRE_CORTO[d.clave] || d.nombre, v = valorCorto(d.valor);
        return `<button class="met2" type="button" data-a="met" data-v="${esc(d.clave)}" aria-label="${esc(nombre)}: ${pal}, ${esc(v)}. Ver qué es"><span class="n">${esc(nombre)}</span><span class="v">${esc(v)}${d.normal ? ` · ${d.clave === 'carga_garmin' ? 'tu franja' : 'tu normal'}, ${esc(d.normal)}` : ''}</span>${tag(tono, ico, pal)}</button>`; }).join('')}</div>`; } });
}
const NOMBRE_LLANO = { readiness: 'Recuperación (Readiness)', vfc: 'Variabilidad (VFC)', pulso: 'Pulso en reposo', frescura: 'Frescura', carga_garmin: 'Carga de la semana', sueno: 'Sueño' };
function hojaCarga() {
  openSheet({ title: 'Ajustar la sesión', size: 'auto', id: 'v2-carga', body: () => bloqueCarga(coachHoy(), sesion(HOY)) || '<p class="muted">Hoy no hay una sesión que ajustar.</p>' });
}
{ const aplicar = ACTIONS['v-carga-aplicar']; ACTIONS['v-carga-aplicar'] = el => { const enHoja = sheetState && sheetState.id === 'v2-carga'; if (enHoja) closeSheet(); aplicar(el); }; }
Object.assign(ACTIONS, {
  'v2-porque': () => hojaPorque(), 'v2-carga': () => hojaCarga(),
  'v2-rpe': el => guardarRpe(el.dataset.id, +el.dataset.v),
});
