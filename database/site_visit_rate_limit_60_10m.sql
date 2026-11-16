-- Palabra del día: decisión docente 2A (16/11/2026).
-- Máximo 60 visitas aceptadas por curso en cualquier ventana móvil de 10 minutos.
-- No almacena IP, usuario, agente, cookies ni identificadores de visitante.
-- Conserva la interfaz del RPC record_site_visit(uuid) y los contadores existentes.
-- Ejecutar como migración Supabase después de revisar esta PR.

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.record_site_visit(uuid)'::regprocedure
      AND p.prosecdef
      AND pg_get_userbyid(p.proowner)='postgres'
  ) THEN
    RAISE EXCEPTION 'La función de visitas ya no coincide con el contrato auditado';
  END IF;
  IF (SELECT count(*) FROM public.site_visit_counters) <> 2 THEN
    RAISE EXCEPTION 'La estructura de los dos contadores no coincide con la auditoría';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname='app_private'
  ) THEN
    RAISE EXCEPTION 'El esquema app_private ya existe: revisar antes de migrar';
  END IF;
END
$guard$;

-- Fuera del esquema expuesto a la Data API: estado agregado por curso.
CREATE SCHEMA app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;

CREATE TABLE app_private.site_visit_rate_limits (
  course_id uuid PRIMARY KEY,
  accepted_at timestamptz[] NOT NULL DEFAULT '{}'::timestamptz[],
  CONSTRAINT max_60_timestamps CHECK (cardinality(accepted_at) <= 60)
);
REVOKE ALL ON TABLE app_private.site_visit_rate_limits
  FROM PUBLIC, anon, authenticated;
ALTER TABLE app_private.site_visit_rate_limits ENABLE ROW LEVEL SECURITY;

-- Mantener la firma/seguridad del RPC: la página lo invoca sin login.
-- Un bloqueo de fila por curso serializa llamadas simultáneas.
CREATE OR REPLACE FUNCTION public.record_site_visit(p_course_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_existing timestamptz[];
  v_recent timestamptz[];
  v_now timestamptz;
BEGIN
  IF p_course_id IS NULL OR p_course_id NOT IN (
    'ec7e0b88-8304-4115-aa8d-fd703ac2b7ea'::uuid,
    '4e9c637b-96af-4385-b9fd-812d192c75ec'::uuid
  ) THEN
    RAISE EXCEPTION 'Unknown site' USING errcode='22023';
  END IF;

  INSERT INTO app_private.site_visit_rate_limits (course_id)
    VALUES (p_course_id)
    ON CONFLICT (course_id) DO NOTHING;

  SELECT accepted_at INTO v_existing
    FROM app_private.site_visit_rate_limits
    WHERE course_id=p_course_id
    FOR UPDATE;

  -- Calcular tras adquirir el bloqueo, no antes de una cola de solicitudes.
  v_now := clock_timestamp();
  SELECT coalesce(array_agg(t.accepted_time ORDER BY t.accepted_time),
                  '{}'::timestamptz[])
    INTO v_recent
    FROM unnest(v_existing) AS t(accepted_time)
    WHERE t.accepted_time > v_now - interval '10 minutes';

  IF cardinality(v_recent) >= 60 THEN
    -- El navegador trata la solicitud como registrada y mantiene su
    -- deduplicación sessionStorage; no falsea el histórico ni eleva errores.
    RETURN;
  END IF;

  UPDATE app_private.site_visit_rate_limits
    SET accepted_at=array_append(v_recent,v_now)
    WHERE course_id=p_course_id;

  UPDATE public.site_visit_counters
    SET total_visits=total_visits+1
    WHERE course_id=p_course_id;
END;
$function$;

-- La función ya era accesible para visitantes; solo ella puede
-- actualizar el contador. No se expone el nuevo estado interno.
REVOKE ALL ON FUNCTION public.record_site_visit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_site_visit(uuid)
  TO anon, authenticated, service_role;
