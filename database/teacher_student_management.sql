
-- No existing student or vote rows are changed.
revoke all on public.students from anon, authenticated;
grant select (id,course_id,auth_user_id,created_at,display_name,student_group) on public.students to authenticated;
grant update (display_name) on public.students to authenticated;
create or replace function public.manage_student(p_action text,p_course_id uuid,p_student_id uuid default null,p_name text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_code text; v_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.teacher_admins where auth_user_id=auth.uid()) then
 raise exception 'Solo el profesor puede gestionar alumnos' using errcode='42501'; end if;
 if p_action is null or p_action not in ('create','rename','rotate') then raise exception 'Acción no válida'; end if;
 if p_name is not null and char_length(btrim(p_name))>120 then raise exception 'Nombre demasiado largo'; end if;
 if not exists(select 1 from public.courses where id=p_course_id) then raise exception 'Curso no válido'; end if;
 if p_action='create' then
 if nullif(btrim(p_name),'') is null then raise exception 'Escribe el nombre del alumno'; end if;
 if p_student_id is not null then raise exception 'Solicitud no válida'; end if;
 else
 select id into v_id from public.students where id=p_student_id and course_id=p_course_id and student_group='course' for update;
 if not found then raise exception 'Alumno no encontrado en este curso'; end if;
 end if;
 if p_action in ('create','rotate') then
 v_code := 'LAT-' || upper(encode(extensions.gen_random_bytes(24),'hex'));
 end if;
 if p_action='create' then
 insert into public.students(course_id,display_name,invite_code_hash,student_group)
 values(p_course_id,btrim(p_name),encode(extensions.digest(v_code,'sha256'),'hex'),'course') returning id into v_id;
 elsif p_action='rename' then
 update public.students set display_name=nullif(btrim(p_name),'') where id=v_id;
 else
 update public.students set invite_code_hash=encode(extensions.digest(v_code,'sha256'),'hex'),auth_user_id=null where id=v_id;
 end if;
 return jsonb_build_object('id',v_id,'code',v_code);
end; $$;
revoke all on function public.manage_student(text,uuid,uuid,text) from public,anon;
grant execute on function public.manage_student(text,uuid,uuid,text) to authenticated;
-- Called only after Edge Function validates the user's JWT. Lock the row so
-- replacement and claiming cannot race and reinstate a retired code.
create or replace function public.claim_student_code_atomic(p_user_id uuid,p_hash text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_student public.students%rowtype;
begin
 if exists(select 1 from public.teacher_admins where auth_user_id=p_user_id) then raise exception 'Utiliza una sesión de alumno'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 select * into v_student from public.students where invite_code_hash=p_hash for update;
 if not found then raise exception 'El código no es correcto'; end if;
 if exists(select 1 from public.students where auth_user_id=p_user_id and id<>v_student.id) then raise exception 'Esta sesión ya está vinculada a otro código'; end if;
 update public.students set auth_user_id=p_user_id where id=v_student.id;
 return v_student.course_id;
end; $$;
revoke all on function public.claim_student_code_atomic(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_student_code_atomic(uuid,text) to service_role;
