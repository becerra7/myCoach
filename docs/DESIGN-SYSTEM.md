# Design system de myCoach

Fuente de verdad: `apps/web/src/app.css`. Este documento recoge lo que hay hoy, las reglas de uso y lo que habría que decidir para que la app sea homogénea. Los puntos de "A decidir" son propuestas, no están aplicados.

> **v1 (octubre 2026).** La app ya usa el lenguaje del rediseño: tinta sobre papel, el color solo para datos (deportes y estados), las acciones en tinta y la fuente Archivo (estrecha para cifras y titulares). Los tokens están en la capa "v1 · Rediseño" al final de `apps/web/src/app.css` (`--paper`, `--surface`, `--ink`, `--ink-2`, `--rule`, estados y `--s-<deporte>`), con un solo estilo para iOS y Android. Componentes nuevos: `blk` (bloque con regla), `info` (ⓘ que abre la explicación), `tag` (estado con palabra e icono), `met2`, `tot`, `dias`, `dia`, `sem7`/`d7v`, `seg2` y las gráficas `chart2` (una escala, tooltip). Lo de abajo describe la base anterior, que sigue debajo para las pantallas secundarias.

## 1. Lo que había antes del rediseño

### Color
- **Marca:** `--brand` / `--tint` azul `#1D4FA0` (en oscuro `#8DB3F7`).
- **Superficies y texto:** `--bg`, `--card`, `--card-2`, `--label` (texto), `--label-2` (secundario), `--label-3` (solo no texto), `--sep`, `--fill`.
- **Estado:** `--good`, `--warn`, `--bad`, cada uno con su `-soft` para fondos.
- **Tipo de sesión:** `--rec` (recuperación), `--fondo`, `--tempo`, `--int`, `--otros`. Color de deporte con `scol()`.
- **Otros:** `--sim` (ejemplo/estimado), mapa (`--map-on`, `--map-off`).
- Claro y oscuro con `prefers-color-scheme` y `data-theme`. Todo sale de tokens.

### Tipografía
- Texto: fuente del sistema (`--font-ui`). Cifras: Barlow Condensed (`--font-num`, clase `.num`).
- Tamaños en uso: 11, 12, 13, 14, 15, 16, 17, 20, 22, 24, 26, 34 px (12 valores).

### Forma y espacio
- Radios: `--r-card` 22 px, `--r-ctl` 999 px, `--r-sheet` 34 px; además aparecen 5, 6, 8, 10, 12, 14 y 16 px sueltos.
- Zona táctil `--tap` 44 px (48 px en Android).
- Dos «sabores» de plataforma: iOS (por defecto, con vidrio) y Android Material 3 (`data-os`).

### Movimiento
- Muelles `--spring` y `--spring-soft`; se respeta `prefers-reduced-motion`.

### Componentes existentes
| Componente | Para qué | Variantes |
|---|---|---|
| `card`, `card-h` | Contenedor de un tema; `card-h` es la etiqueta en mayúsculas | `tap` (toda la tarjeta es un botón), `hero` |
| `btn` | Acción | `fill` (principal), `tonal`, `plain`, `text`, `danger`, `wide` |
| `li` | Fila de lista con día, texto y estado | `today` |
| `chip` | Etiqueta de estado o filtro | colores por estado y deporte |
| `sheet` | Hoja inferior para ver o editar sin salir de la pantalla | |
| `dialog` (`ask`) | Confirmaciones | |
| `toast` | Aviso breve con acción de deshacer | |
| `seg`, `tab`, `tabbar` | Selector segmentado y navegación inferior | |
| `ring`, `bar`, `escala`, `chart`, `minibars` | Gráficas de progreso, rango y series | `est` = rayado, estimado |
| `met`, `tile`, `stat`, `bignum` | Cifras sueltas con etiqueta y estado | |
| `say` | Frase del entrenador (el porqué) | |
| `field`, `toggle-row`, `switch`, `radio`, `stepper` | Formularios | |
| `adapt`, `hp-encaje`, `coach-cambio` | Propuesta de cambio y si encaja | |

## 2. Reglas de uso (ya vigentes en `CLAUDE.md`)

1. Una acción principal por tarjeta (`btn fill`); el resto, `tonal` o `text`. Nunca dos rellenos juntos.
2. Un dato, un sitio.
3. Los estados llevan texto o icono además de color.
4. Texto con contraste mínimo 4,5:1. `--label-3` nunca para texto.
5. Zonas táctiles de 44 px. Encabezados en orden. Foco visible.
6. Lo que cambia algo se enseña antes y se puede deshacer; sin `alert`, `prompt` ni `confirm`.
7. Todos los colores salen de tokens.

## 3. A decidir (propuestas)

1. **Escala tipográfica cerrada.** Pasar de 12 tamaños a 6: 12 (apoyo), 14 (secundario), 16 (cuerpo), 20 (título de sección), 24 (cifra), 34 (título de pantalla). Mismos pesos: 400, 600, 700.
2. **Escala de radios cerrada:** 8 (elementos pequeños), 16 (bloques dentro de tarjeta), 22 (tarjeta), 999 (controles).
3. **Escala de espacio:** 4, 8, 12, 16, 24. Hoy hay valores sueltos.
4. **Un solo sabor de plataforma.** Mantener iOS y Android duplica cada decisión visual. Para la v1 conviene uno solo (con la misma lógica en ambos sistemas) y dejar Material para después.
5. **Tokens de componente.** Añadir una capa entre token y uso (por ejemplo `--card-pad`, `--chip-h`, `--row-h`) para cambiar un componente sin tocar todo el CSS.
6. **Identidad.** Hoy es el aspecto genérico de iOS: tarjetas blancas iguales, azul de sistema y sombras suaves. Para que se vea de myCoach, y no de una plantilla, la identidad se decide con el estudio de apps parecidas y se vuelca en tokens (color de acento, tipografía de cifras, densidad, tono de las ilustraciones), no en estilos sueltos.
7. **Catálogo vivo.** Una página `?componentes` que pinte cada componente con sus variantes, en claro y oscuro, para revisar el sistema de un vistazo.
8. **Nombres.** Hay clases con nombres de pantalla (`hp-`, `est-`, `pz-`, `mf-`). Pasar lo reutilizable a nombres de componente.
