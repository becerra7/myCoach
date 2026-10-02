# Sincronizar entrenos con Garmin Connect: plan

Objetivo: que un entreno exista una sola vez, lo crees donde lo crees (Garmin Connect, la app, o Claude), y que se vea y se edite en los dos sitios sin duplicados.

## Principio

**Cada entreno tiene una identidad, y la guarda myCoach.** Cada entreno de myCoach (`fuerza/entrenos`, `cardio/entrenos` en el KV) lleva su pareja en Garmin: `garmin.workout_id`. myCoach manda en el contenido porque el formato de Garmin pierde cosas (material, rangos de reps "8-10", notas por ejercicio, la última vez). Garmin es la copia que llega al reloj.

## Hecho (2 oct 2026)

- **Pareja estable** (`enviarConPareja` en `garmin-mcp/worker.js`): reenviar un entreno **actualiza el mismo** en Garmin (`PUT /workout-service/workout/{id}`), sin borrarlo y crear otro. Si Garmin lo rechaza o ya no lo tiene, se crea uno nuevo, se borra el viejo y se apunta el id nuevo.
- **Un programado por día**: `garmin.programados` guarda las fechas ya programadas de ese entreno; reenviar para la misma fecha no lo apila.
- **Nombre en Garmin sin prefijo** "myCoach · ": la pareja ya evita duplicados. Ojo: los que se mandaron antes del 2 oct se llaman "myCoach · …"; el importador debe tratarlos como nuestros.
- Pareja guardada: `garmin: { workout_id, fecha, enviado, programados[] }`.

- **Importador mínimo** (`entrenos_desde_garmin`, 2 oct 2026): lista los entrenos de Garmin y trae los de fuerza, bici y correr que no tienen pareja ni se llaman "myCoach · …". Con vista previa y `confirm`; máximo 40 por llamada. Guarda `origen: 'garmin'` y `garmin: { workout_id, actualizado_garmin }`. Los ejercicios que no están en el catálogo entran sin ejercicio de Garmin (no van al reloj hasta elegirlo). Falta: cambios en Garmin (flujo 5), borrados (6), huella (9), cron de la mañana y avisos en la app.

## Flujos y cómo se evita el duplicado

| # | Flujo | Cómo |
|---|---|---|
| 1 | Creas en Garmin → myCoach | El importador lee tu lista de entrenos de Garmin; salta los que ya tienen pareja y los que empiezan por "myCoach · ". Los nuevos de fuerza, bici o correr entran con `origen: 'garmin'` y su `workout_id`. |
| 2 | Creas o editas en myCoach → Garmin | Hecho: sin pareja, se crea; con pareja, se actualiza el mismo. |
| 3 | Claude → Garmin → myCoach | Con nuestro conector no existe: todas las herramientas de Claude guardan primero en myCoach y luego mandan (flujo 4). Si Claude usara otro conector de Garmin, es el flujo 1. |
| 4 | Claude → myCoach → Garmin | Es el flujo 2. |
| 5 | Editas en Garmin uno que ya está en myCoach | Comparar `updateDate` de Garmin con la última sincronización. Si solo cambió en Garmin, myCoach lo coge; si cambió en los dos, avisar en la app y elegir (proponer myCoach para la fuerza, el más reciente para bici y correr). |
| 6 | Borrados | Borrado en Garmin: en myCoach se queda, marcado "Ya no está en tu reloj"; al reenviar se recrea. Borrado en myCoach: preguntar y quitarlo también de Garmin. |
| 7 | Programar un día | Desde myCoach: hecho, uno por día. Desde el calendario de Garmin: leerlo y enlazar el día del plan (`entreno` o `entreno_cardio`). |
| 8 | Haces el entreno con el reloj | La actividad (id de Garmin) se enlaza con el día y el entreno; nunca se crea una sesión aparte. Para la fuerza ya existe (`fuerza_desde_garmin`). |
| 9 | El mismo entreno hecho a mano en los dos sitios | Huella del contenido (deporte + ejercicios o pasos). Si coincide, la app propone fusionar; nunca automático. |
| 10 | Planes de Garmin Coach o planes de carrera | Se ven en el calendario como "plan de Garmin"; no entran en la librería. |
| 11 | Dos sitios guardando a la vez | Control de versión (`at`), como `estado/app`. |

## Pendiente, en orden

1. **Importador** (flujos 1, 5, 6 y 9)
   - Garmin: `GET /workout-service/workouts?start=0&limit=100` (lista, con `workoutId`, `sportType`, `updateDate`) y `GET /workout-service/workout/{id}` (pasos).
   - Convertir al formato de myCoach. Para la fuerza, al revés que `entrenoParaGarmin`: `ExecutableStepDTO` con `category`/`exerciseName` → nombre en castellano con `CATALOGO_GARMIN`; `weightValue`/1000 → kg; repeticiones o tiempo; `RepeatGroupDTO` → series; descanso. Para bici y correr, al revés que `cardioParaGarmin`: tipo de paso, final por tiempo, distancia o botón, y objetivo (zona o rango; ritmo y velocidad vienen en m/s).
   - Herramienta `entrenos_desde_garmin` con vista previa ("3 nuevos, 1 cambiado en Garmin, 1 ya no está") y `confirm`. La misma lógica, sin preguntar, en el cron de la mañana solo para los nuevos; los conflictos quedan marcados para la app.
   - Guardar en la pareja `actualizado_garmin` (el `updateDate`) y `huella` (hash del contenido al enviar o importar).
2. **Calendario** (flujo 7)
   - `GET /calendar-service/year/{y}/month/{m0}` (mes empezando en 0). Los `itemType: 'workout'` tienen `workoutId` y `date`: enlazar el día del plan si el entreno tiene pareja.
   - Guardar el `workoutScheduleId` que devuelve programar, para poder quitar un programado al mover de día.
3. **App** (`apps/web/src/59-entrenos.js`)
   - En "Tus entrenos": origen ("de Garmin" o "de myCoach") y estado ("En el reloj", "Cambiado en Garmin", "Ya no está en tu reloj").
   - Hoja para elegir cuando cambió en los dos sitios.
   - Borrar en myCoach pregunta si también se quita de Garmin.
4. **Pruebas** (`garmin-mcp/test.mjs`, con Garmin simulado)
   - Importar dos veces no duplica.
   - Importar después de enviar no duplica, también con los antiguos "myCoach · …".
   - Conflicto en los dos sitios.
   - Borrado en Garmin.
   - Huella igual: proponer fusionar.

## Cosas a vigilar

- El `PUT` de Garmin no está documentado. Si en la vida real lo rechazara siempre, se vería en el registro de D1 como reenvíos que crean otro entreno y borran el viejo; el resultado es correcto, pero el id cambia. Mirarlo con `SELECT … WHERE note LIKE '%enviar_garmin%'`.
- Decidido con el usuario: quitar el prefijo del nombre; preguntar en los conflictos; borrar en myCoach también borra en Garmin, preguntando antes.
