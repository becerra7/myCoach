# myCoach

Tu entrenador multideporte que lee tu Garmin y te lo cuenta en claro: tu semana, tu forma, tus pueblos y qué comer. Sin calorías, sin suscripción de IA.

- **Web pública**: Cloudflare Worker + estáticos (`apps/worker`, `apps/web`).
- **Conector** (`apps/conector`): el servidor MCP de Garmin que usan tu Claude y la web. El método del entrenador (`coach_*`) vive aquí. Antes era el repo `garmin-mcp`; se trajo con todo su historial.
- **IA sin coste**: la app funciona con reglas; para chatear usas tu propio Claude con el conector, que lee y escribe en la app (`app_leer` / `app_guardar`).

## Probar en local

```bash
npm install
npm run check      # monta la web, comprueba la sintaxis y pasa los tests de la web y del conector
npm run dev        # http://localhost:8787 (necesita wrangler.toml configurado)
```

`npm run build:claude` genera `apps/web/dist/claude.html`, la versión para publicar como artifact dentro de Claude.

## Despliegue

- **Web**: `https://mycoach.albertbecervas.workers.dev`
- **Web** (workflow `CI`): se despliega con cada push a `main`.
- **Conector** (workflow `Conector`): son otros Workers (`garmin`, `garmin-2` y `garmin-pruebas`), porque tu Claude los usa por su URL. Se despliega cuando cambia `apps/conector`. Necesita en los secretos del repo `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` y `SIGNING_KEY`.
- **Pruebas**: "Run workflow" desde una rama que no sea `main` despliega `mycoach-pruebas` y `garmin-pruebas`, sin tocar producción.
- Conector: `GARMIN_URL` en `apps/worker/wrangler.toml`. Sesiones: comparte el KV del conector con el prefijo `mc:`.

Ver `ARCHITECTURE.md` para el diseño, los riesgos y el camino a app móvil, y `docs/PLAN-COACH.md` para el análisis de NUA y el plan de entrenador (voz, IA, canales y fases).
