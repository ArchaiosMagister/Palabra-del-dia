# Decisiones docentes 1B y 2A — comprobación de seguridad (16/11/2026)

Proyecto Supabase: **Palabra_del_dia**. No se modifica el banco léxico, las
fichas, los votos, los códigos de acceso, las cuentas de Supabase ni la PWA.

## 1B — revocación de autorizaciones docentes sin sesión registrada

**Estado antes:** 30 filas en `public.teacher_admins`; 13 correspondían
a `auth.users` con una fila en `auth.sessions` y 17 carecían de sesión
registrada. Todas las identidades docentes del proyecto son cuentas
anónimas de Supabase. La existencia de una sesión en `auth.sessions`
no garantiza actividad reciente ni identidad personal; se ha aplicado
estrictamente el criterio docente solicitado.

Se ejecutó la instrucción transaccional documentada en
[`revoke_inactive_teacher_authorizations_20261116.sql`](revoke_inactive_teacher_authorizations_20261116.sql).
Bloquea brevemente el registro de autorizaciones y la tabla de sesiones,
vuelve a contar en el momento de actuar y cancela la transacción si
el reparto ya no es **30/13/17**. Borra **solo** las 17 filas de
`public.teacher_admins` sin sesión, no `auth.users`.

**Estado comprobado después:**
- **13** autorizaciones restantes, **13** con sesión, **0** sin sesión.
- **70** cuentas de Auth conservadas.
- Los alumnos, sus votos, las palabras y los cursos no se modifican.
- Los 17 dispositivos afectados pueden volver a acreditar el código
  docente mediante `claim-teacher-code`; el código no se ha rotado.
  La revocación no debe confundirse con la eliminación definitiva
  de una cuenta ni con una rotación de la credencial compartida.

Se probó primero una ejecución idéntica dentro de una transacción con
`ROLLBACK`: simulación correcta de **13** autorizaciones restantes.
No se imprimieron UUID de cuentas, códigos ni tokens.

## 2A — 60 visitas por curso cada 10 minutos, sin IP

Migración aplicada a la base:
`20261116190035_limit_site_visits_60_per_rolling_10min_without_ip`,
cuyo SQL exacto se conserva en
[`site_visit_rate_limit_60_10m.sql`](site_visit_rate_limit_60_10m.sql).

- `public.record_site_visit(uuid)` conserva su firma, la lista de cursos
  permitidos, `SECURITY DEFINER`, el `search_path` vacío y la capacidad
  de invocación de `anon`/`authenticated`.
- El estado de límite se guarda exclusivamente en
  `app_private.site_visit_rate_limits`, esquema no expuesto a la Data API.
  La tabla tiene RLS activo y no concede SELECT a `anon` ni a
  `authenticated`.
- Por curso, solo se conservan como máximo 60 marcas de tiempo de
  *visitas aceptadas* de los últimos diez minutos. **No** se almacenan
  IP, IDs de visitante, sesiones, datos de navegador ni identificadores
  de alumno. El bloqueo `FOR UPDATE` de la fila del curso evita
  carreras entre llamadas simultáneas.
- La **61.ª** solicitud en cualquier ventana móvil de diez minutos
  devuelve una respuesta vacía normal y **no** incrementa
  `site_visit_counters`. Se preserva la deduplicación adicional por
  `sessionStorage` que ya realizaban ambas páginas.
- Una visita rechazada por exceso no se «recupera» posteriormente:
  la cifra continúa representando visitas aceptadas, no visitantes
  únicos. El límite no requiere contratar ningún servicio.

**Verificación transaccional antes de aplicar la migración:** instalación
temporal del esquema y función; 61 llamadas al primer curso → **60**
incrementos; una llamada al segundo curso → **1** incremento
independiente; ejecución como rol `anon` autorizada. Toda la
simulación terminó con `ROLLBACK`.

**Verificación posterior a producción:** el RPC se mantiene invocable por
`anon` y `authenticated`, el esquema privado y el RLS están activos y
ambos roles carecen de SELECT sobre la tabla interna. Las **137**
visitas históricas permanecieron intactas tras la migración; los
dos cursos conservan contadores independientes.

## Pruebas en GitHub

`tests/security-visit-limit.test.mjs` comprueba que los SQL no
destruyen usuarios ni visitas, el límite y su tabla privada siguen
presentes, el código mantiene la firma pública, y las dos PWA conservan
sus llamadas y deduplicación. La batería previa de navegador,
votaciones y modos de proyección se mantiene sin cambios.

La integración de esta PR en GitHub registra las operaciones **ya
realizadas en Supabase**. No ejecuta nuevas migraciones, no borra
autorizaciones otra vez y no exige redesplegar las PWA.

## Recuperación y límites

La revocación docente puede revertirse reactivando deliberadamente
los dispositivos con el código docente o mediante una nueva
autorización administrada; **no reinsertar automáticamente las 17
filas**. Una mayor seguridad futura requeriría migrar las
autorizaciones a la cuenta con TOTP de ScholaClassica (decisión 1C),
que no ha sido autorizada aquí.

El límite protege la integridad estadística frente a incrementos
rápidos, pero no constituye una defensa completa contra ataques de
denegación de servicio, pues el RPC continúa siendo público por
necesidad funcional.
