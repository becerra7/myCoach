# NUA Coach: análisis completo y qué nos llevamos a myCoach

Fecha: 28-09-2026. Fuentes: resultados de búsqueda sobre la web de NUA (producto, precios, términos, privacidad, guías, páginas de carreras), prensa (Via Empresa, El Nacional / ON Economia, Merkabici, La Bolsa del Corredor), comparativas de terceros (IntervalCoach, AdaptCycling, Cycling Coach AI) y el hilo de NUA en el foro de Intervals.icu. Desde este entorno no se pudo abrir nua.coach directamente (la red lo bloquea) ni crear cuenta (el alta es un número de WhatsApp), así que lo marcado **(sin confirmar)** hay que comprobarlo con la prueba gratuita (checklist al final).

---

## 1. Qué es en una frase

Un entrenador personal de ciclismo (y ya también running y triatlón) que **vive en WhatsApp/Telegram**: no hay app ni panel, le escribes como a un entrenador humano, lee tus datos de Garmin/Wahoo/Strava/COROS/Polar/Intervals.icu, te manda los entrenos al dispositivo y **te escribe él primero** cada día.

## 2. Negocio

| | |
|---|---|
| Empresa | Startup de Barcelona, fundada en 2025 con apoyo de Barcelona Activa. En su web dicen que empezaron "hace casi dos años". Tienen un club de Strava en Girona. |
| Fundadores | Gerard Morera (físico, corredor de montaña, Empordà), Marc Clotet y Tomàs Viglione (ciclista). "Tres deportistas de resistencia". |
| Tamaño | Según Via Empresa: **~10.000 €/mes facturados**, objetivo 100.000 €/mes en 2026. Con un ticket medio de ~13-20 € salen **~500-800 suscriptores de pago**. En su web: "más de 200 ciclistas prepararon la QH 25 (Quebrantahuesos) con NUA" y "miles de ciclistas". |
| Precio | **12,50-12,90 €/mes pagando el año** (~150-155 €/año) o **19,95 €/mes** mes a mes. Un solo plan con todo (no hay niveles). Se venden como "10 veces más barato que un entrenador humano". |
| Prueba | **14 días con todo, sin tarjeta**: empiezas escribiendo por WhatsApp o Telegram. |
| Cobro | Stripe (Stripe Payments Europe). |
| Crecimiento | **Referidos**: 1 mes gratis por cada amigo que pague y siga 30 días, sin límite. **SEO**: páginas por carrera ("Plan Quebrantahuesos", La Marmotte, We Ride Flanders, Mallorca 312...), guías (`/learn`: FTP, zonas, CTL/ATL/TSB) y artículos que se comparan con la competencia (p. ej. "Strava MCP + Claude: ¿puede entrenarte?"). TikTok, Instagram, YouTube. Testimonios con historia ("1 h 10 min más rápido en la Quebrantahuesos", "madre de dos hijos, triatlón"). |
| Marca de atleta | **"Hermida Coach"**: el mismo producto con la cara de José Antonio Hermida (campeón del mundo de MTB 2010, plata olímpica 2004, entrenó a Pidcock). Es un modelo de *coach* con marca: el famoso pone la cara y la filosofía, NUA pone la máquina. Pueden repetirlo con otros atletas o clubs. |
| Hoja de ruta | App conversacional propia "pronto", Messenger, y **gafas inteligentes** de ciclismo. Running y triatlón ya aparecen como cubiertos. |

**Lectura de negocio**: el producto es "un entrenador humano barato", no "una app de planes". La barrera de entrada es baja (WhatsApp, sin app, sin tarjeta) y la retención viene de la relación diaria (te escribe él) y de la memoria (cuanto más lo usas, más te conoce). El riesgo para ellos: margen (cada mensaje cuesta tokens de OpenAI/Anthropic y conversaciones de WhatsApp Business) y que Strava/Garmin metan IA propia (Strava ya tiene conector MCP para Claude desde junio de 2026; por eso escriben artículos explicando por qué eso "no es entrenar").

## 3. Técnico (lo que se sabe y lo que se deduce)

- **Canales**: WhatsApp (API de WhatsApp Business), Telegram, Messenger. Aceptan texto, **notas de voz, fotos y documentos**.
- **IA**: sus términos listan **OpenAI y Anthropic** como proveedores de modelos (respuestas del coach, razonamiento del plan y comprensión del chat). Es decir, usan varios modelos, probablemente según la tarea.
- **Arquitectura** (palabras de Marc Clotet): "agentes proactivos y especializados que toman cualquier decisión deportiva con los datos adecuados, **distintos tipos de memoria** y **algoritmos y modelos propios de carga, rendimiento, nutrición y recuperación**". Traducido: un LLM orquestador + agentes por dominio (plan, nutrición, recuperación, análisis) + una capa determinista que calcula carga/forma (tipo TSS/CTL/ATL/TSB) para que el LLM no se invente números + memoria a largo plazo (perfil del atleta: historial, fatiga, lesiones, calendario de carreras, contexto de vida).
- **Integraciones**: Garmin, Wahoo, Strava, COROS, Polar, Intervals.icu. "Los entrenos llegan solos y las actividades vuelven solas". Para que un entreno estructurado aparezca en un Edge, lo normal es la **Training API de Garmin** (programa oficial de desarrolladores) o pasar por Intervals.icu, que ya lo sube al calendario de Garmin Connect. **(sin confirmar cuál usan)**.
- **Sin potenciómetro**: todo funciona con vatios, pulso o RPE. Hasta hacer un test, la primera semana va por pulso.
- **Tests**: FTP de ~20 min (miran el mejor esfuerzo entre 12 y 20 min con factores de corrección por duración) y test de rampa; los programa el plan o se los pides; si ya tienes datos, se lo saltan.
- **Privacidad**: RGPD, subencargados en EE. UU. con Data Privacy Framework o cláusulas tipo. Soporte: support@nua.coach. Edad mínima 16 (referidos).

## 4. Funcionalidad (todo lo que hace)

**Plan y adaptación**
- Plan personalizado según objetivo, carrera, disponibilidad, tipo de bici y progreso.
- **Adaptación diaria y en tiempo real**: "hoy solo tengo 60 min" → te reescribe la sesión de hoy; "tengo una cena de trabajo el jueves" → mueve entrenos a otros días **manteniendo el objetivo de la semana**; ajusta carga, bloques y **taper** antes de la carrera.
- Entrenos estructurados enviados al dispositivo (Garmin/Wahoo) y al rodillo **(sin confirmar Zwift)**.
- Tests de FTP/rampa integrados en el plan.
- Planes por carrera (Quebrantahuesos, Marmotte, Flanders, Mallorca 312...) con 12-16 semanas: base Z2, intervalos específicos (subidas, esfuerzos sostenidos, cambios de ritmo) y recuperación.

**Proactividad (lo que más les diferencia)**
- Te escribe **cada mañana** para ver cómo has dormido y recuperado.
- Te escribe **al acabar cada sesión** con el análisis ("feedback en segundos").
- **Antes de una carrera** (estrategia, comida).
- **El domingo**: repaso de la semana y planificación de la siguiente juntos.
- Cuando detecta **fatiga acumulada o una semana que no cuadra**, propone ajustes.

**Análisis**: cada actividad analizada (pulso, potencia, métricas) y comparada con lo planificado.

**Recuperación**: sueño, fatiga, readiness; decide si hoy toca apretar o no.

**Nutrición**: pautas diarias y de avituallamiento para entrenos largos y carreras (qué y cuánto comer por hora) **(detalle sin confirmar)**.

**Estrategia de carrera y motivación**: plan de carrera, ritmo en subidas, psicología.

**Memoria**: guarda para siempre tu historial, lesiones, calendario, contexto de vida. "No da consejos genéricos: toma decisiones y cambia tu plan".

## 5. Diseño y experiencia

- **No hay interfaz**: la interfaz es la conversación. Cero curva de aprendizaje, cero descargas, "no usas una app, hablas con tu coach".
- Tono de entrenador cercano; el valor percibido está en que "alguien" está pendiente de ti.
- **Puntos débiles** que señalan los comparadores: falta una vista de la semana/temporada completa ("¿qué me toca el jueves?" obliga a preguntar), menos visión estratégica del plan, y a quien le gustan los gráficos se le queda corto. AdaptCycling se vende justo por lo contrario: "ves toda la semana y la reconstruye si fallas".
- Web de marketing cuidada y muy orientada a SEO (guías, carreras, comparativas), multiidioma (es/en).

## 6. NUA frente a myCoach hoy

| Área | NUA | myCoach hoy |
|---|---|---|
| Canal | WhatsApp/Telegram | Web/PWA + tu propio Claude con el conector |
| Coste de IA | Lo paga NUA (se repercute en 13-20 €/mes) | 0 €: reglas en la app, IA con tu cuenta de Claude |
| Deportes | Bici (+ running, triatlón) | Bici, correr, skimo, montaña, pádel/tenis, fuerza |
| Datos | Garmin, Wahoo, Strava, COROS, Polar, Intervals | Garmin (conector propio) |
| Plan semanal | Sí, por IA, adaptativo | Sí, por reglas (`generarSemana`), + Claude |
| "Hoy solo tengo 60 min" | Sí, conversacional | A medias: hoja "¿Qué vas a hacer hoy?" (deporte, 30-180 min, intensidad) reajusta la semana; con texto, botón "Que Claude reajuste" |
| Mover sesiones | Sí | Sí (`doMove`, con límite de días intensos y readiness) |
| Calendario real | No lo anuncian | **Sí**: iCal, encaja cada sesión en tus huecos |
| Entreno estructurado (calentamiento, series con objetivos) | Sí | No: la sesión es un texto ("Umbral 3 × 10 min a 160-166 ppm") |
| Enviar al Edge | Sí | No ("Enviar al reloj · Por validar con Garmin") |
| Carga/forma (TSS, CTL, ATL, TSB) | Sí (algoritmos propios) | No; usa readiness, VO2máx, Endurance, zonas de pulso |
| FTP y zonas de potencia | Sí (test 20 min y rampa) | Test de subida de 20 min por física → W/kg; sin zonas de potencia |
| Proactividad | Mañana, post-sesión, domingo, alertas | Ninguna (solo al abrir la app) |
| Análisis post-actividad | Sí, en segundos | Parcial: detecta "Planeado X, hecho Y" |
| Carreras y periodización | Sí (base/construcción/taper) | Modo "Preparar un reto" sin fecha ni bloques |
| Nutrición | Pautas y avituallamiento | Registro de comidas (foto) y "cuartos de plato" |
| Memoria / perfil | Largo plazo (lesiones, contexto) | Estado en `app_*` (plan, comidas, objetivo) |
| Extras propios | — | Pueblos y mapa, balance de salud (fuerza OMS, juego), sin calorías |

## 7. Qué podemos replicar (priorizado)

Leyenda de esfuerzo: S = días, M = 1-2 semanas, L = más.

### Imprescindible (lo que más se nota con el Edge 850)

1. **Entrenos estructurados y envío al Edge 850** — M. Es lo que convierte "un plan en texto" en "el Edge te dice qué hacer".
   - Modelo: cada sesión pasa de `{dep, t, d, min}` a tener `pasos`: calentamiento, bloques repetidos, vuelta a la calma, cada uno con duración y objetivo (zona de pulso, % de FTP o vatios, o RPE).
   - En el conector `garmin-mcp`: dos herramientas nuevas, `garmin_crear_entreno` (crea el workout en Garmin Connect) y `garmin_programar_entreno` (lo pone en una fecha del calendario). El Edge lo sincroniza solo y aparece en *Entrenamiento → Calendario / Entrenos*. Usa la API privada de Garmin Connect (servicio de workouts), igual que el resto del conector; para abrirlo al público habría que pasar a la Training API oficial.
   - En la app: el botón "Enviar al reloj" que ya existe pasa a funcionar, y al generar la semana se pueden mandar todas de golpe.
   - Con Claude: "hoy solo tengo 60 min" → Claude reescribe la sesión, la guarda con `app_guardar` y la manda al Edge con la herramienta nueva. Esto ya es exactamente lo que hace NUA, pero en tu Claude y gratis.

2. **"Tengo X minutos hoy" sin IA** — S. Una acción rápida en Hoy: "Hoy solo tengo 45/60/90 min". Reglas: si era intenso, se mantiene el bloque principal y se recorta calentamiento y volumen (3 × 10 → 2 × 10 o 3 × 8); si era fondo, pasa a 60 min Z2 con 2-3 cambios de ritmo cortos y lo que falta del fondo se mueve al primer hueco libre de la agenda (ya existe `encajar`). Reutiliza `sheetOtro`/`saveOtro`.

3. **Carga y forma (TSS/CTL/ATL/TSB)** — S/M. Calcular en `00-geo-dominio.js` con lo que ya hay: hrTSS por minutos en zonas de pulso (ya los tenemos) y TSS real si hay potencia. CTL (42 días), ATL (7 días), TSB = forma. Una gráfica en Forma y reglas: TSB muy negativo → semana de descarga automática; subida de CTL > 5-7/semana → aviso. Es la "capa determinista" que NUA usa para que la IA no se invente.

4. **FTP y zonas de potencia** — S. Ya hay test de 20 min (por física). Añadir: guardar FTP en vatios, zonas (Coggan) y, si el Edge 850 tiene potenciómetro, leer el mejor esfuerzo 12-20 min de las actividades para detectar FTP sin test (como NUA). Sin potenciómetro, seguir por pulso.

### Muy recomendable

5. **Proactividad sin pagar IA** — M. Lo que más valor da de NUA, replicado con reglas:
   - **Cron diario en el Worker** (ya propuesto en ARCHITECTURE.md para la sincronización): a las 7:00 lee readiness, sueño y VFC y la sesión de hoy, y decide con reglas "hoy sí / hoy baja a suave / hoy descansa".
   - **Notificaciones push de la PWA** (Web Push funciona en Android y en iOS con la app añadida a inicio): "Buenos días: readiness 72, hoy tu umbral 3 × 10 va bien. Ya está en el Edge". Tras cada actividad: "Hecho: 1 h 58 en Z2, 4 min por encima de 150 ppm". Domingo: "Tu semana: 8 h 30, 92 % cumplido. ¿Preparo la próxima?".
   - Alternativa gratuita: un **bot de Telegram** (la API de bots es gratis) que manda esos mismos mensajes. WhatsApp no compensa: cobra por conversación y tiene reglas estrictas con chatbots de IA.
   - Con IA opcional: las **rutinas programadas de Claude** en tu propia cuenta pueden leer el conector cada mañana y escribir la recomendación en `app_guardar`, sin coste por uso.

6. **Objetivo con fecha y periodización** — M. "Preparar un reto" pasa a tener carrera y fecha → bloques base / construcción / específico / taper (12-16 semanas), semana de descarga cada 3-4, y `generarSemana` recibe la fase. Plantillas de carreras catalanas (Cerdanya, Pirineus, Quebrantahuesos) si algún día es público.

7. **Análisis post-actividad** — S. Al sincronizar una actividad del día: planificado vs hecho (tiempo, zonas, TSS), una frase de reglas ("bien suave: 94 % en Z1-Z2" / "el fondo se fue a tempo") y efecto en la semana.

8. **Avituallamiento por sesión** — S. Reglas: <75 min agua; 75-150 min 30-60 g de carbohidrato/h; >150 min 60-90 g/h + sal; mostrarlo en la sesión y en el aviso de la mañana. Encaja con la pantalla de comida que ya hay.

9. **Perfil y memoria a largo plazo** — S. Un documento `estado/perfil` (lesiones, molestias, preferencias, horarios, material: rodillo, potenciómetro, Edge 850) que la app y Claude leen y escriben. Es la "memoria" de NUA pero visible y editable.

### Opcional / no replicar

- **WhatsApp, Messenger, gafas**: no, por coste y porque nuestra baza es la vista de la semana que a NUA le falta.
- **Coach con marca de atleta, referidos, páginas SEO de carreras**: solo tiene sentido si myCoach se abre al público (ver riesgos en ARCHITECTURE.md: API de Garmin y datos de salud).
- **Más fuentes (Wahoo, Strava, COROS, Polar, Intervals.icu)**: Intervals.icu sería la más barata de añadir (API abierta con clave) y da de paso subida de entrenos a varios dispositivos; el resto, cuando haga falta.

## 8. Dónde myCoach ya es mejor (y conviene mantener)

- **Ves la semana entera** y la tocas con el dedo (mover, cambiar, marcar hecha); NUA te obliga a preguntar.
- **Calendario real**: encaja cada sesión en tus huecos; NUA no lo anuncia.
- **Multideporte de verdad** (skimo, montaña, pádel, fuerza con el criterio OMS).
- **Coste cero de IA** y datos en tu conector.
- **Pueblos y mapa**, sin calorías: lo lúdico que NUA no tiene.

La jugada es: **la vista de la semana de myCoach + las tres cosas que hacen a NUA sentirse un entrenador** (entrenos en el Edge, adaptación en un toque o en tu Claude, y avisos proactivos).

## 9. Qué comprobar con la prueba gratuita de 14 días

Si creas la cuenta (WhatsApp o Telegram, sin tarjeta), esto es lo que no se puede saber desde fuera:

1. **Alta**: qué pregunta en el onboarding (objetivo, horas, FTP, peso, material, lesiones) y cuánto tarda.
2. **Conexión con Garmin**: ¿OAuth oficial de Garmin (Training API) o pasa por Intervals.icu? ¿Qué permisos pide?
3. **Entreno en el Edge 850**: ¿aparece en el calendario del Edge? ¿Con objetivos de potencia, pulso o ambos? ¿Nombre y notas de cada paso?
4. **"Hoy solo tengo 60 min"**: ¿qué cambia exactamente del entreno, qué pasa con el resto de la semana, y se actualiza solo en el Edge?
5. **Proactividad real**: a qué hora escribe por la mañana, cuánto tarda el mensaje tras subir una actividad, qué dice el domingo.
6. **Vista de la semana**: ¿hay algún resumen o calendario (imagen, enlace web) o solo texto?
7. **Nutrición**: ¿da gramos de carbohidrato por hora? ¿Lee fotos de comida?
8. **Memoria**: dile una molestia el día 2 y comprueba si la recuerda el día 10.
9. **Calidad**: ¿se inventa datos? ¿Cuadran sus números (TSS, zonas) con Garmin?
10. **Cancelación**: que no se cobre nada al acabar la prueba.

Captura pantallas de los mensajes (sobre todo 3, 4 y 5): con eso se afinan los puntos 1, 2 y 5 del apartado 7.

## Fuentes

- NUA: [inicio](https://nua.coach/en), [producto](https://nua.coach/product), [precios](https://nua.coach/en/pricing), [sobre NUA](https://nua.coach/about), [coach IA](https://nua.coach/ai-cycling-coach), [Hermida Coach](https://nua.coach/en/hermida), [test FTP](https://nua.coach/en/learn/ftp-test), [guías](https://nua.coach/learn), [Strava MCP + Claude](https://nua.coach/en/learn/strava-mcp-claude), [Quebrantahuesos](https://nua.coach/es/races/quebrantahuesos), [La Marmotte](https://nua.coach/en/races/la-marmotte), [We Ride Flanders](https://nua.coach/en/races/we-ride-flanders), [términos](https://nua.coach/en/legal/terms), [privacidad](https://nua.coach/en/legal/privacy)
- Prensa: [Via Empresa](https://www.viaempresa.cat/es/empresa/nua-ia-catalana-entrena-ciclistes-como-profesional_2226675_102.html), [ON Economia (Marc Clotet)](https://www.elnacional.cat/oneconomia/es/on-ia/marc-clotet-nua-coach-si-no-tienes-idea-clara-ia-no-te-lleva-buen-punto_1496227_102.html), [Merkabici](https://merkabici.es/entrenador-de-ciclismo-con-ia-nua-coach/), [La Bolsa del Corredor](https://www.labolsadelcorredor.com/nua-coach-tu-entrenador-virtual-que-funciona-con-inteligencia-artificial/), [LinkedIn de Marc Clotet](https://www.linkedin.com/in/marcclotet/)
- Comparativas y comunidad: [Intervals.icu foro](https://forum.intervals.icu/t/nua-coach-ai-cycling-coach/117693), [IntervalCoach](https://www.intervalcoach.app/en/best-ai-cycling-coach), [AdaptCycling vs](https://www.adaptcycling.com/vs), [Cycling Coach AI](https://cyclingcoachai.com/nua-coach-alternative/), [club de Strava](https://www.strava.com/clubs/1269339)
