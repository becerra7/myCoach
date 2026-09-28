# myCoach

Tu entrenador multideporte que lee tu Garmin y te lo cuenta en claro: tu semana, tu forma, tus pueblos y qué comer. Sin calorías, sin suscripción de IA.

- **Web pública**: Cloudflare Worker + estáticos (`apps/worker`, `apps/web`).
- **Datos**: el conector de Garmin (repo `garmin-mcp`), el mismo que usas en Claude.
- **IA sin coste**: la app funciona con reglas; para chatear usas tu propio Claude con el conector, que lee y escribe en la app (`app_leer` / `app_guardar`).

## Probar en local

```bash
npm install
npm run check      # monta la web, comprueba la sintaxis y pasa los tests del Worker
npm run dev        # http://localhost:8787 (necesita wrangler.toml configurado)
```

`npm run build:claude` genera `apps/web/dist/claude.html`, la versión para publicar como artifact dentro de Claude.

## Despliegue

- **Web**: `https://mycoach.albertbecervas.workers.dev`
- Mientras este repo no tenga sus propios secretos de Cloudflare, lo despliega el workflow **Deploy myCoach** del repo `garmin-mcp` (a mano, "Run workflow"), que usa el token de Cloudflare que ya tiene.
- Para que se despliegue solo con cada push aquí: GitHub → Settings → Secrets → Actions → `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` (los mismos que `garmin-mcp`).
- Conector: `GARMIN_URL` en `apps/worker/wrangler.toml`. Sesiones: comparte el KV del conector con el prefijo `mc:`.

Ver `ARCHITECTURE.md` para el diseño, los riesgos y el camino a app móvil.
