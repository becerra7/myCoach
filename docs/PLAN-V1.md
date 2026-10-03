# myCoach v1: cómo quedaría la app (propuesta del equipo)

Diseño de producto y UX pensado desde cero, no retoques de lo que hay. Se basa en `PRODUCTO.md`, `INVESTIGACION.md` y el inventario de `FEATURES.md`. El aspecto visual lo define el prototipo (`frontend-design` + `ui-ux-pro-max`, revisado con `impeccable`). Aquí van la estructura, qué enseña cada pantalla y qué sale o entra.

## La idea en una línea

Abres la app y lo primero es **la decisión de hoy** (qué entreno y qué comer) y su porqué. Lo demás está a un toque.

## Navegación: 4 secciones + Claude

| Sección | Pregunta que responde | Antes |
|---|---|---|
| **Hoy** | ¿Qué hago hoy, qué como y por qué? | Hoy |
| **Plan** | ¿Qué toca esta semana y por dónde salgo? | Plan |
| **Comer** | ¿Cuánto hidrato y proteína me falta o me sobra? ¿Cómo voy? | Tarjeta pequeña en Hoy + pantalla escondida |
| **Progreso** | ¿Estoy mejorando? | Forma + Pueblos |

Botón fijo **Claude** (abre tu Claude con el encargo, ver abajo). Ajustes desde el avatar.

**Por qué nutrición tiene sección propia.** Se usa varias veces al día (cada comida), tiene su propia pregunta ("¿cuánto me falta?") y su propio histórico. Metida en Hoy, o se queda corta o ahoga el entreno. En Hoy queda solo un resumen de una línea que lleva a Comer.

**Por qué Pueblos va dentro de Progreso.** Es motivación ("lo que has explorado"), no una tarea diaria. Una pestaña entera para algo que se mira de vez en cuando cuesta más de lo que aporta.

---

## Hoy

De arriba abajo:

1. **Titular con la decisión.** "Rodaje suave · 60 min" en grande. Debajo, el porqué en una frase: "Has dormido poco y tu VFC está por debajo de tu normal". El semáforo va como etiqueta con palabra e icono (✓ Verde, · Ámbar), no como círculo.
2. **Franja de carga de hoy.** Barra con la franja recomendada según tu estado y la sesión como marca. Si la cambias, la marca se mueve en directo y dice si entra (antes → después). Aplicar o deshacer.
3. **Por qué (contribuyentes).** Plegado: sueño, VFC, pulso en reposo, carga reciente y cómo te encuentras, cada uno con un punto sobre *tu* normalidad y una palabra ("Normal", "Algo peor", "Mejor"). Sin 0-100.
4. **Comer hoy (una línea).** "Día de hidrato alto · te faltan ~120 g · proteína al 60 %" → abre Comer.
5. **Semana en 7 casillas** con franja lateral: lleno = hecho, contorno = pendiente, rayado = cambiado. Palabras, nunca rojo.
6. **"No estoy al 100 %"** (secundario): enfermo, molestia o semana cargada. Enseña el plan ajustado antes de aplicarlo.

**Según la hora:** después de entrenar, el titular pasa a ser el resumen de la sesión hecha ("Hecho · 62 min, más suave de lo previsto, bien") comparado con tu historia.
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
- **Durante el entreno:** gramos por hora para la sesión de hoy si dura más de 90 min.
- **Histórico:** semana y mes, hidrato y proteína por día frente a su franja, con los días duros marcados. Se lee "en los días duros te quedas corto de hidrato", no un juicio.
- **Registrar:** se hace con Claude (foto o texto, como ya haces). La app enseña lo registrado y deja corregir o borrar.
- **Sin calorías ni culpa.** Gramos de hidrato y proteína sí, porque son lo que cambia tu rendimiento; calorías no.

## Progreso

Segmentos: **Forma · Bici · Correr · Skimo · Pueblos** (solo los deportes que haces).

- **Forma:** zonas de forma con nombre y frase (Óptimo, Fresco, Riesgo…, como Intervals.icu, explicadas), peso con su tendencia, objetivo.
- **Bici** (lo que pides): gráficas y marcadores top, cada uno con su tendencia y una frase de qué significa.
  - Curva de potencia (mejores 5 s, 1, 5, 20 y 60 min) frente a hace 3 meses (`intervals_curvas`).
  - FTP estimado y W/kg.
  - VAM en subidas largas.
  - Eficiencia: vatios por pulso en fondos (EF) y desacople aeróbico (si el pulso se dispara al final de las salidas largas).
  - Velocidad y pulso en llano a igual esfuerzo.
  - Reparto por zonas de las últimas 4 semanas (¿cuánto suave de verdad?).
  - Cadencia media en llano y en subida.
  - Récords recientes ("Nuevo mejor 20 min: 265 W").
- **Correr y Skimo:** lo mismo adaptado (ritmo, ritmo en subida, VAM, eficiencia, desacople).
- **Pueblos:** el mapa y la lista que ya tienes.

Todo con datos de Garmin e Intervals.icu leídos por el conector (`coach_progreso`, `intervals_*`), no recalculados en la web.

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
| Pestaña Pueblos | Pasa a Progreso |
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
- **Marcadores de progreso** por deporte en `coach_progreso` (con Intervals.icu si está conectado).
- **Proponer la semana** desde el conector.
- Comprobar que `comidas` devuelve lo que registra Claude.

## Orden propuesto

1. **Prototipo de Hoy y Comer** en una rama aparte, con datos de ejemplo, para fijar el aspecto visual. Se compara con la app actual.
2. **Progreso de bici** con tus gráficas y marcadores.
3. **Plan con rutas y fuerza.**
4. **Limpieza** de lo que sale.
5. **Conector:** lo que necesita cada paso se hace en paralelo en `garmin-mcp`.

## Pendiente

- El análisis de bici que querías pasar no llegó a este chat: con él ajusto la lista de marcadores.
- Política de Strava y pausa de la API de Garmin: comprobar a mano antes de abrir al público.
