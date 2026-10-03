# myCoach

Tu entrenador multideporte que lee tu Garmin y te lo cuenta en claro: tu semana, tu forma, tus pueblos y qué comer. Sin calorías, sin suscripción de IA.

- **Un solo Worker** (`mycoach`, `apps/worker/src/unico.js`): la web (`apps/web`), su API y el conector MCP, en la misma URL. Tu Claude se conecta a `https://mycoach.albertbecervas.workers.dev/mcp`.
- **Conector** (`apps/conector`): el servidor MCP de Garmin que usan tu Claude y la web. El método del entrenador (`coach_*`) vive aquí. Antes era el repo `garmin-mcp` con sus propios Workers; se trajo con todo su historial.
- **IA sin coste**: la app funciona con reglas; para chatear usas tu propio Claude con el conector, que lee y escribe en la app (`app_leer` / `app_guardar`).

## Probar en local

```bash
npm install
npm run check      # monta la web, comprueba la sintaxis y pasa los tests de la web y del conector
npm run dev        # http://localhost:8787, web y conector (/mcp); necesita apps/worker/.dev.vars con SIGNING_KEY="lo-que-sea"
```

`npm run build:claude` genera `apps/web/dist/claude.html`, la versión para publicar como artifact dentro de Claude.

## Despliegue

- **Web**: `https://mycoach.albertbecervas.workers.dev`
- **Producción** (workflow `CI`): cada push a `main` despliega el Worker `mycoach` (web, API y conector). Necesita en los secretos del repo `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` y `SIGNING_KEY` (firma los tokens OAuth y cifra la clave de Intervals.icu; si cambia, hay que volver a entrar y reconectar Claude e Intervals).
- **Pruebas**: "Run workflow" desde una rama que no sea `main` despliega `mycoach-pruebas` con los mismos datos.
- **Workers antiguos** (`garmin`, `garmin-2`, `garmin-pruebas`): se borran con el workflow "Borrar un Worker antiguo".
- Datos: un KV (`GARMIN` y `SESIONES`, este con el prefijo `mc:`) y la D1 `garmin-diag` para los registros.

Ver `ARCHITECTURE.md` para el diseño, los riesgos y el camino a app móvil, y `docs/PLAN-COACH.md` para el análisis de NUA y el plan de entrenador (voz, IA, canales y fases).
