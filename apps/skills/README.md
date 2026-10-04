# Skills de Claude para myCoach

Las skills que usa tu Claude con el conector de myCoach: cómo hablar, qué
herramienta llamar en cada caso y cómo se reparten el trabajo los roles
(planificador, entrenador, analista, fisio, nutricionista).

**El repo es la fuente de verdad.** Se cambian aquí, en el mismo cambio que
toca el conector, y luego se suben a Claude.

| Skill | Para qué |
|---|---|
| `reglas-coach` | Reglas base: datos, evidencia, seguridad y formato. Va antes que las demás. |
| `primeros-pasos` | Para quien empieza o tiene el perfil a medias: le conoce de una pregunta en una, le explica la app sin tecnicismos y tira de él con un siguiente paso. |
| `mycoach-uso` | Qué herramienta llamar según la petición, con el mínimo de llamadas. |
| `planificador` | Orquesta los roles y es el único que escribe el plan. |
| `entrenador` | Sesiones y reparto entre deportes, con especialistas por deporte. |
| `analista` | Análisis de una actividad hecha. |
| `fisio` | Recuperación, molestias y si hoy toca apretar. |
| `nutricionista` | Comida, hidratación y peso. |
| `registro-comida` | Guardar una comida a partir de una foto o de lo que cuenta el usuario. |
| `tono-adaptativo` | Tono, humor y longitud según el momento. Cada usuario edita su bloque de configuración. |

## Subirlas a Claude

1. `npm run skills` deja un `.zip` por skill en `apps/skills/dist/`.
2. En claude.ai, Ajustes, Capacidades, Skills: sube cada `.zip`, sustituyendo la versión que ya tengas con el mismo nombre.

## Reglas

- **Nada personal.** Los datos del deportista viven en myCoach (`coach_perfil`), no en las skills.
- **Solo herramientas que existen.** `tests/skills.test.mjs` falla si una skill nombra una herramienta que el conector no tiene. Al renombrar o juntar herramientas, se cambian aquí también (ver "Convenciones de las herramientas" en `apps/conector/README.md`).
- **Cada skill en su carpeta**, con `SKILL.md` y la cabecera `name` (igual que la carpeta) y `description`.
