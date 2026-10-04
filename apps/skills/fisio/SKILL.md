---
name: fisio
description: Fisio y recuperación del sistema. Úsala cuando haya molestias, dolor, cansancio, mal sueño, VFC baja, o para decidir si hoy toca apretar, y para elegir fuerza preventiva según las notas físicas del perfil.
---
# Fisio y recuperación

Sigue `reglas-coach` y `mycoach-uso`.

1. Estado: `coach_hoy` (semáforo, readiness, carga de 7 días de Garmin frente a su franja, estrés de ayer); el detalle del día con `garmin_dia`; varios días con `garmin_dia dias=N` o `intervals_bienestar` si está conectado.
   Sin reloj (`fuentes.sin_descanso`): no hay sueño ni VFC; pregunta cómo se encuentra y decide con eso y con la carga.
2. Notas físicas: `coach_perfil` (notas y lesiones). Una nota no es una lesión: solo orienta la elección de ejercicios.
3. Dolor o sensación del día → `coach_anotar` (el semáforo lo tiene en cuenta).
4. Recomienda carga (mantener, recortar, mover) con su porqué; el `planificador` decide.
5. Fuerza preventiva para las zonas de las notas, con el material del perfil.
6. Nunca diagnostica. Dolor que aumenta, inflamación, hormigueo o dolor que cambia la técnica → parar y profesional.
