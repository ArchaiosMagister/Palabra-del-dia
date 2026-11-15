import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const sql=read("database/teacher_word_editor.sql");

test("Teacher-only word manager RPC requires teacher identity and revokes public execution",()=>{
  assert.match(sql,/SECURITY DEFINER/i);
  assert.match(sql,/SET search_path TO ''/);
  assert.match(sql,/auth\.uid\(\)/);
  assert.match(sql,/FROM public\.teacher_admins/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.manage_teacher_word\(text,uuid,uuid,text,text,text,text\)/);
  assert.match(sql,/FROM PUBLIC, anon/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.manage_teacher_word\(text,uuid,uuid,text,text,text,text\)\s+TO authenticated/);
  assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|DELETE) ON public\.(?:words|course_words)/i);
});

test("New words start private and edits preserve published state, IDs and votes",()=>{
  assert.match(sql,/INSERT INTO public\.course_words\(course_id,word_id,explained\)\s+VALUES \(p_course_id,v_word_id,false\)/);
  assert.match(sql,/SELECT cw\.word_id, cw\.explained/);
  assert.match(sql,/WHERE cw\.id = p_course_word_id AND cw\.course_id = p_course_id/);
  assert.match(sql,/UPDATE public\.words\s+SET term = v_term/);
  assert.match(sql,/IF v_explained THEN\s+INSERT INTO public\.word_revisions/);
  assert.match(sql,/ON CONFLICT \(course_id\) DO UPDATE/);
  assert.doesNotMatch(sql,/\bDELETE\s+FROM\s+public\.(?:votes|words|course_words)/i);
  assert.doesNotMatch(sql,/\bUPDATE\s+public\.course_words\s+SET/i);
  assert.match(sql,/lower\(btrim\(w\.term\)\) = lower\(v_term\)/);
  assert.match(sql,/char_length\(v_story\) > 12000/);
  assert.match(sql,/FOR UPDATE/);
  assert.match(sql,/La ficha está compartida entre cursos/);
});

for(const name of ["index.html","4eso/index.html"]){
  test(name+": teacher editor is private, preview matches card and the RPC is atomic",()=>{
    const page=read(name);
    const teacher=page.slice(page.indexOf('<section id="teacher-admin"'),page.indexOf("</main>"));
    assert.match(teacher,/id="teacher-word-manager"/);
    assert.match(teacher,/id="teacher-word-form"/);
    for(const field of ["term","origin","definition","story"]){
      assert.match(teacher,new RegExp('id="teacher-word-'+field+'"'));
    }
    assert.match(teacher,/id="teacher-word-preview-card" class="word-card"/);
    assert.match(teacher,/id="teacher-word-save"/);
    assert.match(teacher,/id="teacher-word-new"/);
    assert.match(page,/function explanationMarkup\(word,showStatus=true\)/);
    assert.match(page,/explanationMarkup\(\{\s*\.\.\.values,term:values.term\|\|/);
    assert.match(page,/\},false\)/);
    assert.match(page,/client\.rpc\("manage_teacher_word",\{/);
    assert.match(page,/p_course_word_id:courseWordId/);
    assert.match(page,/if\(!isTeacher \|\| !currentUser \|\| teacherWordSaving\) return/);
    assert.match(page,/data-edit-course-word/);
    assert.match(page,/\.select\("id,explained,words\(term,origin,definition,story\)"\)/);
    assert.doesNotMatch(page,/client\.from\("words"\)\.insert\(/);
    assert.doesNotMatch(page,/client\.from\("words"\)\.update\(/);
    assert.match(page,/adminWordRows\.clear\(\)/);
  });
}
