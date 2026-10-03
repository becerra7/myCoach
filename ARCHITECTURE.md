# Arquitectura de myCoach

## Piezas

```
Navegador (web / PWA / luego app)          Cloudflare
┌───────────────────────────┐   /api/*    ┌──────────────────────┐  OAuth 2.1 + MCP  ┌─────────────────────┐
│ apps/web  (un solo HTML)  │ ──────────► │ apps/worker          │ ────────────────► │ apps/conector (Worker) │ ─► Garmin Connect
│  módulos 00..60           │             │  login PKCE, sesión, │                   │  garmin_* + app_*   │
│  platform/web.js          │ ◄────────── │  proxy de herramientas│                   │  KV por usuario     │
└───────────────────────────┘  estáticos  └──────────────────────┘                   └─────────▲───────────┘
                                                                                             │ mismo conector
                                                                              Tu Claude (claude.ai / app) ─ chat
```

- **Una sola fuente de datos**: el Worker de Garmin. Guarda los tokens de Garmin, expone las lecturas (`garmin_*`) y el estado de la app (`app_leer` / `app_guardar`: plan, comidas, objetivo, datos procesados). La web y tu Claude leen y escriben lo mismo.
- **La web es un cliente OAuth más** del conector (igual que Claude). No ve contraseñas de Garmin; la sesión es una cookie HttpOnly que apunta a los tokens en KV.
- **Misma app en dos sitios**: el código está escrito contra la interfaz de capacidades del artifact de Claude (`window.claude.use('mcp' | 'db' | 'sample')`). En Claude la da el runtime; en la web la da `platform/web.js`. El build decide cuál incluir (`--target web | claude`).

## Módulos de la web (`apps/web/src`)

| Módulo | Responsabilidad |
|---|---|
| `00-geo-dominio.js` | Dominio puro: geografía (municipio/país de cada punto), clasificación por zonas de pulso, W/kg por física, `construir(dataset)` → modelo `M`, indicadores con "qué dato falta". |
| `10-estado.js` | Estado de usuario `S` (plan, comidas, objetivo…), persistencia, utilidades de fecha, resumen semanal. |
| `20-hoy.js` … `40-forma-pantallas.js` | Pantallas (Hoy, Plan, Forma, test, evolución, ajustes). |
| `35-agenda.js` | Tu calendario (iCal) y huecos para entrenar; aviso de semana sin plan. |
| `50-pueblos-comida-claude.js` | Pueblos, comida, chat, sincronización con Garmin, acciones. |
| `55-coach.js` | Tarjeta "Tu entrenador": semáforo del día, aplicar la propuesta y anotar cómo estás. Lo decide el conector (`coach_hoy`, `coach_proponer`, `coach_anotar`); en demo, un ejemplo con las mismas reglas. |
| `60-mapa.js` | Mapa táctil a pantalla completa (SVG, pellizcar, zoom, encuadre de un pueblo). |
| `99-arranque.js` | Arranque: siempre el último, cuando todo está definido. |
| `public/` | PWA: manifest, icono y service worker (abre sin red con la última versión). |

Siguiente paso de escalado (sin cambiar el comportamiento):
1. Sacar `00-geo-dominio.js` a `packages/domain` (ES modules, sin DOM) con tests de `construir`, `tipoPorZonas`, `wkgFisica`, `indicadores`.
2. Pasar los módulos a ES modules con un bundler (esbuild) y cargar la geografía (1,8 MB) bajo demanda desde `/geo/*.json` con caché, en vez de ir incrustada.
3. Mover la sincronización pesada (detalles, rutas, cruce con municipios) al Worker con un cron diario, para que el móvil solo descargue el resultado.

## Calendario

El usuario pega el enlace privado iCal de su calendario (Google, Outlook, iCloud). El Worker lo guarda en la sesión, lo descarga (caché 10 min) y `apps/worker/src/ics.js` devuelve solo los bloques ocupados de los próximos días en hora de Madrid: zonas horarias, repeticiones, excepciones y cambios de hora incluidos. La app coloca cada sesión en un hueco libre (6:00-22:00, 15 min de margen), la recorta si no cabe o la mueve al día de descanso libre más cercano. Con Google Calendar por OAuth se podría evitar pegar el enlace, pero exige verificación de Google para datos de calendario.

## Camino a app móvil

1. **PWA** (hecho: manifest + service worker): instalable en iOS/Android desde el navegador ("Añadir a pantalla de inicio"), abre sin red con la última sincronización.
2. **Capacitor** envolviendo la misma web: notificaciones push ("tu semana está lista"), compartir nativo, cámara para las comidas. El login OAuth usa el navegador del sistema con un esquema propio de redirect.
3. Nativo (Compose/SwiftUI) solo si la PWA se queda corta; el dominio ya estaría en `packages/domain` y la API en el Worker.

## IA: qué es posible sin pago por uso

- **Dentro de Claude** (artifact): chat en la app con tu cuenta de Claude (`sample`). Funciona hoy.
- **En la web**: no hay IA dentro de la app sin pagar la API por uso. La alternativa gratuita es la inversa: **chateas en tu Claude** (web o app) con el conector de Garmin, que ya tiene `app_leer` / `app_guardar`; Claude lee tu semana, te propone el plan o registra una comida, y al volver a la web lo ves (la app relee el estado al recuperar el foco). El botón "Hacerlo en mi Claude" prepara el mensaje.
- Todo lo básico (plan semanal, balance, avisos, cuartos de plato) funciona con reglas, sin IA.

## Qué es dato real y qué no

| Parte | Origen |
|---|---|
| Actividades, pulso, subidas, llano, trazados, pueblos, países | Garmin (en vivo), calculado en el navegador |
| Readiness, sueño, VFC, VO2máx, Endurance, Hill, evolución mensual | Garmin (en vivo) |
| Nota de subida (W/kg) | Estimada por física de tus subidas; exacta con el test de 20 min o un potenciómetro |
| Plan, comidas, objetivo, nombre | Lo que tú (o tu Claude) introduces |
| Núcleos dentro de cada municipio | Falta: necesita datos de OpenStreetMap en el Worker |
| Modo demo | Instantánea de ejemplo, separada y marcada como "Demo" |

## Riesgos antes de abrirlo al público

- **API de Garmin**: el conector usa la API privada de Garmin Connect con la sesión del usuario. Para uso personal vale; para una web pública hay que pasar al **Garmin Connect Developer Program** (Health/Activity API, requiere solicitud y aprobación) o aceptar que puede romperse o incumplir sus términos.
- **Datos de salud**: son datos sensibles (RGPD art. 9). Antes de abrir: política de privacidad, consentimiento explícito, borrado de cuenta (`app_*` + tokens) y cifrado de los tokens en KV.
- **Límites de Garmin**: la primera sincronización hace muchas llamadas; con usuarios reales debe ir por cron en el Worker y con caché.
- **Nombre**: "Trazo" era provisional; el repo se llama myCoach. Comprobar marca antes de publicar.
