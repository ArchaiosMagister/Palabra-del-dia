# Auditoría de estabilización — 10 de noviembre de 2026

## Alcance y evidencias

**Código:** `index.html`, `4eso/index.html`, los dos manifiestos, los dos service workers y el circuito de pruebas en `tests/smoke.test.mjs`.

**Supabase:** proyecto compartido con políticas RLS para alumnos, profesores, votaciones y datos agregados. Se han revisado las dos funciones Edge de validación de códigos y las funciones SQL de gestión docente.

**Automatización:** las comprobaciones se ejecutan en `push` a `main`, `pull_request` y manualmente desde GitHub Actions. Se validan sintaxis, roles de interfaz, rutas de instalación, aislamiento de caché y contraste de la paleta.

## Hallazgos corregidos

1. Manifest PWA: `id` absoluto incorrecto para alojamientos bajo `/Palabra-del-dia/`; ahora cada manifest usa `"./"`.
2. Service workers: activación que eliminaba la caché del otro curso; ahora cada uno elimina solo sus propias versiones anteriores.
3. Interfaz: contraste insuficiente de `.rank-score` con algunos acentos claros; ahora utiliza el color primario legible.
4. Interfaz: tonos secundarios claros con contraste bajo; ajustados los colores `--muted` de ambos cursos.
5. Prevención de regresiones: añadidas pruebas automáticas para mantener estos requisitos.

## Control de acceso revisado

- Los alumnos solo pueden ver su fila y sus votos (políticas RLS vinculadas al usuario autenticado).
- La inserción y actualización de votos se limita al curso autorizado o al permiso específico de 2.º de Bachillerato.
- Los docentes consultan las votaciones y gestionan los alumnos mediante permisos y funciones que verifican el rol de profesor.
- Las funciones Edge comprueban un JWT válido y comparan códigos mediante hashes; no se expone una clave de servicio en el navegador.
- Las tablas `teacher_codes` y `votos_palabras` tienen RLS sin políticas de lectura: no debe interpretarse automáticamente como error si su cierre es intencionado.

## Advertencias pendientes (no bloqueantes para uso docente)

- **Contador:** el RPC público `record_site_visit` incrementa un agregado sin datos personales. Como todo endpoint público, puede invocarse desde scripts externos y no constituye una métrica antifraude. Consultar el [aviso de Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
- **Funciones SECURITY DEFINER:** `manage_student` y `review_word_proposal` están expuestas a usuarios autenticados, pero verifican `auth.uid()` contra `teacher_admins`. Conviene mantener esa comprobación en cualquier cambio futuro.
- **Sesiones anónimas:** algunas advertencias de Supabase aparecen porque la aplicación usa `signInAnonymously()`. El control real depende de las políticas RLS y los códigos personales.
- **Pruebas físicas y disponibilidad:** queda realizar una comprobación completa en iOS/Android con cuentas de prueba, así como confirmar la disponibilidad del sitio publicado después de cada despliegue. Los tests estáticos no pueden certificarlo.
- **Dependencias externas:** revisar periódicamente el CDN de bibliotecas y el funcionamiento del servidor Supabase.

## Conservación de datos

Esta auditoría no borra ni modifica votos, alumnos, contraseñas o códigos. Los cambios de esta fase son de interfaz, manifest, service workers, documentación y pruebas automatizadas.
