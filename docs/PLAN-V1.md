# myCoach v1: cómo queda la app

> **Estado (3 oct 2026):** implementado en `apps/web` (pantallas en `62-67-v1-*.js`). Pendiente del conector: objetivos de comida en gramos, franja de carga del día (`carga_objetivo` en `coach_hoy`; mientras, sale del color del semáforo), `coach_kpis`, la stamina, el combustible y el desacople por salida (`salida_guardar`). La comida se mide en cuartos de plato, que es como la guarda `comida_registrar`.

Diseño de producto y UX pensado desde cero, no retoques de lo que hay. Se basa en `PRODUCTO.md`, `INVESTIGACION.md` y el inventario de `FEATURES.md`. El aspecto visual lo define el prototipo (`frontend-design` + `ui-ux-pro-max`, revisado con `impeccable`). Aquí van la estructura, qué enseña cada pantalla y qué sale o entra.

## La idea en una línea

Abres la app y lo primero es **la decisión de hoy** (qué entreno y qué comer) y su porqué. Lo demás está a un toque.

## Navegación: 5 secciones + Claude

| Sección | Pregunta que responde | Antes |
|---|---|---|
| **Hoy** | ¿Qué hago hoy, qué como y por qué? | Hoy |
| **Plan** | ¿Qué toca esta semana y por dónde salgo? | Plan |
| **Comer** | ¿Cómo como día a día y cómo afecta a mi peso? | Tarjeta pequeña en Hoy + pantalla escondida; peso en Forma |
| **Progreso** | ¿Estoy mejorando? | Forma |
| **Pueblos** | ¿Cuánto he hecho y por dónde he pasado? | Pueblos |

Botón fijo **Claude** (abre tu Claude con el encargo, ver abajo). Ajustes desde el avatar.

**Por qué nutrición tiene sección propia.** Se usa varias veces al día (cada comida), tiene su propia pregunta ("¿cuánto me falta?") y su propio histórico. Metida en Hoy, o se queda corta o ahoga el entreno. En Hoy queda solo un resumen de una línea que lleva a Comer.

**Pueblos, pestaña propia y resumen de todo lo hecho.** Además del mapa, es el sitio del histórico: totales por año, por mes o desde el inicio. Cinco pestañas más el botón de Claude caben a 390 px; hay que comprobarlo en el prototipo.

---

## Hoy

De arriba abajo:

1. **Titular con la decisión.** "Rodaje suave · 60 min" en grande. Debajo, el porqué en una frase: "Has dormido poco y tu VFC está por debajo de tu normal". El semáforo va como etiqueta con palabra e icono (✓ Verde, · Ámbar), no como círculo.
2. **Franja de carga de hoy.** Barra con la franja recomendada según tu estado y la sesión como marca. Si la cambias, la marca se mueve en directo y dice si entra (antes → después). Aplicar o deshacer.
3. **Tus métricas de Garmin, siempre a la vista.** Una fila compacta con sueño, VFC, pulso en reposo, readiness y carga reciente: cifra + palabra frente a *tu* normalidad ("Normal", "Algo peor", "Mejor"). Sin 0-100 y sin plegar: se leen sin tocar nada. Lo que se pliega es la explicación de cada una (qué es y cómo la lee el entrenador), que se abre al tocarla.
4. **El día en una línea de tiempo.** Comidas y sesión en orden: desayuno → salida de 3 h (con lo que llevar: 60 g/h) → comida de recuperación → cena. Cada comida con su nivel de hidrato según la sesión y lo registrado; arriba, "te faltan ~120 g de hidrato · proteína al 60 %". Tocar abre Comer.
5. **Semana en 7 casillas** con franja lateral: lleno = hecho, contorno = pendiente, rayado = cambiado. Palabras, nunca rojo.
6. **"No estoy al 100 %"** (secundario): enfermo, molestia o semana cargada. Enseña el plan ajustado antes de aplicarlo.

**Según la hora:** después de entrenar, el titular pasa a ser el resumen de la sesión hecha ("Hecho · 62 min, más suave de lo previsto, bien") comparado con tu historia.
**Día sin nada planificado:** el titular dice "Día libre" o "Descanso", y las métricas de Garmin pasan a ser lo principal, con una frase de qué te pide el cuerpo ("Buen día para algo suave si te apetece"). La comida se ajusta a un día suave.
**Primer uso o pocos datos:** "Aprendiendo tu normalidad · 4 de 14 días" en vez de un color inventado.

## Plan

- **Semana** (por defecto): lista de días con la sesión, su briefing de una línea ("Hoy: cadencia alta en los llanos") y la franja de cumplimiento ("Hecho", "Más corto", "Movido", "Descansado"). La semana pasada y la próxima, deslizando.
- **Hoja del día:** ver detalle, mover, cambiar por otra cosa (con antes → después), enviar al reloj, ruta asociada.
- **Preparar la semana:** lo propone el conector (no la web) con tus horas, deportes y calendario. Lo enseña y lo guardas.
- **Rutas:** cada salida de bici puede llevar su ruta (trazada por Claude con `garmin_plan_route`): mapa, distancia, desnivel y "Enviar a Garmin". Lista de tus rutas guardadas (`garmin_courses`).
- **Entrenos de fuerza:** la sesión muestra ejercicios con "La última vez: 3 × 8 a 40 kg" al lado de lo que toca. Librería de entrenos dentro de Plan. El registro serie a serie lo hace el reloj (o Hevy, en el futuro).
- **Objetivo** (cabecera de Plan): qué preparas y para cuándo.

## Comer

- **Hoy:** dos barras con franja objetivo (mínimo-máximo): **hidrato** y **proteína**, en gramos, según la sesión de hoy y tu peso. Cifra grande con lo que falta o sobra: "Te faltan 120 g de hidrato". Se marca como estimado.
- **Comidas del día:** desayuno, comida, merienda, snack, cena y durante el entreno. Cada una con su nivel de hidrato recomendado (Alto, Medio, Bajo, en palabra) y lo registrado.
- **Durante el entreno:** gramos por hora para la sesión de hoy si dura más de 90 min. Lo que tomaste de verdad (guardado con `salida_guardar`) alimenta el indicador de combustible de Progreso.
- **Histórico:** semana y mes, hidrato y proteína por día frente a su franja, con los días duros marcados. Se lee "en los días duros te quedas corto de hidrato", no un juicio.
- **Todos los días, con o sin deporte.** Un día de descanso también tiene su objetivo (más bajo en hidrato, igual en proteína). Comer se abre directamente desde su pestaña, no hace falta pasar por una sesión.
- **Día a día y peso.** Vista por días: hidrato y proteína frente a su franja, el entreno de ese día como contexto y, en la misma gráfica, la línea del peso (media de 7 días) con los pesajes como puntos. Así se ve cómo influye lo que comes en el peso a lo largo de las semanas.
- **Peso:** su gráfica (pesajes y media de 7 días, 3 meses, 1 año, todo) vive aquí. Registrar peso, con la báscula o con Claude.
- **Registrar:** se hace con Claude (foto o texto, como ya haces). La app enseña lo registrado y deja corregir o borrar.
- **Sin calorías ni culpa.** Gramos de hidrato y proteína sí, porque son lo que cambia tu rendimiento; calorías no.

## Cómo se cruzan comida y entreno

Comer tiene su sección, pero no va por un camino aparte. Los dos se cuentan sobre el mismo día y la misma sesión:

| Dónde | Qué se ve |
|---|---|
| Hoy | La línea de tiempo junta comidas y sesión; el objetivo de hidrato sale de la sesión de hoy |
| Plan | Cada día lleva su carga y su nivel de hidrato ("Alto", "Medio", "Bajo"); si mueves una sesión, se mueve también la comida que la acompaña |
| Actividad | "Cómo llegaste y qué tomaste": hidrato de las comidas previas, g/h durante (de `salida_guardar`) y si cuadró con lo que pedía la salida |
| Comer, histórico | Las barras de hidrato por día van alineadas con las sesiones (los días duros marcados), para ver si comes según entrenas |
| Progreso | El indicador de combustible y, con datos suficientes, el cruce: "en las salidas largas en las que tomaste menos de 40 g/h, tu stamina mínima bajó de 30 %" |

Las correlaciones solo salen cuando hay datos suficientes (mínimo de salidas comparables) y se marcan como observación, no como regla.

## Progreso

Segmentos: **Forma · Bici · Correr · Skimo** (solo los deportes que haces).

- **Forma:** zonas de forma con nombre y frase (Óptimo, Fresco, Riesgo…, como Intervals.icu, explicadas) y objetivo. El peso vive en Comer.
- **Bici.** Seis indicadores, sacados de tu análisis con Claude del 3 de octubre. Cada uno lleva gráfica por salida o por semana, su línea de referencia y una frase:

  | Área | Indicador | Gráfica | Referencia |
  |---|---|---|---|
  | Motor aeróbico | FC media y metros por latido, comparando solo la misma ruta o un tramo fijo (La Roca en llano) | Barras por salida con el tramo de referencia destacado | Subir metros por latido a igual pulso |
  | Base aeróbica | Desacople en el tramo fijo | Puntos por salida | Por debajo del 5 % (confianza media) |
  | Disciplina | % del tiempo por debajo del techo de Z2 (144 ppm) en los fondos | Barras por salida con líneas de Z2 (135) y techo (144) | ~80 % suave (dato de entrenados) |
  | Durabilidad | Stamina mínima en salidas largas | Barras por salida (más alto es mejor; 1 % = vaciado) | Sin cifra verificada: se compara contigo |
  | Combustible | Gramos de hidrato por hora en ruta | Barras por salida frente a la línea del plan (60 g/h) | 30-60 g/h; hasta 90 g/h en más de 2,5 h |
  | Volumen | Horas de bici por semana | Barras por semana (la actual, marcada como incompleta) | Tu objetivo de horas |

  El peso (media de 7 días) va en Comer, no aquí.

  **Gráficas que relacionan dos cosas** (más útiles que una cifra suelta):
  - **Velocidad media por salida**, con el desnivel y la temperatura como contexto (una salida lenta con 1.500 m no es peor).
  - **Velocidad frente a esfuerzo:** cada salida es un punto (velocidad en llano frente a FC media), más oscuro cuanto más reciente. Si mejoras, los puntos se van hacia "más rápido con menos pulso".
  - **Duración frente a stamina:** cada salida larga es un punto (horas frente a stamina mínima), con el tamaño según los g/h que tomaste. Enseña cuánto aguantas antes de vaciarte y si comer más lo retrasa.
  - **Desacople dentro de una salida:** pulso y velocidad a lo largo de una salida larga; si el pulso sube a igual velocidad, se marca el punto. Se puede comparar con la misma ruta de otro día.
  - **Zonas por semana:** horas suaves, medias y duras apiladas, para ver la disciplina sin mirar salida por salida.

  **Comparar con la misma ruta.** Si repites recorrido, la actividad enseña "19 sep → 3 oct": FC media (151 → 142), metros por latido (2,60 → 2,89), stamina mínima (26 → 51 %) y velocidad (23,6 → 24,7 km/h), con el contexto que cambia la lectura (6 °C más, otra bici). Es la forma más honesta de ver progreso.

  **Más adelante:** curva de potencia y FTP o W/kg cuando haya potenciómetro (vía Intervals.icu), VAM en subidas largas y récords recientes.
- **Correr y Skimo:** lo mismo adaptado (ritmo, ritmo en subida, VAM, eficiencia, desacople).

Todo con datos de Garmin e Intervals.icu leídos por el conector (`coach_progreso`, `intervals_*`), no recalculados en la web.

## Pueblos

- **Resumen de lo hecho** por año, por mes o desde el inicio: horas, kilómetros, desnivel y salidas, por deporte. Un calendario de calor del año (cada día, un cuadro según las horas) para ver la constancia de un vistazo.
- **Mapa de pueblos** por comunidad, España o mundo, con la ficha de cada pueblo.
- **Lista de actividades** filtrable, que lleva a cada actividad.

## Claude

- El botón Claude no abre un chat de imitación: abre tu Claude con el encargo preparado ("Prepárame la semana", "Registra esta comida", "Trázame una ruta de 80 km").
- Dentro de Claude, la app se abre como pantalla (ya existe).
- La guía de qué pedirle está en `CLAUDE-GUIA.md`.

---

## Qué sale

| Sale | Por qué |
|---|---|
| Chat de ejemplo en la web | Promete algo que no hace; lo sustituye "Abrir en mi Claude" |
| "Marcar como hecha" | No guarda nada; lo marca el reloj |
| Test de 5 km y botón de compartir ficha | Solo avisos; vuelven cuando funcionen (futuro) |
| Nota de forma /10 y "tipo de deportista" calculados en la web | El método vive en el conector; se sustituye por zonas de forma y marcadores reales |
| Planificador y reajustes con reglas de la web | Los hace el conector (`coach_proponer`) |
| Aviso "tu plan no encaja" y readiness de respaldo | Duplican el semáforo |
| Pasos decorativos del onboarding ("qué ver primero", checks de "Preparando") | No hacen nada |
| Panel de prototipo, código muerto | Limpieza |
| Dos estilos de plataforma (iOS y Android) | Uno solo en la v1 |

## Qué entra

| Entra | Dónde |
|---|---|
| Titular con la decisión y franja de carga del día | Hoy |
| Contribuyentes con tu normalidad | Hoy |
| "No estoy al 100 %" | Hoy |
| Sección Comer: gramos que faltan o sobran, por comida, durante el entreno, histórico | Comer |
| Leer las comidas que registra Claude (`comidas`) | Comer |
| Rutas en la sesión y lista de rutas | Plan |
| Resumen por año, mes o desde el inicio, y calendario de calor | Pueblos |
| Comer día a día con el peso en la misma gráfica | Comer |
| Gráficas de velocidad frente a esfuerzo y duración frente a stamina | Progreso |
| "La última vez" en fuerza | Plan |
| Marcadores y gráficas de bici, correr y skimo | Progreso |
| Zonas de forma con nombre | Progreso |
| "Aprendiendo tu normalidad" | Hoy (primer uso) |

## Qué se queda (rehecho con el diseño nuevo)

Semáforo y su explicación, cómo te encuentras, semana y hoja del día, mover y cambiar sesión, envío al reloj (fuerza y series), librería de entrenos, actividad (cómo ha ido), peso, evolución, pueblos y mapa, cuenta, Garmin, Intervals.icu, calendario.

## Futuro (fuera de la v1)

Hevy para registrar fuerza, ficha para compartir, tests guiados, hidratación, notificaciones, enlaces que expliquen las métricas, suscripción sin Claude, Strava (lo usa tu Claude con su conector oficial; myCoach no pasa sus datos).

---

## Lo que necesita el conector (no es solo diseño)

- **Objetivos de comida del día** (gramos de hidrato y proteína, por comida y durante el entreno) calculados en el conector, como el semáforo.
- **Franja de carga del día** ligada al estado.
- **`coach_kpis`:** los seis indicadores en series listas en una sola llamada. Para tu panel, Claude tuvo que traer 50 actividades enteras: es justo el gasto de tokens que hay que evitar.
- **Detección de "misma ruta"** en el servidor: `garmin_activity_detail` devuelve la salida de referencia con la que comparar.
- **`salida_guardar`** (actividad, puntos clave, combustible en g de hidrato, ml y sal, sensaciones): el analista la llama al cerrar el análisis y los puntos clave quedan en myCoach, no en la memoria de Claude. Alimenta el indicador de combustible y la comparación con la misma ruta.
- **Proponer la semana** desde el conector.
- Comprobar que `comidas` devuelve lo que registra Claude.

## Orden propuesto

1. **Prototipo de Hoy y Comer** en una rama aparte, con datos de ejemplo, para fijar el aspecto visual. Se compara con la app actual.
2. **Progreso de bici** con tus gráficas y marcadores.
3. **Plan con rutas y fuerza.**
4. **Limpieza** de lo que sale.
5. **Conector:** lo que necesita cada paso se hace en paralelo en `garmin-mcp`.

## Pendiente

- Los avisos de tu análisis: las FC máximas salen del sensor óptico, algunas salidas no tienen desnivel y el 3 sep fue con otra bici. Los indicadores tienen que decir cuándo un dato no es comparable.
- Política de Strava y pausa de la API de Garmin: comprobar a mano antes de abrir al público.
