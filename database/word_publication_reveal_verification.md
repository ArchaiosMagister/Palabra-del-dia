# Verificación de seguridad de la revelación de palabras

Fecha: 15 de noviembre de 2026. Proyecto Supabase: `Palabra_del_dia`.

## Migración

Se ha aplicado correctamente `word_publication_reveal_security` (versión Supabase `20261115112357`), basada en `database/word_publication_reveal.sql`.

**La migración se ejecutó sobre la instancia Supabase de producción, sin publicar todavía los cambios de interfaz.** Incluye:

- RLS de `public.words`: visitantes y alumnos solo ven palabras explicadas, profesores autorizados pueden leer también pendientes.
- RLS restrictiva en `public.votes`: exige `course_words.explained IS TRUE` para insertar y actualizar valoraciones.
- `public.word_revisions`: una fila pública de solo lectura por curso, sin contenido de fichas ni datos del alumnado; triggers y publicación `supabase_realtime`.
- Sin modificaciones masivas de fichas, códigos, alumnos, votos, calificaciones ni identificadores.

## Pruebas sobre la base de datos

Efectuadas con `SET LOCAL ROLE` y un contexto de autenticación equivalente al de sesiones ya autorizadas, mediante transacciones explícitas **`BEGIN … ROLLBACK`**, sin conservar datos de prueba.

| Caso | Resultado |
|---|---|
| Acceso sin autenticar | 27 fichas explicadas visibles; 59 pendientes ocultas |
| Acceso como alumno | 27 fichas explicadas visibles; pendientes ocultas |
| Acceso como profesor autorizado | 86 fichas visibles, incluidas 59 pendientes |
| Revisión pública por curso | 2 filas visibles, sin permiso INSERT/UPDATE |
| Alumno intenta votar palabra pendiente | Rechazado por RLS |
| Alumno vota palabra explicada | Inserción autorizada; transacción revertida |
| Alumno intenta marcar pendiente como explicada | Rechazado; ninguna fila modificada |
| Profesor revela y después oculta una palabra en 1.º Bachillerato | Éxito; cambios de revisión +1/+1; fechas coherentes; rollback |
| Profesor revela y después oculta una palabra en 4.º ESO | Éxito; cambios de revisión +1/+1; fechas coherentes; rollback |
| Última palabra explicada tras revelar | Corresponde a la ficha recién marcada (orden `explained_at DESC`) |
| Aislamiento entre cursos | El contador del otro curso no varía |
| Ocultar una ficha con votos anteriores | Desaparece de la clasificación, mantiene el voto histórico |
| Alumno intenta modificar voto histórico durante bloqueo | Rechazado |
| Estado final | Todos los contadores conservados; revisiones 0/0 |

### Recuento antes y después

| Entidad | Antes | Después |
|---|---:|---:|
| `words` | 86 | 86 |
| `course_words` | 86 | 86 |
| Explicadas | 27 | 27 |
| Pendientes | 59 | 59 |
| `votes` | 266 | 266 |
| `public_rankings_cache` | 27 | 27 |
| `word_revisions` | 0 (no existía) | 2 |

Se ejecutaron los avisos de seguridad y rendimiento de Supabase. Persisten advertencias relativas a funciones y políticas anteriores, no causadas por esta migración; deben revisarse por separado sin romper los accesos anónimos y la administración que actualmente necesita la aplicación.

## GitHub Actions

La PR #2 contiene 35 pruebas automatizadas, todas superadas en la ejecución #43708458927. Abarcan sintaxis, funcionalidades previas, identidad y caché de ambas PWA, permisos del profesor, sorteo sin sesgos por módulo, última palabra explicada, revelación, diseño y reglas de seguridad.

## Limitación de la validación

**No se ha realizado todavía una prueba end-to-end en dos navegadores reales** con la web de la PR desplegada en un entorno de prueba, un profesor y un alumno. Las comprobaciones de autorización anteriores son pruebas reales contra Postgres con suplantación controlada del rol y `ROLLBACK`, no sesiones web de usuarios ni una garantía de animaciones en Safari/iPad. Conviene completar esa prueba de interfaz antes de publicar el nuevo HTML.

**Estado:** migración aplicada y comprobaciones de base de datos correctas. PR abierta, sin fusionar ni publicar las dos webs.
