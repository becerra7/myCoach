# Agenda, plan de comidas y app de pareja: análisis y propuesta

_Octubre 2026. Análisis conjunto de arquitectura, producto, planificador y nutricionista._

> **Decidido (4 de octubre de 2026)**
> - **Primero, compromisos.** El cambio grande de la agenda se comparte antes de hacerlo: ver `docs/PLAN-COMPROMISOS.md`.
> - **Comidas, en simple.** Sin base de datos de alimentos, sin catálogo y sin plan semanal por ahora. Claude estima el valor nutricional, como hoy, y una comida se puede **guardar como plato** (un sofrito, tu desayuno de siempre) con sus ingredientes y valores. La próxima vez Claude la reutiliza sin preguntar qué lleva. Sustituye al apartado 4 y a las fases 2 y 3.
> - **La app de pareja será marca propia: myLuv.** No es prioridad ahora. Hay que dejar abierto que en el futuro crucen datos con myCoach (compromisos, plan, comidas) y pensar cómo compartir el conector sin que afecte a quien no la use.

## 1. Resumen

| Idea | Veredicto | Dónde vive |
|---|---|---|
| **A. Compromisos que impiden entrenar** (viaje, cena, turno, cuidar a alguien) | **Sí, ya.** Es disponibilidad, no una lista de tareas. Arregla además una deuda: hoy el motor no ve la agenda. | myCoach, en el conector (`agenda`, `agenda_anotar`) |
| **B. Plan semanal de comidas + librería de platos** | **Sí, después de A.** Platos que te gustan repartidos según la carga del día. Valor nutricional guardado, pero se enseña en cuartos de plato y código de hidrato, sin kcal. | myCoach (`comida_*`) |
| **C. App de pareja** (tareas de casa, turnos, agenda común, ver el plan del otro) | **Sí como producto aparte, pero al final y probándolo solo con vosotros dos.** Mercado saturado y barato; lo distinto es el reparto de la carga mental y que el Claude de cada uno hable con el hogar. | "Hogar": otra web, **mismo Worker, misma cuenta y mismo conector** (`hogar_*`) |

Por qué el mismo conector: Claude Free solo admite **un** conector personalizado. Si el hogar tuviera su propio MCP, quien use Free tendría que elegir entre los dos.

## 2. Lo que hay hoy (y falla)

- **El motor no sabe nada de la agenda.** El iCal se guarda en la sesión de la web (`apps/worker/src/index.js:145-170`) y quien coloca las sesiones en los huecos es el navegador (`apps/web/src/35-agenda.js:36-52`). `validarSemana` (`apps/conector/worker.js:3914`), `calcularHoy` (`:3865`) y `diaParaMover` (`:3704`) lo ignoran. Tu Claude planifica sin ver tu calendario. Va contra "la web enseña, no recalcula".
- **Fallo:** `huecos()` descarta los eventos de día entero (`35-agenda.js:17`). Un viaje apuntado como "todo el día" **no bloquea nada**.
- `aplicarAgenda` solo corre al generar una semana nueva; si luego entra un evento o un cambio por `coach_proponer`, no se vuelve a comprobar. Al mover una sesión no mira si quedan dos intensos seguidos.
- `perfil.disponibilidad` se puede guardar (`worker.js:4260-4285`), pero nadie la lee. Una nota "tengo cena el martes" en `coach_anotar` no cambia el plan.
- Comida: solo cuartos de plato por comida (`worker.js:6592-6680`); el objetivo según la carga lo calcula la web (`63-v1-hoy.js:92`, `50-pueblos-comida-claude.js:34-40`). No hay platos, plan semanal ni lista de la compra.

## 3. A. Compromisos y disponibilidad

**Modelo** (KV `app:<id>:agenda/compromisos`):

```
{ id, fecha, hasta?, de?, a?, todo_dia, tipo: viaje|trabajo|social|familia|salud|casa|otros,
  titulo, efecto: bloquea|limita|solo_suave, min_max?, carga: 0-3, trasnoche?, sin_material?,
  repite?: { dias, hasta }, origen: manual|ical|hogar, ref_hogar? }
```

**Cómo los trata el motor:**

| Tipo | Plan | Nutrición | Recuperación |
|---|---|---|---|
| Día bloqueado (viaje, boda, guardia) | La sesión clave se mueve; la de relleno se quita | Día de hidrato bajo; avituallamiento si viajas | Cuenta como descanso, salvo que canse |
| Hueco reducido (solo 45 min) | Clave: mejor moverla que recortarla. Series cortas, nunca "fondo de 45" | Según lo que quede | — |
| Fatiga no deportiva (turno de noche, mudanza, limpieza fuerte) | Ese día y el siguiente, nada intenso | Comidas regulares, proteína | Suma al semáforo |
| Cena o alcohol | Al día siguiente, nada intenso ni el fondo | Agua; hidratos al día siguiente si hay sesión | La víspera cuenta como peor sueño |
| Viaje sin bici / otra zona horaria | Cambia a correr o fuerza sin material; suave 1-2 días con jet lag | Comer a la hora local | — |

**Reglas de replanificación:**
1. Prioridad: fondo largo y series > tempo > fuerza > relleno.
2. Orden: mover > recortar manteniendo el estímulo > cambiar de deporte > quitar.
3. Siguen valiendo las reglas de siempre (máximo de intensos, nunca dos seguidos, semáforo) y se añaden `dia_bloqueado`, `no_cabe`, `intenso_tras_cena`, `intenso_tras_fatiga`.
4. Si la semana pierde más del 40 % de horas, es semana de descarga: no se recupera apretando el resto.
5. Se enseña "He movido las series del martes al jueves porque tienes cena" (antes → después), se aplica con tu sí y se puede deshacer. Si borras el compromiso, se ofrece volver al plan anterior.
6. Sin culpa: un día bloqueado no cuenta como "no hecho".

**Conector:**
- El enlace iCal pasa de la sesión web a `app:<id>:agenda/fuente` (cifrado) y `ics.js` lo usa el conector. Se arregla lo del día entero.
- `disponibilidad(fecha)` junta perfil + compromisos + iCal → `{ bloqueado, min_libres, solo_suave, motivos }`.
- Herramientas: `agenda` ("¿cuándo puedo entrenar?": compromisos y huecos de un rango), `agenda_anotar` (`write`: crear, corregir, borrar), `agenda_calendario` (`soloApp`: conectar el iCal). `coach_semana` trae por día `compromisos` y `min_libres`.
- `aplicarAgenda` y `huecos` salen de la web.
- Skills en el mismo cambio: `planificador` ("tengo cena el martes" → `agenda_anotar` y luego `coach_proponer`), `mycoach-uso`, `fisio` (fatiga no deportiva, alcohol), `nutricionista` (cena, viaje, turno).

**Web:** Hoy no cambia de pregunta; el porqué de la sesión lo cuenta ("40 min suaves: tienes cena a las 20:00"). En Plan, la hoja del día lleva "No puedo este día" (tonal) → `openSheet` con día entero o franja, motivo y "Cada semana". El día ocupado lleva candado y texto ("Ocupado: cena"), nunca solo color. El calendario pasa a Ajustes › Conexiones.

**Tamaño:** M (1-1,5 semanas).

## 4. B. Plan semanal de comidas y librería

**Voz:** se guarda todo (hidratos, proteína, grasa, fibra, sal, kcal), pero por defecto se enseña el **código de hidrato por comida** (alto, medio, bajo, con texto) y los cuartos de plato, como Hexis o Fuelin. Preferencia `nutricion.ver: cuartos | gramos | completo`; las kcal, solo si se piden, siempre "estimado", y se desactiva sola ante señales de riesgo.

**Datos:**

| Fuente | Uso |
|---|---|
| CIQUAL (ANSES, Licence Ouverte) | Base principal, uso comercial con cita. Un subconjunto de ~300 alimentos cabe en D1 o en el código |
| USDA FoodData Central (CC0) | Lo que falte |
| BEDCA (AESAN) | La mejor para España, pero el uso electrónico/comercial **pide autorización expresa**: validar a mano y solicitarla |
| Open Food Facts (ODbL) | Productos envasados por código de barras, en colección aparte (share-alike) |
| Edamam, Spoonacular, Nutritionix | Descartadas: no dejan cachear ni usarse con un LLM |

**Modelo:**
- `alimento { id, nombre, fuente, por100: {hc, azucar, fibra, prot, grasa, sal, kcal}, medidas: [{txt, g}] }` → D1, tabla global de solo lectura.
- `plato { id, nombre, ingredientes: [{alimento_id, g}], racion_casera, hc_g, prot_g, cuartos, codigo, momento, etiquetas: {gusta, prep_min, temporada, tupper, batch, coste}, alergenos (14 UE), origen: oficial|claude|usuario, confianza }` → KV `nutricion/libreria`. El valor sale de los ingredientes por código, no de Claude; lo que corrige el usuario gana.
- Plan `nutricion/plan/AAAA-Www`, preferencias en `perfil.nutricion` (gustos, no gustos, alergias, quién cocina, para cuántos, tiempo, tupper). La lista de la compra se calcula.

**Lo que decide el motor:** carga del día (pasa al conector) → código por comida (alto antes y después de la sesión dura y la víspera del fondo) → proteína en las 4 tomas → elige platos (filtros duros: alérgenos y no gustos; suman gusto, temporada, tupper; resta repetir en menos de 3 días; legumbre 2-3 y pescado 2+ por semana) → sobras del batch al día siguiente → respeta compromisos ("cena fuera: pide arroz o pasta") → lista de la compra por pasillo.

**Lo que hace Claude:** proponer platos nuevos a partir de tus gustos (con ingredientes, para que el motor calcule), adaptar ("solo tengo 15 min"), explicar en una frase y guardar con tu sí.

**Herramientas:** `comida_plan` (leer), `comida_proponer` (`guardar` como `coach_proponer`), `comida_platos` (librería y alimentos; con `id`, detalle), `comida_plato_guardar`, `comida_compra`. `comida_registrar` acepta `plato_id`.

**Librería semilla:** unos 30 platos españoles (lentejas, garbanzos con espinacas, arroz con pollo, macarrones con atún, tortilla, merluza en salsa verde, pisto con huevo, gachas de avena…) con hidrato, proteína, cuartos y código estimados, que hay que validar con CIQUAL/BEDCA antes de publicar.

**Riesgos:** TCA y baja disponibilidad energética (pasa a solo cuartos y deriva a un profesional), alergias como filtro duro (si hay duda, "lo contiene"; nunca "no lleva"), nada de diagnosticar (celiaquía, diabetes, embarazo, menores → genérico y profesional).

**Tamaño:** M en dos tandas: platos propios y plan sin catálogo (1,5 semanas); catálogo CIQUAL en D1 (2 semanas).

## 5. C. App de pareja ("Hogar")

**Mercado:** Cupla, TimeTree, FamilyWall, Cozi (39-80 $/año), Sweepy, Tody, Maple… La queja que se repite: la app no quita la carga mental, la **traslada** a quien ya lo llevaba todo, que ahora además asigna tareas en la app. Los puntos y rankings no lo arreglan.

**Lo que la haría distinta:**
1. **Cada tarea tiene dueño de principio a fin** (pensarla, planificarla, hacerla; método Fair Play), no "hoy te toca fregar". Resumen semanal de carga por persona, sin ranking.
2. **Tu Claude habla con el hogar:** "Apúntame la ITV y pásale la compra a Laura". Nadie tiene que hacer de gestor.
3. **El deporte cuenta como tiempo de casa:** tu fondo del sábado aparece en la semana común, y lo del hogar vuelve a myCoach como compromiso. El reparto evita darte la limpieza fuerte el día del fondo o el siguiente a las series, y lleva la cuenta para que no le toque siempre al otro.
4. **Entrenar juntos:** una sesión compartida es un compromiso de los dos, en un hueco común; cada uno con sus zonas.

**Arquitectura:**
- Monorepo: `packages/domain` (motor, agenda, nutrición, turnos; ya previsto en `ARCHITECTURE.md`), `packages/ui` (tokens y componentes de `app.css`), `apps/hogar`.
- Mismo Worker, misma cuenta, mismo conector con familia `hogar_*`. `tools/list` se filtra por los módulos activos de la cuenta (`coach`, `nutricion`, `hogar`), así quien no lo use no ve esas herramientas. Separarlo en otro Worker con *service binding* queda como salida si crece. Dos MCP federados: descartado.
- D1 (hay dos escritores; KV tarda hasta 60 s en propagarse): `hogares`, `miembros`, `invitaciones`, `comparticion`, `tareas`, `turnos`, `tareas_hechas`, `eventos_hogar`, `outbox`. Un evento del hogar que bloquea aparece como compromiso (`origen: hogar`) en la agenda de cada uno.
- Una única puerta `puedeVer(quien, dueño, ambito)` para leer datos de otro; el test de aislamiento se amplía.

**Privacidad (RGPD art. 9):** el semáforo, el sueño, la VFC, el peso, las lesiones y las alergias son datos de salud. Por defecto tu pareja ve "ocupado de 9 a 13" o "fondo largo", nunca tu estado. Compartir más pide un consentimiento aparte, versionado y revocable, que solo se da desde la app (`soloApp`), nunca desde el chat.

**MVP:** hogar de 2 con invitación por enlace; tareas que se repiten con dueño y turnos que rotan; lista de la compra común (que se llena con los menús de B); semana común con compromisos de los dos y entrenos de myCoach en solo lectura; resumen del domingo (quién lleva qué, qué queda sin dueño). Fuera: gastos, chat, cosas de relación.

**Herramientas:** `hogar`, `hogar_tareas`, `hogar_tarea_guardar`, `hogar_tarea_hecha`, `hogar_turnos` (propone reparto, `guardar`), `hogar_agenda`, `hogar_evento_guardar`, `hogar_compartir` e `hogar_invitar` (`soloApp`).

**Coste en Cloudflare:** con varios usuarios, Workers Paid (~5 $/mes) por las escrituras en KV; D1 sobra. Riesgo: un despliegue roto tumba las dos apps → tests de humo por familia.

## 6. Plan por fases

| Fase | Qué | Tamaño |
|---|---|---|
| 1 | **Compromisos**: iCal en el conector (y el arreglo del día entero), `disponibilidad()`, `agenda` y `agenda_anotar`, reglas nuevas en `validarSemana`, `aplicarAgenda` fuera de la web, skills | M |
| 2 | **Comidas I**: `perfil.nutricion`, carga del día en el conector, platos propios, `comida_plan`, `comida_proponer`, `comida_compra` | M |
| 3 | **Comidas II**: catálogo CIQUAL en D1, nutrientes por plato, código de hidrato | M-L |
| 4 | **Base para el hogar**: `packages/domain` y `packages/ui`, D1 `mycoach`, filtrado de herramientas por módulos | M |
| 5 | **Hogar MVP**: probado solo por vosotros dos | L |
| 6 | **Hogar ↔ myCoach**: lista de la compra común, consentimiento de salud aparte, avisos | M |

Antes o en paralelo conviene cerrar lo pendiente de la v1 (`docs/CASOS-DE-USO.md`), y el riesgo de datos de Garmin sigue siendo el mayor para abrir al público; el hogar no lo agrava.

## 7. Por decidir

1. ¿Empezamos ya por la fase 1 (rehace `35-agenda.js`)?
2. Compromisos: ¿solo texto libre o tipos (trabajo, familia, viaje, casa) que el motor entiende? Propuesta: tipos, deducidos del título y corregibles.
3. Comidas: ¿te vale código de hidrato + cuartos por defecto y gramos como opción? ¿Pedimos autorización a AESAN para BEDCA?
4. Hogar: ¿marca propia o "myCoach Casa" con la misma cuenta? ¿Tiene que funcionar entero sin Claude para tu pareja?
5. Privacidad: ¿qué ve tu pareja de tu entreno por defecto: solo "ocupado" o también la sesión?
