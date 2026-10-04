# Compromisos: qué se ha hecho

_Octubre 2026. Sale de `docs/PROPUESTA-AGENDA-COMIDA-HOGAR.md`._

## Qué hace

Le dices a tu Claude "el martes ceno de 20 a 23" o "del 10 al 12 estoy de viaje", o lo marcas en la app ("No puedo este día"). También lee tu calendario de Google (u Outlook, o iCloud) si lo conectas en Ajustes. El entrenador no te pone una sesión donde no cabe sin preguntarte: te enseña el cambio antes de guardarlo y se puede deshacer.

## Decisiones

- **Franjas, no días enteros.** Un compromiso con hora (de 19:30 a 22:00) solo ocupa esa franja, con 15 min de margen; el resto del día sigue libre (se entrena de 6:00 a 22:00). Sin hora, ocupa el día entero.
- **Todo vive en el conector.** La app y tu Claude ven lo mismo. El enlace del calendario se guarda cifrado en tu cuenta y no en la sesión del navegador. Si ya lo tenías conectado, se pasa solo al abrir la app.
- **Google por iCal.** Se usa la "dirección secreta en formato iCal" de Google Calendar. Así no hay que pasar la verificación de Google que pide su API de calendario.
- **Qué hace el motor si una sesión no cabe:**
  - la sesión clave (series, tempo o fondo largo) se mueve a un día libre de la semana, sin pegarla a otra exigente;
  - la de relleno se recorta al hueco que queda;
  - si no hay sitio, el día se deja libre.
- **Nunca sin preguntar.** Si dices que entrenas igualmente, se respeta (`entrena_igualmente`) y queda solo como aviso.
- **Sin culpa.** Un día sin hueco no cuenta como sesión saltada.
- **Descartado:** el "trasnoche" (la idea de que al día siguiente de una cena tarde no se pusiera nada exigente). Ni las sesiones fijas por semana ni el diario lo necesitan de momento.

## Piezas

- **Conector:**
  - herramientas `agenda`, `agenda_anotar` y `agenda_calendario` (esta última solo la usa la app);
  - las reglas `dia_ocupado` y `no_cabe` dentro de `validarSemana`;
  - la agenda de cada día en `coach_semana`, y la de hoy en `coach_hoy`.
- **Web:**
  - el candado y el texto en cada día del Plan;
  - "Tu agenda" y "No puedo este día" en la hoja de cada día;
  - el aviso "Tu agenda choca con el plan", con el antes → después;
  - los compromisos de hoy en "Tu día";
  - al preparar la semana, la versión corregida del motor;
  - el calendario se conecta en Ajustes, pasando por el conector.
- **Skills:** `planificador` y `mycoach-uso` (hay que volver a subirlas con `npm run skills`).
- **Pruebas:** las del motor y las herramientas en el conector (sección 12 quater), y en el Worker la que pasa el calendario de la sesión al conector.
