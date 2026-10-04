# Catálogo de features de myCoach

Cada tarjeta, pantalla y flujo de la app, con cómo funciona hoy y una **propuesta** de decisión para el roadmap. La columna "Decisión" es mía y está sin validar: **Quedarse** (ya vale), **Mejorar**, **Borrar**, **Añadir** (no existe) o **Futuro**.

Leyenda de estado: ✅ completa · 🟡 a medias · 🧪 solo demo o maqueta · 💀 código muerto.
Fuentes: *Garmin* (`garmin_*`), *Coach* (`coach_*` del conector), *Local* (estado de la app, `localStorage` y doc `estado/app`), *Demo* (`demo.json`).
El inventario salió de leer el código con un agente; los puntos marcados ✔ los he comprobado yo.

---

## A. Estado (cómo estoy)

| Feature | Cómo funciona hoy | Datos | Estado | Decisión |
|---|---|---|---|---|
| Semáforo (tarjeta de Hoy) | Veredicto verde, ámbar o rojo con el porqué, y "Ver los 5 datos" (readiness, sueño, VFC, pulso, frescura). Cada dato abre una hoja que explica qué es y cómo lo lee el entrenador | Coach (`coach_hoy`); Demo inventado | ✅ | Quedarse |
| Hoja de métrica | Qué es, de dónde sale, regla del entrenador, escala de frescura | Coach | ✅ | Quedarse |
| Cómo te encuentras | Caras de ánimo y físico (1-5), dolor en texto, "Ya no me duele". Una entrada por día, editable | Coach (`coach_anotar`) | ✅ | Quedarse; añadir que el dolor afecte visiblemente al plan |
| Readiness de respaldo (`cardReadiness`) | Si no hay semáforo, muestra el readiness de Garmin con aro, sueño y VFC | Garmin | ✅ duplicada | Borrar cuando el semáforo cubra el estado "sin datos de la noche" |
| Aviso "tu plan de hoy no encaja" | Reglas locales sobre el readiness; ofrece suave, descanso o mantener | Local | 🟡 duplica a la propuesta del coach; asume bici | Borrar (lo cubre el semáforo con su propuesta) |

## B. Plan (qué toca y cuándo)

| Feature | Cómo funciona hoy | Datos | Estado | Decisión |
|---|---|---|---|---|
| Hoy y esta semana | Sesión de hoy, "encaja con tu estado" (hecho, ya has entrenado, mejor ajustarla con antes → después, encaja), tira de 7 días con hecha, no hecha y hoy | Local + Garmin + Coach | ✅ | Quedarse |
| Aplicar el cambio propuesto | Guarda la propuesta del entrenador (`coach_proponer`) y se puede deshacer | Coach | ✅ | Quedarse |
| Aviso de semana sin preparar | "Aún no has preparado esta semana" o, de viernes a domingo, "Prepara la semana que viene" | Local | ✅ | Quedarse |
| Selector de semanas | 8 pasadas, la actual y la próxima, con horas y minibarra por deporte | Garmin + Local | ✅ | Quedarse |
| Planificador de semana | Deportes, horas (3-12 h) y "Proponer semana" (reglas locales, sin IA) o "Con Claude" | Local | ✅ pero el método está en la web | Mejorar: que proponga el conector; la web solo lo enseña |
| Lista de días de la semana | Plan frente a hecho, "Plan: tipo" si no coincide, no hecho, planeado, agenda ocupada | Local + Garmin | ✅ | Quedarse |
| Semana pasada (revisión) | Horas, actividades, días activos, % del plan, insights. Solo lectura | Garmin + Local | ✅ | Quedarse |
| "Lo que necesitas" y "Lo que dice tu semana" | Reparto cardio, fuerza, intensidad y juego frente al objetivo; insights plegados | Local | ✅ | Mejorar: un solo sitio, el detalle en hoja |
| Hoja del día | Ver actividad, mover, cambiar por otra cosa, poner entreno de fuerza, series de cardio, enviar al reloj | Local + Coach | ✅ | Quedarse |
| Marcar como hecha | Solo muestra un aviso, no guarda ✔ | — | 🟡 | Borrar (lo marca el reloj) o hacer que guarde |
| Mover sesión | Intercambia días respetando el máximo de intensos | Local | ✅ | Quedarse |
| Cambiar por otra cosa | Deporte, duración, suave, medio o fuerte, texto; "Guardar y reajustar" | Local | ✅ reglas simples | Mejorar: que reajuste el conector |
| Calendario iCal | Enlace privado; respeta huecos de 6 a 22 h al planificar. Solo web | Local | ✅ solo web | Quedarse; Futuro: mostrar el calendario en el Plan |
| Objetivo | 4 modos (forma, reto, mejorar, volver), fecha, deporte, modo pro con horas, intensos y fuerza | Local | ✅ | Mejorar: darle un sitio visible en la navegación |
| `cardSemana`, `cardObjetivo` grande | Sin uso | — | 💀 | Borrar |

## C. Entreno (la sesión)

| Feature | Cómo funciona hoy | Datos | Estado | Decisión |
|---|---|---|---|---|
| Bloque de fuerza del día | Ejercicios con series × reps, kg, material, descanso, última vez y estado frente al plan. Tocar un ejercicio abre su historial. **La app no marca series**: las cuenta el reloj o Claude | Coach (`fuerza_dia`) | ✅ | Mejorar: caso 2 (durante el entreno) está sin cubrir |
| Enviar fuerza al reloj | Comprueba que cada ejercicio tenga su equivalente Garmin, confirma y envía | Coach (`entreno_enviar_garmin`) | ✅ | Quedarse |
| Tus entrenos (librería) | Entrenos de fuerza con nombre más series de bici y correr | Coach | ✅ | Mejorar: acceso desde la navegación, no desde enlaces sueltos |
| Editor de entreno de fuerza | Nombre, casa o gimnasio, ejercicios, series, reps, kg, descanso, duplicar, borrar. No se puede crear desde cero | Coach | ✅ | Añadir: crear desde cero |
| Series de bici y correr | Pasos del día y "Enviar al reloj". Solo lectura | Coach (`cardio_*`) | ✅ | Añadir: crear y editar en la app |
| Actividad (cómo ha ido) | Cifras, plan frente a lo hecho, cómo cuenta en tu semana, lo mejor de la salida, mapa, pueblos nuevos; en fuerza, por ejercicio. "Corregir" el tipo | Garmin (`garmin_activity_detail`) | ✅ | Mejorar: hacerla el sitio único de "cómo ha ido" |
| Corregir tipo de actividad | Cambia suave, fondo, tempo o intenso; solo local | Local | ✅ | Quedarse |
| Test de subida | 20 min a tope, datos a mano, calcula W/kg y umbral | Local | ✅ manual | Mejorar: leer la actividad de Garmin |
| Test de 5 km | Solo un aviso | — | 🧪 | Borrar o Futuro |

## D. Nutrición

| Feature | Cómo funciona hoy | Datos | Estado | Decisión |
|---|---|---|---|---|
| Tarjeta Comida (en Hoy) | Día duro, moderado o suave según la sesión → "la mitad, algo más de un tercio o un cuarto de cada plato, carbohidrato". "Llevas N comidas" | Local (reglas fijas) | 🟡 etiquetada "En investigación" | Mejorar: mostrar las comidas del día |
| Pantalla Comida | Hoy (objetivo frente a lo registrado), semana (carbohidrato por día), "qué comer los próximos días", registradas, nota metodológica | Local | 🟡 | Mejorar |
| Añadir comida | Foto (solo dentro de Claude), "Desde Claude", tipo (desayuno, comida, merienda, cena, tentempié, durante el entreno), cuartos de carbohidrato, proteína y verdura, texto | Local | 🟡 | Mejorar |
| Registro con Claude | Claude guarda con `comida_registrar` | Coach | ✅ en Claude | ✔ **La web no lee `comidas`**: lo que apunte Claude puede no verse |
| Plan de comidas del día (desayuno, comida, merienda, snack, cena) | No existe: solo hay proporciones por día | — | ❌ | Añadir (pilar de la v1) |
| Comida durante el entreno | Solo el consejo de 60-90 g/h en días duros | Local | 🟡 | Mejorar: ligarlo a la sesión concreta |
| Editar y borrar comidas | No existe | — | ❌ | Añadir |
| Hidratación | No existe | — | ❌ | Futuro |

## E. Rendimiento (¿estoy mejorando?)

| Feature | Cómo funciona hoy | Datos | Estado | Decisión |
|---|---|---|---|---|
| Forma general | Nota /10, tipo de deportista, ver evolución, compartir | Garmin + cálculo en la web | ✅ pero el método está en la web | Mejorar: usar `coach_progreso` |
| Común a todos (motor, fondo, volumen, equilibrio) | Barras con marcas; rayado si es estimación; cada una abre una hoja con el porqué y cómo mejorar | Garmin | ✅ | Quedarse |
| Detalle por deporte | Km, desnivel, VAM, mejor llano, W/kg estimado, VO2máx, Hill, pulso | Garmin | ✅ | Quedarse |
| Evolución | Horas por semana por deporte, Endurance, VO2máx, minutos suaves, Hill | Garmin | ✅ | Quedarse |
| Peso | Último, media de 7 días, cambio a 30 días y 3 meses, gráfica, tabla. **Solo lectura**: se registra con Claude o la báscula | Garmin | ✅ lectura | Añadir: registrar peso en la app |
| Ficha para compartir | Maqueta; el botón solo muestra un aviso | Local | 🧪 | Futuro (o borrar de la v1) |
| Enlaces que explican las métricas | No existen | — | ❌ | Futuro |

## F. Rutas y pueblos

| Feature | Cómo funciona hoy | Datos | Estado | Decisión |
|---|---|---|---|---|
| Mapa de pueblos | Municipios cruzados por comunidad, España o Mundo, por deporte; lista por kilómetros con buscador | Garmin (`garmin_activity_route`) + IGN | ✅ (Mundo solo países) | Quedarse |
| Mapa a pantalla completa | Zoom, ficha del pueblo con km por deporte y primera vez. "Núcleos: pendiente de OpenStreetMap" | Garmin | 🟡 | Mejorar: quitar el texto pendiente |
| Banner "+3 pueblos" | Aviso de actividad nueva | Demo | 🧪 | Mejorar: hacerlo real tras sincronizar |
| **Planificar una ruta de bici** | No existe en la app. Claude puede hacerlo con `garmin_plan_route` | Coach | ❌ | Añadir: ver y revisar rutas en la app |
| **Revisar rutas guardadas** | No existe (`garmin_courses`) | Coach | ❌ | Añadir |
| Ruta de cada sesión del plan | Texto inventado por el generador ("80 km por el Vallès") | Local | 🟡 | Mejorar: ruta real ligada a la sesión |

## G. Claude y plataforma

| Feature | Cómo funciona hoy | Estado | Decisión |
|---|---|---|---|
| Chat con Claude | Con Claude: propone cambios y se aplican o descartan. Sin Claude (web): respuestas de ejemplo | 🧪 en la web | Mejorar: en la web, solo "Hacerlo en mi Claude" |
| "Hacerlo en mi Claude" | Copia el encargo y abre claude.ai | ✅ | Quedarse |
| Onboarding (6 pasos) | Cuenta, Garmin, deportes, "qué ver primero", IA, preparación. Los pasos 3 y 5 son decorativos | 🟡 | Mejorar: quitar los pasos que no hacen nada |
| Vincular Garmin | Email, contraseña, código MFA; volver a vincular; desvincular. Solo web | ✅ | Quedarse |
| Intervals.icu | ID y clave; conectar y desconectar | ✅ | Quedarse |
| Cuenta de myCoach | Contraseña y cerrar sesión. Solo web | ✅ | Quedarse |
| Ajustes | Cuenta, conexiones, entrenador, deportes, preferencias, versión | ✅ | Mejorar: agrupar por qué quiere hacer el usuario |
| Sincronización | Readiness, actividades, detalles, rutas, evolución; caché local | ✅ | Mejorar: estado de espera de hasta 11 s sin contenido útil |
| Panel de prototipo (`?proto`) | 12 flujos de validación | ✅ solo prototipo | Borrar de producción |

---

## Cómo se relacionan (a nivel teórico) y qué muestra Hoy

Hoy es el sitio donde se juntan estado, plan y nutrición. Lo ideal:

1. **Estado** (semáforo y por qué).
2. **Sesión de hoy** con "encaja o no" y su antes → después. Si ya la hiciste, un resumen de cómo ha ido.
3. **Nutrición del día**: desayuno, comida, merienda, snack y cena, con el reparto que pide la sesión de hoy (y qué llevar durante el entreno). Hoy solo hay una frase y las proporciones.
4. **Esta semana** en 7 días.

| Dato de origen | Alimenta a |
|---|---|
| Sueño, VFC, readiness, "cómo me encuentro" | Semáforo → ajuste de la sesión de hoy y de los días siguientes |
| Sesión del plan (tipo y duración) | Nutrición del día y durante el entreno |
| Actividad hecha (reloj) | Estado de mañana, cumplimiento del plan, carga de la semana, pueblos nuevos |
| Peso y rendimiento | Objetivo y carga del plan |
| Ruta | Sesión del plan y pueblos |

## Huecos que no cubre ninguna feature hoy

- Nutrición como plan del día por comidas (no solo proporciones).
- Rutas dentro de la app.
- Registrar peso y editar comidas en la app.
- Seguir la sesión de fuerza durante el entreno (marcar series).
- Notificaciones y enlaces que expliquen las métricas (ya anotados como decisión abierta).

## Para limpiar antes de la v1 (código muerto o decorativo)

`cardSemana`, `cardFuerzaHoy`, `cardObjetivo` grande, variantes del panel de prototipo, paso "qué ver primero", checks falsos de "Preparando tu app", "Marcada como hecha", test de 5 km, botón de compartir.
