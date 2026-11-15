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
    for(const id of ["tab-pending","pending-view","pending-list","pending-count","presentation-dialog","presentation-stage","presentation-close","teacher-projection-open","projection-word","projection-random","projection-count","projection-status"]){
      assert.ok(html.includes('id="'+id+'"'),"Missing "+id);
    }
    assert.match(html, /if\(tab==="pending" && !isTeacher\) tab="dictionary"/);
    assert.match(html, /\$\("tab-pending"\)\.classList\.toggle\("hidden",!isTeacher\)/);
    const pending=section(html,"function pendingCardMarkup(","function renderPendingWords(");
    assert.ok(pending.includes("formatText(word.term)"));
    assert.ok(!pending.includes("word.definition") && !pending.includes("word.origin") && !pending.includes("word.story"),"Do not render private explanations before reveal");
    const loader=section(html,"async function loadPendingWords()","function randomPendingIndex(");
    assert.match(loader,/if\(!isTeacher/);
    assert.match(loader,/fetchPendingCandidates\(\)/);
    const query=section(html,"async function fetchPendingCandidates()","function updateProjectionControls()");
    assert.match(query,/\.eq\("course_id",SITE_COURSE_ID\)\.eq\("explained",false\)/);
    assert.match(query,/row\.explained===false/);
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
    assert.ok(!card.includes('data-present-id='),"Random projection must not require manual selection");
    const projected=front({id:"word-A",term:"Alea",origin:"private-origin",definition:"private-definition",story:"private-story"},false);
    assert.ok(!projected.includes("data-reveal-id"),"Projection should not contain inert manual reveal buttons");
  });
}


for (const {name,file} of sites) {
  test(name+": teacher-only projection starts from the latest explained entry",async()=>{
    const html=read(file);
    assert.match(html,/id="teacher-projection-open" class="hidden"/);
    assert.match(html,/\$\("teacher-projection-open"\)\.classList\.toggle\("hidden",!isTeacher\)/);
    const code=section(html,"async function loadLastExplainedForProjection()","async function openProjectionMode()");
    const calls=[];
    const nodes={
      "presentation-dialog":{open:true},
      "projection-word":{innerHTML:"",dataset:{}},
      "projection-status":{textContent:""}
    };
    const $=key=>nodes[key];
    const mockQuery={
      select(x){calls.push(["select",x]);return this;},
      eq(k,v){calls.push(["eq",k,v]);return this;},
      order(k,v){calls.push(["order",k,v]);return this;},
      limit(n){calls.push(["limit",n]);return this;},
      maybeSingle(){calls.push(["maybeSingle"]);return Promise.resolve({data:{words:{term:"Última",definition:"Explicación"}}});}
    };
    const client={from(table){calls.push(["from",table]);return mockQuery;}};
    const factory=new Function("$","isTeacher","revealInProgress","client","SITE_COURSE_ID","explanationMarkup","requestAnimationFrame","fitProjectionCard",code+"return loadLastExplainedForProjection;");
    await factory($,false,false,client,"COURSE-X",()=>"<p>Explained</p>",cb=>cb(),()=>{})();
    assert.equal(calls.length,0,"No teacher, no private queries");
    await factory($,true,false,client,"COURSE-X",()=>"<p>Explained</p>",cb=>cb(),()=>{})();
    assert.ok(calls.some(x=>x[0]==="eq"&&x[1]==="explained"&&x[2]===true));
    assert.ok(calls.some(x=>x[0]==="eq"&&x[1]==="course_id"&&x[2]==="COURSE-X"));
    assert.ok(calls.some(x=>x[0]==="order"&&x[1]==="explained_at"&&x[2].ascending===false));
    assert.ok(calls.some(x=>x[0]==="order"&&x[1]==="explained_at"&&x[2].nullsFirst===false));
    assert.ok(calls.some(x=>x[0]==="limit"&&x[1]===1));
    assert.equal(nodes["projection-word"].innerHTML,'<article class="word-card"><p>Explained</p></article>');
    assert.ok(html.includes('id="projection-random" type="button" class="primary" disabled'));
  });

  test(name+": secure uniform random index and rejection sampling",()=>{
    const html=read(file);
    const code=section(html,"function randomPendingIndex(","async function fetchPendingCandidates()");
    let samples=[0xffffffff,7],count=0;
    const window={crypto:{getRandomValues(view){view[0]=samples[count++];return view;}}};
    const select=new Function("window",code+"return randomPendingIndex;")(window);
    assert.equal(select(3),7%3,"Biased remainder sample must be rejected");
    assert.equal(count,2);
    assert.throws(()=>select(0),RangeError);
    assert.throws(()=>select(-1),RangeError);
  });

  test(name+": one-click random reveal is persistent and duplicate-safe",async()=>{
    const html=read(file);
    const code=section(html,"async function revealRandomPendingWord()","async function updateWordPublication(");
    assert.ok(!code.includes("data-present-id"),"No manual selection in projection");
    assert.ok(code.includes("revealInProgress=true"),"Lock immediately");
    assert.ok(code.indexOf("await updateWordPublication(word.id,true)")<code.indexOf("back.innerHTML=explanationMarkup(word)"),"Never show explanation before publishing");

    const calls=[];
    const nodes={
      "presentation-dialog":{open:true},
      "projection-random":{disabled:false},
      "projection-status":{textContent:""},
      "projection-word":{
        innerHTML:"",
        querySelector(){return {querySelector(){return {append(){calls.push("append")}}},classList:{add(x){calls.push(["flip",x])}}};}
      }
    };
    const $=id=>nodes[id];
    const mockWindow={matchMedia(){return {matches:true}}};
    const document={createElement(){return {className:"",innerHTML:""}}};
    const dependencies=[
      "$","isTeacher","currentUser","revealInProgress","pendingWords",
      "fetchPendingCandidates","randomPendingIndex","pendingCardMarkup",
      "updateWordPublication","explanationMarkup","document","window",
      "requestAnimationFrame","syncPublicationChange","loadPendingWords","updateProjectionControls","fitProjectionCard"
    ];
    const factory=new Function(...dependencies,code+"return revealRandomPendingWord;");
    const build=(teacher=true,candidates=[{id:"A",term:"A"},{id:"B",term:"B"}])=>
      factory($,teacher,{id:"teacher"},false,[],
        async()=>{calls.push("fetch");return candidates},
        n=>{calls.push(["choose",n]);return n-1},
        word=>{calls.push(["front",word.id]);return "front"},
        async(id,explained)=>{calls.push(["publish",id,explained])},
        word=>"<p>"+word.id+"</p>",
        document,mockWindow,callback=>callback(),
        async options=>{calls.push(["sync",options])},
        async()=>{calls.push("reload-pending")},
        ()=>{calls.push("update-controls")},()=>{calls.push("fit")});
    await build()();
    assert.deepEqual(calls.slice(0,4),["fetch",["choose",2],["front","B"],["publish","B",true]]);
    assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==="flip"));
    assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==="sync"&&x[1].preserveProjection===true));
    assert.equal(nodes["projection-status"].textContent,"Palabra revelada y votación desbloqueada.");
    calls.length=0;
    await build(false)();
    assert.equal(calls.length,0,"Student cannot trigger a reveal");
    calls.length=0;
    await build(true,[])();
    assert.ok(!calls.some(x=>Array.isArray(x)&&x[0]==="publish"),"No pending words, no write");
    assert.equal(nodes["projection-random"].disabled,true);
  });

  test(name+": reduced motion, isolated PWA and logout behavior are retained",()=>{
    const html=read(file);
    assert.match(html,/matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
    assert.match(html,/if\(\$\("presentation-dialog"\)\.open\) \$\("presentation-dialog"\)\.close\(\)/);
    assert.ok(!html.includes('data-present-id'),"Presentation no longer manually selects pending words");
    assert.ok(html.includes('client.channel("publication-"+SITE_COURSE_ID)'),"Course-scoped realtime subscription");
  });
}
