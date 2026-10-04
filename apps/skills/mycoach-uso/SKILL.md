---
name: mycoach-uso
description: Cómo y cuándo usar las herramientas de myCoach/Garmin (coach_*, garmin_*, intervals_*, comida_*, peso_*, fuerza_*) con el mínimo de llamadas y tokens. Úsala SIEMPRE antes de llamar a cualquier herramienta de myCoach o Garmin, en cualquier conversación de entreno, comida, peso, sueño o recuperación.
---
# Uso eficiente de myCoach

## Principios
1. myCoach es la fuente de verdad del atleta (plan, perfil, peso, comidas, fuerza, decisiones). La memoria de Claude solo guarda cómo trabajamos.
2. Lee cada dato UNA vez por conversación. Si ya está en contexto, no lo vuelvas a pedir.
3. Pide agregados, no días sueltos (un rango > N llamadas de un día).
4. Nunca pidas capturas: stamina, pulso y gráficas salen de `garmin_activity_detail` (perfil de 24 tramos).
5. Lo planificado nunca se presenta como hecho: lo real sale de Garmin.
6. Usa solo el servidor del usuario con el que hablas; ignora los de otras personas (p. ej. Garmin-Paula).

## Qué llamar según la petición
| Petición | Llamadas (máx.) |
|---|---|
| ¿Qué hago hoy? / ¿puedo apretar? | `coach_hoy` (1) |
| Revisar o cambiar la semana | `coach_semana` → `coach_proponer` (validar) → con su sí, `guardar=true` → `coach_semana` para verificar (4) |
| Primer mensaje de entreno de la conversación | `coach_perfil` (1, solo si no está en contexto) |
| Analizar una actividad | `garmin_activities limit=3` → `garmin_activity_detail` (2); `intervals_actividad` solo si hace falta desacople o zonas |
| Sueño, VFC, readiness, estrés de un día | `garmin_dia` (1; con `partes` si solo hace falta una cosa) |
| Lo mismo en varios días | `garmin_dia dias=N` (1, la serie guardada) o `intervals_bienestar` (1) si Intervals está conectado (`intervals_estado` una vez) |
| ¿Me estoy pasando de carga? ¿Estoy en forma? VO2máx, umbral, FTP, predicciones | `garmin_forma` (1). La carga de hoy y su franja ya vienen en `coach_hoy` |
| ¿Estoy mejorando? | `coach_progreso` (1) |
| Peso | decirlo = `peso_registrar` confirm=true; comentar = `peso_historico` (tendencia de 7 días, no el dato de un día) |
| Comida | `comida_registrar`; consultar con `comidas` |
| Fuerza | `entrenos tipo=fuerza` antes de proponer; al reloj, `entreno_enviar_garmin tipo=fuerza`; al acabar `fuerza_desde_garmin` o `fuerza_registrar` |
| Series de bici o correr para el reloj | `entreno_enviar_garmin tipo=cardio` sin confirm (vista previa) → con su sí, confirm=true |
| Un dato de Garmin que ninguna herramienta trae (récords, material, zonas, planes de Garmin…) | `garmin_api` sin path (catálogo) → `garmin_api` con la ruta (2). Nunca digas que no lo tienes sin mirarlo |
| Ver la app | `mycoach_abrir`, no dibujar tarjetas propias |

## Sin reloj (solo un Edge)
Si `coach_hoy` trae `fuentes.sin_descanso: true`, su dispositivo no mide sueño ni VFC: no se los pidas a Garmin ni le preguntes por ellos. Pregunta cómo se encuentra y anótalo con `coach_anotar`; el semáforo decide con eso y con la carga.

## Cuándo NO llamar
- Preguntas generales (conceptos, técnica, recetas) sin datos personales.
- Datos que ya salieron en esta conversación.
- Comprobaciones "por si acaso" (`garmin_status` solo tras un error de autenticación).

## Escritura
- Toda escritura (plan, Garmin, perfil) se valida y se confirma con el usuario antes; tras escribir, se relee una vez para verificar.
- `coach_proponer` siempre con `porque` en una frase: es el registro de decisiones.

## Presupuesto
- Respuesta simple: ≤2 llamadas. Análisis: ≤5. Planificación semanal: ≤8.
- Si el presupuesto no basta, dilo y pregunta antes de seguir.
