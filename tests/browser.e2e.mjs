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
  const longExplanation=("Una explicación con abundantes ejemplos etimológicos y referencias al vocabulario estudiado en clase. ").repeat(42);
  for(const rows of state.byCourse.values()) for(const row of rows) if(!row.explained) row.words.story=longExplanation;
  // Regression: actual public Bachillerato entry that previously generated 174 one-word slides.
  const damocles=state.byCourse.get(sites[0].course).find(row=>row.id==="Bachillerato-latest");
  damocles.words={...damocles.words,term:"Damocles",origin:"Griego",definition:"Mítico adulador áulico griego cuya historia se utilizaba para transmitir la enseñanza moral de que una posición de aparente privilegio conlleva una serie de contrapartidas que la pueden hacer indeseable.",story:"Damocles era un cortesano en el palacio del tirano Dionisio de Siracusa. En cierto momento, se dedicó a propagar lo supuestamente afortunado que era el gobernante de ostentar gran poder y riquezas, y Dionisio decidió darle un escarmiento: le cedió durante un día su puesto. Al final de ese mismo día se celebró un banquete en el que Damocles fue servido y tratado como un rey, con suntuosos manjares, bailarinas y lujos y disfrutes de todo tipo.\n\nSin embargo, al final del banquete, Damocles miró arriba y vio sobre su cabeza una espada que colgaba del techo atada por un pelo de la crin de un caballo. En ese momento, Damocles rechazó todo tipo de lujo y privilegio, abandonó el puesto del tirano Dionisio y dijo que ya no quería ser tan afortunado."};
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
      async function assertProjectionFits(label) {
        const sizes=await teacher.evaluate(()=>{
          const dialog=document.querySelector("#presentation-dialog");
          const word=document.querySelector("#projection-word");
          const face=word?.querySelector(".pending-face-back, .word-card");
          const controls=document.querySelector(".projection-controls");
          return {dialogOverflow:dialog.scrollHeight-dialog.clientHeight,
            faceOverflow:face?face.scrollHeight-face.clientHeight:0,
            faceScroll:face?.scrollHeight,faceClient:face?.clientHeight,
            faceWidth:face?.getBoundingClientRect().width,probeWidth:word?.dataset.probeWidth,probeHeight:word?.dataset.probeHeight,
            innerWidth:face?.parentElement?.getBoundingClientRect().width,
            currentScale:face?.style.getPropertyValue("--projection-scale"),
            page:document.querySelector("#projection-page-count")?.textContent,
            pageButtonsVisible:getComputedStyle(document.querySelector("#projection-pagination")).display,
            faceTextLength:face?.textContent.length,
            faceBottomBlank:face && face.children.length ? Math.round(face.getBoundingClientRect().bottom-face.lastElementChild.getBoundingClientRect().bottom):0,
            cardWidth:word?.clientWidth,
            wordHeight:word?.clientHeight,
            controlsBottom:controls?.getBoundingClientRect().bottom,
            windowHeight:window.innerHeight};
        });
        assert.ok(sizes.dialogOverflow<=3,label+": dialog must not scroll: "+JSON.stringify(sizes));
        assert.ok(sizes.faceOverflow<=3,label+": content must fit its slide: "+JSON.stringify(sizes));
        assert.ok(sizes.wordHeight>100,label+": card has usable height: "+JSON.stringify(sizes));
        assert.ok(sizes.cardWidth<=790,label+": card should not stretch across the whole iPad: "+JSON.stringify(sizes));
        if(label.includes("latest")) {
          assert.ok(sizes.faceBottomBlank<=66,label+": no excess blank space within the card: "+JSON.stringify(sizes));
          if(site.name!=="Bachillerato") {
            assert.ok(sizes.wordHeight<=290,label+": short card should fit its natural content: "+JSON.stringify(sizes));
          }
        }
        assert.ok(sizes.wordHeight<=Math.min(440,sizes.windowHeight*.54)+4,
          label+": projected card must remain compact: "+JSON.stringify(sizes));
        assert.ok(sizes.controlsBottom<=sizes.windowHeight+3,label+": controls not clipped: "+JSON.stringify(sizes));
      }
      await teacher.locator("#presentation-dialog[open] #projection-word").waitFor();
      const expectedLatest=site.name==="Bachillerato"?"Damocles":"Última explicada";
      await teacher.waitForFunction(term=>document.querySelector("#projection-word")?.textContent.includes(term),expectedLatest,{timeout:10000});
      await teacher.waitForFunction(()=>document.querySelector("#projection-word")?.dataset.layoutReady==="true",undefined,{timeout:10000});
      assert.equal(await teacher.locator("#projection-random").isDisabled(),false);
      assert.equal(await teacher.locator("#projection-count").textContent(),"2 palabras pendientes.");
      if(site.name==="Bachillerato") {
        const pageLabel=(await teacher.locator("#projection-page-count").textContent()).trim();
        const count=pageLabel?Number(pageLabel.split(" / ")[1]):1;
        console.log("DAMOCLES-PAGINATION",site.name,pageLabel||"1 / 1");
        assert.ok(Number.isInteger(count)&&count>=1&&count<=7,
          "Damocles should be presented in a few readable slides, not one slide per word: "+pageLabel);
        const firstSlideWords=(await teacher.locator("#projection-word .word-card").innerText()).split(/\s+/).filter(Boolean).length;
        assert.ok(firstSlideWords>=16,"Damocles must show a readable block, not one word: "+firstSlideWords);
        for(let i=1;i<count;i++) await teacher.locator("#projection-next").click();
        const lastSlide=await teacher.locator("#projection-word .word-card").innerText();
        assert.ok(lastSlide.includes("afortunado"),"The ending of the Damocles story must be preserved");
        for(let i=count-1;i>0;i--) await teacher.locator("#projection-prev").click();
      }
      await assertProjectionFits(site.name+" latest landscape");
      await teacher.setViewportSize({width:768,height:1024});
      await teacher.waitForTimeout(100);
      await assertProjectionFits(site.name+" latest portrait");
      await teacher.setViewportSize({width:1024,height:768});
      await teacher.waitForTimeout(100);
      await assertProjectionFits(site.name+" latest landscape restored");
      await teacher.locator("#projection-random").click();
      assert.equal(await teacher.locator("#projection-random").isDisabled(),true,"The reveal button is disabled immediately after activation");
      await teacher.locator("#projection-word .pending-card.is-revealed").waitFor({timeout:15000});
      const revealed=await teacher.locator("#projection-word .pending-card").getAttribute("data-pending-id");
      await teacher.waitForFunction(()=>document.querySelector("#projection-pagination").classList.contains("is-active"),{timeout:10000});
      await assertProjectionFits(site.name+" revealed landscape");
      const firstPage=await teacher.locator("#projection-page-count").textContent();
      const pageCount=Number(firstPage.split(" / ")[1]);
      assert.ok(pageCount>=2&&pageCount<=35,"The very long mock story must not produce one-word slides: "+firstPage);
      const firstSlideWordCount=(await teacher.locator("#projection-word .pending-face-back").innerText()).split(/\s+/).filter(Boolean).length;
      assert.ok(firstSlideWordCount>=4,"The first slide must contain more than the title: "+firstPage+", words="+firstSlideWordCount);
      assert.match(firstPage,/^1 \/ (?:[2-9]|[1-9][0-9]+)$/,"Long explanation must be paginated without scroll");
      await teacher.locator("#projection-next").click();
      assert.match(await teacher.locator("#projection-page-count").textContent(),/^2 \/ /);
      await assertProjectionFits(site.name+" second page");
      await teacher.setViewportSize({width:768,height:1024});
      await teacher.waitForTimeout(120);
      await assertProjectionFits(site.name+" revealed portrait");
      await teacher.setViewportSize({width:1024,height:768});
      await teacher.waitForTimeout(120);
      await assertProjectionFits(site.name+" revealed landscape after rotation");
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
