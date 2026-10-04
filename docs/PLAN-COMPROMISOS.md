# Compromisos: plan del cambio (para aprobar antes de tocar la agenda)

_Octubre 2026. Sale de `docs/PROPUESTA-AGENDA-COMIDA-HOGAR.md`. Aún no hay nada implementado._

## Qué se consigue

Le dices a tu Claude, o marcas en la app, "el martes tengo cena" o "del 10 al 12 estoy de viaje sin bici". El entrenador lo tiene en cuenta: no te pone nada ese día, mueve la sesión clave a otro y te enseña el cambio antes de guardarlo. Al día siguiente de la cena no te pone series.

## Lo que hay hoy

- El motor del conector no sabe nada de tu agenda. `validarSemana` (`apps/conector/worker.js:3914`) y `diaParaMover` (`:3704`) la ignoran.
- El calendario iCal solo lo usa la web: lo guarda en la sesión del navegador y coloca las sesiones en los huecos (`apps/web/src/35-agenda.js:36-52`). Esto solo pasa al **generar** una semana nueva.
- Los eventos de día entero se ignoran (`35-agenda.js:17`), así que un viaje de todo el día no bloquea nada.

## Propuesta en dos pasos

### Paso 1. Compromisos en el conector. La agenda iCal no se toca

Es un cambio contenido: **añade** cosas y no quita nada de lo que funciona hoy.

**1. Dato nuevo**

Documento `agenda/compromisos` del usuario, en KV como los demás:

```
{ id, fecha, hasta?, de?, a?,            // sin de/a = todo el día; hasta = varios días
  tipo: "viaje" | "trabajo" | "social" | "familia" | "casa" | "salud" | "otros",
  titulo,                                 // "Cena con los de la uni"
  efecto: "bloquea" | "limita" | "solo_suave",
  min_max?,                               // con "limita": minutos que te quedan ese día
  trasnoche?, sin_material?,              // cena hasta tarde, viaje sin bici
  origen: "manual" }                      // más adelante: "ical" y "myluv"
```

- **Tipos:** el tipo lo propone Claude o la app, y tú lo corriges.
- **Efecto por defecto según el tipo:**
  - un viaje bloquea;
  - una cena es `solo_suave` al día siguiente si hay trasnoche;
  - un turno de noche es `solo_suave` ese día y el siguiente.

**2. Reglas nuevas en el motor** (`validarSemana`)

| Regla | Qué pasa | Error o aviso |
|---|---|---|
| `dia_bloqueado` | Hay sesión en un día que no puedes. La versión corregida la mueve con `diaParaMover`; si no hay día, deja libre el de relleno | Error |
| `no_cabe` | La sesión dura más que `min_max`. La corregida la recorta; si es de series, la deja en una versión corta, nunca "fondo de 45" | Error |
| `intenso_tras_trasnoche` | Series o fondo largo el día después de una cena hasta tarde o de un turno de noche | Aviso |
| `solo_suave` | Sesión exigente un día marcado `solo_suave`. La corregida la pasa a suave | Error |
| `sin_material` | Bici un día de viaje sin bici. Se propone correr o fuerza | Aviso |

`diaParaMover` deja de elegir días bloqueados. Las reglas de siempre (máximo de intensos, nada de dos intensos seguidos, semáforo) se siguen cumpliendo después de mover.

**3. Herramientas**

Siguen las convenciones del README del conector.

- `agenda`: responde a "¿cuándo puedo entrenar?". Da los compromisos de un rango (`desde`, `dias`) y, por cada día, si está bloqueado, los minutos que quedan y el motivo.
- `agenda_anotar` (`write`): crear, corregir o borrar un compromiso. Funciona como `coach_proponer`:
  - Con `guardar=false` (por defecto) **no guarda nada**. Devuelve qué sesiones choca y la propuesta del motor: antes → después y el porqué ("Muevo las series del martes al jueves: tienes cena").
  - Con `guardar=true`, después de tu sí, guarda el compromiso y, si aceptas, también el plan.
  - Si borras un compromiso, se ofrece volver a dejar la sesión donde estaba.
- `coach_semana`: cada día trae sus `compromisos` y los avisos nuevos.
- `coach_hoy`: si hoy o ayer hay un compromiso, el porqué del semáforo lo dice ("Ayer cena hasta tarde: hoy suave").
- **Sin culpa:** un día bloqueado no cuenta como "no hecho" en lo cumplido de la semana.

**4. Web**

Pocos cambios y con los componentes de siempre.

- **Plan, fila del día:** el día con compromiso lleva el icono de candado y el texto ("Ocupado: cena"). Nunca solo un color.
- **Plan, hoja del día:** una fila nueva, "No puedo este día". Abre una hoja (`openSheet`) con:
  - día entero o solo una franja;
  - el motivo, con los tipos como chips;
  - "Ceno hasta tarde".

  Al guardar se ve el antes → después de la semana, con un botón "Aplicar el cambio" (relleno) y otro "Solo apuntarlo" (texto). Se puede deshacer desde el aviso.
- **Hoy:** no cambia de pregunta. Si hay compromiso, lo dice la línea del porqué de la sesión.

**5. Skills** (mismo cambio, `npm run skills`)

- `planificador`: ante "tengo cena el martes", primero `agenda_anotar` sin guardar, después enseñar el cambio y guardar con el sí. Incluye la prioridad para mover (clave antes que relleno) y el formato "he movido X porque Y".
- `mycoach-uso`: fila nueva en la tabla de herramientas.
- `fisio`: tiene en cuenta el trasnoche y el turno de noche.
- `nutricionista`: tiene en cuenta la cena fuera y el viaje.

**6. Pruebas**

- Tests del motor: día bloqueado, no cabe, solo suave, trasnoche y mover sin pegar dos intensos.
- Tests de las herramientas, con y sin guardar.
- El test de las skills.
- Capturas de Plan y de la hoja a 390 px, en claro y en oscuro.

**Arreglo pequeño que va en este paso:** que los eventos de día entero del iCal bloqueen el día en la web (`35-agenda.js:17`). Es una línea y no cambia nada más.

### Paso 2. Llevar la agenda iCal al conector (lo hablamos después del paso 1)

Este es el **cambio grande en la agenda**. No lo empiezo sin tu visto bueno.

- El enlace iCal pasaría de la sesión de la web a tus datos del conector (cifrado), y `ics.js` lo leería el conector. Así tu Claude también ve el calendario.
- Los eventos del calendario se tratarían como compromisos (`origen: "ical"`), con el tipo deducido del título.
- `aplicarAgenda` y `huecos` saldrían de la web: colocar las sesiones en los huecos lo haría el motor.

**Qué cambia para ti:**
- Tendrías que volver a pegar el enlace del calendario una vez.
- Las sesiones dejarían de recolocarse solas al generar la semana: el motor propone y tú aceptas, como con todo lo demás.

## Lo que necesito que me confirmes

1. ¿Te vale el paso 1 tal cual, y el paso 2 después?
2. Una cena: ¿la marco por defecto como "trasnoche" (al día siguiente, nada exigente) o solo si lo dices?
3. En la hoja del día, ¿"No puedo este día" o prefieres otro texto?
