-- Palabra del día: publicación de fichas con seguridad y notificaciones.
-- Ejecutar en Supabase ANTES de publicar las dos webs actualizadas.
-- No cambia IDs, fichas, alumnos ni votos históricos. Idempotente.
BEGIN;

-- La explicación de una palabra pendiente no debe ser accesible directamente
-- desde la Data API por una sesión anónima o de alumno.
DROP POLICY IF EXISTS "Teacher can read unpublished words" ON public.words;
CREATE POLICY "Teacher can read unpublished words" ON public.words
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.teacher_admins t
      WHERE t.auth_user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Public can read published words" ON public.words;
CREATE POLICY "Public can read published words" ON public.words
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.course_words cw
      WHERE cw.word_id = words.id AND cw.explained IS TRUE
    )
  );
DROP POLICY IF EXISTS "Public can read words" ON public.words;

-- Segunda barrera: incluso un cliente que omita el filtro de la interfaz
-- no puede insertar ni modificar valoraciones de fichas pendientes.
DROP POLICY IF EXISTS "Votes require explained word on insert" ON public.votes;
CREATE POLICY "Votes require explained word on insert" ON public.votes
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.course_words cw
      WHERE cw.id = votes.course_word_id AND cw.explained IS TRUE
    )
  );

DROP POLICY IF EXISTS "Votes require explained word on update" ON public.votes;
CREATE POLICY "Votes require explained word on update" ON public.votes
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.course_words cw
      WHERE cw.id = votes.course_word_id AND cw.explained IS TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.course_words cw
      WHERE cw.id = votes.course_word_id AND cw.explained IS TRUE
    )
  );

-- Revisión por curso, sin títulos, explicaciones, notas ni identidades.
-- Esta tabla permite recibir incluso el cambio a "no explicada":
-- los eventos de filas ahora privadas no llegarían al alumnado por RLS.
CREATE TABLE IF NOT EXISTS public.word_revisions (
  course_id uuid PRIMARY KEY REFERENCES public.courses(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.word_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.word_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.word_revisions TO anon, authenticated;

DROP POLICY IF EXISTS "Read word publication revision" ON public.word_revisions;
CREATE POLICY "Read word publication revision" ON public.word_revisions
  FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.word_revisions(course_id)
SELECT id FROM public.courses
ON CONFLICT (course_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.bump_word_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.explained IS DISTINCT FROM NEW.explained THEN
    INSERT INTO public.word_revisions(course_id, revision, changed_at)
    VALUES (NEW.course_id, 1, now())
    ON CONFLICT (course_id) DO UPDATE
      SET revision = public.word_revisions.revision + 1,
          changed_at = now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.bump_word_revision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS word_revisions_on_publication ON public.course_words;
CREATE TRIGGER word_revisions_on_publication
AFTER UPDATE OF explained ON public.course_words
FOR EACH ROW
WHEN (OLD.explained IS DISTINCT FROM NEW.explained)
EXECUTE FUNCTION private.bump_word_revision();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname='supabase_realtime'
         AND schemaname='public'
         AND tablename='word_revisions'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.word_revisions;
  END IF;
END;
$$;

COMMIT;

-- Validación posterior (de lectura):
-- SELECT count(*) FROM public.word_revisions;
-- SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime'
--   AND schemaname='public' AND tablename='word_revisions';
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname='public' AND tablename IN ('words','votes','word_revisions');
