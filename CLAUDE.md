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

## Que no parezca hecho por IA

- Diseño propio de myCoach, no plantilla. No uses un patrón solo porque es habitual: gradientes morados o azules, vidrio, sombras de más, pastillas en todo, tres tarjetas iguales, manchas decorativas, animaciones gratuitas. Se permiten si encajan de verdad con el producto.
- Primero tipografía, espacio, color, densidad y jerarquía; los efectos, después.
- Móvil y escritorio se diseñan, no se encogen: decide qué se apila, se pliega, desaparece o cambia de interacción.
- La animación comunica estado o continuidad; si no, sobra.
- Cambio visual importante: ábrelo con Playwright (móvil y escritorio, estados e interacciones), arregla y vuelve a mirar. Que compile no significa que se vea bien.
- Al acabar, una pasada de `impeccable` buscando aspecto genérico, jerarquía floja o espacios incoherentes. Arregla lo que importa y para.
- Ante la duda: específico, simple e intencionado gana a moda, genérico y decorativo.

## Skills de diseño: cuál usar y cuándo

Las reglas de este archivo y los tokens de `app.css` mandan siempre sobre cualquier skill. Se usa **una** skill por tarea, la primera que encaje:

| Tarea | Skill |
|---|---|
| Revisar, criticar, pulir, auditar accesibilidad, simplificar o afinar una pantalla que ya existe | `impeccable` |
| Crear una pantalla o componente nuevo desde cero | `frontend-design` (dirección visual) + `ui-ux-pro-max` (UX, patrones y gráficos) |
| Elegir estilo, paleta, tipografía o tipo de gráfico, o consultar guías de UX | `ui-ux-pro-max` (solo como consulta de datos) |

- No se encadenan más skills sobre la misma pantalla, salvo la pareja `frontend-design` + `ui-ux-pro-max` al crear. Si hay duda, gana `impeccable`.
- En la app actual, `frontend-design` se limita a los componentes y tokens existentes (`card`, `btn`, `sheet`…). En un rediseño acordado puede proponer identidad nueva, que se vuelca en tokens, no en estilos sueltos.
- `ui-ux-pro-max` aconseja en UX (flujos, guías, tipo de gráfico); su paleta o tipografía no se aplican si chocan con los tokens.
- Las demás skills de `.claude/skills` (`brand`, `banner-design`, `slides`, `design`, `design-system`, `ui-styling`) no se usan en myCoach salvo que el usuario las pida.

## Producto
- El método (semáforo, reglas del plan) vive en el conector (`apps/conector`, herramientas `coach_*`). La web lo enseña, no lo recalcula. Si la web necesita un dato nuevo, se añade al conector en el mismo cambio.
- Solo se planifican bici, correr y skimo (y fuerza como complemento). El resto de deportes cuenta como carga.
- `docs/PLAN-COACH.md` recoge las decisiones de producto; `docs/PRUEBAS.md`, cómo probar.

## Comprobaciones
- `npm run check` antes de cada commit.
- Nada va a `main` sin que lo pida el usuario. Las pruebas van en `mycoach-pruebas` / `garmin-pruebas`.
