-- Palabra del día: decisión docente 1B (16/11/2026).
-- Retirar exactamente las 17 autorizaciones de profesor sin auth.sessions.
-- NO borrar auth.users, sesiones, votos, alumnos, palabras ni códigos.
-- REQUIERE que el estado de producción siga siendo 30/13/17.
-- Ejecutar mediante execute_sql de Supabase como instrucción transaccional.
-- DML: no registrar como cambio de esquema.
DO $revoke$
DECLARE
  v_total integer;
  v_with_session integer;
  v_without_session integer;
  v_removed integer;
BEGIN
  -- Bloqueo corto: evita que una sesión se cree entre el cotejo y el DELETE.
  LOCK TABLE public.teacher_admins IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE auth.sessions IN SHARE MODE;

  SELECT count(*),
         count(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM auth.sessions s WHERE s.user_id=t.auth_user_id
           )
         ),
         count(*) FILTER (
           WHERE NOT EXISTS (
             SELECT 1 FROM auth.sessions s WHERE s.user_id=t.auth_user_id
           )
         )
  INTO v_total,v_with_session,v_without_session
  FROM public.teacher_admins t;

  IF v_total<>30 OR v_with_session<>13 OR v_without_session<>17 THEN
    RAISE EXCEPTION 'La situación de autorizaciones ha variado: no revocar automáticamente';
  END IF;

  WITH removed AS (
    DELETE FROM public.teacher_admins t
    WHERE NOT EXISTS (
      SELECT 1 FROM auth.sessions s WHERE s.user_id=t.auth_user_id
    )
    RETURNING t.auth_user_id
  )
  SELECT count(*) INTO v_removed FROM removed;

  IF v_removed<>17 THEN
    RAISE EXCEPTION 'El número revocado difiere de 17: cancelar transacción';
  END IF;
END
$revoke$;
