# Arquitectura de myCoach en C4

Cuatro niveles, de fuera hacia dentro: con quién habla myCoach, qué se despliega, qué hay dentro de cada pieza y cómo viaja una llamada concreta. Cubre todo el repo, conector incluido (`apps/conector`). Estado a 3 de octubre de 2026.

Versión dibujada (más legible, claro y oscuro): https://claude.ai/artifact/JJxEwkUSQ2j51EmHubinio

## C1 · Contexto

Dos puertas al mismo entrenador: la app (web o PWA) y el Claude de cada uno. Las dos acaban en el mismo sistema, que es el único que habla con Garmin.

```mermaid
C4Context
  Person(atleta, "Deportista", "Bici, correr y skimo; reloj Garmin")
  System_Ext(claude, "Claude", "claude.ai y apps: conversa con las skills del coach y abre la app en el chat")
  System(mycoach, "myCoach", "Web/PWA y conector MCP con el motor, en un solo Worker")
  System_Ext(gc, "Garmin Connect", "API no oficial: sueño, VFC, readiness, actividades")
  System_Ext(reloj, "Reloj Garmin", "Graba actividades; recibe entrenos y rutas")
  System_Ext(icu, "Intervals.icu", "Opcional: potencia, curvas, desacople")
  System_Ext(brouter, "BRouter", "Trazado de rutas por carreteras reales")
  System_Ext(cal, "Tu calendario", "Enlace iCal (Google, Outlook, iCloud)")

  Rel(atleta, mycoach, "Usa la web o la PWA")
  Rel(atleta, claude, "Conversa")
  Rel(claude, mycoach, "MCP + OAuth 2.1: coach_*, garmin_*, app_*, ui://mycoach/app")
  Rel(mycoach, gc, "Lee salud y actividades; sube entrenos y rutas")
  Rel(gc, reloj, "Sincroniza")
  Rel(mycoach, icu, "Métricas avanzadas (clave cifrada)")
  Rel(mycoach, brouter, "garmin_plan_route")
  Rel(mycoach, cal, "Bloques ocupados (solo la web)")
```

- El método (semáforo, reglas del plan) vive en el conector (`coach_*`). La web y Claude lo enseñan y lo explican.
- Claude no habla con Garmin: llama a las herramientas de myCoach, igual que la web.

## C2 · Contenedores

```mermaid
C4Container
  Person(atleta, "Deportista")
  System_Ext(claude, "Claude", "Chat con el conector; pinta ui://mycoach/app")
  System_Ext(cal, "Calendario iCal")
  System_Ext(gc, "Garmin Connect")
  System_Ext(icu, "Intervals.icu")
  System_Ext(brouter, "BRouter")

  System_Boundary(cf, "myCoach · Cloudflare") {
    Container(web, "App web", "index.html, JS sin framework, PWA", "Hoy, Plan, Comer, Progreso, Pueblos")
    Container(mcpapp, "App en Claude", "mcp-app.html, MCP App", "La misma app en un iframe; sin red propia")
    Container_Boundary(worker, "Worker mycoach (apps/worker/src/unico.js reparte por ruta)") {
      Container(wweb, "Web y API", "apps/worker/src/index.js", "Estáticos, /api/*, cliente OAuth PKCE, lista blanca de herramientas")
      Container(con, "Conector MCP", "apps/conector/worker.js", "/mcp, /oauth/*, /cuenta, /panel; motor coach_*; cron 05:30 UTC")
    }
    ContainerDb(kv, "Workers KV", "Un solo namespace", "mc:* sesiones web; user:*, cuenta:*, app:* del conector")
    ContainerDb(d1, "D1 garmin-diag", "SQLite", "activities, days, sync_state, registro de llamadas")
  }

  Rel(atleta, web, "Abre")
  Rel(web, wweb, "HTTPS: estáticos y /api/*", "cookie mc_s HttpOnly")
  Rel(mcpapp, wweb, "Carga mcp-app.js")
  BiRel(claude, mcpapp, "postMessage JSON-RPC (tools/call)")
  Rel(claude, con, "MCP + OAuth 2.1")
  Rel(wweb, con, "/oauth, /mcp, /cuenta", "en proceso (GARMIN_SVC)")
  Rel(con, wweb, "Pide /mcp-app", "en proceso (MYCOACH)")
  Rel(wweb, cal, "Descarga iCal")
  Rel(wweb, kv, "mc:s:* sesiones, mc:ics:* caché")
  Rel(con, kv, "Tokens, cuentas y documentos")
  Rel(con, d1, "Histórico y registro")
  Rel(con, gc, "Datos y entrenos")
  Rel(con, icu, "Métricas")
  Rel(con, brouter, "Rutas")
```

- Una URL para todo: `unico.js` manda `/mcp`, `/oauth/*`, `/cuenta`, `/panel`, `/.well-known/*` y los GPX al conector, y el resto a la web. Tu Claude se conecta a `…/mcp` del mismo dominio.
- Las dos partes se llaman en proceso: `unico.js` les da un `GARMIN_SVC` y un `MYCOACH` que llaman al `fetch()` de la otra, así que su código no cambió al juntarlas.
- `SESIONES` (web) y `GARMIN` (conector) son el mismo namespace de KV; la web escribe bajo `mc:`.
- La app en Claude no tiene flecha hacia el conector: no tiene red y todo se lo pide a Claude.
- `mycoach-pruebas` (sin cron) comparte KV y D1 con producción: datos reales.
- Despliegue: GitHub Actions, `npm run check` (web, Worker y tests del conector) en cada push; en `main`, `wrangler deploy` con `SIGNING_KEY` como secreto y comprobación de la web, la API y el login.

## C3 · Componentes

### Conector MCP (`apps/conector/worker.js`)

```mermaid
C4Component
  Container_Ext(wweb, "Web y API", "mismo Worker")
  System_Ext(claude, "Claude", "HTTPS /mcp")

  Container_Boundary(con, "Conector MCP · apps/conector/worker.js") {
    Component(cron, "Cron diario", "scheduled(), 05:30 UTC", "sincronizarTodos() y calcularHoy() → coach/hoy")
    Component(router, "Router HTTP", "fetch()", "/oauth/*, /cuenta/*, /mcp, /panel, /.well-known/*")
    Component(panel, "Panel de progreso", "/panel", "Gráficas desde D1")
    Component(oauth, "OAuth 2.1 y cuentas", "handleAuthorize, handleToken", "Cuenta myCoach (PBKDF2), tokens firmados con HMAC")
    Component(rpc, "Servidor MCP", "handleRpc", "tools/list, tools/call, resources/read")
    Component(ui, "App en Claude", "ui://mycoach/app", "HTML pedido a la web por MYCOACH")
    Component(coach, "coach_*", "Motor", "semaforo, validarSemana, ajusteDelDia, progreso")
    Component(garmin, "garmin_*", "Lecturas y rutas", "sueño, VFC, readiness, actividades, recorridos")
    Component(fuerza, "fuerza_*, cardio_*, entrenos_*", "Entrenos", "librería, registro, envío e importación")
    Component(intervals, "intervals_*", "Segunda fuente", "actividades, bienestar, curvas")
    Component(app, "app_*, comida_*, peso_*, mycoach_abrir", "Estado de la app", "plan, comidas, peso")
    Component(hist, "Histórico", "sincronizar()", "actividades y días")
    Component(http, "Clientes HTTP", "apiGet, apiPost, routeVia", "login de Garmin: app iOS y, si limita, portal web")
    Component(icuc, "Cliente Intervals", "icuGet, cifrar()", "clave en AES-GCM")
    Component(docs, "Documentos", "leerDoc, guardarDoc", "estado/app, atleta/*, coach/*")
  }

  ContainerDb_Ext(d1, "D1 garmin-diag")
  ContainerDb_Ext(kv, "Workers KV")
  System_Ext(gc, "Garmin Connect")
  System_Ext(brouter, "BRouter")
  System_Ext(icu, "Intervals.icu")

  Rel(wweb, router, "En proceso")
  Rel(claude, router, "HTTPS")
  Rel(router, oauth, "")
  Rel(router, rpc, "")
  Rel(router, panel, "")
  Rel(rpc, ui, "resources/read")
  Rel(rpc, coach, "tools/call")
  Rel(rpc, garmin, "tools/call")
  Rel(rpc, fuerza, "tools/call")
  Rel(rpc, intervals, "tools/call")
  Rel(rpc, app, "tools/call")
  Rel(cron, coach, "calcularHoy()")
  Rel(coach, hist, "")
  Rel(garmin, http, "")
  Rel(fuerza, http, "")
  Rel(intervals, icuc, "")
  Rel(app, docs, "")
  Rel(hist, d1, "")
  Rel(http, gc, "")
  Rel(http, brouter, "")
  Rel(icuc, icu, "")
  Rel(docs, kv, "")
```

`coach_*` también lee documentos (plan, perfil, diario) y la salud de hoy de Garmin.

### App web (`apps/web`)

```mermaid
C4Component
  Container_Boundary(web, "App web · apps/web/src (un HTML por destino)") {
    Component(pant, "Pantallas v1", "62-v1-base, 63…67-v1-*", "Hoy, Plan, Comer, Progreso, Pueblos; navegación y hojas en 20-hoy")
    Component(coach, "Entrenador", "55-coach", "Semáforo de coach_hoy; aplica el cambio con coach_proponer")
    Component(entrenos, "Entrenos", "57-cardio, 58-fuerza, 59-entrenos", "Librería, registro, envío al reloj")
    Component(cuenta, "Cuenta y fuentes", "56-cuenta, 57-intervals, 61-peso")
    Component(dom, "Dominio", "00-geo-dominio", "construir(dataset) → M; zonas, W/kg, municipios")
    Component(estado, "Estado y render", "10-estado, 99-arranque", "S: plan, comidas, objetivo")
    Component(datos, "Acceso a datos", "50-pueblos-comida-claude", "LIVE.callTool y DB.doc(p).get/set → app_leer / app_guardar")
    Component(iface, "window.claude.use('mcp' | 'db' | 'sample')", "Interfaz de capacidades de los artifacts de Claude")
    Component(pweb, "platform/web.js", "--target web → index.html", "fetch POST /api/mcp con la cookie")
    Component(pmcp, "platform/mcpapp.js", "--target mcpapp → mcp-app.html", "postMessage JSON-RPC")
  }
  Container_Ext(wweb, "Web y API", "/api/mcp")
  System_Ext(host, "Claude, anfitrión del iframe", "MCP Apps")
  System_Ext(art, "Claude, runtime de artifact", "--target claude → claude.html, window.claude nativo")

  Rel(pant, estado, "")
  Rel(coach, datos, "")
  Rel(entrenos, datos, "")
  Rel(cuenta, datos, "")
  Rel(estado, dom, "")
  Rel(datos, iface, "claude.use()")
  Rel(pweb, iface, "implementa")
  Rel(pmcp, iface, "implementa")
  Rel(art, iface, "implementa")
  Rel(pweb, wweb, "HTTPS")
  Rel(pmcp, host, "postMessage")
```

`apps/web/build.mjs` elige la plataforma y mete en el mismo HTML la geografía (IGN y Natural Earth, 1,8 MB), `demo.json` y los módulos `00…99` en orden.

## C4 · Código: «Aplicar el cambio»

El semáforo de Hoy propone recortar la sesión y tocas el botón.

```mermaid
sequenceDiagram
  participant H as 55-coach.js
  participant P as platform/web.js
  participant W as index.js (web y API)
  participant R as handleRpc (conector)
  participant M as coach_proponer (motor)
  participant K as Workers KV
  Note over H: Tocas «Aplicar el cambio»<br/>(la tarjeta ya enseña antes → después)
  H->>P: coachCall('coach_proponer', { cambios, porque, guardar: true })
  P->>W: POST /api/mcp { tool, input }
  Note over W: TOOLS.has(tool): lista blanca<br/>acceso(): renueva el token si caducó
  W->>R: tools/call · Bearer (en proceso, GARMIN_SVC)
  Note right of R: Claude entra aquí
  R->>M: coach_proponer(input)
  Note over M: validarSemana(): intensos, horas,<br/>semáforo, fuerza, lesiones
  M->>K: guardarDoc estado/app y coach/decisiones
  M-->>H: { guardado, semanas } (por la misma cadena)
  alt guardado
    Note over H: actualiza S y relee coach_hoy
  else rechazado
    Note over H: diálogo (ask) con el porqué del motor
  end
```

Desde Claude la llamada entra directamente en `handleRpc` y desde ahí es idéntica: mismo motor, mismas reglas, mismo documento.

## Puntos a vigilar

- **API privada de Garmin.** Ya se rompió en marzo de 2026 y el programa oficial no acepta solicitudes. Intervals.icu es el plan B.
- **Pruebas y producción comparten datos.** Un cambio guardado desde `mycoach-pruebas` se ve en la web de siempre.
- **Un archivo para todo el conector.** `apps/conector/worker.js` (~6.500 líneas) mezcla OAuth, cliente de Garmin, motor y entrenos; separar el motor a `packages/domain` está en el plan.
- **HTML pesado.** La geografía va incrustada en la web; el plan es cargarla bajo demanda.
