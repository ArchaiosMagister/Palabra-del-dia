import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium, webkit } from "playwright-core";

const root=path.resolve(import.meta.dirname,"..");
const sites=[
  {route:"/",course:"ec7e0b88-8304-4115-aa8d-fd703ac2b7ea",name:"Bachillerato"},
  {route:"/4eso/",course:"4e9c637b-96af-4385-b9fd-812d192c75ec",name:"4ESO"},
];

const mockSdk=String.raw`
(()=>{
  const role=window.__testRole;
  const site=location.pathname.startsWith("/4eso")?"4e9c637b-96af-4385-b9fd-812d192c75ec":"ec7e0b88-8304-4115-aa8d-fd703ac2b7ea";
  const hooks=[];
  window.__emitWordUpdate=()=>hooks.forEach(h=>h({new:{course_id:site}}));
  function from(table){
    const state={table,filters:[],orders:[],role,course:site};
    const query={
      select(value){state.select=value;return this},
      eq(key,value){state.filters.push({operator:"eq",key,value});return this},
      gt(key,value){state.filters.push({operator:"gt",key,value});return this},
      in(key,value){state.filters.push({operator:"in",key,value});return this},
      or(value){state.orFilter=value;return this},
      order(key,value){state.orders.push({key,value});return this},
      limit(value){state.limit=value;return this},
      update(value){state.update=value;return this},
      insert(value){state.insert=value;return this},
      upsert(value){state.upsert=value;return this},
      maybeSingle(){return window.__mockQuery({...state,single:true})},
      single(){return window.__mockQuery({...state,single:true})},
      then(resolve,reject){return window.__mockQuery(state).then(resolve,reject)},
    };
    return query;
  }
  const authUser={id:role==="teacher"?"mock-teacher":role==="student"?"mock-student":null};
  window.supabase={createClient:()=>({
    from,
    rpc:async()=>({data:1,error:null}),
    auth:{
      getSession:async()=>({data:{session:role==="visitor"?null:{user:authUser}},error:null}),
      getUser:async()=>({data:{user:authUser},error:null}),
      signInAnonymously:async()=>({data:{session:{user:authUser}},error:null}),
      signOut:async()=>({error:null}),
    },
    channel:()=>({
      on(_kind,_filter,fn){hooks.push(fn);return this},
      subscribe(){return this},
    }),
    functions:{invoke:async()=>({data:null,error:{message:"Not available in test"}})},
  })};
})();
`;

function mockDb(){
  const state={byCourse:new Map()};
  for(const site of sites){
    state.byCourse.set(site.course,[
      {id:site.name+"-prior",course_id:site.course,explained:true,explained_at:"2026-11-01T10:00:00.000Z",words:{id:"w0",term:"Antigua",origin:"Latin",definition:"Definición antigua",story:""}},
      {id:site.name+"-latest",course_id:site.course,explained:true,explained_at:"2026-11-12T10:00:00.000Z",words:{id:"w1",term:"Última explicada",origin:"Greek",definition:"Explicación más reciente",story:""}},
      {id:site.name+"-pending1",course_id:site.course,explained:false,explained_at:null,words:{id:"w2",term:"Pendiente uno",origin:"Latin",definition:"Secreto uno",story:""}},
      {id:site.name+"-pending2",course_id:site.course,explained:false,explained_at:null,words:{id:"w3",term:"Pendiente dos",origin:"Greek",definition:"Secreto dos",story:""}},
    ]);
  }
  // The first projection design shows complete entries, with scrolling when necessary.
  const bachLatest=state.byCourse.get(sites[0].course).find(row=>row.id==="Bachillerato-latest");
  bachLatest.words={...bachLatest.words,term:"Damocles",origin:"Griego",definition:"Mítico adulador áulico griego cuya historia se utilizaba para transmitir la enseñanza moral de que una posición de aparente privilegio conlleva una serie de contrapartidas que la pueden hacer indeseable.",story:"Damocles era un cortesano en el palacio del tirano Dionisio de Siracusa. En cierto momento, se dedicó a propagar lo supuestamente afortunado que era el gobernante de ostentar gran poder y riquezas, y Dionisio decidió darle un escarmiento: le cedió durante un día su puesto. Al final de ese mismo día se celebró un banquete en el que Damocles fue servido y tratado como un rey, con suntuosos manjares, bailarinas y lujos y disfrutes de todo tipo.\n\nSin embargo, al final del banquete, Damocles miró arriba y vio sobre su cabeza una espada que colgaba del techo atada por un pelo de la crin de un caballo. En ese momento, Damocles rechazó todo tipo de lujo y privilegio, abandonó el puesto del tirano Dionisio y dijo que ya no quería ser tan afortunado."};
  const longExplanation=("Una explicación extensa con ejemplos etimológicos para probar el giro original de la tarjeta. ").repeat(42);
  for(const rows of state.byCourse.values()) for(const row of rows) if(!row.explained) row.words.story=longExplanation;
  const votes=new Map();
  const fetchRows=async q=>{
    let rows=[];
    if(q.table==="courses") rows=[{id:q.course,name:"2026-2027",is_active:true}];
    else if(q.table==="teacher_admins") rows=q.role==="teacher"?[{auth_user_id:"mock-teacher"}]:[];
    else if(q.table==="students") rows=q.role==="student"?[{id:"mock-student-record",auth_user_id:"mock-student",course_id:q.course,student_group:"course",display_name:"Alumno de prueba",created_at:"2026-01-01"}]:[];
    else if(q.table==="course_words") rows=state.byCourse.get(q.course).map(row=>{const words={...row.words};if(!q.select?.includes("words(id,")) delete words.id;return {...row,words};});
    else if(q.table==="votes") rows=[...votes.entries()].map(([course_word_id,rating])=>({course_word_id,student_id:"mock-student-record",rating}));
    else if(q.table==="site_visit_counters") rows=[{course_id:q.course,total_visits:42}];
    else if(q.table==="word_proposals") rows=[];
    else if(q.table==="public_rankings"||q.table==="public_rankings_bach2")
      rows=state.byCourse.get(q.course).filter(row=>row.explained)
        .map(row=>({course_id:q.course,course_word_id:row.id,term:row.words.term,average_rating:votes.get(row.id)||null,vote_count:votes.has(row.id)?1:0}));
    if(q.table==="course_words"&&q.update){
      assert.equal(q.role,"teacher","Mock backend denies publication updates to students");
      const match=rows.filter(row=>q.filters.every(f=>f.operator!=="eq" || row[f.key]===f.value));
      for(const row of match){const ref=state.byCourse.get(q.course).find(item=>item.id===row.id);Object.assign(ref,q.update);}
      return {data:match.map(x=>({id:x.id})),error:null};
    }
    if(q.table==="votes"&&q.upsert){
      assert.equal(q.role,"student");
      const cw=state.byCourse.get(q.course).find(x=>x.id===q.upsert.course_word_id);
      if(!cw?.explained)return {data:null,error:{message:"Voting disabled"}};
      votes.set(q.upsert.course_word_id,q.upsert.rating);
      return {data:[q.upsert],error:null};
    }
    rows=rows.filter(row=>q.filters.every(f=>
      f.operator==="eq"?row[f.key]===f.value:
      f.operator==="gt"?row[f.key]>f.value:
      f.operator==="in"?f.value.includes(row[f.key]):true));
    for(const {key,value} of q.orders||[]){
      rows.sort((a,b)=>{
        const av=a[key]??null,bv=b[key]??null;
        if(av===null||bv===null)return av===bv?0:av===null?(value?.nullsFirst?-1:1):(value?.nullsFirst?1:-1);
        return (av<bv?-1:av>bv?1:0)*(value?.ascending===false?-1:1);
      });
    }
    if(q.limit)rows=rows.slice(0,q.limit);
    return {data:q.single?(rows[0]||null):rows,error:null};
  };
  return {state,votes,query:fetchRows};
}
const db=mockDb();

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost");
  const site=sites.find(x=>x.route===url.pathname);
  if(!site){res.writeHead(404);res.end();return;}
  const file=path.join(root,site.route==="/4eso/"?"4eso/index.html":"index.html");
  res.writeHead(200,{"content-type":"text/html;charset=utf-8","cache-control":"no-store"});
  res.end(fs.readFileSync(file));
});

test("Real-browser teacher projection and student realtime regression",async()=>{
  const listen=await new Promise(resolve=>server.listen(0,"127.0.0.1",()=>resolve(server.address())));
  let browser;
  try {
    const engine=process.env.BROWSER_ENGINE==="webkit"?webkit:chromium;
    const options=engine===webkit?{headless:true}:{headless:true,executablePath:process.env.CHROME_BIN||"/usr/bin/google-chrome",args:["--no-sandbox","--disable-dev-shm-usage"]};
    browser=await engine.launch(options);
    for(const site of sites){
      const teacherContext=await browser.newContext({viewport:{width:1024,height:768}});
      const studentContext=await browser.newContext({viewport:{width:390,height:844}});
      const teacher=await teacherContext.newPage(),student=await studentContext.newPage();
      const errors=[];
      for(const [page,role] of [[teacher,"teacher"],[student,"student"]]){
        await page.addInitScript(role=>window.__testRole=role,role);
        await page.exposeFunction("__mockQuery",q=>db.query(q));
        await page.route("https://cdn.jsdelivr.net/**",async route=>{
          if(route.request().url().includes("supabase-js"))await route.fulfill({status:200,contentType:"application/javascript",body:mockSdk});
          else await route.fulfill({status:200,contentType:"application/javascript",body:"window.QRCode=function(){};"});
        });
        await page.route("https://fonts.googleapis.com/**",route=>route.fulfill({status:200,contentType:"text/css",body:""}));
        await page.route("https://fonts.gstatic.com/**",route=>route.fulfill({status:204,body:""}));
        page.on("pageerror",error=>errors.push(role+": "+error.message));
        page.on("console",msg=>{if(["warning","error"].includes(msg.type()) && !msg.text().includes("Failed to load resource")) errors.push(role+" console: "+msg.text());});
      }
      const url="http://127.0.0.1:"+listen.port+site.route;
      await Promise.all([teacher.goto(url,{waitUntil:"domcontentloaded"}),student.goto(url,{waitUntil:"domcontentloaded"})]);
      await teacher.locator("#teacher-projection-open:visible").waitFor({timeout:15000});
      await student.locator("#cards .entry-preview").first().waitFor({timeout:15000});
      assert.equal(await student.locator("#tab-pending:visible").count(),0,"Student must not see unpublished section");
      assert.equal(await student.locator("#teacher-projection-open:visible").count(),0,"Student must not see projection");
      assert.equal(await student.locator("#cards .entry-preview").count(),2,"Only two explained fixtures visible");
      await teacher.locator("#teacher-projection-open").click();
      await teacher.locator("#presentation-dialog[open] #projection-word").waitFor();
      const expectedLatest=site.name==="Bachillerato"?"Damocles":"Última explicada";
      await teacher.waitForFunction(term=>document.querySelector("#projection-word")?.textContent.includes(term),expectedLatest,{timeout:10000});
      assert.equal(await teacher.locator("#projection-pagination").count(),0,"Original projection has no pagination");
      assert.equal(await teacher.locator("#projection-prev").count(),0,"Original projection has no slide controls");
      const projectionStyle=await teacher.evaluate(()=>{
        const dialog=document.querySelector("#presentation-dialog");
        const card=document.querySelector("#projection-word .word-card");
        const word=document.querySelector("#projection-word");
        return {overflow:getComputedStyle(dialog).overflowY,minHeight:getComputedStyle(card).minHeight,
          wordHeight:word.style.height,wordMaxWidth:getComputedStyle(word).maxWidth};
      });
      assert.equal(projectionStyle.overflow,"auto","Original presentation must allow document scrolling");
      assert.equal(projectionStyle.wordHeight,"","No dynamic card height in original projection");
      assert.ok(parseFloat(projectionStyle.minHeight)>100,"Original word card has minimum display height");
      if(site.name==="Bachillerato"){
        const content=await teacher.locator("#projection-word .word-card").innerText();
        assert.ok(content.includes("Damocles")&&content.includes("ya no quería ser tan afortunado"),
          "Damocles must appear in full on a single card, without dividing the story into slides");
      }
      assert.equal(await teacher.locator("#projection-random").isDisabled(),false);
      assert.equal(await teacher.locator("#projection-count").textContent(),"2 palabras pendientes.");
      await teacher.locator("#projection-random").click();
      assert.equal(await teacher.locator("#projection-random").isDisabled(),true,"The reveal button is disabled immediately after activation");
      await teacher.locator("#projection-word .pending-card.is-revealed").waitFor({timeout:15000});
      const revealed=await teacher.locator("#projection-word .pending-card").getAttribute("data-pending-id");
      const revealedCard=teacher.locator("#projection-word .pending-face-back");
      assert.ok((await revealedCard.innerText()).includes("Una explicación extensa"),"Long explanation stays intact after revealing");
      const backLayout=await revealedCard.evaluate(el=>({
        overflow:getComputedStyle(el).overflowY,
        pageBreak:!!el.closest("#projection-pagination"),
        storyPresent:el.textContent.includes("Una explicación extensa"),
      }));
      assert.equal(backLayout.overflow,"auto","Original flip card scrolls within its back face if necessary");
      assert.equal(backLayout.pageBreak,false);
      assert.equal(backLayout.storyPresent,true);
      assert.ok(db.state.byCourse.get(site.course).find(x=>x.id===revealed).explained,"Published before revealing");
      await student.evaluate(()=>window.__emitWordUpdate());
      await student.waitForFunction(()=>document.querySelectorAll("#cards .entry-preview").length===3,{timeout:10000});
      await teacher.waitForFunction(()=>!document.querySelector("#projection-random").disabled,{timeout:10000});
      assert.equal((await teacher.locator("#projection-count").textContent()).trim(),"1 palabra pendiente.");
      // Newly revealed word is available to the student in a separate browser context.
      const term=db.state.byCourse.get(site.course).find(x=>x.id===revealed).words.term;
      await student.locator("#cards .entry-preview").filter({hasText:term}).click();
      await student.locator("#entry-dialog .stars button").first().waitFor();
      await student.locator("#entry-dialog .stars button[data-rating='5']").click();
      await student.locator("#notice").filter({hasText:"Tu valoración se ha guardado"}).waitFor({timeout:10000});
      assert.equal(db.votes.get(revealed),5);
      // Reverse publication as a teacher, verify votes persist and the card disappears.
      await teacher.locator("#presentation-close").click();
      await teacher.locator("#tab-dictionary").click();
      await teacher.locator("#teacher-admin details.teacher-fold").first().locator("summary").click();
      const management=teacher.locator('#admin-list button[data-course-word="'+revealed+'"]');
      await management.waitFor();
      await management.click();
      await teacher.waitForFunction(id=>document.querySelector('#admin-list button[data-course-word="'+id+'"]')?.dataset.next==="true",revealed);
      await student.evaluate(()=>window.__emitWordUpdate());
      await student.waitForFunction(()=>document.querySelectorAll("#cards .entry-preview").length===2,{timeout:10000});
      assert.equal(db.votes.get(revealed),5,"Historical rating is never deleted by undo");
      assert.ok(errors.length===0,errors.join("\n"));
      await teacherContext.close();
      await studentContext.close();
    }
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
});
