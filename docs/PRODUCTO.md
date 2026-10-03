# myCoach: definición de producto (borrador para validar)

## En una frase

Tu entrenador personal de bolsillo: planifica y sigue tu entrenamiento, tu nutrición, tu rendimiento y tu estado físico, y se apoya en tu Garmin y en tu propio Claude para automatizar casi todo, incluidas las rutas.

## Para quién

Deportistas de resistencia aficionados, serios, en España: bici, correr y skimo, con fuerza como complemento. Tienen un reloj Garmin. Empezamos por el autor y sus amigos, pensando en abrirlo al público. El primer uso tiene que entenderse sin nadie al lado y sin Claude.

## Las seis áreas del producto

| Área | Qué resuelve | Lo que hace el usuario | Lo que automatiza el sistema |
|---|---|---|---|
| **Estado** | ¿Cómo estoy hoy? | Cuenta cómo se siente, anota molestias | Semáforo con sueño, VFC, readiness, pulso y frescura desde Garmin |
| **Plan** | ¿Qué toca y cuándo? | Revisa y ajusta la semana | Propone la semana según objetivo, estado y calendario; reajusta si cambia algo |
| **Entreno** | ¿Qué hago en la sesión? | Entrena | Series para el reloj, entrenos de fuerza con progresión, envío a Garmin |
| **Nutrición** | ¿Qué como y cuándo? | Dice lo que ha comido (foto o texto) | Reparto de la comida del día según la carga (desayuno, comida, merienda, snack, cena y durante el entreno) |
| **Rendimiento** | ¿Estoy mejorando? | Mira la evolución con calma | Métricas por deporte, peso, test, explicación de cada métrica |
| **Rutas** | ¿Por dónde salgo? | Pide una ruta y la revisa | Traza la ruta por carretera real, mide distancia y desnivel, la guarda en Garmin; pueblos visitados |

El eje que une todo es **Hoy**: estado + plan + nutrición del día, relacionados entre sí.

## Cómo se relacionan (la lógica del producto)

- **Estado → Plan.** Si el semáforo no está verde, la sesión de hoy se adapta (más suave o descanso). El motor lo propone, el usuario lo acepta o no.
- **Plan → Nutrición.** La carga de la sesión de hoy decide cuánto hidrato lleva cada comida y qué se toma durante el entreno.
- **Entreno hecho → Estado y Plan.** Lo que dice el reloj actualiza la carga, el estado de mañana y si se cumplió el plan.
- **Peso y rendimiento → Plan.** La tendencia ajusta objetivo y carga (sin culpa).
- **Rutas → Plan y Pueblos.** Una ruta se vincula a una sesión del plan y, al hacerla, suma pueblos.

## Principios

1. **Hoy primero:** cada pantalla responde una pregunta; Hoy, "¿qué hago hoy y por qué?".
2. **Explicar, no volcar datos:** resumen compacto y el detalle a un toque.
3. **Claude es el camino rápido:** todo lo que se hace en la app se puede pedir a Claude, y lo que hace Claude se ve en la app.
4. **Sin culpa:** progreso y motivación sin castigar lo no hecho; sin calorías.
5. **Un dato, un sitio.**
6. **El método vive en el conector** (`coach_*`): la app lo enseña, no lo recalcula.

## Fuera de alcance en la v1

Planificar deportes distintos de bici, correr, skimo y fuerza (cuentan como carga). Dietas con calorías. Diagnóstico médico (ante dolor se baja la carga y se recomienda un profesional).

## Decisiones abiertas

- Suscripción para quien no tenga Claude.
- Notificaciones push.
- Enlaces a contenido que explique las métricas.
- Si Rutas y Nutrición tienen pestaña propia o viven dentro de Hoy y Plan.
