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
