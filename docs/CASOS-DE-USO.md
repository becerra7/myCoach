# Casos de uso y funciones de myCoach (estado actual)

Inventario para cerrar una v1. Salió de leer el código de `apps/web/src` y de `PRODUCT.md`. Lo marcado con ✔ lo he comprobado en el código; el resto viene del inventario y conviene verlo en la app antes de decidir.

## Casos de uso

| # | Momento | Pregunta del usuario | Pantalla que lo resuelve hoy |
|---|---|---|---|
| 1 | Por la mañana | ¿Qué toca hoy y por qué? | Hoy |
| 2 | Durante el entreno | ¿Qué ejercicio, series y peso toca? | Hoja del día → bloque de fuerza (Tus entrenos) |
| 3 | Después | ¿Cómo ha ido y cumplí el plan? | Actividad |
| 4 | Planificar la semana | Quiero montarla o ajustarla | Plan (+ Claude) |
| 5 | Con calma | ¿Estoy mejorando? | Forma, Peso, Pueblos |

Casos de apoyo: conectar Garmin y primer uso (onboarding), comer según la carga del día (Comida), pedirle cosas a tu Claude (entrenos, rutas, plan).

## Cómo funciona cada feature

**Hoy.** Semáforo del conector (`coach_hoy`) con el porqué y los datos que lo explican (se abren a un toque). Debajo, la sesión de hoy con "encaja o no", la semana en 7 días, deportes y Comida. Acciones: aplicar el cambio propuesto, abrir el día, "Cuéntame cómo te encuentras", preparar la semana.

**Plan.** Selector de 9 semanas. Actual: % cumplido y días. Pasada: revisión. Próxima: planificador (deportes, horas, "Proponer semana"). La hoja del día permite mover, cambiar por otra cosa, poner entreno de fuerza y enviar al reloj. Usa el calendario iCal (solo web) para respetar huecos.

**Forma.** Nota general /10, dimensiones comunes y por deporte, filtro por deporte, peso, objetivo, evolución (horas, VO2/Endurance/Hill), test de subida de 20 min y ficha para compartir. Las notas las calcula la web.

**Pueblos y mapa.** Municipios cruzados por comunidad, España o Mundo, filtro por deporte, buscador y mapa a pantalla completa con ficha del pueblo. Datos de `garmin_activity_route`.

**Actividad.** Cifras, cómo cuenta en tu semana, plan frente a lo hecho, lo mejor de la salida (llano, subida, VAM), mapa y pueblos nuevos. En fuerza, plan frente a lo hecho por ejercicio. El detalle se pide al abrirla. "Corregir" el tipo.

**Fuerza y Tus entrenos.** Librería de entrenos con nombre (casa o gimnasio), editor de ejercicios, envío al reloj (`fuerza_enviar_garmin`), historial por ejercicio. Las series de bici y correr se ven y se reenvían, pero no se editan en la app. La app no marca series: las cuenta el reloj o Claude.

**Peso.** Último pesaje, media de 7 días, cambio a 30 días y 3 meses, gráfica y tabla. La app no tiene entrada de peso: se registra con la báscula o con Claude (`peso_registrar`).

**Comida.** Cuartos de plato según la carga del día, gráfico semanal de hidratos, registro por foto (estimado) o a mano. Los datos son locales (`S.meals`).

**Ajustes.** Cuenta, conexiones (Garmin, Intervals.icu, calendario), nombre del entrenador, deportes, preferencias y versión.

**Chat con Claude.** En la web es siempre un modo de ejemplo ("aquí no hay Claude"); dentro de Claude se habla en la conversación.

**Onboarding.** Seis pasos: cuenta, Garmin, deportes, qué ver primero, IA sí o no, preparación.

## Lo que no encaja (candidatos a cerrar en la v1)

1. ✔ **"Marcada como hecha" no hace nada.** Solo lanza un aviso (`mark-done`, `50-pueblos-comida-claude.js:318`). O guarda, o se quita.
2. **Método repartido.** Forma, comida, planificador y la adaptación local se calculan en la web, y el `CLAUDE.md` dice que la web enseña y no recalcula. ✔ La web no usa `coach_progreso` ni `coach_semana`.
3. ✔ **La comida que registra Claude no se lee.** La web no consulta `comidas`, solo su propio `estado/app`. Lo que apunte Claude puede no aparecer en la app. Por comprobar.
4. **Chat falso en la web.** Responde con textos de ejemplo. Da una expectativa que no se cumple.
5. **Tres entradas a Forma** (pestaña, tarjeta opcional en Hoy y ficha) y accesos sueltos a Tus entrenos, Objetivo y Comida desde tarjetas distintas, sin un sitio claro.
6. **Cosas a medias visibles:** test de 5 km (solo un aviso), "Núcleos del municipio: pendiente de OpenStreetMap" en la ficha del pueblo, cardio sin editor, peso sin entrada manual.
7. **Paso "qué quieres ver primero"** del onboarding sin efecto en una navegación fija. El panel `?proto` sigue en producción, oculto por CSS.
8. **Estado de espera:** hasta 8-11 s con pantallas vacías mientras se comprueba el conector.

## Siguiente paso propuesto

Antes de rediseñar, decidir qué entra en la v1: quitar o terminar los puntos 1, 4, 6 y 7, y decidir dónde vive el método (puntos 2 y 3). Después, un estudio breve de apps parecidas (Garmin Connect, TrainingPeaks, Intervals.icu, Strava, Whoop, Hevy) para elegir el enfoque visual con los casos 1, 2 y 3 como prueba.
