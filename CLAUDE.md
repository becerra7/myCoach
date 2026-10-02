# myCoach: reglas para trabajar en este repo

## Diseño: piensa como un diseñador senior en cada pantalla

Antes de dar por buena una pantalla, repásala con esta lista y **mírala en el navegador** (captura a 390 px, en claro y en oscuro). Si algo no pasa, se arregla antes de subir.

**Simplicidad**
- Cada pantalla responde a una pregunta. Hoy responde "¿qué hago hoy y por qué?": eso va primero.
- Un dato, un sitio. Si ya se ve en una tarjeta, no se repite en otra, ni en el subtítulo ni en el mensaje.
- Una acción principal por tarjeta (botón relleno). El resto son secundarias (texto o tonal). Nunca dos botones rellenos juntos.
- Nada decorativo que no informe: un círculo grande que solo tiene un color no aporta nada.
- Textos cortos, en castellano de España, tuteando. Los verbos de los botones dicen lo que pasa ("Aplicar el cambio", no "Aceptar").

**Usabilidad**
- Lo que cambia algo se enseña antes de hacerlo (antes → después) y se puede deshacer.
- Nada de `prompt()`, `alert()` ni `confirm()`: se usan hojas (`openSheet`) y diálogos (`ask`).
- Las opciones van agrupadas por lo que el usuario quiere hacer: conexiones, entrenador, deportes, preferencias.
- Estados vacíos y de error que digan qué hacer a continuación.

**Accesibilidad (WCAG 2.2 AA)**
- El color nunca es el único medio: cada estado lleva texto o icono (✓ hecho, ✕ no hecho, "Algo peor"…).
- Contraste de texto de al menos 4,5:1. `--label-3` solo se usa en elementos que no son texto.
- Zonas táctiles de 44 × 44 px como mínimo (`--tap`).
- Encabezados en orden, `aria-label` en lo que solo es gráfico, foco visible y todo usable con teclado.
- Respeta `prefers-reduced-motion` y el modo oscuro: los colores salen de los tokens de `app.css`, nunca a pelo.

**Coherencia**
- Se usan los componentes que ya existen (`card`, `card-h`, `btn fill|tonal|text`, `li`, `chip`, `sheet`, `toast`), no estilos sueltos.
- Los tokens de color, radio y tipografía de `app.css` mandan.

## Skills de diseño: cuál usar y cuándo

Las reglas de este archivo y los tokens de `app.css` mandan siempre sobre cualquier skill. Se usa **una** skill por tarea, la primera que encaje:

| Tarea | Skill |
|---|---|
| Revisar, criticar, pulir, auditar accesibilidad, simplificar o afinar una pantalla que ya existe | `impeccable` |
| Crear una pantalla o componente nuevo desde cero | `frontend-design` |
| Elegir estilo, paleta, tipografía o tipo de gráfico, o consultar guías de UX | `ui-ux-pro-max` (solo como consulta de datos) |

- No se encadenan dos skills sobre la misma pantalla. Si hay duda entre dos, gana `impeccable`.
- `frontend-design` tiende a proponer estéticas llamativas: aquí se limita a los componentes y tokens existentes (`card`, `btn`, `sheet`…), sin fuentes, colores ni estilos nuevos.
- `ui-ux-pro-max` solo aconseja: nunca se aplica su paleta o tipografía si choca con `app.css`.
- Las demás skills de `.claude/skills` (`brand`, `banner-design`, `slides`, `design`, `design-system`, `ui-styling`) no se usan en myCoach salvo que el usuario las pida.

## Producto
- El método (semáforo, reglas del plan) vive en el conector (`garmin-mcp`, herramientas `coach_*`). La web lo enseña, no lo recalcula.
- Solo se planifican bici, correr y skimo (y fuerza como complemento). El resto de deportes cuenta como carga.
- `docs/PLAN-COACH.md` recoge las decisiones de producto; `docs/PRUEBAS.md`, cómo probar.

## Comprobaciones
- `npm run check` antes de cada commit.
- Nada va a `main` sin que lo pida el usuario. Las pruebas van en `mycoach-pruebas` / `garmin-pruebas`.
