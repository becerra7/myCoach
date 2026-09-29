# Fuerza en myCoach

## Lo que hay (29 de septiembre)

Versión sencilla, liderada por Claude con el conector:
- **Claude propone la sesión**: ejercicio, series × reps (o segundos), peso, material y descanso. La guarda como **entreno con nombre** (`fuerza_entreno_guardar`) para repetirla. En el plan, el día de fuerza apunta a él (`entreno: "pierna-a"`).
- **Al reloj** (`fuerza_enviar_garmin`, con permiso): se crea como entreno de fuerza guiado en Garmin Connect y se programa para el día. Cada ejercicio lleva su nombre del catálogo de Garmin (`fuerza_ejercicios_garmin`, que busca en castellano), así que el reloj sabe qué grupos trabajas.
- **Al acabar**: si la hiciste con el reloj, las series que cuenta (reps y peso) cierran la sesión solas (`fuerza_desde_garmin`). Si no, le dices a Claude solo lo que cambió (`fuerza_registrar`). Si subiste peso o reps, te pregunta si lo deja así para la próxima.
- **Histórico** por ejercicio (`fuerza_historial`), sume de qué entreno sume.
- **En la app** (Hoy y la hoja del día en Plan): antes, cada ejercicio con su objetivo y lo que hiciste la última vez, y el botón "Enviar al reloj". Después, plan frente a lo hecho. Tocando un ejercicio, su histórico. No se marcan series en la app, por decisión.

Lo de abajo es la investigación y la propuesta más ambiciosa, que queda para más adelante.

## Investigación y propuesta

Estado: propuesta, sin construir. Objetivo: que la sesión de fuerza diga **qué ejercicios, series, repeticiones y peso o material**, en **casa o en el gimnasio**, lo más automático posible, y que sirva para ir **alternando ejercicios y zonas del cuerpo**. Sin complicarse.

## 1. Cómo lo resuelven otras apps

| App | Qué hace bien | Qué tomamos |
|---|---|---|
| **Fitbod** | Genera cada sesión con tu objetivo, tu material (perfiles de equipo), el tiempo que tienes y tu historial. Evita los músculos que no se han recuperado y sube el peso a partir de lo que registraste. | Perfiles de material (casa, gym). Elegir ejercicios por lo que llevas sin hacer. Subir peso con tu registro. |
| **Hevy / Strong** | Registro rápido: al lado de cada serie enseñan "la última vez" (peso × reps). | Enseñar la última vez como guía del peso de hoy. |
| **Runna, TrainerRoad, Built to Endure** | La fuerza es un complemento del plan de resistencia: 20-40 min, versión casa y gym, periodizada con la temporada. | Mismo enfoque: fuerza para rendir y no lesionarse, no culturismo. |
| **Garmin** | El reloj cuenta repeticiones y guarda cada serie (ejercicio, reps, peso) en la actividad de fuerza. También se pueden mandar sesiones de fuerza al reloj, que te guía serie a serie. | Leer las series del reloj para registrar solo. Más adelante, mandar la sesión al reloj. |

Lo que **no** copiamos (complica mucho y aporta poco a un deportista de resistencia): 1RM estimado por ejercicio, mapa de recuperación músculo a músculo, decenas de ejercicios por grupo.

## 2. Propuesta

### Catálogo corto (unos 40 ejercicios)
Cada ejercicio tiene:
- **Patrón:** sentadilla, bisagra de cadera, una pierna, empuje, tirón, core, y gemelo y tobillo.
- **Zona:** pierna, cadera y glúteo, core, tren superior.
- **Material:** peso corporal, banda, mancuernas, kettlebell, barra, máquina.
- **Variante de casa y de gym:** por ejemplo, sentadilla goblet con mancuerna frente a sentadilla con barra.
- **Categoría de Garmin**, para leer y mandar series al reloj.

### Sesión tipo (5-6 ejercicios, 30-45 min)
- **Ejercicios:** uno de rodilla (sentadilla), uno de cadera (peso muerto rumano o puente), uno a una pierna (búlgara o zancada), un empuje, un tirón y core. Para correr y skimo se añade gemelo y tibial.
- **Rotación automática:** en cada patrón se elige la variante que más tiempo llevas sin hacer, y se alternan sesión A y B. Así se varía solo.
- **Casa o gym:** se elige en la propia sesión, con un interruptor. Por defecto, lo que sueles usar ese día de la semana. Cada ejercicio cambia a su variante con el material disponible.

### Series, repeticiones y peso
- **Esfuerzo:** se da en repeticiones en reserva (RIR). Por ejemplo, "3 × 8, que te sobren 2". Vale sin saber tu máximo y en casa.
- **Según la temporada:**
  - Base: 3 × 8-10, RIR 2-3.
  - Temporada de competición: 2-3 × 4-6 pesado, RIR 3, para mantener sin cansar.
  - Vuelta tras un parón: 2 × 10-12 suave.
- **Peso:** la primera vez, "elige un peso con el que te sobren 2-3". Después se usa la **doble progresión**:
  - Primero subes repeticiones dentro del rango.
  - Cuando haces todas las series en lo alto del rango, subes peso (+2,5 kg con barra, el siguiente par de mancuernas o una banda más dura).
  - Con peso corporal: más repeticiones o una variante más difícil.
- **Con el semáforo y el plan:**
  - Ámbar: 2 series en vez de 3.
  - Rojo: movilidad y core.
  - Nada de pierna pesada en las 24-48 h antes de un día de series o de fondo largo. Esto ya lo aplica el motor del entrenador.

### Registro casi automático
1. Si la haces con el reloj en modo fuerza, **se leen las series de Garmin** (ejercicio, reps, peso) y se marca hecha, sin tocar nada.
2. Si no, con un toque: "Hecha como estaba", o se corrige el peso o las reps del ejercicio que cambió.
3. Con eso sale la próxima sesión (más peso, más reps o otra variante) y el **balance por zonas**. Por ejemplo: "Llevas 3 semanas sin tirón: el jueves toca remo".

### Dónde vive cada cosa
Según las reglas del repo, el método vive en el conector:
- **Conector:** `coach_fuerza` genera la sesión (casa o gym), `coach_fuerza_registrar` guarda lo hecho, y se leen las series de Garmin (`exerciseSets`). Así la web y tu Claude dan la misma sesión.
- **Web:** la sesión del día con el interruptor casa/gym, y el registro de un toque. En Forma, el balance por zonas.

## 3. Por fases
1. **Sesión detallada:** catálogo, generador casa/gym, sesión en Hoy y Plan, y herramienta para Claude.
2. **Registro y progresión:** series del reloj, registro de un toque, doble progresión y balance por zonas.
3. **Al reloj** (opcional): mandar la sesión a Garmin como entreno de fuerza guiado. Escribe en tu cuenta, así que irá con tu permiso.

## 4. Preguntas abiertas
- Material en casa: ¿mancuernas (hasta qué peso), kettlebell, bandas, barra de dominadas?
- Para qué es la fuerza: ¿rendir en bici y montaña, prevenir lesiones (rodilla, espalda), o las dos?
- ¿Usas el modo fuerza del reloj? Si no, el registro sería de un toque.

## Fuentes
- [Cómo genera Fitbod los entrenos](https://fitbod.me/blog/fitbod-algorithm/)
- [Progresión de carga en Fitbod](https://fitbod.me/blog/what-is-progressive-overload-and-how-fitbod-builds-it-into-every-workout-automatically/)
- [Fuerza para corredores en Runna](https://www.runna.com/training/strength-training)
- [Built to Endure: fuerza para corredores y ciclistas](https://www.builttoendure.pro/built-to-endure-app)
- [python-garminconnect: series de fuerza y entrenos de fuerza](https://github.com/cyberjunky/python-garminconnect)
