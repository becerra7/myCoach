/* ===== Intervals.icu: conectar desde Ajustes =====
   La clave va directa al conector (intervals_conectar), que la comprueba contra
   Intervals.icu y la guarda cifrada. La web no la guarda en ningún sitio. */
let ICU = undefined; // undefined: sin comprobar · null: sin conector · { conectado, nombre, atleta }

async function cargarIcu() {
  if (!LIVE || S.modo !== 'vivo') { ICU = null; return; }
  try { ICU = await coachCall('intervals_estado', {}, true); } catch (e) { ICU = null; }
  if (S.stack.some(x => x.s === 'ajustes')) render();
}

function cardIntervals() {
  const caja = (estado, cuerpo) => `<div class="card stack" style="gap:12px"><div class="card-h">${ic('chart', 18)}<span class="grow">Intervals.icu</span>${estado}</div>${cuerpo}</div>`;
  if (!LIVE || S.modo !== 'vivo') return caja('', '<p class="small">Entra primero en myCoach: Intervals.icu se vincula a tu cuenta.</p>');
  if (ICU === undefined) { cargarIcu(); return caja('', '<p class="small muted">Comprobando…</p>'); }
  if (ICU === null) return caja('', '<p class="small">Tu conector aún no tiene Intervals.icu. Llegará cuando se actualice.</p>');
  if (ICU.conectado) return caja('<span class="live">Conectado</span>', `<p class="small">${ICU.nombre ? `Como <b>${esc(ICU.nombre)}</b>. ` : ''}Tu entrenador y tu Claude ven eficiencia, desacople, zonas de potencia y ritmo, intervalos, mejores marcas y tu bienestar.</p>
    <div class="btns"><button class="btn plain" type="button" data-a="icu-quitar">Desconectar</button></div>`);
  return caja('', `<p class="small">Más detalle de cada actividad: eficiencia, desacople, W', zonas de potencia y ritmo, intervalos y mejores marcas. Es gratis y recibe tus datos de Garmin solo.</p>
    <label class="stack" for="icu-id" style="gap:6px"><b class="small">ID de atleta</b><input id="icu-id" class="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="i123456"></label>
    <label class="stack" for="icu-key" style="gap:6px"><b class="small">Clave de la API</b><input id="icu-key" class="search" type="password" autocomplete="off" spellcheck="false"></label>
    <p class="small" id="icu-err" role="alert" style="color:var(--bad);margin:0"></p>
    <div class="btns"><button class="btn fill" type="button" data-a="icu-conectar">Conectar Intervals.icu</button></div>
    <details><summary class="small">Dónde encuentro el ID y la clave</summary><ol class="small" style="padding-left:18px;margin:8px 0">
      <li>Entra en <b>intervals.icu</b> y conecta allí tu Garmin si aún no lo has hecho (Settings → Connections).</li>
      <li>En <b>Settings → Developer Settings</b> están tu <i>Athlete ID</i> y el botón para crear la <i>API Key</i>.</li>
      <li>Cópialos aquí. La clave es como una contraseña: se guarda cifrada y puedes desconectarla cuando quieras.</li></ol></details>`);
}

Object.assign(ACTIONS, {
  'icu-conectar': async el => {
    const id = ($('#icu-id') || {}).value?.trim() || '', key = ($('#icu-key') || {}).value?.trim() || '';
    const err = $('#icu-err'); if (!id || !key) { if (err) err.textContent = 'Pon el ID de atleta y la clave.'; (!id ? $('#icu-id') : $('#icu-key'))?.focus(); return; }
    el.disabled = true; el.textContent = 'Comprobando con Intervals.icu…';
    try { ICU = await coachCall('intervals_conectar', { athlete_id: id, api_key: key }, true); render(); toast(`Intervals.icu conectado${ICU.nombre ? ` como ${ICU.nombre}` : ''}`); }
    catch (e) { el.disabled = false; el.textContent = 'Conectar Intervals.icu'; const x = $('#icu-err'); if (x) x.textContent = e.message || 'No he podido conectar'; }
  },
  'icu-quitar': () => ask({ title: '¿Desconectar Intervals.icu?', text: 'Se borra la clave guardada. Puedes volver a conectarlo cuando quieras.', actions: [
    { label: 'Desconectar', kind: 'fill', fn: async () => { try { await coachCall('intervals_desconectar', {}, true); ICU = { conectado: false }; render(); toast('Intervals.icu desconectado'); } catch (e) { toast('No he podido desconectarlo'); } } },
    { label: 'Cancelar' }] }),
});
