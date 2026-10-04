> **Ahora vive en el repo myCoach** (`apps/conector`) y se despliega dentro del Worker `mycoach` junto a la web: el conector está en `https://mycoach.albertbecervas.workers.dev/mcp`. Lo que este README dice de `wrangler.toml`, `garmin`, `garmin-2` y `garmin-pruebas` es historia.

# garmin-mcp

Servidor MCP que expone los datos de Garmin Connect a Claude, sobre un único
Cloudflare Worker. Multiusuario: cada persona añade la misma URL y se
autentica con sus propias credenciales de Garmin.

```
https://garmin.<tu-subdominio>.workers.dev/mcp
```

## Convenciones de las herramientas

Es el camino para crecer sin romper. Lo comprueban los tests (`12 ter`).

- **Nombre = familia + qué hace**, en castellano: `garmin_*` lee Garmin tal cual; `coach_*` es el método; el resto va por lo que hace en myCoach (`entrenos`, `entreno_enviar_garmin`, `comida_*`, `peso_*`, `fuerza_*`, `intervals_*`, `app_*`, `mycoach_*`).
- **Una herramienta por pregunta, no por endpoint.** Antes de añadir una, mira si cabe como parámetro de otra:
  - `garmin_dia` junta todo lo de un día (con `partes` y `dias`);
  - `garmin_forma` junta la forma y su evolución;
  - `entrenos` y `entreno_enviar_garmin` llevan `tipo`;
  - `garmin_courses` con `course_id` da el detalle de un recorrido.
- **Lo que solo usa la app lleva `soloApp: true`.** Se anuncia con `_meta.ui.visibility: ["app"]` (MCP Apps): Claude no la ve, la app dentro de Claude sí la llama, y la web la usa por `/api/mcp`, que tiene su propia lista en `apps/worker/src/index.js`.
- **Las instrucciones del servidor, por debajo de 4.096 caracteres** (Claude corta ahí). Lo de cada herramienta va en su descripción, no en las instrucciones. Lo comprueba el test `12 quater`.
- **Lo que escribe lleva `write: true`.** Si escribe en Garmin, pide `confirm` (o da vista previa sin él).
- **Para Garmin, `garmin_api` es el respaldo.** Si un dato no tiene herramienta, Claude lo pide a pelo con el catálogo `ENDPOINTS_GARMIN`.
  - Un dato nuevo de Garmin se añade primero al catálogo.
  - Solo pasa a una herramienta propia cuando myCoach lo interpreta: lo traduce, lo compara o el motor lo usa.
- **Cada dato de Garmin, por su lado.** Si el dispositivo no lo mide, sale en `sin_datos` y el resto llega igual. Un 401 (sin Garmin vinculado) sí corta, para decir cómo arreglarlo.
- **Renombrar o juntar** se hace cambiando a la vez:
  - el conector y sus instrucciones;
  - la web (`apps/web/src`) y la lista de `apps/worker`;
  - los tests;
  - las skills de Claude (`apps/skills`; `tests/skills.test.mjs` avisa si alguna nombra una herramienta que ya no existe).

## Cómo funciona

Garmin no tiene API pública para particulares (la oficial son 5.000 $ de
alta), así que el Worker habla con los mismos endpoints que la app móvil.
El login intenta primero la ruta de la app iOS y, si Garmin la tiene
limitada, cae automáticamente a la del portal web, que va en otro cubo de
límites.

Claude se registra solo (RFC 7591), el usuario autoriza en `/oauth/authorize`
y recibe un token ligado a él.

### Cuentas de myCoach: Garmin es una fuente vinculada

En `/oauth/authorize` se entra con la **cuenta de myCoach** (email y
contraseña propios), no con Garmin. Garmin se vincula aparte, desde la app
(Ajustes › Conexiones), igual que Intervals.icu. Así conectar Claude no
depende del login de Garmin, que a veces pide captcha a los servidores; y
cuando haya acceso oficial a Garmin solo cambia cómo se vincula.

- La contraseña se guarda con PBKDF2-SHA256 (100.000 iteraciones, sal
  aleatoria) en `cuenta:<id>`. Tras 10 fallos seguidos, 15 minutos de espera.
- El id sigue siendo el hash del email: quien ya entraba con Garmin conserva
  sus datos. Crea su contraseña desde la app con su sesión abierta
  (`POST /cuenta/contrasena`); crear cuenta con un email que ya existe se
  rechaza.
- "Entrar con Garmin" sigue en la misma página para quien aún no tiene
  contraseña.
- La app usa `/cuenta` con el token del usuario: `GET /cuenta`,
  `POST /cuenta/contrasena`, `POST|DELETE /cuenta/garmin` (con MFA). No son
  herramientas MCP a propósito: las contraseñas no pasan por el chat.

### Qué se guarda de cada persona

El token de Garmin, el `displayName` que exige su API y, si la creas, el hash
de tu contraseña de myCoach. **Ni la contraseña de Garmin ni el email**: el
identificador de usuario es un hash del email.

Las credenciales OAuth (client_id, código de autorización, token de acceso)
no se guardan: van **firmadas con HMAC**. Esto no es una optimización — el
KV de Cloudflare es eventualmente consistente y tarda hasta 60 s en
propagar, mientras que el handshake cruza continentes en segundos (el
usuario autoriza desde su país, Claude canjea el código desde EE. UU.).
Guardarlas era una carrera que a veces se perdía.

### Recorridos

`garmin_plan_route` traza y mide, `garmin_save_course` sube, y
`garmin_courses` (con `course_id`, el trazado de uno) relee lo que hay guardado en la
cuenta. Esto ultimo existe porque sin ello Claude sube rutas a ciegas: no
puede comprobar como han quedado ni saber cuales ya tiene el usuario.

El servicio de recorridos de Garmin no esta documentado y su ruta de
listado no es estable, asi que `garmin_courses` prueba las conocidas en
orden y devuelve cual ha contestado. Si un dia dejan de funcionar todas, el
error enumera lo que se intento.

## Entrenador de myCoach (`coach_*`)

El método de entrenamiento de myCoach vive aquí, no en la web ni en el
modelo. Las herramientas deciden con reglas fijas y devuelven el porqué;
quien las llama (tu Claude, la web de myCoach o un bot) solo explica y
negocia. Así da igual con quién hables: la lógica es la misma.

| Herramienta | Qué hace |
|---|---|
| `coach_hoy` | Semáforo del día (verde / ámbar / rojo) con sus razones: readiness, VFC y pulso en reposo frente a tu mediana de 28 días, horas de sueño, frescura (TSB), la carga de 7 días de Garmin frente a su franja óptima, el estado de entreno de Garmin (sobrecargado o en sobreesfuerzo cuentan), el estrés de ayer y lo que hayas anotado. Trae `garmin` (carga, Load Focus, estado, aclimatación) y `fuentes`: qué mide el dispositivo. Sin datos de descanso (solo un Edge) no enseña huecos y pide cómo te encuentras (`pide_sensacion`). Si hace falta, propone cambiar, recortar o mover la sesión del plan. Trae un mensaje ya redactado. |
| `coach_semana` | Plan frente a lo hecho día a día, carga de la semana frente a la media de 4 y avisos (rampa, descarga, fuerza, intensidad). En esta semana y la siguiente, `avisos_garmin`: qué tipo de trabajo falta según el Load Focus y si la carga se sale de la franja. |
| `coach_proponer` | Valida cambios de plan (máximo de intensos, nada de intensos seguidos, semáforo, horas, fuerza, lesiones). Sin `guardar` solo valida; con errores no guarda y ofrece una versión corregida. Deja el porqué en `coach/decisiones`. |
| `coach_perfil` / `coach_perfil_guardar` | Objetivo con fecha, disponibilidad, lesiones, experiencia, preferencias, material, tono del entrenador (`entrenador.tono`) y lo que no le gusta (`no_le_gusta`). `coach_perfil` devuelve `por_conocer`: lo que falta saber, por orden; `coach_hoy` trae solo la siguiente pregunta y el tono. |
| `coach_anotar` | Sensaciones (1-5), dolores y notas. Un dolor en las últimas 36 h pone el día en rojo. |
| `coach_progreso` | Evolución de bici, correr o skimo semana a semana: velocidad, ritmo, VAM, pulso, potencia, cadencia y eficiencia (metros por latido); últimas 4 semanas frente a las 4 anteriores y mejores registros. |

Las instrucciones del servidor (`initialize`) incluyen la voz y el método,
así que cualquier Claude con este conector habla como el entrenador. El
entrenador tiene el nombre que le ponga cada usuario (por defecto myCoach) y
solo planifica bici, correr y skimo, con la fuerza como complemento. Cada
mañana el cron deja `coach/hoy` calculado para quien usa myCoach.

## Fuerza (`fuerza_*`)

Entrenos de fuerza con nombre, liderados por Claude: `entrenos` (los de fuerza y los de bici y correr), `fuerza_entreno_guardar`, `fuerza_registrar`, `fuerza_historial`, `fuerza_ejercicios_garmin` (busca en el catálogo de Garmin, en castellano; va en `ejercicios-garmin.js`), `entreno_enviar_garmin` con `tipo: fuerza` (crea el entreno de fuerza guiado en Garmin Connect y lo programa; escribe, pide confirmación), `fuerza_desde_garmin` (cierra la sesión con las series que contó el reloj) y `fuerza_dia` (solo la app). Se guarda en `app:<id>:fuerza/entrenos` y `app:<id>:fuerza/registro`; la plantilla y lo hecho van separados.

## Entrenos de bici y correr para el reloj

`entreno_enviar_garmin` con `tipo: cardio` crea un entreno guiado por pasos (calentamiento, bloques que se repiten, recuperación, vuelta a la calma), cada paso por tiempo, distancia o hasta pulsar vuelta, con objetivo de pulso (zona del reloj o rango en ppm), potencia (zona o W), ritmo (min/km), velocidad (km/h) o cadencia. Sin `confirm` devuelve la vista previa y no escribe; con `confirm=true` lo crea en Garmin Connect, lo programa para el día, lo guarda (`app:<id>:cardio/entrenos`) y enlaza el día del plan (`entreno_cardio`). `entrenos` los lista para repetirlos.

## Todas las métricas de una actividad

`garmin_activity_detail` devuelve el resumen de Garmin entero, con nombre y
unidad: velocidad media y máxima, ritmo y ritmo ajustado a la pendiente,
potencia media, normalizada, IF y TSS, cadencia, dinámicas de carrera,
velocidad vertical, temperatura, efecto de entrenamiento y stamina. Lo que
no reconoce lo devuelve igualmente en `otros_campos_garmin`. Además, `series`
resume cada gráfica de la actividad (mínimo, media, máximo, inicio y final)
y `perfil` da las principales en 24 tramos. Así Claude contesta sobre la
gráfica de stamina o de potencia sin pedir capturas.

## Forma y tendencia según Garmin (`garmin_forma`)

Lo que Garmin calcula de la forma, con su evolución (por defecto 12 semanas,
`semanas` hasta 52), en una sola llamada:

| Dato | Endpoint de Garmin |
|---|---|
| Estado de entreno (traducido), carga aguda y crónica con su franja óptima y ratio, carga de la semana, balance del mes, aclimatación al calor y la altitud | `metrics-service/metrics/trainingstatus/aggregated/{día}` (del reloj principal) |
| VO2máx de correr y de bici, un punto por semana | `metrics-service/metrics/maxmet/daily/{desde}/{hasta}` |
| Endurance Score por semanas | `metrics-service/metrics/endurancescore/stats` |
| Hill Score por semanas | `metrics-service/metrics/hillscore/stats` |
| Predicciones de 5K, 10K, media y maratón | `metrics-service/metrics/racepredictions/latest/{usuario}` |
| Umbral de lactato (ppm y ritmo) | `biometric-service/biometric/latestLactateThreshold` |
| FTP y W/kg | `biometric-service/biometric/latestFunctionalThresholdPower/CYCLING` |
| Edad física | `fitnessage-service/fitnessage/{día}` |

Cada dato se pide por separado: si Garmin no tiene uno (sin potenciómetro no
hay FTP), el resto sale igual y `sin_datos` dice cuál falta. La web aún no
la usa, así que no está en la lista de herramientas de `apps/worker`.

## Cualquier dato de Garmin (`garmin_api`)

Respaldo de solo lectura para lo que no tiene herramienta propia. Sin `path`
devuelve el catálogo de endpoints conocidos (`ENDPOINTS_GARMIN`, por grupos).
Con `path` hace un GET a connectapi y devuelve el JSON tal cual:

- rellena `{usuario}` y `{perfil}`;
- si la respuesta es grande, la recorta sin romper el JSON y con `campos` se pide solo una parte.

Nunca toca login, subidas ni descargas de archivos. El inventario completo y
qué usa myCoach de cada cosa están en `docs/GARMIN-API.md`.

## Intervals.icu

Segunda fuente, oficial: Intervals.icu es socio de Garmin y recibe cada
actividad y el bienestar al sincronizar el reloj. Se conecta con la clave
personal del usuario (Intervals.icu → Settings → Developer Settings) desde
Ajustes de myCoach. La clave se guarda **cifrada** (AES-GCM, clave derivada
de `SIGNING_KEY`) en `intervals:<usuario>`.

| Herramienta | Qué hace |
|---|---|
| `intervals_estado` / `intervals_conectar` / `intervals_desconectar` | Conexión. Conectar valida la clave contra Intervals.icu antes de guardarla. |
| `intervals_actividades` | Actividades con todas sus métricas: eficiencia, desacople, IF, VI, W' gastado, carga, tiempo en zonas de pulso, potencia y ritmo, dinámicas de carrera, RPE, clima y viento. |
| `intervals_actividad` | Una actividad a fondo: intervalos (cada serie o vuelta) y todas sus series resumidas, con un perfil de 24 tramos. |
| `intervals_bienestar` | Forma, fatiga, rampa, pulso en reposo, VFC, sueño, readiness, peso, VO2máx, ánimo… |
| `intervals_curvas` | Mejores marcas: potencia de 5 s a 60 min, ritmo de 400 m a maratón o pulso, en 6 semanas y en un año. |

La stamina de Garmin no llega por Intervals.icu (no la importa): sale de
`garmin_activity_detail` si el reloj la graba.

## Worker de pruebas

`garmin-pruebas` es el mismo código en otra URL, para probar una rama en
Claude sin tocar los conectores de producción. Comparte KV y D1 (mismos
datos, misma cuenta de Garmin) y no tiene cron.

1. GitHub → Actions → **Deploy** → *Run workflow* y elegir la rama. Desde
   una rama que no sea `main` solo se despliega `garmin-pruebas`.
2. En Claude: Ajustes → Conectores → Añadir conector personalizado →
   `https://garmin-pruebas.albertbecervas.workers.dev/mcp`.

## Panel de progreso

`/panel` es una pagina con el historico de entrenamiento: condicion fisica
desde el primer dia, frescura, horas por semana y eficiencia. Se entra con la
cuenta de Garmin, igual que el conector.

### Que se guarda ahora

**Esto cambia lo de arriba.** Sin historico no hay curva de forma, asi que el
panel guarda en D1 las actividades y los datos diarios de cada usuario
conectado. Sigue sin guardarse ni la contrasena ni el email. Queda dicho en la
pantalla de login, porque el servidor lo hospeda una persona y quien conecta su
cuenta tiene derecho a saberlo antes de entrar.

Un `scheduled` diario (ver `[triggers]` en `wrangler.toml`) recorre a todos los
usuarios y actualiza lo que falte. Los dos Workers tienen cron, con 15 minutos
de diferencia, pero comparten KV y D1: el segundo se salta a quien ya este
fresco, asi que no duplica peticiones a Garmin y hace de red por si el primero
ha fallado. La primera carga trae el historico completo
en varias pasadas acotadas: Garmin responde 429 si se le pide todo de golpe.

### Aislamiento entre usuarios

Una sola base para todos, con el `user_id` (hash del email) en la clave
primaria de cada tabla y en el `WHERE` de cada consulta. El `user_id` sale
siempre de la cookie firmada o del token OAuth, nunca de nada que mande el
navegador.

No hay una base por persona porque en D1 no se puede: el plan gratuito
permite 10 bases por cuenta, y crearlas sobre la marcha exigiria guardar en
el Worker un token de cuenta capaz de leerlas todas, que es peor. Como el
aislamiento vive entonces en que ninguna consulta se olvide del `user_id`,
hay un test que lee el propio codigo fuente y falla si aparece una sentencia
que toque datos de personas sin filtrar por usuario.

Quien administra la cuenta de Cloudflare si puede leer la base entera. Eso no
lo arregla ningun diseño de la aplicacion, y por eso se avisa en la pantalla
de login.

### Como se mide la forma

El modelo estandar (CTL/ATL/TSB) se apoya en el TSS, que se calcula con
potencia. Sin potenciometro se sustituye por TRIMP de Banister sobre la
frecuencia cardiaca, escalado para que una hora a umbral valga 100 igual que un
TSS. La FC de reposo y la maxima salen de los propios datos y se pueden
corregir a mano en el panel.

El esquema guarda potencia y cadencia desde el primer dia. En cuanto una
actividad las traiga, la carga pasa a calcularse con vatios sin tocar nada.

## Puesta en marcha

### Secretos de GitHub

En **Settings → Secrets and variables → Actions**:

| Secreto | De dónde sale |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → plantilla **Edit Cloudflare Workers**. Añade también permiso de edición sobre **D1**, que el Worker tiene un binding. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → Workers & Pages → panel derecho |
| `SIGNING_KEY` | Cadena aleatoria larga. Firma los códigos y tokens OAuth. |

### Sobre `SIGNING_KEY`

Se sube **con cada despliegue** (`wrangler deploy --secrets-file`), no se
configura a mano en el dashboard. Se hizo así después de que un despliegue
borrara el secreto y dejara el Worker devolviendo 500 a todo: los secretos
puestos por el dashboard no sobrevivieron.

Si su valor cambia, **todos los conectores dejan de validar** y hay que
volver a añadirlos, porque los tokens en circulación están firmados con el
valor anterior.

El despliegue tiene dos redes contra ese fallo: `wrangler` aborta si el
secreto no está declarado, y una comprobación posterior llama al Worker ya
desplegado y falla si no responde. Un despliegue no cuenta como bueno hasta
que el servidor contesta.

### Recursos

Ya existen en la cuenta y están referenciados por id en `wrangler.toml`: el
namespace KV `garmin` y la base D1 `garmin-diag`.

## Desarrollo

```bash
node test.mjs
```

Sin dependencias: los tests simulan Garmin, el KV y el reloj. Cubren el
handshake OAuth completo, PKCE, la rotación de refresh, el aislamiento entre
usuarios, el fallback del portal y el caso de KV sin propagar. CI no
despliega si alguno falla.

## Diagnóstico

La tabla `events` de la base D1 `garmin-diag` registra ruta, método, estado
y motivo de cada petición. Nunca tokens, credenciales ni datos de Garmin.
Existe porque los logs del dashboard no se pueden consultar desde fuera y
hacía falta depurar la conexión de otra persona.
