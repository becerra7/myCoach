import test from 'node:test';
import assert from 'node:assert/strict';
import { ocupados } from '../apps/worker/src/ics.js';

const cal = (...evs) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...evs.flatMap(e => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

test('evento con zona horaria y evento en UTC (horario de verano en Madrid)', () => {
  const r = ocupados(cal(
    ['UID:a', 'SUMMARY:Reunión', 'DTSTART;TZID=Europe/Madrid:20260929T090000', 'DTEND;TZID=Europe/Madrid:20260929T103000'],
    ['UID:b', 'SUMMARY:Dentista', 'DTSTART:20260930T160000Z', 'DTEND:20260930T170000Z'],
  ), '2026-09-28', 7);
  assert.deepEqual(r, [{ f: '2026-09-29', de: '09:00', a: '10:30', t: 'Reunión' }, { f: '2026-09-30', de: '18:00', a: '19:00', t: 'Dentista' }]);
});

test('repetición semanal con BYDAY, excepción y una repetición editada', () => {
  const r = ocupados(cal(
    ['UID:w', 'SUMMARY:Trabajo', 'DTSTART;TZID=Europe/Madrid:20260901T090000', 'DTEND;TZID=Europe/Madrid:20260901T180000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'EXDATE;TZID=Europe/Madrid:20260930T090000'],
    ['UID:w', 'SUMMARY:Trabajo', 'RECURRENCE-ID;TZID=Europe/Madrid:20261001T090000', 'DTSTART;TZID=Europe/Madrid:20261001T080000', 'DTEND;TZID=Europe/Madrid:20261001T140000'],
  ), '2026-09-28', 7);
  assert.deepEqual(r.map(x => `${x.f} ${x.de}-${x.a}`), ['2026-09-28 09:00-18:00', '2026-09-29 09:00-18:00', '2026-10-01 08:00-14:00', '2026-10-02 09:00-18:00']);
});

test('el cambio de hora no mueve una reunión semanal', () => {
  const r = ocupados(cal(['UID:x', 'SUMMARY:Clase', 'DTSTART;TZID=Europe/Madrid:20261019T190000', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;COUNT=3']), '2026-10-19', 21);
  assert.deepEqual(r.map(x => `${x.f} ${x.de}`), ['2026-10-19 19:00', '2026-10-26 19:00', '2026-11-02 19:00']);
});

test('día entero, cancelados, "disponible" y eventos que cruzan medianoche', () => {
  const r = ocupados(cal(
    ['UID:v', 'SUMMARY:Vacaciones', 'DTSTART;VALUE=DATE:20260928', 'DTEND;VALUE=DATE:20260930'],
    ['UID:c', 'SUMMARY:Cancelada', 'STATUS:CANCELLED', 'DTSTART:20260928T100000Z', 'DTEND:20260928T110000Z'],
    ['UID:t', 'SUMMARY:Recordatorio', 'TRANSP:TRANSPARENT', 'DTSTART:20260928T100000Z', 'DTEND:20260928T110000Z'],
    ['UID:n', 'SUMMARY:Guardia', 'DTSTART;TZID=Europe/Madrid:20260929T220000', 'DTEND;TZID=Europe/Madrid:20260930T020000'],
  ), '2026-09-28', 7);
  assert.deepEqual(r, [
    { f: '2026-09-28', todoDia: true, t: 'Vacaciones' }, { f: '2026-09-29', todoDia: true, t: 'Vacaciones' },
    { f: '2026-09-29', de: '22:00', a: '24:00', t: 'Guardia' }, { f: '2026-09-30', de: '00:00', a: '02:00', t: 'Guardia' },
  ]);
});

test('mensual por día de la semana (primer lunes) y líneas plegadas', () => {
  const r = ocupados(cal(['UID:m', 'SUMMARY:Comité de', ' dirección', 'DTSTART;TZID=Europe/Madrid:20260907T120000', 'DTEND;TZID=Europe/Madrid:20260907T130000', 'RRULE:FREQ=MONTHLY;BYDAY=1MO']), '2026-10-01', 40);
  assert.deepEqual(r.map(x => `${x.f} ${x.t}`), ['2026-10-05 Comité dedirección', '2026-11-02 Comité dedirección']);
});
