import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"..");
const sites=[
  {name:"1.º Bachillerato",file:"index.html"},
  {name:"4.º ESO",file:"4eso/index.html"},
];
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const section=(source,start,end)=>{
  const begin=source.indexOf(start),finish=source.indexOf(end,begin+start.length);
  assert.ok(begin>=0 && finish>begin,"Expected block: "+start);
  return source.slice(begin,finish);
};
const sql=read("database/word_publication_reveal.sql");

for(const {name,file} of sites){
  test(name+": unpublished word gallery is teacher-only and explanation-free",()=>{
    const html=read(file);
    for(const id of ["tab-pending","pending-view","pending-list","pending-count","presentation-dialog","presentation-stage","presentation-close"]){
      assert.ok(html.includes('id="'+id+'"'),"Missing "+id);
    }
    assert.match(html, /if\(tab==="pending" && !isTeacher\) tab="dictionary"/);
    assert.match(html, /\$\("tab-pending"\)\.classList\.toggle\("hidden",!isTeacher\)/);
    const pending=section(html,"function pendingCardMarkup(","function renderPendingWords(");
    assert.ok(pending.includes("formatText(word.term)"));
    assert.ok(!pending.includes("word.definition") && !pending.includes("word.origin") && !pending.includes("word.story"),"Do not render private explanations before reveal");
    const loader=section(html,"async function loadPendingWords()","function presentPendingWord(");
    assert.match(loader,/if\(!isTeacher/);
    assert.match(loader,/\.eq\("course_id",SITE_COURSE_ID\)\.eq\("explained",false\)/);
  });
  test(name+": revealing is server-first, animated, reversible and course-isolated",()=>{
    const html=read(file);
    const reveal=section(html,"async function revealPendingWord(","async function init()");
    assert.ok(reveal.indexOf("await updateWordPublication(courseWordId,true)")<reveal.indexOf("back.innerHTML=explanationMarkup(word)"),"Persist before revealing");
    assert.ok(reveal.includes('card.classList.add("is-revealed")'));
    assert.ok(reveal.includes('card.classList.add("is-transferring")'));
    assert.ok(html.includes("Volver a marcar como no explicada"));
    const update=section(html,"async function updateWordPublication(","async function syncPublicationChange(");
    assert.ok(update.includes('.eq("course_id",SITE_COURSE_ID)'));
    assert.ok(update.includes('.eq("explained",!explained)'));
    assert.ok(!update.includes('from("votes")'),"Never delete or rewrite historical votes");
    assert.ok(html.includes('if($("presentation-dialog").open) $("presentation-dialog").close()'),"Close private presentation on logout");
  });
  test(name+": students refresh on both publication directions",()=>{
    const html=read(file);
    assert.ok(html.includes('table:"word_revisions"'));
    assert.ok(html.includes('filter:"course_id=eq."+SITE_COURSE_ID'));
    assert.ok(html.includes('void syncPublicationChange()'));
    assert.ok(html.includes('window.setInterval(()=>{if(!document.hidden) void syncPublicationChange();},30000)'));
    assert.ok(html.includes('if($("entry-dialog").open && !entries.some('),"Dismiss unpublished open card");
    assert.ok(html.includes('reviewDeck.some(w=>!entries.some('),"Dismiss unpublished study card");
    assert.ok(html.includes('if(!entries.some(e=>e.id===courseWordId) || !student'),"Voting requires currently visible word");
  });
  test(name+": fullscreen projection is readable and respects motion preferences",()=>{
    const html=read(file);
    assert.ok(html.includes(".presentation-dialog{position:fixed;inset:0"));
    assert.ok(html.includes("height:100dvh"));
    assert.ok(html.includes("@media(prefers-reduced-motion:reduce)"));
    assert.ok(html.includes("background:var(--paper);color:var(--ink)"),"Use light/dark/OLED theme tokens");
  });
}

test("The two course identifiers and PWA caches remain independent",()=>{
  const bach=read("index.html"),eso=read("4eso/index.html");
  const id=html=>{
    const direct=html.match(/const SITE_COURSE_ID = "([^"]+)"/)?.[1];
    if(direct) return direct;
    const alias=html.match(/const SITE_COURSE_ID = ([A-Z_0-9]+);/)?.[1];
    return alias ? html.match(new RegExp("const "+alias+" = \"([^\"]+)\""))?.[1] : null;
  };
  assert.ok(id(bach) && id(eso));
  assert.notEqual(id(bach),id(eso));
  assert.ok(read("sw.js").includes("palabra-shell-bach-v5"));
  assert.ok(read("4eso/sw.js").includes("palabra-shell-4eso-v5"));
});

test("Supabase migration hides pending explanations and prohibits pending votes",()=>{
  assert.match(sql,/DROP POLICY IF EXISTS "Public can read words" ON public\.words/);
  assert.match(sql,/CREATE POLICY "Public can read published words"/);
  assert.match(sql,/CREATE POLICY "Teacher can read unpublished words"/);
  assert.match(sql,/CREATE POLICY "Votes require explained word on insert"/);
  assert.match(sql,/CREATE POLICY "Votes require explained word on update"/);
  assert.equal((sql.match(/cw\.explained IS TRUE/g)||[]).length,4);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.word_revisions/);
  assert.match(sql,/ALTER TABLE public\.word_revisions ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/GRANT SELECT ON public\.word_revisions TO anon, authenticated/);
  assert.match(sql,/CREATE TRIGGER word_revisions_on_publication/);
  assert.match(sql,/ALTER PUBLICATION supabase_realtime ADD TABLE public\.word_revisions/);
  assert.ok(!/\bDELETE FROM public\.(votes|words|course_words|students)\b/i.test(sql));
});


for(const {name,file} of sites){
  test(name+": publication update enforces session, course and prior state",async()=>{
    const html=read(file);
    const code=section(html,"async function updateWordPublication(","async function syncPublicationChange(");
    const factory=new Function("client","isTeacher","currentUser","SITE_COURSE_ID",code+"return updateWordPublication;");
    const calls=[];
    const client={from(table){
      calls.push(["from",table]);
      return {
        update(value){calls.push(["update",value]);return this;},
        eq(key,value){calls.push(["eq",key,value]);return this;},
        select(key){calls.push(["select",key]);return Promise.resolve({data:[{id:"word-A"}],error:null});},
      };
    }};
    await assert.rejects(factory(client,false,null,"course-A")("word-A",true),/sesión de profesor/);
    assert.equal(calls.length,0,"Students cannot submit publication changes");
    await factory(client,true,{id:"teacher"},"course-A")("word-A",true);
    assert.deepEqual(calls,[
      ["from","course_words"],
      ["update",{explained:true,explained_at:calls[1][1].explained_at}],
      ["eq","id","word-A"],["eq","course_id","course-A"],["eq","explained",false],["select","id"]
    ]);
    assert.ok(typeof calls[1][1].explained_at==="string");
    calls.length=0;
    await factory(client,true,{id:"teacher"},"course-A")("word-A",false);
    assert.equal(calls[1][1].explained,false);
    assert.equal(calls[1][1].explained_at,null);
    assert.ok(calls.some(c=>c[0]==="eq"&&c[1]==="explained"&&c[2]===true));
  });
  test(name+": front card never inserts explanation or executable HTML",()=>{
    const html=read(file);
    const code=section(html,"function pendingCardMarkup(","function renderPendingWords(");
    const escapeHtml=value=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
    const front=new Function("escapeHtml","formatText",code+"return pendingCardMarkup;")(escapeHtml,escapeHtml);
    const card=front({id:"word-A",term:"<script>alert(1)</script>",origin:"private-origin",definition:"private-definition",story:"private-story"});
    assert.ok(card.includes("&lt;script&gt;"));
    for(const secret of ["private-origin","private-definition","private-story"])assert.ok(!card.includes(secret));
    assert.ok(card.includes('data-reveal-id="word-A"'));
    assert.ok(card.includes('data-present-id="word-A"'));
  });
}
