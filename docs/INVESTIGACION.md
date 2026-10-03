# Investigación de producto y diseño (octubre 2026)

Once apps de referencia, miradas con un objetivo: replantear myCoach desde cero sin parecer una interfaz genérica hecha por IA.

**Cómo leer este documento.** Desde este entorno no se pudo abrir ninguna web (el proxy bloquea las páginas de producto). Todo sale de resultados de búsqueda con fuente enlazada. Etiquetas:
- **Verificado**: lo dice la propia empresa (blog, ayuda, documentación) en el resultado enlazado.
- **Comunidad**: lo dice un tercero (reseña, repositorio, directorio de MCP).
- **Supuesto**: deducción mía. Hay que comprobarlo.

No hay capturas. Colores y tipografía solo se citan cuando una fuente los describe.

---

## Resumen: lo más útil para myCoach

1. **Tres cifras arriba, una decisión debajo.** Whoop (Sueño, Recuperación, Esfuerzo) y Oura (Sueño, Preparación, Actividad) abren con tres indicadores y debajo un consejo. myCoach debería abrir con la decisión ("Hoy: rodaje suave 60 min") y poner el estado como su porqué, no al revés.
2. **Un objetivo de carga para el día, no solo un estado.** Whoop (Strain Target) y Athlytic (Target Exertion) convierten la recuperación en una franja de esfuerzo para hoy. Es la pieza que une estado y plan, y a myCoach le falta.
3. **Contribuyentes con nombre, no una caja negra.** Oura descompone la preparación en siete factores con etiqueta (Óptimo, Bien, Regular, Atención). Garmin enseña los seis factores de Training Readiness. Es el mejor patrón para explicar el semáforo.
4. **Lo no hecho, sin rojo de castigo.** TrainingPeaks pinta en rojo lo no hecho, y funciona para un entrenador, no para un aficionado. Runna ("Not Feeling 100%") y Oura (Rest Mode) dejan pausar sin perder el sitio. myCoach debe copiar lo segundo.
5. **La comida, por semáforo de hidratos, no por calorías.** Fuelin colorea cada comida según la carga del día. Encaja con "sin calorías" mejor que cualquier diario de comida.
6. **Fuerza: no construir un registro de series.** Hevy lo resuelve (valor anterior en línea, temporizador de descanso automático) y tiene API pública y MCP. myCoach planifica la fuerza; el registro detallado puede vivir en Hevy o en el reloj.
7. **Strava ya tiene conector oficial para Claude** (desde junio de 2026). El Claude del usuario puede cruzar Strava y myCoach sin que myCoach toque la API de Strava. Ojo: la política de Strava prohíbe que terceros expongan sus datos por MCP.
8. **Intervals.icu es el mejor socio técnico.** API abierta con clave personal, varios MCP de comunidad y la gráfica Forma con zonas con nombre. myCoach ya la usa (`intervals_*`): reutilizar sus cifras en vez de recalcularlas.

---

## Whoop

**Qué resuelve.** "¿Cuánto puedo exigirme hoy?" para gente que entrena sin entrenador.

**UI/UX que destaca.**
- Inicio con tres diales separados: Sueño, Recuperación y Esfuerzo. Cada uno abre su página de detalle con lo que lo compone (verificado, [Whoop](https://www.whoop.com/thelocker/the-all-new-whoop-home-screen)).
- La recuperación es un porcentaje con tres franjas: verde 67-99, amarillo 34-66, rojo 1-33. Cada franja tiene una frase de qué significa (verificado, [Whoop](https://www.whoop.com/thelocker/how-does-whoop-recovery-work-101)).
- Strain Target: según la recuperación, propone cuánto esfuerzo hacer hoy (verificado, mismo enlace).
- Diario de hábitos: tras 5 "sí" y 5 "no" de un hábito en 90 días, dice si se asocia a más o menos recuperación (verificado, [Whoop](https://www.whoop.com/at/fr/thelocker/a-new-way-to-see-insights-on-which-behaviors-affect-your-recovery/)).
- Se pueden ocultar Sueño y Recuperación los días en que no quieres verlos (verificado, primer enlace). Buen gesto contra la ansiedad.

**Copiar.** El objetivo de carga del día ligado al estado. La regla mínima de datos antes de sacar una conclusión ("aún no hay datos suficientes"). La opción de ocultar el estado.

**Evitar.** Tres diales iguales compiten entre sí. Una reseña cuestiona que el rediseño sea más intuitivo (comunidad, [the5krunner](https://the5krunner.com/2023/03/28/new-whoop-home-screen-looks-pretty-but-is-it-as-intuitive/)). Anillos de un solo color que solo enseñan un número son justo lo "decorativo que no informa" que prohíbe CLAUDE.md.

**Integración.** API oficial v2 con OAuth: ciclos, sueño, recuperación, entrenos y webhooks (verificado por documentación citada en [Terra](https://tryterra.co/blog/whoop-api-data-access-permissions-limitations-2026); portal: developer.whoop.com). Varios MCP de comunidad (comunidad, [mcp.so](https://mcp.so/tags/whoop)). Sin conector oficial de Claude encontrado. Con Claude: comparar la recuperación de Whoop con el semáforo de myCoach si el usuario lleva las dos cosas.

## Oura

**Qué resuelve.** Sueño y recuperación sin hablar de entreno.

**UI/UX que destaca.**
- Pasó de cinco pestañas a tres: Hoy, Constantes y Mi salud (verificado, [Oura](https://ouraring.com/blog/new-oura-app-experience/)).
- Hoy: tres puntuaciones arriba, un "destacado del día" que cambia según la hora y una línea de tiempo del día (verificado, mismo enlace).
- Preparación = siete contribuyentes en tres pilares (sueño, actividad, estrés del cuerpo), con franjas Óptimo 85-100, Bien 70-84, Regular 60-69, Atención 0-59 (verificado, [Oura](https://ouraring.com/readiness-score)).
- Equilibrio de VFC: tu media de 7 días frente a tu media larga (verificado, [Oura ayuda](https://support.ouraring.com/hc/en-us/articles/360057791533)).
- Rest Mode: silencia actividad y contribuyentes si estás enfermo o lesionado; si sube la temperatura, lo sugiere (verificado, mismo enlace).

**Copiar.** Etiquetas de palabra y no solo de color (cumple WCAG sin esfuerzo). "Atención" en lugar de "Malo". El destacado que cambia según el momento del día. El modo descanso.

**Evitar.** Tres puntuaciones de 0 a 100 parecidas entre sí. El usuario no sabe cuál manda.

**Integración.** API v2 oficial con token personal y OAuth (comunidad, a través de los README de MCP). Varios MCP de comunidad (comunidad, [Glama](https://glama.ai/mcp/servers/dlyfts57l6)). No encontré conector oficial (comunidad, [Claude Marketplaces](https://claudemarketplaces.com/mcp/davidmosiah/oura-mcp)). Intervals.icu ya importa datos de Oura (verificado, ver Intervals.icu).

## Bevel y Athlytic

**Qué resuelven.** Recuperación, esfuerzo y sueño estilo Whoop con el Apple Watch.

**UI/UX que destaca.**
- Bevel: recuperación, esfuerzo y sueño como una cifra cada uno, tarjetas del inicio editables, claro y oscuro (comunidad, [App Store](https://apps.apple.com/us/app/bevel-all-in-one-health-app/id6456176249), [Kiledjian](https://kiledjian.com/2026/07/07/bevel-turns-apple-watch-data.html)). Una reseña lo resume: "la recuperación en un vistazo, no una hoja de cálculo".
- Athlytic: franja de esfuerzo objetivo para hoy. Puedes ajustar intensidad, duración o tipo de una sesión sugerida y ver cómo cambia el esfuerzo previsto en directo hasta caer en la franja (verificado, [App Store](https://apps.apple.com/dk/app/id1543571755)).

**Copiar.** El "antes → después" en directo de Athlytic: mueves la sesión y ves si entra en la franja. Es exactamente la regla de CLAUDE.md de enseñar el cambio antes de hacerlo.

**Evitar.** Reseñas critican los degradados de Athlytic por meter ruido y piden un solo color de acento y la cifra principal más grande (comunidad, [App Store](https://apps.apple.com/dk/app/id1543571755)). Degradados y brillos son la marca de "app hecha por IA".

**Integración.** Sin API pública encontrada para ninguna de las dos. Viven de Apple Health. Fuera del alcance de myCoach (usuarios Garmin).

## MyFitnessPal

**Qué resuelve.** Registrar comida con la base de datos más grande.

**UI/UX que destaca.** Todas las formas de registrar en una sola vista: escanear, hablar y buscar. Meal Scan (foto) y Voice Log son de pago (verificado, nota de prensa en [Eastern Progress](https://www.easternprogress.com/myfitnesspal-announces-its-2025-summer-release/article_0c108ad7-c8f9-5cbe-bbc6-eca09b6be312.html), [Webull](https://www.webull.com/news/12377891991156736)).

**Copiar.** Una sola entrada para comer: foto, texto o voz en el mismo sitio. myCoach ya registra con foto o texto vía Claude: esa es su versión.

**Evitar.** El contador de calorías como centro. Choca con "sin calorías".

**Integración.** Sin API pública desde 2017-2019 (comunidad, [RapidDevelopers](https://www.rapidevelopers.com/bolt-ai-integrations/myfitnesspal)). Hay un MCP de comunidad que usa cookies del navegador, frágil (comunidad, [PyPI mfp-mcp](https://pypi.org/project/mfp-mcp/)). No recomiendo integrarlo.

## Cronometer y Fuelin

**Qué resuelven.** Cronometer: micronutrientes con precisión. Fuelin: qué comer según el entreno.

**UI/UX que destaca.**
- Cronometer: barras de objetivo por macro (consumido o restante); en gráficas, la franja objetivo se pinta entre mínimo y máximo (verificado, [Cronometer](https://cronometer.com/blog/charts), [ayuda](https://support.cronometer.com/hc/en-us/articles/360019864311)).
- Fuelin: se sincroniza con el plan (TrainingPeaks y otros) y colorea los hidratos de cada comida con un semáforo según la carga del día (comunidad, [Roadman](https://roadmancycling.com/compare/hexis-vs-fuelin), [L'Étape](https://slovenia.letapeseries.com/blog/training-tips/moja-prva-prehranska-periodizacija?locale=en)).

**Copiar.** El semáforo de hidratos por comida de Fuelin, ligado a la sesión del día. La franja objetivo (mínimo-máximo) en vez de una cifra exacta.

**Evitar.** Las pantallas de 80 nutrientes de Cronometer. No es el público.

**Integración.** Ninguna de las dos tiene API pública (comunidad). Cronometer tiene MCP de comunidad por ingeniería inversa (comunidad, [Glama](https://glama.ai/mcp/servers/rwestergren/cronometer-api-mcp)). No integrar en la v1.

## TrainingPeaks

**Qué resuelve.** El calendario entre entrenador y deportista, y la carga (TSS, CTL, ATL, TSB).

**UI/UX que destaca.**
- Colores de cumplimiento: verde ±20 % de lo planificado, amarillo 50-79 % o 121-150 %, naranja más allá, rojo no hecho, gris no planificado. Se dice qué valor manda (duración, distancia o TSS) y si te pasaste o te quedaste corto (verificado, [TrainingPeaks ayuda](https://help.trainingpeaks.com/hc/en-us/articles/204861204)).
- En móvil, el color es una franja a la izquierda de la tarjeta (verificado, mismo enlace).
- PMC: Forma = Fitness − Fatiga (verificado por varias fuentes, p. ej. [Roadman](https://roadmancycling.com/blog/cycling-ctl-atl-tsb-explained-guide)).

**Copiar.** La franja lateral de la tarjeta: estado de cumplimiento sin ocupar sitio. Decir "te pasaste" o "te quedaste corto", no solo un color.

**Evitar.** Rojo para lo no hecho. Siglas (CTL/ATL/TSB) en la vista principal.

**Integración.** API solo para socios; no aceptan uso personal (verificado, [TrainingPeaks](https://www.trainingpeaks.com/blog/an-update-on-trainingpeaks-partner-api/), [API Evangelist](https://providers.apievangelist.com/providers/trainingpeaks/)). Sin MCP oficial encontrado. Dejar fuera.

## Garmin Connect

**Qué resuelve.** La fuente de datos de todos los usuarios de myCoach.

**UI/UX que destaca.**
- Inicio rediseñado (2024) con secciones editables: Actividad de hoy, In Focus, De un vistazo, Eventos, Planes (verificado, [Garmin](https://www.garmin.com/en-US/blog/fitness/new-garmin-connect-mobile/)).
- In Focus: tarjetas que se deslizan, una de ellas con los seis factores de Training Readiness (comunidad, [Android Authority](https://androidauthority.com/garmin-connect-redesign-3364392)).
- Morning Report en el reloj al despertar: sueño, readiness, agenda (comunidad, [DC Rainmaker](https://dcrainmaker.com/2023/07/training-readiness-instinct.html)).

**Copiar.** El "parte de la mañana" como ritual: el usuario ya lo ve en la muñeca. myCoach debe añadir lo que Garmin no da: qué hacer con eso y por qué.

**Evitar.** Repetir sus métricas (Body Battery, Training Status) con otro nombre. Si Garmin ya lo enseña, myCoach lo resume en una línea o no lo pone.

**Integración.** API oficial solo para empresas y con nuevas altas en pausa (comunidad, [Terra](https://tryterra.co/blog/garmin-connect-developer-program-pause); [Garmin Developers](https://developer.garmin.com/gc-developer-program/overview)). myCoach usa acceso no oficial (`garmin-mcp`). Riesgo a vigilar antes de abrir al público (supuesto).

## Strava

**Qué resuelve.** Lo social, los segmentos y las rutas populares.

**UI/UX que destaca.** Athlete Intelligence resume cada actividad en texto nada más subirla y compara con los últimos 30 días (verificado por prensa, [Cycling Weekly](https://cyclingweekly.com/news/strava-introduces-artificial-intelligence-feature-for-subscribers)). Rutas sugeridas según zona, distancia, superficie y desnivel, con datos de millones de actividades (verificado por prensa, [Cycling Weekly](https://cyclingweekly.com/news/latest-news/strava-releases-new-automated-routes-feature-452517)).

**Copiar.** El resumen de una frase tras la actividad, comparado con tu historia.

**Evitar.** Competir en lo social o en el mapa de calor de rutas. No podemos ganar.

**Integración.** Conector MCP oficial para Claude, remoto en `https://mcp.strava.com/mcp`, solo lectura, para suscriptores, desde el 1 de junio de 2026 (verificado, [Strava ayuda](https://support.strava.com/hc/en-us/articles/46190267796237), [Let's Data Science](https://letsdatascience.com/news/strava-launches-mcp-connector-for-claude-integration-909e07a0)). Según un análisis de la política, Strava prohíbe que terceros operen un MCP que exponga sus datos y que se metan en contexto de IA fuera de su conector (comunidad, [Tredict](https://www.tredict.com/blog/strava_mcp_server/)). Consecuencia: myCoach **no** debe pasar datos de Strava por su conector; el Claude del usuario puede usar los dos a la vez.

## Intervals.icu

**Qué resuelve.** Análisis serio y gratis de carga, forma y bienestar.

**UI/UX que destaca.**
- Gráfica Fitness/Fatiga/Forma con zonas con nombre: Óptimo (ganas forma), Alto riesgo (no te quedes mucho), Fresco (listo para competir) (verificado, [Intervals.icu](https://www.intervals.icu/features/track/), [foro](https://forum.intervals.icu/t/zones-of-form-in-fitness-chart/3623)).
- Importa bienestar de Garmin, Oura, Polar y más (verificado, mismo enlace).

**Copiar.** Zonas de forma con nombre y frase, no un número suelto. "Óptimo" significa "estás entrenando bien", no "estás fresco": hay que explicarlo, porque confunde (comunidad, [foro](https://forum.intervals.icu/t/clients-loss-in-confidence-in-intervals-icu-fitness-page/104874)).

**Evitar.** Su densidad. Es una herramienta de análisis, no un entrenador.

**Integración.** API pública con clave personal y OAuth, Swagger publicado (verificado, [Intervals.icu Open API](https://www.intervals.icu/features/open-api/), [foro API](https://forum.intervals.icu/t/api-access-to-intervals-icu/609)). Varios MCP de comunidad que leen y escriben eventos (comunidad, [Glama](https://glama.ai/mcp/servers/mvilanova/intervals-mcp-server)). myCoach ya lo integra.

## Runna

**Qué resuelve.** Planes de carrera que se adaptan, con envío al reloj.

**UI/UX que destaca.**
- "Not Feeling 100%": ajustas el entreno si estás malo, con molestias o con mucha semana, y vuelves al plan sin perder tu sitio (comunidad, [IT Brief](https://itbrief.co.uk/story/runna-revamps-beginner-plans-with-flexible-guidance)).
- Mileage Insights: mira cuánto cumples y propone ajustar el volumen (misma fuente).
- Sesiones con "briefing" personal: en qué fijarte hoy (misma fuente).
- Envía sesiones a Garmin y recoge lo hecho (verificado, [Runna ayuda](https://support.runna.com/en/articles/6169639-using-your-garmin-watch-with-runna)). Strava compró Runna en 2025 ([DC Rainmaker](https://dcrainmaker.com/2025/04/strava-acquires-runna-thoughts-forward.html)).

**Copiar.** El botón "No estoy al 100 %" como entrada de primera clase en Hoy. El briefing de una línea por sesión.

**Evitar.** Planes cerrados que no cuentan otros deportes como carga.

**Integración.** Sin API pública encontrada. Sus datos llegan vía Garmin o Strava (supuesto).

## Hevy

**Qué resuelve.** Registrar fuerza serie a serie, rápido.

**UI/UX que destaca.**
- Columna ANTERIOR junto a cada serie; un toque la copia (verificado, [Hevy](https://www.hevyapp.com/features/track-exercises/)).
- Temporizador de descanso que salta al marcar la serie hecha (verificado, [Hevy](https://www.hevyapp.com/features/workout-rest-timer/)).

**Copiar.** "La última vez: 3 × 8 a 40 kg" al lado de lo que toca hoy. myCoach ya guarda la última vez en `fuerza_entrenos`.

**Evitar.** Construir un registro en vivo serie a serie dentro de myCoach.

**Integración.** API pública oficial con clave, requiere Hevy Pro (verificado, documentación en api.hevyapp.com/docs citada por [API Evangelist](https://providers.apievangelist.com/providers/hevy/)). MCP de comunidad con endpoint remoto OAuth para añadir como conector personalizado en Claude (comunidad, [Glama hevy-mcp](https://glama.ai/mcp/servers/@chrisdoc/hevy-mcp/blob/a6a4ef7c6645c712b5f77f1896accce8ed636a07/README.md)). Con Claude: myCoach propone "Pierna A", Claude la crea como rutina en Hevy y luego lee lo hecho.

---

## Construir, integrar o dejar fuera

| Área | Construir en myCoach | Integrar con otra app | Dejar fuera |
|---|---|---|---|
| Estado | Semáforo con contribuyentes nombrados, objetivo de carga del día, modo "no estoy al 100 %" | Garmin (datos), Intervals.icu (bienestar y forma) | Puntuaciones propias de sueño o estrés: Garmin ya las da |
| Plan | Semana con franja de cumplimiento sin rojo, propuesta antes → después | Envío a Garmin (ya existe), Intervals.icu (calendario) | TrainingPeaks (API cerrada) |
| Entreno | Sesión con briefing de una línea, "la última vez" en fuerza | Hevy para registro serie a serie (opcional, Pro) | Registro en vivo de series dentro de la app |
| Nutrición | Semáforo de hidratos por comida según la sesión, registro por foto o texto con Claude | Ninguna en la v1 | MyFitnessPal y Cronometer (sin API oficial), calorías |
| Rendimiento | Forma con zonas con nombre, tendencias por deporte con frase | Intervals.icu (curvas, eficiencia) | Siglas CTL/ATL/TSB en primer plano |
| Rutas | Trazado con `garmin_plan_route`, pueblos visitados | Strava vía su conector oficial en el Claude del usuario | Pasar datos de Strava por nuestro conector; Komoot (sin API pública) |

---

## Ideas de representación para la pantalla Hoy

1. **La decisión es el titular.** Primera línea, en grande: "Rodaje suave · 60 min". Debajo, una frase: "Has dormido poco y tu VFC está por debajo de tu media". El semáforo acompaña al titular como etiqueta de texto con icono ("Verde ✓", "Ámbar · cuidado"), no como círculo.
2. **Barra de contribuyentes en vez de dial.** Una fila por factor (sueño, VFC, pulso en reposo, carga reciente, sensaciones) con un punto sobre una escala corta de tu propia normalidad y una palabra: "Normal", "Algo peor", "Mejor". Patrón Oura/Garmin con tu línea base, sin 0-100.
3. **Franja de carga de hoy.** Una barra horizontal con la franja recomendada sombreada y la sesión planificada como marca. Si mueves duración o intensidad, la marca se desplaza en directo y dice si entra (Athlytic). Es el "antes → después" de los cambios de plan.
4. **La semana en siete casillas con franja lateral.** Cada día con el deporte y una franja: lleno = hecho, contorno = pendiente, rayado = cambiado o descansado. Texto corto: "Hecho", "Más corto", "Movido". Nunca rojo para lo no hecho (mejora sobre TrainingPeaks).
5. **Comidas como semáforo de hidratos.** Desayuno, comida, merienda, cena y "durante" en una fila, cada una con nivel de hidrato (Alto, Medio, Bajo) en palabra y forma de relleno, ligado a la sesión de hoy (Fuelin). Sin calorías.
6. **Botón "No estoy al 100 %".** Siempre visible y secundario. Abre una hoja con tres opciones (enfermo, molestia, semana cargada). Enseña el plan ajustado antes de aplicarlo (Runna, Oura Rest Mode).
7. **Destacado según la hora.** Por la mañana, el porqué de la sesión; por la tarde, si ya la hiciste, el resumen de una frase comparado con tu historia (Strava); por la noche, la hora de acostarse si mañana toca calidad (Oura).
8. **"Aún no sé lo suficiente."** Mientras falten días de datos, el semáforo dice "Aprendiendo tu normalidad · 4 de 14 días" en lugar de inventar un color (regla mínima de Whoop). Sirve de estado vacío y de primer uso.

---

## Fuentes

- Whoop: [nuevo inicio](https://www.whoop.com/thelocker/the-all-new-whoop-home-screen) · [recuperación 101](https://www.whoop.com/thelocker/how-does-whoop-recovery-work-101) · [hábitos y recuperación](https://www.whoop.com/at/fr/thelocker/a-new-way-to-see-insights-on-which-behaviors-affect-your-recovery/) · [the5krunner](https://the5krunner.com/2023/03/28/new-whoop-home-screen-looks-pretty-but-is-it-as-intuitive/) · [API en Terra](https://tryterra.co/blog/whoop-api-data-access-permissions-limitations-2026) · [MCP en mcp.so](https://mcp.so/tags/whoop)
- Oura: [nueva app](https://ouraring.com/blog/new-oura-app-experience/) · [Readiness](https://ouraring.com/readiness-score) · [ayuda contribuyentes](https://support.ouraring.com/hc/en-us/articles/360057791533) · [MCP Glama](https://glama.ai/mcp/servers/dlyfts57l6) · [oura-mcp](https://claudemarketplaces.com/mcp/davidmosiah/oura-mcp)
- Bevel y Athlytic: [Bevel App Store](https://apps.apple.com/us/app/bevel-all-in-one-health-app/id6456176249) · [Kiledjian](https://kiledjian.com/2026/07/07/bevel-turns-apple-watch-data.html) · [Athlytic App Store](https://apps.apple.com/dk/app/id1543571755)
- MyFitnessPal: [versión verano 2025](https://www.easternprogress.com/myfitnesspal-announces-its-2025-summer-release/article_0c108ad7-c8f9-5cbe-bbc6-eca09b6be312.html) · [versión invierno 2025](https://www.webull.com/news/12377891991156736) · [API cerrada](https://www.rapidevelopers.com/bolt-ai-integrations/myfitnesspal) · [mfp-mcp](https://pypi.org/project/mfp-mcp/)
- Cronometer y Fuelin: [gráficas](https://cronometer.com/blog/charts) · [ayuda](https://support.cronometer.com/hc/en-us/articles/360019864311) · [MCP](https://glama.ai/mcp/servers/rwestergren/cronometer-api-mcp) · [Hexis vs Fuelin](https://roadmancycling.com/compare/hexis-vs-fuelin) · [L'Étape](https://slovenia.letapeseries.com/blog/training-tips/moja-prva-prehranska-periodizacija?locale=en)
- TrainingPeaks: [cumplimiento](https://help.trainingpeaks.com/hc/en-us/articles/204861204) · [API de socios](https://www.trainingpeaks.com/blog/an-update-on-trainingpeaks-partner-api/) · [API Evangelist](https://providers.apievangelist.com/providers/trainingpeaks/) · [CTL/ATL/TSB](https://roadmancycling.com/blog/cycling-ctl-atl-tsb-explained-guide)
- Garmin: [nuevo Connect](https://www.garmin.com/en-US/blog/fitness/new-garmin-connect-mobile/) · [Android Authority](https://androidauthority.com/garmin-connect-redesign-3364392) · [DC Rainmaker readiness](https://dcrainmaker.com/2023/07/training-readiness-instinct.html) · [programa de desarrolladores](https://developer.garmin.com/gc-developer-program/overview) · [pausa en Terra](https://tryterra.co/blog/garmin-connect-developer-program-pause)
- Strava: [conector MCP](https://support.strava.com/hc/en-us/articles/46190267796237) · [lanzamiento](https://letsdatascience.com/news/strava-launches-mcp-connector-for-claude-integration-909e07a0) · [Tredict sobre la política](https://www.tredict.com/blog/strava_mcp_server/) · [Athlete Intelligence](https://cyclingweekly.com/news/strava-introduces-artificial-intelligence-feature-for-subscribers) · [rutas](https://cyclingweekly.com/news/latest-news/strava-releases-new-automated-routes-feature-452517)
- Intervals.icu: [seguimiento](https://www.intervals.icu/features/track/) · [zonas de forma](https://forum.intervals.icu/t/zones-of-form-in-fitness-chart/3623) · [confusión con Óptimo](https://forum.intervals.icu/t/clients-loss-in-confidence-in-intervals-icu-fitness-page/104874) · [Open API](https://www.intervals.icu/features/open-api/) · [foro API](https://forum.intervals.icu/t/api-access-to-intervals-icu/609) · [MCP](https://glama.ai/mcp/servers/mvilanova/intervals-mcp-server)
- Runna: [IT Brief](https://itbrief.co.uk/story/runna-revamps-beginner-plans-with-flexible-guidance) · [Garmin](https://support.runna.com/en/articles/6169639-using-your-garmin-watch-with-runna) · [compra por Strava](https://dcrainmaker.com/2025/04/strava-acquires-runna-thoughts-forward.html)
- Hevy: [ejercicios](https://www.hevyapp.com/features/track-exercises/) · [descanso](https://www.hevyapp.com/features/workout-rest-timer/) · [API](https://providers.apievangelist.com/providers/hevy/) · [hevy-mcp](https://glama.ai/mcp/servers/@chrisdoc/hevy-mcp/blob/a6a4ef7c6645c712b5f77f1896accce8ed636a07/README.md)
- Komoot (rutas): [komoot-mcp, sin API pública](https://glama.ai/mcp/servers/integrations/komoot)
