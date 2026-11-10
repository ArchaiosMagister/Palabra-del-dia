# Palabra del día — versión 1.0

Fecha de referencia: **10 de noviembre de 2026**.

## Alcance

Versión de referencia del sitio de **1.º de Bachillerato** (`/`) y **4.º de ESO** (`/4eso/`). Ambas versiones comparten la misma base de Supabase y están preparadas para instalarse como aplicaciones web progresivas independientes.

## Funciones incluidas

- Diccionario por curso, fichas completas y búsqueda; orden alfabético, por media o por número de votos.
- Votación con códigos individuales y consulta de las votaciones personales.
- Clasificación general y clasificación personal, con trofeos para los tres primeros puestos.
- Propuestas de palabras y revisión docente.
- Panel del profesor: gestión de palabras, alumnos, códigos y QR; votos por persona dentro de la ficha; contador agregado de visitas.
- Selector de doce colores con preferencias por usuario y aspecto claro/oscuro.
- Detección de sesiones de alumnos desplazadas al volver a la aplicación y antes de votar.
- PWA para ambos cursos con manifest y service worker propios.

## Estabilización de la versión 1.0

- Identificadores `id` relativos al ámbito de cada manifest; corregidas las rutas de instalación en GitHub Pages.
- Cachés independientes entre Bachillerato y 4.º ESO, con revisión de versión del service worker.
- Mayor contraste de textos secundarios y puntuaciones numéricas en modo claro.
- Pruebas de regresión automatizadas con Node.js y GitHub Actions, independientes de servicios externos.

## Comprobaciones y límites

El código está sujeto a las pruebas de `tests/smoke.test.mjs` y `.github/workflows/smoke.yml`. Se han revisado las políticas RLS y los controles de acceso de las funciones administrativas en Supabase.

**Limitaciones conocidas:**

- El diccionario y la interfaz pueden aparecer sin conexión gracias al shell de la PWA; votar, autenticar códigos y consultar datos de Supabase **requiere conexión**.
- El contador de visitas es orientativo, no mide usuarios únicos y su endpoint público de incremento no impide completamente recuentos automatizados.
- La verificación en GitHub Actions **no sustituye** la prueba interactiva de instalación, navegación y actualización en Safari de iPhone ni en Chrome de Android.
- El nombre de usuario visible en el formulario docente ayuda al gestor de contraseñas, pero la autorización continúa dependiendo del código del profesor.
- Los recursos externos (bibliotecas JavaScript, tipografías, Supabase) requieren conexión y mantenimiento.

Las futuras mejoras podrán añadirse a `main` sin alterar la copia conservada en la rama **`release/v1.0`**.

## Comprobación manual recomendada tras instalar

1. Abrir la web de cada curso en un móvil, instalarla y comprobar que los iconos y las ventanas independientes son correctos.
2. En cada web, acceder con un **código de prueba**, votar una palabra, cambiar su puntuación y consultar ambas clasificaciones.
3. Comprobar el cierre de sesión y la detección de sesiones desplazadas con **dos dispositivos de prueba**.
4. Entrar como profesor, revisar votaciones, códigos, contador y las tres primeras posiciones del ranking.
5. Probar los doce colores en tema claro y oscuro y verificar una actualización de la PWA sin reinstalar.

> No se han modificado ni reiniciado las votaciones ni los códigos existentes durante esta fase de estabilización.
