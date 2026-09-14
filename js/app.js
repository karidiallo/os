import { categories, loadLocal, persistLocal, dateKey, isoAt, localParts, newDay } from "./state.js";
import { getLevelInfo, xpForTask } from "./levels.js";
import { getSession, sendMagicLink, onAuth, cloudHasData, hydrateCloud, syncCloud } from "./supabase.js";

let state=loadLocal();
let user=null, cloudReady=false, syncTimer=null;
const todayKey=dateKey();
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const uuid=()=>crypto.randomUUID();

function ensureDay(){ if(!state.days[todayKey]) state.days[todayKey]=newDay(); return state.days[todayKey]; }
function finance(){ if(!state.financeSnapshots[todayKey]) state.financeSnapshots[todayKey]={cash:"0 zł",protected:"0 zł",incoming:"0 zł",bills:"0 zł",revenueToday:"0 zł",revenueMonth:"0 zł"}; return state.financeSnapshots[todayKey]; }
function body(){ if(!state.bodyLogs[todayKey]) state.bodyLogs[todayKey]={steps:"",weight:"",water:"",sleep:"",workout:false}; return state.bodyLogs[todayKey]; }
function done(t){return t.status==="done"||!!t.completedAt}
function scheduled(t){return !!t.scheduledAt&&!done(t)}
function catLabel(id){return categories.find(c=>c.id===id)?.label||id}
function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),1500)}
function syncStatus(msg){$("#syncStatus").textContent="Chmura: "+msg}
function save(){
  persistLocal(state);
  if(cloudReady&&user){clearTimeout(syncTimer);syncTimer=setTimeout(async()=>{try{syncStatus("zapisywanie…");await syncCloud(user.id,state);syncStatus("zsynchronizowano")}catch(e){console.error(e);syncStatus("offline / błąd")}},450)}
}

function calculateCapacity(){
  const i=ensureDay().interview;
  const sleepHoursScore=Math.max(0,10-Math.abs((i.sleepHours||0)-7.5)*2);
  const timeScore=Math.min(10,(i.availableHours||0)/6*10);
  let score=i.energy*.34+i.sleepQuality*.18+sleepHoursScore*.12+(11-i.overload)*.22+timeScore*.14;
  score=Math.max(1,Math.min(10,score));
  let mode,label,copy;
  if(score>=7&&i.availableHours>=4){mode="full";label="Dzisiaj robimy pełny dzień.";copy="Masz zasoby na trzy ważne wyniki i kilka godzin realnego outputu. Nadal pilnujemy priorytetów."}
  else if(score>=4){mode="standard";label="Dzisiaj robimy dzień standardowy.";copy="Najważniejsze są 2–3 sensowne wyniki, jeden ruch finansowy i podstawy życia."}
  else{mode="survival";label="Dzisiaj robimy dzień minimalny.";copy="Jedno najważniejsze zadanie, jeden mały ruch finansowy i podstawy. Nie dokładamy sztucznego obciążenia."}
  ensureDay().capacity={score,percent:Math.round(score*10),mode,label,copy};
}

/* auth */
async function initAuth(){
  $("#authButton").onclick=async()=>{
    const email=$("#authEmail").value.trim(); if(!email)return;
    $("#authMessage").textContent="Wysyłam link…";
    const {error}=await sendMagicLink(email);
    $("#authMessage").textContent=error?error.message:"Link wysłany. Otwórz email i kliknij link.";
  };
  const session=await getSession(); await handleSession(session);
  onAuth(handleSession);
}
async function handleSession(session){
  if(!session?.user){$("#authGate").classList.remove("hidden");cloudReady=false;syncStatus("wylogowano");return}
  user=session.user;$("#authGate").classList.add("hidden");syncStatus("pobieranie…");
  try{
    if(await cloudHasData(user.id)){state=await hydrateCloud(user.id);persistLocal(state)}
    else await syncCloud(user.id,state);
    cloudReady=true;syncStatus("zsynchronizowano");renderAll();openBriefingIfNeeded();
  }catch(e){console.error(e);syncStatus("błąd synchronizacji")}
}

/* briefing */
let briefStep=0;
const steps=[
  {render:()=>`<h2>Jak się dziś czujesz?</h2><p class="helper">Napisz własnymi słowami, co dzieje się w głowie i ciele.</p><textarea id="qFeeling">${esc(ensureDay().interview.feeling||"")}</textarea>`,save:()=>ensureDay().interview.feeling=$("#qFeeling").value.trim()},
  {render:()=>`<h2>Ile masz energii?</h2><div class="big-num" id="energyNum">${ensureDay().interview.energy}</div><input id="qEnergy" type="range" min="1" max="10" value="${ensureDay().interview.energy}">`,bind:()=>$("#qEnergy").oninput=e=>$("#energyNum").textContent=e.target.value,save:()=>ensureDay().interview.energy=Number($("#qEnergy").value)},
  {render:()=>`<h2>Jak wyglądał sen?</h2><label>Godziny<input id="qSleepHours" type="number" step=".5" value="${ensureDay().interview.sleepHours}"></label><label>Jakość 1–10<input id="qSleepQuality" type="number" min="1" max="10" value="${ensureDay().interview.sleepQuality}"></label>`,save:()=>{ensureDay().interview.sleepHours=Number($("#qSleepHours").value)||0;ensureDay().interview.sleepQuality=Number($("#qSleepQuality").value)||1}},
  {render:()=>`<h2>Jak przeciążona jest głowa?</h2><div class="big-num" id="overNum">${ensureDay().interview.overload}</div><input id="qOver" type="range" min="1" max="10" value="${ensureDay().interview.overload}">`,bind:()=>$("#qOver").oninput=e=>$("#overNum").textContent=e.target.value,save:()=>ensureDay().interview.overload=Number($("#qOver").value)},
  {render:()=>`<h2>Ile realnego czasu masz dziś na pracę?</h2><select id="qHours"><option value="1">około 1 godziny</option><option value="2">około 2 godzin</option><option value="3">około 3 godzin</option><option value="4">około 4 godzin</option><option value="5">około 5 godzin</option><option value="6">6 godzin lub więcej</option></select>`,bind:()=>$("#qHours").value=String(ensureDay().interview.availableHours||4),save:()=>ensureDay().interview.availableHours=Number($("#qHours").value)},
  {render:()=>{calculateCapacity();const c=ensureDay().capacity;return `<h2>${esc(c.label)}</h2><p class="helper">${esc(c.copy)}</p><div class="chips"><span>Pojemność ${c.percent}%</span><span>Energia ${ensureDay().interview.energy}/10</span><span>${ensureDay().interview.availableHours} h pracy</span></div>`},save:()=>{}}
];
function renderBrief(){
  const s=steps[briefStep];$("#briefingQuestion").innerHTML=s.render();s.bind?.();
  $("#briefingProgress").innerHTML=steps.map((_,i)=>`<i class="${i<=briefStep?"on":""}"></i>`).join("");
  $("#briefingBack").style.visibility=briefStep===0?"hidden":"visible";
  $("#briefingNext").textContent=briefStep===steps.length-1?"Otwórz dzień":"Dalej";
}
function openBriefingIfNeeded(){if(!ensureDay().interviewCompleted){$("#morningGate").classList.remove("hidden");renderBrief()}}
$("#briefingBack").onclick=()=>{if(briefStep){briefStep--;renderBrief()}};
$("#briefingNext").onclick=()=>{steps[briefStep].save();if(briefStep<steps.length-1){if(briefStep===4)calculateCapacity();briefStep++;save();renderBrief();return}calculateCapacity();ensureDay().interviewCompleted=true;save();$("#morningGate").classList.add("hidden");renderAll()};

/* nav */
$$(".nav").forEach(b=>b.onclick=()=>{const name=b.dataset.view;$$(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));$$(".nav").forEach(n=>n.classList.toggle("active",n===b));window.scrollTo({top:0,behavior:"smooth"});renderAll()});

/* tasks modal */
let taskStep=0,draft={title:"",category:"digitalmap",priority:"P2",estimateMinutes:30};
function openTask(){taskStep=0;draft={title:"",category:"digitalmap",priority:"P2",estimateMinutes:30};$("#taskModal").classList.remove("hidden");renderTaskStep()}
["addTaskHero","addTaskSide","addTaskTasks"].forEach(id=>$("#"+id).onclick=openTask);
$("#taskCancel").onclick=()=>$("#taskModal").classList.add("hidden");
$("#taskBack").onclick=()=>{if(taskStep){taskStep--;renderTaskStep()}};
$("#taskNext").onclick=()=>{
  if(taskStep===0){draft.title=$("#newTaskTitle").value.trim();if(!draft.title){toast("Wpisz nazwę zadania.");return}}
  if(taskStep<4){taskStep++;renderTaskStep();return}
  state.tasks.unshift({id:uuid(),title:draft.title,category:draft.category,priority:draft.priority,estimateMinutes:draft.estimateMinutes,actualMinutes:null,scheduledAt:null,completedAt:null,status:"unscheduled",createdAt:new Date().toISOString()});
  save();$("#taskModal").classList.add("hidden");renderAll();toast("Zapisane jako niezaplanowane.");
};
function renderTaskStep(){
  const root=$("#taskStep");
  if(taskStep===0)root.innerHTML=`<label>Co chcesz zrobić?<input id="newTaskTitle" placeholder="np. znaleźć 10 leadów"></label>`;
  if(taskStep===1)root.innerHTML=`<p class="helper">Do czego to należy?</p><div class="choices">${categories.map(c=>`<button class="choice ${draft.category===c.id?"selected":""}" data-cat="${c.id}"><strong>${c.label}</strong><small>${c.desc}</small></button>`).join("")}</div>`;
  if(taskStep===2)root.innerHTML=`<p class="helper">Jak ważne jest to zadanie?</p><div class="choices">${["P1","P2","P3"].map(p=>`<button class="choice ${draft.priority===p?"selected":""}" data-pr="${p}"><strong>${p}</strong><small>${p==="P1"?"Krytyczne":p==="P2"?"Ważne":"Dodatkowe"}</small></button>`).join("")}</div>`;
  if(taskStep===3)root.innerHTML=`<p class="helper">Ile realnie to zajmie?</p><div class="choices">${[15,30,45,60,90].map(m=>`<button class="choice ${draft.estimateMinutes===m?"selected":""}" data-minutes="${m}"><strong>${m} min</strong></button>`).join("")}</div>`;
  if(taskStep===4)root.innerHTML=`<h3>Gotowe.</h3><p class="helper">Status po zapisaniu: <strong>Niezaplanowane</strong>. Dopiero blok w kalendarzu zamienia to w realny plan.</p>`;
  $$("[data-cat]").forEach(b=>b.onclick=()=>{draft.category=b.dataset.cat;renderTaskStep()});
  $$("[data-pr]").forEach(b=>b.onclick=()=>{draft.priority=b.dataset.pr;renderTaskStep()});
  $$("[data-minutes]").forEach(b=>b.onclick=()=>{draft.estimateMinutes=Number(b.dataset.minutes);renderTaskStep()});
  $("#taskBack").style.visibility=taskStep===0?"hidden":"visible";
  $("#taskNext").textContent=taskStep===4?"Zapisz":"Dalej";
}

/* task/calendar completion */
function completeTask(id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return;
  t.completedAt=new Date().toISOString();t.status="done";
  const gain=xpForTask(t);state.xp=(state.xp||0)+gain;
  state.proof.unshift({id:uuid(),date:todayKey,text:`Ukończone: ${t.title}`,source:"task",createdAt:new Date().toISOString()});
  save();renderAll();toast(`+${gain} XP · zadanie ukończone`);
}
function slots(){const out=[];for(let h=7;h<=22;h++){out.push(`${String(h).padStart(2,"0")}:00`,`${String(h).padStart(2,"0")}:30`)}out.push("23:00");return out}
function taskAt(time){return state.tasks.find(t=>scheduled(t)&&localParts(t.scheduledAt).date===todayKey&&localParts(t.scheduledAt).time===time)}

/* render */
function renderAll(){renderToday();renderTasks();renderWeek();renderMoney();renderProjects();renderBody();renderProof();renderReviews();renderIdeas()}
function renderToday(){
  const d=ensureDay();$("#todayDate").textContent=new Date().toLocaleDateString("pl-PL",{weekday:"long",day:"numeric",month:"long"}).toUpperCase();
  $("#modeStat").textContent=d.capacity.mode==="full"?"Pełny":d.capacity.mode==="survival"?"Minimalny":"Standardowy";
  $("#capacityStat").textContent=(d.capacity.percent||0)+"%";$("#streakStat").textContent=state.streak||0;$("#capacityTitle").textContent=d.capacity.label||"Dzisiaj robimy dzień standardowy.";$("#capacityCopy").textContent=d.capacity.copy||"";
  $("#capacityMeta").innerHTML=`<span>Energia ${d.interview.energy}/10</span><span>Sen ${d.interview.sleepHours} h</span><span>${d.interview.availableHours} h pracy</span>`;
  const lvl=getLevelInfo(state.xp||0);$("#levelName").textContent=`Level ${lvl.level} · ${lvl.title}`;$("#levelFinance").textContent=lvl.finance;$("#levelBar").style.width=lvl.progress+"%";$("#levelXp").textContent=lvl.next?`${lvl.currentXp} / ${lvl.needed} XP`:"MAX LEVEL";$("#actualCash").textContent=`Realne cash: ${finance().cash||"0 zł"}`;
  const top=$("#top3Grid");top.innerHTML="";d.top3.forEach((v,i)=>{const el=document.createElement("div");el.className="outcome";el.innerHTML=`<b>${i+1}</b><div><label>Wynik ${i+1}</label><input value="${esc(v)}" placeholder="Co ma być prawdą pod koniec dnia?"></div>`;el.querySelector("input").oninput=e=>{d.top3[i]=e.target.value;save()};top.appendChild(el)});
  const cal=$("#todayCalendar");cal.innerHTML="";for(const time of slots()){const row=document.createElement("div");row.className="slot";row.innerHTML=`<div class="slot-time">${time}</div><div class="slot-drop"></div>`;const drop=row.querySelector(".slot-drop"),t=taskAt(time);if(t){drop.innerHTML=`<div class="task-block"><div><strong>${esc(t.title)}</strong><small>${t.estimateMinutes} min · ${esc(catLabel(t.category))} · ${t.priority}</small></div><button class="done">✓</button></div>`;drop.querySelector(".done").onclick=()=>completeTask(t.id)}drop.ondragover=e=>{e.preventDefault();drop.classList.add("drag")};drop.ondragleave=()=>drop.classList.remove("drag");drop.ondrop=e=>{e.preventDefault();drop.classList.remove("drag");const t=state.tasks.find(x=>x.id===e.dataTransfer.getData("text/plain"));if(!t)return;t.scheduledAt=isoAt(todayKey,time);t.status="scheduled";save();renderAll();toast(`Zaplanowano ${time}`)};cal.appendChild(row)}
  const uns=$("#unscheduledList");uns.innerHTML="";const list=state.tasks.filter(t=>!done(t)&&!t.scheduledAt).slice(0,7);if(!list.length)uns.innerHTML='<div class="helper">Brak niezaplanowanych zadań.</div>';for(const t of list){const el=document.createElement("div");el.className="unscheduled";el.draggable=true;el.innerHTML=`<strong>${esc(t.title)}</strong><small>${esc(catLabel(t.category))} · ${t.priority} · ${t.estimateMinutes} min</small><span class="badge">Niezaplanowane</span>`;el.ondragstart=e=>e.dataTransfer.setData("text/plain",t.id);uns.appendChild(el)}
  $("#moneyMove").value=d.moneyMove||"";$("#moneyMove").oninput=e=>{d.moneyMove=e.target.value;save();$("#moneyMoveFinance").value=e.target.value};
  $$("[data-min]").forEach(i=>{i.checked=!!d.minimums[i.dataset.min];i.onchange=e=>{d.minimums[e.target.dataset.min]=e.target.checked;save()}});
}
$("#clearToday").onclick=()=>{state.tasks.forEach(t=>{if(t.scheduledAt&&localParts(t.scheduledAt).date===todayKey&&!done(t)){t.scheduledAt=null;t.status="unscheduled"}});save();renderAll()};

function renderTasks(){
  $("#unscheduledCount").textContent=state.tasks.filter(t=>!done(t)&&!t.scheduledAt).length;$("#scheduledCount").textContent=state.tasks.filter(scheduled).length;$("#p1Count").textContent=state.tasks.filter(t=>!done(t)&&t.priority==="P1").length;$("#doneCount").textContent=state.tasks.filter(done).length;
  const cf=$("#categoryFilter"),old=cf.value||"all";cf.innerHTML='<option value="all">Wszystkie kategorie</option>'+categories.map(c=>`<option value="${c.id}">${c.label}</option>`).join("");cf.value=old;
  const sf=$("#statusFilter").value,pf=cf.value;let list=[...state.tasks];if(sf==="open")list=list.filter(t=>!done(t));if(sf==="unscheduled")list=list.filter(t=>!done(t)&&!t.scheduledAt);if(sf==="scheduled")list=list.filter(scheduled);if(sf==="done")list=list.filter(done);if(pf!=="all")list=list.filter(t=>t.category===pf);
  $("#tasksTable").innerHTML=list.map(t=>`<div class="task-row"><div><strong>${esc(t.title)}</strong><br><span>${esc(catLabel(t.category))}</span></div><span>${t.priority}</span><span>${t.estimateMinutes} min</span><span>${t.scheduledAt?new Date(t.scheduledAt).toLocaleString("pl-PL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"Niezaplanowane"}</span><button class="btn ghost" data-delete="${t.id}">Usuń</button></div>`).join("")||'<div class="helper" style="padding:16px">Brak zadań.</div>';
  $$("[data-delete]").forEach(b=>b.onclick=()=>{state.tasks=state.tasks.filter(t=>t.id!==b.dataset.delete);save();renderAll()});
}
$("#statusFilter").onchange=renderTasks;$("#categoryFilter").onchange=renderTasks;

function renderWeek(){
  const root=$("#weekGrid");root.innerHTML="";const now=new Date(),dn=now.getDay()||7,monday=new Date(now);monday.setHours(0,0,0,0);monday.setDate(now.getDate()-dn+1);
  for(let i=0;i<7;i++){const d=new Date(monday);d.setDate(monday.getDate()+i);const key=dateKey(d),tasks=state.tasks.filter(t=>scheduled(t)&&localParts(t.scheduledAt).date===key).sort((a,b)=>new Date(a.scheduledAt)-new Date(b.scheduledAt));root.innerHTML+=`<div class="week-day ${key===todayKey?"today":""}"><div class="week-head"><strong>${d.toLocaleDateString("pl-PL",{weekday:"short"})}</strong><span>${d.toLocaleDateString("pl-PL",{day:"numeric",month:"short"})}</span></div><div class="week-body">${tasks.map(t=>`<div class="week-task"><strong>${localParts(t.scheduledAt).time}</strong><br>${esc(t.title)}</div>`).join("")||'<span class="helper">Brak bloków</span>'}</div></div>`}
}
function renderMoney(){
  const f=finance(),defs=[["cash","Dostępna gotówka"],["protected","Środki chronione"],["incoming","Spodziewane wpływy"],["bills","Wydatki 7 dni"],["revenueToday","Przychód dziś"],["revenueMonth","Przychód miesiąca"]];
  $("#financeGrid").innerHTML=defs.map(([k,l])=>`<div class="panel finance-card"><span>${l}</span><input data-fin="${k}" value="${esc(f[k])}"></div>`).join("");
  $$("[data-fin]").forEach(i=>i.onchange=e=>{f[e.target.dataset.fin]=e.target.value;save();renderToday()});$("#moneyMoveFinance").value=ensureDay().moneyMove||"";$("#moneyMoveFinance").oninput=e=>{ensureDay().moneyMove=e.target.value;save();$("#moneyMove").value=e.target.value}
}
function renderProjects(){
  $("#projectsGrid").innerHTML=Object.entries(state.projects).map(([id,p])=>`<div class="panel content-card project-card"><small>Projekt</small><h3>${esc(p.label)}</h3><label>Status<select data-ps="${id}"><option ${p.status==="Główny"?"selected":""}>Główny</option><option ${p.status==="Aktywny"?"selected":""}>Aktywny</option><option ${p.status==="Podtrzymanie"?"selected":""}>Podtrzymanie</option><option ${p.status==="Wstrzymany"?"selected":""}>Wstrzymany</option></select></label><label>Następny ruch<input data-pn="${id}" value="${esc(p.nextAction||"")}"></label></div>`).join("");
  $$("[data-ps]").forEach(x=>x.onchange=e=>{state.projects[e.target.dataset.ps].status=e.target.value;save()});$$("[data-pn]").forEach(x=>x.onchange=e=>{state.projects[e.target.dataset.pn].nextAction=e.target.value;save()})
}
function renderBody(){const b=body();$("#bodyEnergy").textContent=ensureDay().interview.energy;$("#bodyEnergyBar").style.width=(ensureDay().interview.energy*10)+"%";for(const [id,key] of [["bodySteps","steps"],["bodyWeight","weight"],["bodyWater","water"],["bodySleep","sleep"]]){$("#"+id).value=b[key];$("#"+id).onchange=e=>{b[key]=e.target.value;save()}}$("#bodyWorkout").checked=!!b.workout;$("#bodyWorkout").onchange=e=>{b.workout=e.target.checked;save()}}
function renderProof(){const month=todayKey.slice(0,7);$("#proofCount").textContent=state.proof.length;$("#proofMonthCount").textContent=state.proof.filter(p=>String(p.date).startsWith(month)).length;$("#proofTasksCount").textContent=state.tasks.filter(done).length;$("#proofLevel").textContent=getLevelInfo(state.xp||0).level;$("#proofGrid").innerHTML=state.proof.map(p=>`<div class="panel content-card"><small>${p.date}</small><h3>${esc(p.text)}</h3></div>`).join("")||'<span class="helper">Brak dowodów.</span>'}
$("#addProof").onclick=()=>{const v=$("#proofInput").value.trim();if(!v)return;state.proof.unshift({id:uuid(),date:todayKey,text:v,source:"manual",createdAt:new Date().toISOString()});$("#proofInput").value="";save();renderProof()};
function renderReviews(){$("#reviewsGrid").innerHTML=state.reviews.map(r=>`<div class="panel content-card"><small>${r.date}</small><h3>${esc(r.done||"Przegląd dnia")}</h3><p class="helper"><b>Wniosek:</b> ${esc(r.learn||"—")}<br><b>Jutro:</b> ${esc(r.tomorrow||"—")}</p></div>`).join("")||'<span class="helper">Brak przeglądów.</span>'}
$("#addReview").onclick=()=>$("#reviewModal").classList.remove("hidden");$("#reviewCancel").onclick=()=>$("#reviewModal").classList.add("hidden");$("#reviewSave").onclick=()=>{const doneV=$("#reviewDone").value.trim(),learn=$("#reviewLearn").value.trim(),tom=$("#reviewTomorrow").value.trim();state.reviews.unshift({id:uuid(),date:todayKey,done:doneV,learn,tomorrow:tom,createdAt:new Date().toISOString()});if(doneV)state.proof.unshift({id:uuid(),date:todayKey,text:doneV,source:"review",createdAt:new Date().toISOString()});const y=new Date();y.setDate(y.getDate()-1);state.streak=state.lastReviewDate===dateKey(y)?(state.streak||0)+1:1;state.lastReviewDate=todayKey;save();$("#reviewModal").classList.add("hidden");renderAll()};
function renderIdeas(){$("#ideasGrid").innerHTML=state.ideas.map(x=>`<div class="panel content-card"><small>${esc(x.category)}</small><h3>${esc(x.title)}</h3><p class="helper">${esc(x.status)}</p></div>`).join("")||'<span class="helper">Schowek jest pusty.</span>'}
$("#ideaForm").onsubmit=e=>{e.preventDefault();const v=$("#ideaTitle").value.trim();if(!v)return;state.ideas.unshift({id:uuid(),title:v,category:$("#ideaCategory").value,status:"Zaparkowany",createdAt:new Date().toISOString()});$("#ideaTitle").value="";save();renderIdeas()};

window.addEventListener("online",()=>{syncStatus("online");save()});window.addEventListener("offline",()=>syncStatus("offline — zapis lokalny"));
ensureDay();renderAll();initAuth();
