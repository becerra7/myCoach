# myCoach para Android (el widget de Hoy)

Una app mínima para tener en la pantalla de inicio "qué toca hoy y por qué". No replica la web:

- **La app** es la web de myCoach dentro de una vista web. Sirve para entrar con tu cuenta; la sesión se queda en el teléfono.
- **El widget** (4 × 2, redimensionable) pide `coach_hoy` a tu myCoach con esa sesión y enseña lo mismo que la primera pantalla de Hoy: el estado con icono y palabra, la frase y su porqué. No calcula nada. Tocar el widget abre la app.
- Se actualiza cada 30 minutos (el mínimo que deja Android) y cada vez que abres o cierras la app. Sin red enseña lo último que leyó ese día y a qué hora.

## Instalar

1. GitHub → Actions → **Android** → última ejecución → artefacto `mycoach-android` → `app-debug.apk`.
2. Pásalo al teléfono y ábrelo (hay que permitir "instalar apps desconocidas" para el navegador o el gestor de archivos).
3. Abre myCoach y entra con tu cuenta.
4. Mantén pulsada la pantalla de inicio → Widgets → myCoach → **Hoy**.

## Compilar en local

```
cd apps/android
echo "sdk.dir=/ruta/a/tu/android-sdk" > local.properties
gradle :app:assembleDebug          # Gradle 8.9 o superior, JDK 17 o 21
```

Contra el entorno de pruebas: `gradle :app:assembleDebug -PmycoachUrl=https://mycoach-pruebas.albertbecervas.workers.dev`.

## Límites (dichos claro)

- **Sin probar en un teléfono.** Compila y el APK se genera, pero aquí no hay emulador: la primera instalación es la prueba.
- Es un APK de depuración, firmado con una clave que cambia en cada compilación del CI: para actualizarlo hay que desinstalar el anterior (se vuelve a entrar). Para evitarlo hace falta una clave de firma fija guardada como secreto del repo.
- No está en Google Play. Publicarlo pide cuenta de desarrollador, ficha y política de privacidad.
- Sin dependencias: solo el SDK de Android (Java, `RemoteViews`). Los colores son los tokens de la web (`app.css`), en claro y en oscuro.
