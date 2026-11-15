-- Profesor: crear y editar fichas del diccionario sin cambiar su identidad,
-- fecha de explicación ni las votaciones. Aplicar una sola vez en Supabase.
-- La operación se ejecuta de forma atómica y NO se concede INSERT/UPDATE directo
-- sobre words ni course_words a los clientes.

CREATE OR REPLACE FUNCTION public.manage_teacher_word(
  p_action text,
  p_course_id uuid,
  p_course_word_id uuid,
  p_term text,
  p_origin text,
  p_definition text,
  p_story text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_term text := btrim(coalesce(p_term, ''));
  v_origin text := btrim(coalesce(p_origin, ''));
  v_definition text := btrim(coalesce(p_definition, ''));
  v_story text := btrim(coalesce(p_story, ''));
  v_word_id uuid;
  v_course_word_id uuid;
  v_explained boolean := false;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.teacher_admins ta
    WHERE ta.auth_user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'Solo el profesor puede gestionar palabras';
  END IF;

  IF p_action NOT IN ('create', 'update') OR p_action IS NULL THEN
    RAISE EXCEPTION 'Acción de edición no válida';
  END IF;
  IF char_length(v_term) NOT BETWEEN 1 AND 160
    OR char_length(v_origin) > 4000
    OR char_length(v_definition) > 4000
    OR char_length(v_story) > 12000 THEN
    RAISE EXCEPTION 'Revisa la longitud de los campos de la ficha';
  END IF;
  IF (p_action = 'create' AND p_course_word_id IS NOT NULL)
    OR (p_action = 'update' AND p_course_word_id IS NULL) THEN
    RAISE EXCEPTION 'Identificador de ficha no válido';
  END IF;

  -- La fila del curso serializa las altas/ediciones simultáneas de este RPC.
  -- No es una autorización: la pertenencia a teacher_admins se valida arriba.
  PERFORM 1 FROM public.courses c WHERE c.id = p_course_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El curso indicado no existe';
  END IF;

  IF p_action = 'update' THEN
    SELECT cw.word_id, cw.explained INTO v_word_id, v_explained
    FROM public.course_words cw
    WHERE cw.id = p_course_word_id AND cw.course_id = p_course_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La ficha no pertenece a este curso';
    END IF;
    IF (SELECT count(*) FROM public.course_words WHERE word_id = v_word_id) > 1 THEN
      RAISE EXCEPTION 'La ficha está compartida entre cursos; requiere revisión antes de editar';
    END IF;
    v_course_word_id := p_course_word_id;
  END IF;

  -- Mismo título en el mismo curso (insensible a mayúsculas y espacios externos).
  -- No altera otras palabras del mismo término presentes en cursos distintos.
  IF EXISTS (
    SELECT 1 FROM public.course_words cw
    JOIN public.words w ON w.id = cw.word_id
    WHERE cw.course_id = p_course_id
      AND lower(btrim(w.term)) = lower(v_term)
      AND (p_action = 'create' OR cw.id <> p_course_word_id)
  ) THEN
    RAISE EXCEPTION 'Ya existe una palabra con ese título en este curso';
  END IF;

  IF p_action = 'create' THEN
    INSERT INTO public.words(term, origin, definition, story)
    VALUES (v_term, v_origin, v_definition, v_story)
    RETURNING id INTO v_word_id;

    INSERT INTO public.course_words(course_id,word_id,explained)
    VALUES (p_course_id,v_word_id,false)
    RETURNING id INTO v_course_word_id;
  ELSE
    UPDATE public.words
    SET term = v_term, origin = v_origin, definition = v_definition, story = v_story
    WHERE id = v_word_id;

    -- Las ediciones de palabras ya explicadas deben actualizar las fichas
    -- visibles a los alumnos sin modificar explained_at ni los votos.
    IF v_explained THEN
      INSERT INTO public.word_revisions(course_id,revision,changed_at)
      VALUES(p_course_id,1,now())
      ON CONFLICT (course_id) DO UPDATE
        SET revision = public.word_revisions.revision + 1,
            changed_at = now();
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'action', p_action,
    'word_id', v_word_id,
    'course_word_id', v_course_word_id,
    'explained', v_explained
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.manage_teacher_word(text,uuid,uuid,text,text,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_teacher_word(text,uuid,uuid,text,text,text,text)
  TO authenticated;
