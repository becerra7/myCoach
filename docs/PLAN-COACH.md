# myCoach como entrenador: análisis de NUA y plan

_Septiembre 2026. Complementa `ARCHITECTURE.md`._

## 1. Resumen

- **NUA** es un entrenador de IA (sobre todo de ciclismo) que funciona **por WhatsApp o Telegram**, lee Garmin, Wahoo, Strava, COROS, Polar e Intervals.icu, y cambia tu plan cada día. Cuesta **19,95 $/mes, o 12,50 $/mes pagando el año**, con 14 días de prueba. No tiene app ni gráficas: todo es conversación.
- Su ventaja no está en el modelo de IA. Está en tres cosas que ellos mismos dicen que a "Claude con un conector" le faltan: **escribe primero** (proactividad), **se acuerda de ti** (estado del atleta vivo) y **sigue un método** (no cambia de criterio cada vez que le preguntas).
- **Usar el Claude Pro o Free de cada usuario *dentro* de myCoach no está permitido.** Desde enero y febrero de 2026, Anthropic prohíbe que una app de terceros use el login o los tokens de los planes de consumo. **Lo que sí se puede es lo contrario:** myCoach es un **conector** que cada uno añade a *su* Claude (también en el plan Free, que admite 1 conector personalizado), y puede mostrar pantallas de myCoach dentro del chat (**MCP Apps**). Eso ya lo tenéis a medias con `app_leer` y `app_guardar`.
- **El mayor riesgo no es la IA, son los datos.** El login no oficial de Garmin se rompió en marzo de 2026. El programa oficial de desarrolladores de Garmin **no acepta solicitudes** desde septiembre de 2026. Desde junio de 2026, **Strava prohíbe meter sus datos en IA**. Para abrirlo al público hace falta otra fuente: Intervals.icu, Apple Health o Health Connect, o esperar a Garmin.
- **Propuesta:** un motor propio que **decide** (carga, plan, límites), con reglas y sin IA, y un LLM que **explica y negocia**. Encima, tres formas de usarlo: **sin IA** (gratis), **con tu Claude** (gratis, por el conector) y **myCoach Coach** (de pago, con nuestra IA, por Telegram o WhatsApp y proactivo). Precio de 5 a 7 €/mes: la mitad que NUA y multideporte de verdad.

---

## 2. Qué hace NUA exactamente

| Caso de uso | Cómo lo hace NUA |
|---|---|
| **Crear el plan con una conversación** | Sin descargar nada: le escribes tu objetivo, tu rutina y tus dispositivos, y te va preguntando. |
| **Ajustar el día a día** | "No puedo entrenar mañana, tengo cena" → mueve las series al jueves, retoca el viernes para llegar fresco al sábado y te da un consejo para la cena. |
| **Adaptarse a cómo estás** | Usa VFC, sueño y fatiga para rehacer la sesión en pocas horas si cambia tu estado. |
| **Medir tu nivel sin test** | Saca el FTP de la curva de potencia o de los umbrales de pulso. Si no hay potenciómetro, usa pulso, ritmo o sensación (RPE). |
| **Periodizar** | Temporada, semana y día, con puesta a punto para la carrera. Si cambia la fecha o te lesionas, rehace el plan. |
| **Varios deportes** | El núcleo es la bici, pero también cubre correr, nadar, fuerza y triatlón con **un único modelo de carga**. |
| **Comida** | Plan de comidas semanal ligado a los entrenamientos (dicen haber hecho más de 1.000). |
| **Analizar cada actividad** | Te la comenta sola y guarda el histórico para ver tu progresión. |
| **Motivar y hacerte cumplir** | Mensajes diarios según tu contexto. Dicen que se cumple el plan 3 veces más. |
| **Idiomas** | 7 u 8 idiomas, incluidos español y catalán, y detecta el tuyo solo. |
| **Escala** (lo que publican) | Más de 15 países, más de 500.000 entrenos creados y más de 5 millones de mensajes. Montan "más de 60 agentes especializados". |

**Lo que aprendieron** (lo cuentan los fundadores en Merkabici): su primera versión falló porque **quien decidía no era quien explicaba**, y las explicaciones no cuadraban con las decisiones. Hoy mezclan un algoritmo que da la estructura con IA que decide y explica, y todo en ciclo cerrado: planificar → observar → replanificar. Y lo más importante: *"si el deportista no entiende **por qué** cambia algo, deja de creer en el proceso"*.

**Puntos débiles** (competidores y reseñas):
- **Solo chat.** No hay dónde ver tu semana, tu forma o tu progresión. Ellos lo presentan como decisión, pero hay gente que quiere ver las cosas.
- **Caro** para quien no compite: de 150 a 240 $ al año.
- **La bici primero.** Correr, montaña o raquetas son secundarios. Esquí de montaña o pádel ni aparecen.
- **Depende de WhatsApp.** Desde el 15 de enero de 2026, Meta prohíbe los chatbots de IA "de propósito general". Un entrenador especializado sí se permite, pero es una dependencia más.

---

## 3. Casos de NUA: cómo está myCoach y cómo replicarlo

| Caso de NUA | Qué hay hoy en myCoach | Cómo replicarlo (y mejorarlo) |
|---|---|---|
| Plan conversacional | Onboarding con pasos y `generarSemana()` con reglas. Chat en el artifact (`sample`) con la herramienta `proponer_cambios`. | Onboarding que se puede **hablar o tocar**. El plan sale de un motor determinista y el LLM solo propone cambios dentro de sus límites (ya se hace con `validarPropuesta`). |
| Ajuste diario | Mover una sesión, límites por semana, aviso si la semana está sin plan. | **Replanificar solo** tras cada actividad o cambio de readiness, en un cron diario del Worker. Mensaje proactivo del tipo "he movido X porque Y". |
| Adaptación a VFC, sueño y readiness | Se leen (`garmin_dia`: sueño, VFC y readiness) y se aplica "nada intenso con readiness < 40". | Regla de semáforo para cada sesión (verde, ámbar, rojo) con **la razón en una frase**. Y aprender del usuario: si dice "estaba reventado", ajustar su umbral. |
| Nivel sin test | W/kg estimado por física de las subidas, test de 20 min, VO2máx y Endurance de Garmin. | Añadir la curva de potencia (si hay potenciómetro) y umbrales de pulso y ritmo por deporte a partir del historial. |
| Periodización | Objetivo por "modo" y semanas sueltas. | **Temporada**: fecha del objetivo, bloques de base, construcción, pico y descarga, y descarga cada 3 o 4 semanas. Motor en `packages/domain`. |
| Carga multideporte | Horas, zonas de pulso y resumen semanal. | **Un modelo de carga para todo** (TRIMP por pulso → forma, fatiga y frescura) que incluya el esquí de montaña, la montaña, el pádel y la fuerza. **Es vuestra ventaja**: NUA es de bici. |
| Comida | Cuartos del plato, foto con Claude y sin calorías. | Consejo **según la carga del día** ("mañana fondo de 3 h: cena con más hidratos") y avituallamiento para sesiones largas. Mantener la regla de no hablar de calorías. |
| Análisis de la actividad | Detalle, pueblos, rutas y zonas. | Un **comentario de 2 o 3 frases** tras cada actividad: ¿se cumplió lo previsto? ¿qué cambia? Lo manda el Worker cuando entra la actividad. |
| Memoria | Estado en `estado/app` (plan, comidas, objetivo) y notas. | Documento **`atleta/perfil`** con lesiones, preferencias, disponibilidad, días fijos, material, lo que no le gusta y el historial de decisiones con su porqué. Lo leen la web, tu Claude y el bot. |
| Proactividad | Ninguna: la app espera a que la abras. | Cron diario en el Worker → **Web Push (PWA)** y **Telegram**, y luego WhatsApp. Ver el apartado 5. |
| Mandar sesiones al reloj | Guardar recorridos en Garmin (`garmin_save_course`). | **Mandar entrenos estructurados** a Garmin por el conector (API no oficial, como los recorridos) o por Intervals.icu, que es socio oficial de Garmin. |
| Idiomas | Castellano. | Castellano primero, luego catalán e inglés. El LLM traduce solo, pero los textos de la app van a i18n. |

**Lo que NUA no tiene y myCoach sí:** una **app visual** (semana, forma, mapa), los **pueblos** como juego de exploración, **huecos reales de tu calendario** (iCal), **esquí de montaña, montaña y pádel**, comida **sin calorías** y **usar tu propio Claude sin pagar dos veces**.

---

## 4. "Con el Claude de cada uno": qué se puede y qué no

### Lo que NO se puede
- **"Entrar con Claude" en myCoach y gastar la cuota Pro o Free del usuario desde nuestra web o nuestro bot.** Anthropic lo prohíbe expresamente en sus condiciones desde febrero de 2026, y desde enero bloquea esos tokens en herramientas de terceros. Si lo intentamos, nos cierran el acceso y dejamos tirados a los usuarios. **Descartado.**

### Lo que SÍ se puede (y es gratis para nosotros)
1. **myCoach como conector de Claude.** Ya existe: el conector de Garmin con `app_leer` y `app_guardar`. Funciona en claude.ai, en escritorio y en el **móvil**, y en **todos los planes**. El Free admite **1 conector personalizado**, así que **tiene que ser uno solo**: Garmin y myCoach juntos, como ahora.
2. **MCP Apps.** El conector puede devolver **pantallas interactivas dentro del chat de Claude** (tarjeta de la semana, semáforo de hoy, botón "aceptar cambios"). Funciona en Free, Pro y Max, en web, escritorio y móvil. Así el usuario de Claude ve lo mismo que en la web, sin salir del chat.
3. **Artifact de Claude.** `npm run build:claude` ya hace una versión que usa `sample`, que gasta la cuota del propio usuario. Sirve para ti y para quien lo use dentro de Claude.
4. **Instrucciones del entrenador en el propio conector.** El conector trae sus propias instrucciones y el método va dentro de las herramientas (ver el apartado 6). Así tu Claude habla y decide como el entrenador de myCoach, no "a su manera".

### Los límites de este modo (hay que decirlos claro)
- **Claude no escribe primero.** Las tareas programadas y las Routines solo están en los planes de pago, y Pro tiene unas 5 ejecuciones al día. En Free no hay nada. **La proactividad la tiene que poner myCoach:** un aviso (push o Telegram) que diga "tu semana está lista" y abra la app o Claude con el encargo ya preparado.
- **Da más trabajo:** hay que añadir un conector personalizado a mano. Sirve para gente técnica y amigos. Para el público general es una barrera.
- **Quien más lo aprovecha es quien ya paga Claude Pro.** Es un buen gancho ("no pagues dos veces") y un diferenciador, pero **no puede ser la única forma de tener IA**.

### Conclusión: tres modos, un solo motor
| Modo | IA | Coste para el usuario | Coste para nosotros | Para quién |
|---|---|---|---|---|
| **Sin IA** | Reglas: plan, semáforo, avisos, balance | 0 € | Casi 0 | Todos. El núcleo tiene que gustar por sí solo. |
| **Con tu Claude** | Tu Claude con el conector y las MCP Apps | 0 € (ya pagas Claude o usas Free) | 0 € | Tú, amigos técnicos, usuarios de Claude |
| **myCoach Coach** | Nuestra IA (API de Anthropic), proactiva, por Telegram, WhatsApp y dentro de la app | 5–7 €/mes | ~1–3 €/mes (ver abajo) | Público general |
| _(opcional)_ Clave propia | Tu clave de la API | Lo que gastes | 0 € | Frikis. Lo hacen otras apps (ICU Coach). |

**Cuánto nos costaría la IA en el modo de pago** (precios de la API a septiembre de 2026: Sonnet 5.5 a 2 $ entrada y 10 $ salida por millón de tokens, con lecturas de caché a 0,20 $; Haiku 4.5 a 1 $ y 5 $):
- Mensaje típico: unos 8.000 tokens de contexto en caché (perfil, semana y método), 500 nuevos y 400 de respuesta ≈ **0,007 $ con Sonnet 5.5**.
- Mensaje proactivo diario (resumen de la mañana y comentario de la actividad): unos 2 al día ≈ 0,4–0,6 $/mes.
- Usuario normal (unos 3 mensajes al día más los proactivos) ≈ **1–1,5 $/mes**. Usuario muy activo (unos 10 al día) ≈ 3 $/mes.
- A **5–7 €/mes** el margen es bueno aunque se sume Stripe (~0,30 € + 1,5 %) y WhatsApp (0,0166 € por mensaje proactivo de utilidad en España; las respuestas dentro de las 24 h son gratis). Hay que ponerle **tope de uso** para que un usuario no se coma el margen.
- Truco de coste: **el motor decide y el LLM solo escribe.** Los mensajes proactivos pueden salir de plantillas con datos y usar el LLM solo cuando aportan algo, o ir por Batch API (-50 %) la noche anterior.

---

## 5. El canal: cómo te habla el entrenador

| Canal | Pros | Contras | Cuándo |
|---|---|---|---|
| **Web Push (PWA)** | Gratis, ya tenemos PWA y service worker | En iOS solo con la PWA instalada; es un aviso, no una conversación | **Fase 1** |
| **Telegram** | Bot gratis, sin aprobación, API muy simple, texto y fotos (comidas) | Menos gente lo usa en España | **Fase 1–2** (tú y tus amigos) |
| **WhatsApp** | Todo el mundo lo usa; es lo que da fuerza a NUA | Cuenta de empresa, verificación en Meta, plantillas aprobadas, 0,0166 € por mensaje proactivo y la regla contra chatbots genéricos (el nuestro es especializado, así que se permite) | **Fase 3** |
| **Chat dentro de la app** | Control total, UI rica (proponer y aceptar cambios) | Hay que abrir la app | Siempre (modo de pago) |
| **Tu Claude** | Gratis, potente | No es proactivo | Siempre (modo Claude) |

**Recomendación:** no copiar el "solo chat" de NUA. **La app es donde se ve y se decide; el chat es donde se avisa y se habla.** Cada mensaje proactivo lleva un enlace a la pantalla exacta: "Tu semana está lista → [Ver y aceptar]".

---

## 6. Cómo habla myCoach (voz y método)

### Arquitectura: "el motor decide y el LLM explica"
Es la lección de NUA, y **vuestro código ya va por ahí** (`proponer_cambios` + `validarPropuesta` + topes):
1. **El motor determinista** (`packages/domain`) calcula la carga, la frescura, el semáforo del día, el plan de la semana y los límites. Siempre da el mismo resultado con los mismos datos.
2. **Las herramientas del coach** (en el conector, las usan tu Claude, el bot y la web): `coach_hoy`, `coach_semana`, `coach_proponer(cambios)` (el motor valida y devuelve la versión corregida y el porqué), `coach_registrar(sensacion|comida|lesion|disponibilidad)` y `coach_perfil`.
3. **El LLM** traduce, negocia y explica. **Nunca inventa una sesión fuera del motor.** Si el usuario insiste en algo contra las reglas, lo dice claro ("puedo, pero te lo desaconsejo por X").

Así da igual que hables con tu Claude o con el nuestro: **el método es el mismo** y se acaba la queja de "cada respuesta sigue una lógica distinta".

### Personalidad
- **Un compañero que sabe**, no un sargento ni un animador. Tutea, en castellano de España y con frases cortas.
- **Siempre el porqué, en una frase.** "Hoy suave: dormiste 5 h y la VFC está baja."
- **Da la respuesta, no un abanico de opciones.** Si hay alternativa, una sola: "Si te ves bien, alarga 20 min."
- **Confirma antes de tocar el plan** y avisa de lo que hizo solo ("He movido la fuerza al jueves porque el martes tienes reunión hasta las 20:00").
- **Honesto con los datos:** dice si una cifra es estimada ("tu W/kg es estimado; con el test de 20 min lo afino").
- **Sin calorías ni culpa con la comida:** cuartos de plato y ajustes según la carga del día.
- **Seguridad:** si hay dolor, lesión o síntomas raros, bajar la carga y recomendar un profesional. Nunca diagnostica.
- **Poco y bien:** máximo 1 o 2 mensajes proactivos al día y un modo silencio. Mejor echarle de menos que hartarse.

### Los mensajes clave (borradores)
- **Domingo por la tarde, la semana:** "Semana lista: 7 h 30. Martes series de bici, jueves fuerza y sábado fondo de 3 h hacia Vic. El miércoles lo dejo libre, que tienes la cena. [Ver y aceptar]"
- **Por la mañana, el semáforo:** "🟢 Hoy toca tempo 60 min. Dormiste bien y la VFC está normal. Sal antes de las 8:30, que luego tienes reuniones."
- **Tras la actividad:** "Fondo hecho: 2 h 50 y 85 % en zona suave, como tocaba. Pueblo nuevo: Collsuspina (el 214). Mañana descanso de verdad."
- **Si algo cambia:** "Readiness 32 y has dormido mal. Cambio las series de hoy por 45 min suaves y las paso al jueves. ¿Te va bien?"
- **Comida:** "Mañana fondo largo: esta noche medio plato de hidratos. Para la salida, 60 g por hora a partir de la primera hora."
- **Revisión del domingo:** "Semana: 6 h 40 de 7 h 30 (89 %). Tu frescura sube; la próxima semana toca descarga."

---

## 7. Plan por fases

### Fase 1: la app perfecta para ti (4–6 semanas)
Objetivo: que la uses cada día sin tener que pensar en ella.
1. **Motor de dominio** en `packages/domain` (ya estaba previsto en `ARCHITECTURE.md`), con tests:
   - carga TRIMP multideporte → forma, fatiga y frescura, y semáforo del día;
   - plan semanal y temporada (objetivo con fecha, bloques y descargas) respetando los huecos del calendario;
   - replanificación: sesión perdida, readiness bajo o actividad no planificada.
2. **Perfil del atleta** (`atleta/perfil`) y **registro de decisiones** (qué cambió y por qué).
3. **Herramientas `coach_*`** en el conector (`apps/conector`) e **instrucciones del entrenador** en el conector.
4. **Cron diario del Worker** (Cron Triggers): sincroniza Garmin, calcula y deja preparado el resumen del día. **Web Push** con el aviso de la mañana y el de "semana lista".
5. **Bot de Telegram solo para ti**, en modo "tu Claude"; o, para probar ya la voz, con una clave de API tuya y un tope de gasto de pocos euros al mes.
6. **Mandar entrenos estructurados a Garmin** (como `garmin_save_course`, con la API no oficial).
7. Medir: % de sesiones hechas, días que abres la app y cuántas veces el entrenador acierta o lo corriges.

### Fase 2: amigos (5–20 personas, 2–3 meses)
Objetivo: que funcione sin ti delante y aprender qué enamora.
1. **Multiusuario sólido:** tokens de Garmin cifrados en KV, borrado de cuenta, exportar tus datos y límites de uso por usuario.
2. **Onboarding en 3 minutos**, hablado o tocando: deportes, objetivo, disponibilidad, calendario y lesiones.
3. **Segunda fuente de datos: Intervals.icu** (socio oficial de Garmin, con API por clave personal u OAuth). Quita el riesgo del login de Garmin y trae COROS, Polar, Wahoo y Suunto.
4. **Telegram para todos** y **MCP App** (pantallas de myCoach dentro de Claude) para quien use Claude.
5. **Evals del entrenador:** 30–50 situaciones reales (lesión, semana imposible, readiness bajo, viaje) para comprobar que el motor y la voz responden bien antes de cada cambio.
6. **Feedback en la app** (ya existe el panel `?proto`): una pregunta semanal, "¿te ha ayudado esta semana?".
7. **Sin cobrar.** Solo medir: ¿vuelven a las 4 semanas? ¿lo recomiendan?

### Fase 3: público (cuando la fase 2 retenga más del 40 % a las 8 semanas)
1. **Datos legales:** Intervals.icu + **Apple Health / Health Connect** (app con Capacitor) + subir archivos FIT. Pedir el **Garmin Connect Developer Program** cuando vuelva a abrir. **No abrir al público** con la API no oficial de Garmin.
2. **Cumplimiento:** RGPD art. 9 (datos de salud), consentimiento explícito, evaluación de impacto (DPIA), política de privacidad, aviso de que no es consejo médico y datos alojados en la UE.
3. **Suscripción** (Stripe o las tiendas): gratis (sin IA) / Claude (gratis) / **Coach 5–7 €/mes** o ~50 €/año, con 14 días de prueba **sin tarjeta** (como NUA).
4. **WhatsApp** como canal de pago (cuenta de empresa + plantillas de "semana lista", "resumen del día" y "actividad analizada").
5. **Apps en las tiendas** con Capacitor: push nativo, cámara para las comidas, HealthKit.
6. **Marca y comunidad:** comprobar que el nombre está libre, clubs (retos de pueblos por grupos) y compartir el mapa de pueblos (es viral).
7. **Idiomas:** catalán e inglés.

---

## 8. Riesgos principales

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Garmin rompe o bloquea la API no oficial | **Alta** (ya pasó en marzo de 2026) | Intervals.icu y Health como alternativas; que el motor no dependa de la fuente. |
| Garmin no reabre el programa de desarrolladores, o lo reabre con restricciones para IA | Media | Intervals.icu (socio oficial) y Health. No construir el negocio sobre Garmin directo. |
| Strava | Ya pasó: su API prohíbe la IA desde junio de 2026 | **No usar Strava** como fuente para la IA. |
| Anthropic cambia las condiciones de los conectores | Baja | El modo "Tu Claude" es un extra. El núcleo funciona sin IA y el de pago usa la API oficial. |
| Meta endurece la política de WhatsApp | Media | Telegram, push y app como canales principales. |
| Mal consejo → lesión | Media | El motor tiene límites fijos, avisos de seguridad y evals. El LLM no decide solo. |
| Coste de la IA descontrolado | Baja | Tope por usuario, caché, plantillas y Batch API. |

---

## 9. Decisiones tomadas (29 de septiembre)
1. **Deportes que planifica el entrenador:** solo los que se miden con pulso, ritmo, potencia o cadencia. Se empieza con **bici (carretera, gravel, MTB, rodillo), correr (asfalto y trail) y skimo**, más **fuerza como complemento**. Después, natación. El esquí de pista, el pádel o la montaña **cuentan como carga** (cansan igual), pero no se planifican.
2. **Sin Telegram ni bot proactivo** por ahora. Se habla dentro de la app o dentro de Claude. Los avisos llegarán más adelante como **push de la PWA**.
3. **Amigos: se mantiene el login no oficial de Garmin.** Intervals.icu queda como plan B si Garmin lo rompe, y como vía para abrirlo al público.
4. **Nombre del entrenador configurable**, por defecto "myCoach": en Ajustes o diciéndoselo a Claude. Se guarda en `atleta/perfil`.
5. **Un solo bloque en Hoy**: el semáforo junto con los datos que lo explican (lo que antes era "Cómo estás hoy").
6. **Siguiente gran pieza: myCoach dentro de Claude** con MCP Apps (pantallas interactivas servidas por el conector).
7. **Cuenta propia de myCoach; Garmin es una fuente que se vincula.** Entras en myCoach (y conectas tu Claude) con email y contraseña de myCoach. Garmin e Intervals.icu se vinculan en Ajustes › Conexiones. Motivo: Garmin empezó a pedir captcha al login desde nuestro servidor y eso dejaba sin poder reconectar Claude. Así solo falla la fuente, no la app ni Claude, y el día que haya API oficial de Garmin solo cambia cómo se vincula. Más adelante: passkeys y "Entrar con Google".

### Decisiones del 4 de octubre: todo lo de Garmin, en el motor
8. **El entrenador usa todo lo que Garmin calcula y ayuda a decidir.** En el semáforo entran tres señales nuevas, leves (suman 1):
   - la carga de 7 días de Garmin por encima de su franja óptima (o el ratio aguda/crónica "muy alto");
   - el estado de entreno "sobrecargado" o "en sobreesfuerzo";
   - el estrés medio de ayer por encima de 50.
   Son otro modelo distinto de la frescura (TSB), por eso suman aparte. `coach_semana` avisa de qué tipo de trabajo falta según el Load Focus y de si la carga se sale de la franja.
9. **Sin datos de descanso, no se enseñan huecos.** Si en dos semanas no llega sueño, VFC ni pulso (solo un Edge):
   - el semáforo decide con la carga y con lo que el usuario cuente;
   - la app y Claude le preguntan cómo se encuentra.
10. **Claude no está ciego:** lo que myCoach no tenga se pide a Garmin con `garmin_api` (solo lectura, con catálogo). Ver `docs/GARMIN-API.md`.
11. **Las skills se quedan como la capa de criterio** (4 de octubre). Cómo analizar, cómo diseñar una sesión, la nutrición, el tono y el onboarding son criterio y no se pueden convertir en reglas del conector. El conector se queda con lo que es regla o dato: validar, preguntar lo que falta en el perfil y guardar preferencias. Retirar una skill necesita una decisión aparte, con pruebas de conversaciones reales.

12. **Conocer a la persona antes de recomendar** (4 de octubre).
   - El perfil guarda el tono (`entrenador.tono`: estilo, humor de 0 a 3 y emojis), la experiencia por deporte y lo que no le gusta (`no_le_gusta`: ejercicio, motivo y alternativa).
   - `coach_perfil` devuelve lo que falta por saber, por orden (`por_conocer`): tono, objetivo, tiempo, molestias, experiencia y material. `coach_hoy` devuelve solo la siguiente pregunta, para hacerla una por conversación.
   - `entrenos` no deja proponer fuerza nueva sin saber el nivel, el material, las molestias y el tiempo (`antes_de_proponer`).
   - Si algo no le gusta, no se quita sin más: se pregunta por qué, se explica para qué sirve y se ofrecen dos alternativas. Si es porque duele, es un dolor.
   - La skill `primeros-pasos` lleva el criterio de cómo hacerlo; el conector, qué falta y dónde se guarda.
13. **Las instrucciones del conector, por debajo de 4.096 caracteres** (Claude corta a partir de ahí). Lo importante va primero (voz, tirar de la persona, preguntar antes de recomendar, método) y lo de cada herramienta, en su descripción. Un test vigila que no vuelvan a crecer y que no se pierda ninguna regla.

### Decisiones del 5 de octubre: myLuv ve los entrenos planificados, sin detalle

- myLuv (la app de pareja) se vincula con OAuth pidiendo `scope=plan:leer`. Ese token solo abre `GET /compartido/plan`: día, deporte, tipo y minutos. Ni descripción de la sesión, ni salud, ni sueño, ni peso, ni comida.
- Un token con ese permiso no abre `/mcp`, `/cuenta` ni la app. Sin permiso (o con otro), el OAuth es el de siempre: Claude entra igual que antes.
- No es una herramienta MCP: el conector no gana ninguna herramienta y nadie ve nada de myLuv.

### Decisiones del 5 de octubre: plan de comidas
14. **Plan semanal de comidas, como el de entrenos.** Cambia la decisión del 4 de octubre ("sin plan semanal por ahora"), a petición del usuario. Se hace todo lo de la fase "Comidas I" de `docs/PROPUESTA-AGENDA-COMIDA-HOGAR.md` **menos la base de datos de alimentos** (CIQUAL/BEDCA): los nutrientes de un plato los estima Claude o los da el usuario, y lo que no se sabe queda como **desconocido**, nunca inventado.
    - El motor (conector) pone la carga de cada día a partir del plan de entrenos y el **código de hidrato** de cada comida: alto el día duro (2 h o más, o series), medio el moderado (1 h o más), bajo el suave; la cena de la víspera de un día duro, alta; la merienda, un punto por debajo. En cuartos de plato, sin calorías.
    - Herramientas: `comida_plan` (la semana, con `lista_compra`), `comida_proponer` (sin guardar por defecto; guarda con su sí), `comida_platos`, `comida_plato_guardar`. `comida_registrar` acepta `plato_id`, `del_plan` y `guardar_como_plato`. El perfil gana `nutricion` (alergias, no_gustos, gustos, tiempo_min, para_cuantos, quien_cocina, tupper).
    - Reglas: una alergia o algo que no le gusta **no se guarda**; si un plato no dice lo que lleva y hay alergias, se avisa para confirmarlo. Avisos: hidrato fuera del código, mismo plato en menos de tres días (las sobras de tupper al día siguiente, no), menos de 2 legumbres o 2 pescados con la semana casi planeada, y comidas que caen fuera de casa según la agenda.
    - Web: en Comer, "Menús de esta semana" (y la que viene) con la hoja de cada día y la lista de la compra; en Hoy, "Tu día" enseña lo previsto y el hidrato del motor. Los menús los propone tu Claude.

### Decisiones del 6 de octubre: el conector, también en ChatGPT
15. **El conector funciona en cualquier cliente MCP, no solo en Claude.** `server/discover` (MCP 2026-07-28) no se implementa y contesta -32601, como antes del 29 de septiembre: así Claude y ChatGPT van por `initialize`. Motivo: contestarlo anunciando solo versiones viejas hacía que ChatGPT se parara tras el login sin ver las herramientas; anunciar 2026-07-28 hacía que Claude rechazara las respuestas. Se vuelve a implementar cuando el servidor cumpla 2026-07-28 entero y se pruebe en los dos.

### Decisiones del 8 de octubre: Insights
16. **La pestaña Progreso pasa a llamarse Insights**, a petición del usuario (el nombre en inglés lo eligió él; la clave interna sigue siendo `progreso`, así `mycoach_abrir` no cambia). Responde a "¿dónde estoy y cómo voy?":
    - **Un solo selector de periodo** (4 semanas, 3 meses, 6 meses, 1 año) para toda la pestaña. No hay tarjetas de "antes → ahora": se enseñan los números del periodo y las gráficas.
    - **General:** arriba, "Dónde estás", las notas de 1 a 10 que ya existían (VO2máx, Endurance, subida en bici, volumen, equilibrio) en una barra con las marcas de aficionado medio (5) y fuerte (7), para compararse con otra gente; después, la evolución de Endurance Score, VO2máx y Hill Score (semanal, de `garmin_forma`), las horas por semana de todos los deportes, el peso, la frescura y la carga.
    - **El peso se mueve de Comer a Insights** (un dato, un sitio); Comer deja un enlace.
    - **Por deporte:** "Tus números" por terreno (llano, subida y bajada: velocidad o ritmo, pulso, metros por latido, VAM, W/kg estimados en bici); arriba, las gráficas fáciles (velocidad en llano, VAM, horas por semana); en "Para profundizar", plegado, lo de los frikis: eficiencia (metros por latido, la idea del EF de Intervals.icu sin potenciómetro), velocidad frente a pulso, desacople (Friel), mejor pulso sostenido 5/20/60 min, bajadas, disciplina en los fondos, zonas y la misma ruta.
    - **La bajada se enseña pero no se puntúa:** depende de la pendiente, el tráfico y la técnica, no de la forma.
    - **Sin "Forma bici" combinado todavía.** No se ha encontrado literatura que valide la velocidad a pulso fijo sin potenciómetro; antes de puntuarla hay que probarla con el histórico (o con GoldenCheetah OpenData). Intervals.icu no está conectado, así que todo sale de Garmin.
17. **El conector calcula el terreno de toda la salida** (`garmin_activity_detail` → `analisis.por_terreno`): tramos de 500 m, llano por debajo del 1,5 %, subida desde el 3 % y bajada desde el −3 %, medias por tiempo; y `analisis.bajadas`, con las mismas reglas que las subidas. Antes solo se medía el puerto más largo, y en salidas rompepiernas no salía ninguna subida. La web guarda el detalle del último año de bici, carrera y skimo (antes, 60 días) y vuelve a pedir el que se guardó con la versión anterior, de 15 en 15 por sincronización.

18. **Velocidad según la pendiente.** El conector suma cada salida por pendiente en tramos de 2 puntos (`por_terreno.por_pendiente`, de −10 % a +12 %) y Insights dibuja la curva del periodo frente a la del periodo anterior, con una frase: "en llano, un X % más rápido; en subida, un Y %", a igual pendiente. Es la comparación más limpia sin potenciómetro, porque no depende de haber hecho rutas más llanas o más duras.
19. **Lo que dicen los estudios y los datos (8 de octubre).**
    - Literatura: el índice pulso-velocidad en carrera (Vesterinen y otros, 2014) sigue la mejora de forma con correlaciones moderadas (r = 0,43-0,61), medido en llano y en carrera continua. El modelo físico de potencia en bici (Martin y otros, 1998) acierta mucho (R² = 0,97) con viento, aerodinámica y rozamiento medidos; sin ellos, el error lo ponen esos supuestos, sobre todo en llano. El factor de eficiencia (EF) es una convención de entrenadores sin validación publicada.
    - Con las 16 salidas de bici del usuario (junio a octubre): a igual pulso, la velocidad en llano sube 1,2 km/h al mes en los fondos (±1,1, al límite de lo significativo); de una salida a otra el ruido es de 1,2-2 km/h; en la misma ruta repetida, los metros por latido salen casi iguales (3,32 y 3,31) aunque cambie la intensidad; el desacople fuera de salidas constantes da cifras sin sentido (de −15 % a +18 %).
    - Decisión: la eficiencia y el desacople solo se enseñan con fondos; los vatios por kilo, solo en subida; y no hay nota "Forma bici" hasta tener más histórico o validarla con datos de potencia (GoldenCheetah OpenData, bloqueado ahora por la red del entorno: hay que permitir `api.osf.io` y `files.osf.io`).
    - Intervals.icu (conectado el 8 de octubre) no trae viento ni potencia para este usuario: sin potenciómetro aporta lo mismo que Garmin (curva de pulso, carga, metros por latido). El viento sí sale de Garmin (`/activity-service/activity/{id}/weather`), pero de una estación al empezar, sin dirección respecto a la ruta (y en la Cerdanya, la de Perpiñán).
    - Con viento y temperatura en el modelo, el ruido baja (de 2,0 a 1,7 km/h), pero la temperatura va de la mano del calendario (verano caluroso, otoño fresco: r = −0,68) y la "mejora" a igual pulso deja de distinguirse (−0,05 ± 1,5 km/h al mes). Con estos datos no se puede separar "he mejorado" de "hace menos calor". Por eso la temperatura de cada salida sale en los detalles de las gráficas de llano y eficiencia.
20. **Este cambio va directo a `main`** cuando el usuario lo dé por bueno, sin pasar por `mycoach-pruebas` (lo pidió él).
21. **Insights, segunda vuelta (9 de octubre).**
    - **Quién calcula qué:** el conector calcula cada actividad (terreno, pendiente, ritmo ajustado, VAM sostenida) cuando la app la pide al sincronizar; la web solo suma por periodo y dibuja. Claude no interviene ni gasta tokens en eso.
    - **Métricas por deporte** (research): carrera, ritmo ajustado a pendiente con el coste de Minetti y otros (2002), fiable entre −10 % y +10 %, y metros por latido sobre ese ritmo (la idea del índice pulso-velocidad de Vesterinen y otros, 2014). Skimo, lo que explica el rendimiento en los estudios es el VO2máx y el umbral (r = 0,7-0,9): sin laboratorio se mide con la VAM de subida, la mejor VAM sostenida de 10, 20 y 60 min, el desnivel por 100 latidos y el desnivel por semana. La bajada en skimo no se mide.
    - **General sin cosas de un deporte:** "Dónde estás" y la nota general ya no usan la subida en bici (la nota general pasa a ser motor, fondo, volumen y equilibrio para todo el mundo).
    - **Gráficas por actividad:** puntos, recta de tendencia y la media del periodo, que es la misma cifra que la tabla. Se quita la "media de las 3 últimas", que no cuadraba con la tabla.
    - **Ejes con unidad** en todas las gráficas; el ritmo de carrera se dibuja en min/km con marcas redondas.
    - **Filtros:** deporte con botones (cambia la pantalla) y periodo con un desplegable discreto al lado; antes eran dos filas de botones iguales.
    - **Peso a mano** en Insights → Peso → "Apuntar peso": se enseña lo que se guardará y se sube a Garmin con `peso_registrar` (la web ya puede llamarla). Para borrar un error, en Garmin Connect.

## 10. Próximos pasos concretos (2 semanas)
1. Sacar `packages/domain` con carga TRIMP, semáforo y tests.
2. Documento `atleta/perfil` más registro de decisiones.
3. Cron del Worker más Web Push ("semana lista" y el semáforo de la mañana).
4. Herramientas `coach_hoy`, `coach_semana` y `coach_proponer` en el conector, con instrucciones del entrenador en el conector.
5. Escribir las 20 primeras situaciones de evaluación con la voz de arriba.

---

### Fuentes
- NUA: [producto](https://nua.coach/es/product), [precios](https://nua.coach/en/pricing), [inicio](https://nua.coach/en), [Strava MCP + Claude vs entrenador](https://nua.coach/en/learn/strava-mcp-claude), [los fundadores en Merkabici](https://merkabici.es/entrenador-de-ciclismo-con-ia-nua-coach/), [comparativa de un competidor](https://cyclingcoachai.com/nua-coach-alternative/)
- Claude: [conectores personalizados (Free: 1)](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [MCP Apps en Claude](https://claude.com/blog/interactive-tools-in-claude), [prohibición del OAuth de consumo en terceros](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/), [tareas programadas en Cowork](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork)
- Datos: [Garmin congela el programa de desarrolladores](https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/), [Terra sobre la pausa de Garmin](https://tryterra.co/blog/garmin-connect-developer-program-pause), [login de garminconnect roto (marzo de 2026)](https://github.com/cyberjunky/python-garminconnect/issues/332), [política de la API de Strava 2026](https://www.strava.com/legal/api_policy), [Intervals.icu ↔ Garmin](https://stas.run/en/guides/intervals-icu-garmin-sync)
- Canales: [precios de WhatsApp en España](https://whautomate.com/whatsapp-business-api-pricing-spain), [política de IA de WhatsApp 2026](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban)
- Competidores: [comparativa de apps de IA para triatlón](https://www.triathlete.com/gear/tech-wearables/ai-triathlon-training-apps/), [apps de IA para correr](https://therunninggenie.com/blog/best-ai-running-coach-apps)
