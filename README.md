# garmin-mcp

Servidor MCP que expone los datos de Garmin Connect a Claude, sobre un único
Cloudflare Worker. Multiusuario: cada persona añade la misma URL y se
autentica con sus propias credenciales de Garmin.

```
https://garmin.<tu-subdominio>.workers.dev/mcp
```

## Cómo funciona

Garmin no tiene API pública para particulares (la oficial son 5.000 $ de
alta), así que el Worker habla con los mismos endpoints que la app móvil.
El login intenta primero la ruta de la app iOS y, si Garmin la tiene
limitada, cae automáticamente a la del portal web, que va en otro cubo de
límites.

Claude se registra solo (RFC 7591), el usuario autoriza en `/oauth/authorize`
—que es la pantalla de login de Garmin— y recibe un token ligado a él.

### Qué se guarda de cada persona

Solo el token de Garmin y el `displayName` que exige su API. **Ni la
contraseña ni el email**: el identificador de usuario es un hash del email.

Las credenciales OAuth (client_id, código de autorización, token de acceso)
no se guardan: van **firmadas con HMAC**. Esto no es una optimización — el
KV de Cloudflare es eventualmente consistente y tarda hasta 60 s en
propagar, mientras que el handshake cruza continentes en segundos (el
usuario autoriza desde su país, Claude canjea el código desde EE. UU.).
Guardarlas era una carrera que a veces se perdía.

### Recorridos

`garmin_plan_route` traza y mide, `garmin_save_course` sube, y
`garmin_courses` / `garmin_course_detail` releen lo que hay guardado en la
cuenta. Esto ultimo existe porque sin ello Claude sube rutas a ciegas: no
puede comprobar como han quedado ni saber cuales ya tiene el usuario.

El servicio de recorridos de Garmin no esta documentado y su ruta de
listado no es estable, asi que `garmin_courses` prueba las conocidas en
orden y devuelve cual ha contestado. Si un dia dejan de funcionar todas, el
error enumera lo que se intento.

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
