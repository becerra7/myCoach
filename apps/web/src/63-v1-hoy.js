/* ===== v1 · Hoy: ¿qué hago hoy, qué como y por qué? =====
   Arriba, la decisión (la sesión, o lo que propone el entrenador) con su porqué.
   Debajo, tus datos de Garmin siempre visibles, cómo te encuentras, la carga de hoy,
   tu día (comidas y sesión en orden) y la semana. El método lo pone el conector (coach_hoy). */

const coachHoy = () => (S.modo === 'demo' ? coachDemo() : COACH);

/* Carga de una sesión en una escala de 0 (descanso) a 100 (muy duro): duración e intensidad.
   La zona del día la da el conector cuando la tenga (carga_objetivo); mientras, sale del color del semáforo. */
const CARGA_T = { rec: 2, fondo: 8, otros: 10, tempo: 22, int: 32 };
const cargaSesion = (min, t) => Math.min(98, Math.round(min / 240 * 62 + (CARGA_T[t] ?? 10)));
function zonaCarga(c) {
  if (c && Array.isArray(c.carga_objetivo)) return { z: c.carga_objetivo, est: false };
  const col = c?.semaforo?.color || 'verde';
  return { z: { verde: [14, 62], ambar: [8, 36], rojo: [0, 16] }[col], est: true };
}

function bloqueDecision(c, s) {
  const sm = c && c.semaforo;
  const titular = s?.a ? `Hecho: ${SPORTS[s.a.dep]?.n.toLowerCase() || 'entreno'}, ${dur(s.a.min)}`
    : c?.ya_entrenado_hoy?.length ? 'Ya has entrenado hoy'
    : s ? (s.t === 'descanso' ? 'Descanso' : s.d) : 'Día libre';
  let estado = '';
  if (sm) { const [tono, ico] = TONO_SEM[sm.color] || TONO_SEM.verde; const [col, lectura] = COACH_TXT[sm.color] || COACH_TXT.verde; estado = tag(tono, ico, `${col}: ${lectura}`); }
  const motivos = sm ? (sm.color === 'verde' ? sm.positivos : sm.razones) || [] : [];
  let porque = motivos.length ? `${cap1(motivos.slice(0, 2).join(' y '))}.` : '';
  if (!s && sm) porque = sm.color === 'verde' ? `${porque} Buen día para algo suave si te apetece.`.trim() : `${porque} Hoy, mejor descansar.`.trim();
  if (!sm && rdy() != null) porque = `Readiness de Garmin: ${rdy()}.`;
  if (s?.a) porque = `${esc(s.a.lugar)}${s.a.km && SPORTS[s.a.dep]?.cardio ? `, ${nf(s.a.km)} km` : ''}${s.a.fc ? ` a ${s.a.fc} ppm de media` : ''}.`;
  const ruta = s && !s.a && s.ruta ? `<div class="ruta-l"><svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true"><path d="M2 18 C8 18 10 8 16 9 S26 18 30 13 38 6 38 6" fill="none" stroke="${scol(s.dep)}" stroke-width="2.5" stroke-linecap="round"/></svg><div><b>${esc(s.ruta)}</b></div></div>` : '';
  const prop = !s?.a && c?.propuesta?.sesion ? `<div class="cambio" role="group" aria-label="Cambio propuesto">
      <p>${tag('warn', '!', 'Con tu estado, mejor ajustarla')}</p><p style="margin-top:6px">${esc(c.propuesta.texto || '')}</p>
      <div class="antes-despues"><div><span class="xs muted">Antes</span><p><s>${esc(s?.d || '')}</s></p></div><div class="ahora"><span class="xs muted">Después</span><p><b>${esc(c.propuesta.sesion.d || '')}</b></p></div></div>
      <div class="btns"><button class="btn fill" type="button" data-a="coach-aplicar">Aplicar el cambio</button><button class="link" type="button" data-a="coach-claude">Hablarlo con Claude</button></div></div>` : '';
  const acciones = s?.a ? `<button class="btn fill" type="button" data-a="push" data-v="actividad" data-id="${s.a.id}">Ver cómo ha ido</button>`
    : s && s.t !== 'descanso' ? `<button class="btn ${prop ? 'tonal' : 'fill'}" type="button" data-a="day" data-v="${HOY}">Ver la sesión</button>` : '';
  const demo = S.modo === 'demo' ? '<span class="demo-tag">Ejemplo</span>' : '';
  return `<section class="decision" aria-labelledby="dec-t">
    <p class="fecha">${cap1(fLarga(HOY))}${demo}</p>
    <h1 id="dec-t">${esc(titular)}</h1>
    ${estado}
    ${porque ? `<p class="porque">${porque}</p>` : ''}
    ${ruta}${prop}
    <div class="btns">${acciones}<button class="link" type="button" data-a="v-no100">No estoy al 100 %</button></div>
  </section>`;
}

function bloqueDatos(c) {
  const datos = c?.semaforo?.datos || [];
  const sentir = resumenSentir();
  // Sin datos de descanso (solo un Edge, o un reloj que no se lleva de noche): no se enseñan huecos;
  // el entrenador decide con la carga y con lo que cuentes, así que eso pasa a ir primero.
  const sinDescanso = !!(c && (c.fuentes?.sin_descanso || c.semaforo?.sin_descanso));
  const filas = datos.length ? datos.map(d => { const [tono, ico, pal] = TONO_EST[d.estado] || TONO_EST.normal; const nombre = NOMBRE_CORTO[d.clave] || d.nombre; const v = valorCorto(d.valor);
      const m = String(v).match(/^(.*?)\s(ms|ppm)$/);
      return `<button class="met2" type="button" data-a="met" data-v="${esc(d.clave)}" aria-label="${esc(nombre)}: ${esc(v)}, ${pal}. Ver qué es">
        <span class="n">${esc(nombre)}</span><b class="v">${m ? `${esc(m[1])}<small>${m[2]}</small>` : esc(v)}</b>
        ${d.normal ? `<span class="nm">${d.clave === 'carga_garmin' ? 'Tu franja' : 'Tu normal'}: ${esc(d.normal)}</span>` : ''}${tag(tono, ico, pal)}</button>`; }).join('')
    : `<p class="muted" style="padding:8px 0">${LIVE === undefined ? 'Abriendo tu myCoach…' : 'Garmin aún no tiene tus datos de esta noche. Necesita que duermas con el reloj puesto.'}</p>`;
  if (sinDescanso) return blk(`${blkH('Cómo llegas hoy', info('datos', 'Cómo llegas hoy', 'Tu Garmin no mide el sueño ni la VFC (pasa con un Edge, o si no duermes con el reloj). Tu entrenador decide con tu carga y con lo que le cuentes, así que lo que digas pesa más. Si te pones un reloj por la noche, aquí saldrán también tus datos de descanso.'))}
    <div class="sentir"><span class="grow">${sentir ? esc(sentir) : '<b>¿Cómo te encuentras hoy?</b> Sin datos de descanso, es lo que más pesa.'}</span>${sentir ? '<button class="link" type="button" data-a="coach-sentir-hoja">Cambiar</button>' : '<button class="btn tonal" type="button" data-a="coach-sentir-hoja">Contármelo</button>'}</div>
    ${datos.length ? `<div class="mets2">${filas}</div>` : ''}`);
  return blk(`${blkH('Tus datos de esta noche', info('datos', 'Tus datos de esta noche', 'Salen de tu Garmin y cada uno se compara con tu normal: tu media de las últimas 4 semanas. Toca uno para ver qué es y cómo lo lee tu entrenador. Con ellos decide el semáforo.'))}
    ${datos.length ? `<div class="mets2">${filas}</div>` : filas}
    <div class="sentir"><span class="grow">${sentir ? esc(sentir) : 'Cómo te encuentras hoy'}</span><button class="link" type="button" data-a="coach-sentir-hoja">${sentir ? 'Cambiar' : 'Cuéntamelo'}</button></div>`);
}

function bloqueCarga(c, s) {
  if (!s || s.a || s.t === 'descanso' || !SPORTS[s.dep]?.cardio) return '';
  const { z: [a, b], est } = zonaCarga(c);
  V.carga = V.carga && V.carga.f === HOY ? V.carga : { f: HOY, min: s.min || 60, t: s.t };
  const k = V.carga, ahora = cargaSesion(k.min, k.t), antes = cargaSesion(s.min || 60, s.t), cambiado = k.min !== (s.min || 60) || k.t !== s.t;
  const ver = ahora >= a && ahora <= b ? tag('good', '✓', 'Entra en lo que tu cuerpo aguanta hoy') : ahora > b ? tag('warn', '!', 'Se pasa: hoy te conviene menos') : tag('neutral', '·', 'Se queda corto, pero vale');
  const INT = [['rec', 'Muy suave'], ['fondo', 'Suave'], ['tempo', 'Tempo'], ['int', 'Intenso']];
  return blk(`${blkH('Carga de hoy', info('carga', 'Carga de hoy', `La zona marcada es lo que tu estado aguanta hoy y la raya negra, tu sesión. Si cambias minutos o intensidad, ves al momento si sigue entrando.${est ? ' La zona sale del semáforo; cuando el conector la calcule, será más fina.' : ''}`))}
    <div class="fr-bar" role="img" aria-label="Carga de la sesión ${ahora} de 100; tu zona de hoy va de ${a} a ${b}">
      <div class="fr-rail"></div><div class="fr-ok" style="left:${a}%;width:${b - a}%"></div>
      ${cambiado ? `<div class="fr-mark antes" style="left:${antes}%"></div>` : ''}<div class="fr-mark" style="left:${ahora}%"></div></div>
    <div class="fr-esc" aria-hidden="true"><span>Descanso</span><span>Suave</span><span>Moderado</span><span>Duro</span></div>
    <div class="fr-ctl">
      <div class="step"><button type="button" data-a="v-carga-min" data-v="-15" aria-label="Quitar 15 minutos">−</button><b aria-live="polite">${dur(k.min)}</b><button type="button" data-a="v-carga-min" data-v="15" aria-label="Añadir 15 minutos">+</button></div>
      <div class="seg2" role="group" aria-label="Intensidad">${INT.map(([t, l]) => `<button type="button" data-a="v-carga-t" data-v="${t}" aria-pressed="${k.t === t}">${l}</button>`).join('')}</div>
    </div>
    <p style="margin-top:12px">${ver}</p>
    ${cambiado ? `<p class="xs muted" style="margin-top:6px">Antes: ${dur(s.min || 60)}, ${TIPOS[s.t]?.n.toLowerCase() || ''}. Después: ${dur(k.min)}, ${TIPOS[k.t].n.toLowerCase()}.</p>
      <div class="btns"><button class="btn fill" type="button" data-a="v-carga-aplicar">Aplicar el cambio</button><button class="link" type="button" data-a="v-carga-reset">Dejarlo como estaba</button></div>` : ''}`);
}

/* Tu día: las comidas (lo registrado y lo que toca) y la sesión, en orden */
const HUECOS = [['desayuno', 'Desayuno', '08:00'], ['comida', 'Comida', '14:00'], ['merienda', 'Merienda', '17:30'], ['cena', 'Cena', '21:00']];
const tipoMeal = m => String(m.tipo || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function objetivosComida(f) {
  // Cuartos de plato al día según la carga (la misma regla que la comida de la app: 1, 1,5 o 2 cuartos de hidrato por comida principal)
  const cg = cargaDia(f); const c = cg.c;
  return { cg, hidrato: [Math.round(c * 3 * 2) / 2, Math.round((c * 3 + 1) * 2) / 2], proteina: [3, 4] };
}
const nivelHidrato = (c, merienda) => merienda ? (c >= 2 ? 'medio' : 'bajo') : c >= 2 ? 'alto' : c >= 1.5 ? 'medio' : 'bajo';
function sumaComida(f) { const ms = (S.meals || []).filter(m => m.f === f); return { ms, c: ms.reduce((a, m) => a + (+m.c || 0), 0), p: ms.reduce((a, m) => a + (+m.p || 0), 0) }; }
const qTxt = v => `${nf(v)} ${v === 1 ? 'cuarto' : 'cuartos'}`;
function filaMacro(nombre, llevas, [lo, hi]) {
  const max = Math.max(hi * 1.25, llevas, 1), falta = lo - llevas;
  return `<span class="lbl">${nombre}</span>
    <span class="mb" role="img" aria-label="${nombre}: ${qTxt(llevas)}; objetivo de ${nf(lo)} a ${nf(hi)}"><span class="zona" style="left:${lo / max * 100}%;width:${(hi - lo) / max * 100}%"></span><span class="ya" style="width:${Math.min(100, llevas / max * 100)}%"></span></span>
    <span class="mq">${falta > 0 ? `faltan ${qTxt(falta)}` : llevas > hi ? `${qTxt(llevas - hi)} de más` : 'en objetivo'}</span>`;
}
function bloqueDia(enHoy) {
  const s = sesion(HOY), o = objetivosComida(HOY), sum = sumaComida(HOY);
  // El código de hidrato y lo previsto de cada comida salen del plan de comidas del conector (comida_plan).
  if (MENUS.datos[SEM] === undefined) cargarMenus(SEM);
  const menu = menuDelDia(HOY);
  const items = HUECOS.map(([k, n, h]) => ({ k, n, h, m: sum.ms.find(m => tipoMeal(m) === k) }));
  sum.ms.filter(m => !HUECOS.some(([k]) => k === tipoMeal(m))).forEach(m => items.push({ k: tipoMeal(m), n: cap1(m.tipo), h: m.h || '12:00', m }));
  if (s && s.t !== 'descanso') items.push({ k: 'sesion', h: s.a ? '' : '10:30', s });
  agendaDia(HOY).forEach(e => items.push({ k: 'agenda', h: e.todo_dia ? '00:00' : e.de, e }));
  const clave = it => it.k === 'sesion' ? '10:30' : (it.m?.h || it.h);
  // Si la sesión de hoy no cabe en tu agenda, lo dice el motor (coach_hoy) y aquí se cuenta debajo.
  const ag = COACH && COACH.fecha === HOY && COACH.agenda, noCabe = ag && ag.cabe === false && s && !s.a
    ? (ag.libre_min >= 30 ? `Hoy solo tienes ${dur(ag.libre_min)} libres: tu entrenador te propone qué hacer en Plan.` : 'Hoy no tienes hueco: tu entrenador te propone moverla en Plan.') : '';
  items.sort((x, y) => clave(x).localeCompare(clave(y)));
  const durante = s && SPORTS[s.dep]?.cardio && s.t !== 'descanso' ? (s.min >= 90 ? 'Lleva hidrato: 60-90 g por hora desde la segunda hora.' : 'Menos de 90 min: con agua basta.') : '';
  const li = items.map(it => {
    if (it.k === 'sesion') return `<li><span class="h"></span><span class="eje"><i class="dep ${it.s.a ? 'ok' : ''}" style="${it.s.a ? '' : `border-color:${scol(it.s.dep)};background:${scol(it.s.dep)}`}"></i></span>
      <button class="c" type="button" data-a="day" data-v="${HOY}"><b>${esc(it.s.a ? `Hecho: ${it.s.a.lugar}` : it.s.d)}</b>${noCabe ? `<span class="agenda-l small">${ic('info', 14)}<span>${noCabe}</span></span>` : durante && !it.s.a ? `<span class="small muted" style="display:block">${durante}</span>` : ''}</button></li>`;
    if (it.k === 'agenda') return `<li><span class="h">${it.e.todo_dia ? '' : esc(it.e.de)}</span><span class="eje"><i></i></span><div class="c"><span class="agenda-l">${ic('lock', 14)}<b>${esc(it.e.titulo)}</b></span>
      <span class="small muted" style="display:block">${it.e.todo_dia ? 'Todo el día' : `Hasta las ${esc(it.e.a === '24:00' ? '00:00' : it.e.a)}`}</span></div></li>`;
    const m = it.m, merienda = it.k === 'merienda', mc = menu?.comidas[it.k], previsto = mc?.plan;
    const nivel = mc ? mc.texto : `Hidrato ${nivelHidrato(o.cg.c, merienda)}`;
    return `<li><span class="h">${esc(m?.h || it.h)}</span><span class="eje"><i class="${m ? 'ok' : ''}"></i></span><div class="c"><b>${esc(it.n)}</b>${HUECOS.some(([k]) => k === it.k) ? `<span class="nivel">${esc(nivel)}</span>` : ''}
      <span class="small ${m ? '' : 'muted'}" style="display:block">${m ? `✓ ${esc(m.txt || 'Registrada')}: ${qTxt(+m.c || 0)} de hidrato, ${qTxt(+m.p || 0)} de proteína` : previsto ? `Previsto: ${esc(previsto.descripcion)}` : 'Sin registrar'}</span></div></li>`;
  }).join('');
  return blk(`${blkH('Tu día', `${info('dia', 'Tu día', `Hoy es ${o.cg.n.toLowerCase()} (${esc(o.cg.txt)}). El objetivo va en cuartos de plato, la medida en la que registras las comidas con Claude: ${nf(o.hidrato[0])}-${nf(o.hidrato[1])} cuartos de hidrato y ${o.proteina[0]}-${o.proteina[1]} de proteína en el día. Es una estimación, sin calorías.`)}${enHoy ? '<button class="link" type="button" data-a="tab" data-v="comer">Ver Comer</button>' : ''}`)}
    <div class="macro">${filaMacro('Hidrato', sum.c, o.hidrato)}${filaMacro('Proteína', sum.p, o.proteina)}</div>
    <ol class="dia">${li}</ol>`);
}

function tabHoyV1() {
  const c = coachHoy(), s = sesion(HOY);
  const aviso = cardAvisoPlan();
  return { title: 'Hoy', html: `<div class="v1"><div class="cols"><div class="col">
      ${bloqueDecision(c, s)}
      ${bloqueDatos(c)}
      ${bloqueCarga(c, s)}
    </div><div class="col">
      ${bloqueDia(true)}
      ${blk(`${blkH('Esta semana', `${info('sem', 'Esta semana', 'Cada casilla es un día con el color de su deporte. Franja llena: hecho. Hueca: pendiente. Rayada: no se hizo. Sin franja: descanso o libre. Toca un día para ver su sesión.')}<button class="link" type="button" data-a="tab" data-v="plan">Ver el plan</button>`)}${semana7(SEM)}${aviso ? `<div style="margin-top:16px">${aviso}</div>` : ''}`)}
    </div></div></div>` };
}

/* No estoy al 100 %: enseña el plan de hoy ajustado antes de cambiar nada */
const MOTIVOS = [['enfermo', 'Estoy enfermo', 'Descanso hasta que estés bien; el plan te espera'], ['molestia', 'Tengo una molestia', 'Sin impacto ni intensidad unos días'], ['cargado', 'Voy cargado de semana', 'Más corto y suave, sin perder lo importante']];
function despuesMotivo(k, s) {
  if (!s || s.t === 'descanso') return null;
  if (k === 'enfermo') return { ...s, a: undefined, f: undefined, t: 'descanso', d: 'Descanso', min: 0, ajustada: true };
  const min = Math.max(30, Math.round((s.min || 60) * (k === 'molestia' ? .6 : .65) / 5) * 5);
  return { ...s, a: undefined, f: undefined, t: 'rec', d: k === 'molestia' ? `${dur(min)} muy suave, sin cuestas ni impacto` : `${dur(min)} suave`, min, ajustada: true };
}
function hojaNo100(sel) {
  const s = sesion(HOY), d = sel && despuesMotivo(sel, s);
  openSheet({ title: 'No estoy al 100 %', size: 'auto', id: 'v-no100', body: () => `<p class="muted">Te enseño cómo queda hoy antes de cambiar nada.</p>
    <div class="filas">${MOTIVOS.map(([k, t, x]) => `<button class="fila-b" type="button" data-a="v-motivo" data-v="${k}" aria-pressed="${sel === k}"><span><b>${t}</b><span class="small muted" style="display:block">${x}</span></span>${sel === k ? tag('good', '✓', '') : ''}</button>`).join('')}</div>
    ${sel ? (s && s.t !== 'descanso' && !s.a ? `<div class="antes-despues"><div><span class="xs muted">Antes</span><p><s>${esc(s.d)}</s></p></div><div class="ahora"><span class="xs muted">Después</span><p><b>${esc(d.d)}</b></p></div></div>
      ${sel === 'molestia' ? '<p class="small muted" style="margin-top:8px">Si en dos o tres días no mejora, consulta a un profesional.</p>' : ''}
      <div class="btns"><button class="btn fill" type="button" data-a="v-motivo-ok" data-v="${sel}">Aplicar el cambio</button><button class="link" type="button" data-a="coach-sentir-hoja">Contar cómo me encuentro</button></div>`
      : `<p style="margin-top:12px">Hoy no tienes nada pendiente. Cuéntale a tu entrenador cómo estás para que ajuste los próximos días.</p><div class="btns"><button class="btn fill" type="button" data-a="coach-sentir-hoja">Contar cómo me encuentro</button></div>`) : ''}` });
}
/* Cambia la sesión de hoy donde esté (plan de esta semana o la siguiente) y deja deshacerlo */
function cambiarHoy(nueva, txt) {
  const dondeNext = S.next && S.next[HOY] && !S.plan[HOY]; const almacen = dondeNext ? S.next : S.plan;
  const antes = almacen[HOY] ? clone(almacen[HOY]) : null; const { a, f, ...limpia } = nueva;
  almacen[HOY] = limpia; save(); V.carga = null; render();
  toast(txt, { undo: () => { if (antes) almacen[HOY] = antes; else delete almacen[HOY]; save(); render(); } });
}

Object.assign(ACTIONS, {
  'v-carga-min': el => { if (!V.carga) return; V.carga.min = Math.max(20, Math.min(360, V.carga.min + +el.dataset.v)); render(); },
  'v-carga-t': el => { if (!V.carga) return; V.carga.t = el.dataset.v; render(); },
  'v-carga-reset': () => { V.carga = null; render(); },
  'v-carga-aplicar': () => { const s = sesion(HOY); if (!s || !V.carga) return; const { min, t } = V.carga;
    cambiarHoy({ ...s, min, t, d: `${dur(min)} ${TIPOS[t].n.toLowerCase()}`, ajustada: true }, 'Sesión de hoy cambiada'); },
  'v-no100': () => hojaNo100(null),
  'v-motivo': el => hojaNo100(el.dataset.v),
  'v-motivo-ok': el => { const s = sesion(HOY), d = despuesMotivo(el.dataset.v, s); if (!d) return; closeSheet(); cambiarHoy(d, 'Plan de hoy cambiado'); },
});
