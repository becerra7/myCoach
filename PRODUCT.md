# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(PWA en el móvil, web en el ordenador y la misma app dentro de Claude como MCP App. Mismo código para las tres.)

## Users

Deportistas de resistencia aficionados, serios, en España: bici (carretera, gravel, MTB), correr (asfalto y trail) y skimo, con la fuerza como complemento. Tienen un reloj Garmin. Empezamos por el autor y sus amigos, pero se diseña ya pensando en abrirlo al público: el primer uso tiene que entenderse sin nadie al lado, y también sin Claude.

Momentos de uso, todos confirmados:
- **Por la mañana**: "¿qué toca hoy y por qué?", un vistazo rápido antes de entrenar.
- **Durante el entreno**: con el móvil al lado, sobre todo en fuerza (ejercicios, series, peso).
- **Después**: cómo ha ido la actividad y si se cumplió el plan.
- **Planificar la semana**: un rato tranquilo para montarla o ajustarla.
- **Con calma**: ver estadísticas y cómo progresa en cada deporte con métricas claras. Más adelante, con enlaces a información que explique esas métricas.

## Product Purpose

Un entrenador multideporte que lee tu Garmin, decide con método (semáforo de cómo estás, reglas del plan) y te explica el porqué en una frase. Planificar tiene que ser fácil, y el histórico de progreso va ligado a métricas que te ayudan a mejorar. Éxito: que abras la app, sepas qué hacer hoy sin pensar, y veas que mejoras.

## Positioning

Lo que no tienen Garmin Connect ni otras apps, todo a la vez:
- **Un entrenador que te explica**: decide con método y te dice por qué; no es un panel de datos.
- **Todo tu deporte en un sitio**: bici, correr, skimo y fuerza con un plan que encaja con tu vida.
- **Tu propio Claude como entrenador (foco principal)**: hablas con tu Claude y ve lo mismo que la app. Te crea entrenos y el plan, los manda a tu Garmin, te traza rutas de bici a partir de lo que charláis. Sin pagar otra IA.
- **Motivación sin presión**: progreso, forma y pueblos visitados, sin culpa.

## Operating Context

- Datos de Garmin por el conector propio (`garmin-mcp`, herramientas `coach_*`, `fuerza_*`, `garmin_*`); opcionalmente Intervals.icu.
- El método (semáforo, reglas del plan) vive en el conector: la app lo enseña, no lo recalcula.
- Claude (claude.ai, app móvil y escritorio) con el conector: conversación, entrenos, rutas y envío al reloj. Dentro de Claude, la app se abre como pantalla; allí se habla en la conversación, no en la app.
- Cuenta propia de myCoach (email y contraseña); Garmin e Intervals se vinculan como fuentes.

## Capabilities and Constraints

- Se planifican bici, correr y skimo, y fuerza como complemento. El resto de deportes cuenta como carga pero no se planifica.
- Fuerza: entrenos con nombre (librería editable), registro, histórico por ejercicio, envío al reloj como entreno guiado, cierre con las series que cuenta el reloj.
- Todo lo que cambia algo se enseña antes (antes → después) y se puede deshacer. Nada de `prompt()`, `alert()` ni `confirm()`.
- Castellano de España, tuteando, frases cortas; los botones dicen lo que pasa.
- Un único HTML por destino (web, Claude); sin framework. Tokens de color, radio y tipografía en `apps/web/src/app.css`.
- Avisos push en la web: el semáforo de la mañana y, el domingo, semana sin plan o sin menús (ver la decisión 23 de `docs/PLAN-COACH.md`).
- Sin decidir: suscripción para quien no tenga Claude; enlaces a contenido que explique las métricas.

## Brand Commitments

- Nombre: myCoach. El entrenador se puede renombrar (por defecto "myCoach").
- Voz: como un compañero que sabe; siempre el porqué en una frase; una recomendación, no un abanico; dice cuándo un dato es estimado; sin calorías ni culpa con la comida; ante dolor, baja la carga y recomienda un profesional.

## Evidence on Hand

- Datos reales del autor (actividades, sueño, VFC, readiness, plan) por el conector; datos de ejemplo en `apps/web/src/demo.json`.
- No hay usuarios externos, testimonios ni métricas de uso todavía: no inventarlos.

## Product Principles

1. **Hoy primero**: cada pantalla responde a una pregunta; Hoy responde "¿qué hago hoy y por qué?".
2. **Explicar, no volcar datos**: resumen compacto y el detalle a un toque.
3. **Claude es el camino rápido**: todo lo que se puede hacer en la app se puede pedir a Claude, y lo que Claude hace se ve en la app.
4. **Sin culpa**: progreso y motivación sin castigar lo que no se hizo.
5. **Un dato, un sitio**.

## Accessibility & Inclusion

WCAG 2.2 AA: color nunca como único medio, contraste 4,5:1, zonas táctiles de 44 × 44 px, encabezados en orden, foco visible y todo usable con teclado, `prefers-reduced-motion` y modo oscuro.
