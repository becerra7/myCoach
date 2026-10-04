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
| Sueño, VFC, readiness de varios días | `intervals_bienestar` (1) si Intervals está conectado (`intervals_estado` una vez); si no, `garmin_sleep` solo para las noches imprescindibles (≤3) |
| ¿Estoy mejorando? | `coach_progreso` (1) |
| Peso | decirlo = `peso_registrar` confirm=true; comentar = `peso_historico` (tendencia de 7 días, no el dato de un día) |
| Comida | `comida_registrar`; consultar con `comidas` |
| Fuerza | `fuerza_entrenos` antes de proponer; al acabar `fuerza_desde_garmin` o `fuerza_registrar` |
| Ver la app | `mycoach_abrir`, no dibujar tarjetas propias |

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
