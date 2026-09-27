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

## Poner la web en marcha (pasos humanos, en orden)

1. En `garmin-mcp`, fusiona la rama `mycoach-estado` en `main` (añade `app_leer` / `app_guardar`; se despliega sola).
2. Cloudflare → crea el KV de sesiones: `npx wrangler kv namespace create SESIONES` y pega el id en `apps/worker/wrangler.toml`.
3. En `apps/worker/wrangler.toml`, pon en `GARMIN_URL` la URL de tu Worker de Garmin (la que usas como conector en Claude, sin `/mcp`).
4. GitHub → Settings → Secrets → Actions: añade `CLOUDFLARE_API_TOKEN` (plantilla "Edit Cloudflare Workers") y `CLOUDFLARE_ACCOUNT_ID`.
5. Push a `main`: CI pasa los tests y despliega en `https://mycoach.<tu-subdominio>.workers.dev`.
6. En la web: Ajustes → **Conectar mi Garmin** (inicia sesión en Garmin una vez).

Ver `ARCHITECTURE.md` para el diseño, los riesgos y el camino a app móvil.
