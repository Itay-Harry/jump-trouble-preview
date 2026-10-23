/* Browser gameplay. Training is separate: trainer.py exports the JSON policy used here. */
const canvas=document.querySelector("#gameCanvas"),ctx=canvas.getContext("2d"),W=960,H=540;
const GRAVITY=1800,SPEED=250,JUMP=-650,STEP=1/60;
const LEVELS=[
  {name:"Tutorial",start:[55,430],marker:[175,440],key:[820,420],exit:[900,410],platforms:[[0,480,960,60],[300,420,170,20],[570,360,170,20]],spikes:[[470,460,70,20]],bots:[[700,320]]},
  {name:"1",start:[55,430],key:[820,420],exit:[900,410],platforms:[[0,480,960,60],[220,400,220,20],[610,420,220,20]],spikes:[[450,460,85,20]],bots:[[690,370]]},
  {name:"2",start:[55,430],key:[770,250],exit:[900,410],platforms:[[0,480,960,60],[160,390,180,20],[420,320,190,20],[700,340,190,20]],spikes:[[350,460,60,20],[610,460,70,20]],bots:[[220,350],[760,300]]},
  {name:"3",start:[45,430],key:[790,195],exit:[900,410],platforms:[[0,480,960,60],[130,400,150,20],[330,335,145,20],[535,270,150,20],[735,350,185,20]],spikes:[[280,460,60,20],[475,460,60,20],[685,460,45,20]],bots:[[200,360],[390,295],[790,310]]}
];
const $=s=>document.querySelector(s);
const load=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))||f}catch{return f}};
const save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const previewMode=new URLSearchParams(location.search).has("preview")||location.hostname.endsWith(".github.io");
let levelIndex=1,level,player,bots,keys={},last=0,acc=0,paused=false,completed=false,model=null;
let progress=load("progress",{completed:[],highest:1,tutorial:false}),tutorialStep=0;
const rect=(x,y,w,h)=>({x,y,w,h});
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const terrainState=x=>`${Math.floor(Math.max(0,Math.min(959,x))/160)}:${x+30>450&&x<535?1:0}`;

function startGame(index=levelIndex,tutorial=false){
  levelIndex=index;level=LEVELS[index];tutorialStep=0;
  player={x:level.start[0],y:level.start[1],w:28,h:40,vx:0,vy:0,ground:false,coyote:0,jumpBuffer:0,hasKey:false};
  bots=level.bots.map((p,n)=>({x:p[0],y:p[1],w:30,h:38,vx:0,vy:0,ground:false,coyote:0,id:n}));
  completed=false;paused=false;
  $("#menu").classList.add("hidden");$("#training").classList.add("hidden");$("#game").classList.remove("hidden");
  $("#pauseModal").classList.add("hidden");$("#completeModal").classList.add("hidden");
  $("#levelLabel").textContent=`  •  ${level.name==="Tutorial"?"Tutorial":"Level "+index}`;
  $("#keyLabel").textContent="🔒 Find the key!";$("#tutorialCard").classList.toggle("hidden",!tutorial);
  last=performance.now();requestAnimationFrame(loop);
}
function reset(){startGame(levelIndex,levelIndex===0)}
function showMenu(){paused=true;$("#game").classList.add("hidden");$("#training").classList.add("hidden");$("#menu").classList.remove("hidden");$("#menuStatus").textContent=`Highest level unlocked: ${Math.min(3,progress.highest)}`;$("#pauseModal").classList.add("hidden")}
function moveBody(o,dt){
  o.vy+=GRAVITY*dt;o.x+=o.vx*dt;
  o.y+=o.vy*dt;o.ground=false;
  for(const p of level.platforms)if(o.x<p[0]+p[2]&&o.x+o.w>p[0]&&o.y+o.h>=p[1]-8&&o.y+o.h<=p[1]+10&&o.vy>=0){o.y=p[1]-o.h;o.vy=0;o.ground=true}
  o.x=Math.max(0,Math.min(W-o.w,o.x));o.coyote=o.ground?.1:Math.max(0,o.coyote-dt);
}
function playerJump(){
  if(player.jumpBuffer>0&&(player.ground||player.coyote>0)){
    player.vy=JUMP;player.ground=false;player.coyote=0;player.jumpBuffer=0;
    for(const bot of bots)if(bot.ground){bot.vy=JUMP;bot.ground=false}
  }
}
function botAction(bot){
  const relative=player.x-bot.x,state=`${Math.sign(relative)}:${Math.sign(player.vx)}:${bot.ground?1:0}:${Math.sign(bot.vy)}:${terrainState(bot.x)}`;
  const legacyState=`${Math.sign(relative)}:${Math.sign(player.vx)}:${bot.ground?1:0}:${Math.sign(bot.vy)}`;
  const values=model?.q?.[state]||model?.q?.[legacyState];let action;
  if(values&&typeof values==="object")action=Number(Object.entries(values).sort((a,b)=>b[1]-a[1])[0]?.[0]||0);
  else action=relative>12?1:relative<-12?-1:0;
  return Math.max(-1,Math.min(1,action));
}
function updateTutorial(){
  const nearMarker=player.x+player.w>=level.marker[0]-8&&player.x<=level.marker[0]+32;
  if(tutorialStep===0&&nearMarker)tutorialStep=1;
  else if(tutorialStep===1&&player.vy<0)tutorialStep=2;
  else if(tutorialStep===2&&player.vy<0&&bots.some(bot=>bot.vy<0))tutorialStep=3;
  else if(tutorialStep===3&&bots.some(bot=>bot.y>level.platforms[0][1]-70))tutorialStep=4;
  else if(tutorialStep===4&&player.hasKey)tutorialStep=5;
  const text=[
    ["1. Move to the marker","Walk right onto the bright outlined marker."],
    ["2. Jump the low step","Press Space, W, or Up once to jump."],
    ["3. Watch the bot","Your successful jump makes grounded bots jump too."],
    ["4. Make trouble","Time a jump so the bot lands near the spikes."],
    ["5. Find the key","Collect the key, then touch the unlocked exit."]
  ][Math.min(tutorialStep,4)];
  $("#tutorialTitle").textContent=text[0];$("#tutorialText").textContent=text[1];
}
function update(dt){
  if(paused||completed)return;
  player.jumpBuffer=Math.max(0,player.jumpBuffer-dt);
  const direction=(keys.ArrowRight||keys.d?1:0)-(keys.ArrowLeft||keys.a?1:0);
  player.vx+=(direction*SPEED-player.vx)*Math.min(1,dt*14);moveBody(player,dt);playerJump();
  for(const bot of bots){bot.vx=botAction(bot)*150;moveBody(bot,dt);if(overlap(bot,player)){toast("Caught! Retry with a well-timed jump.");reset();return}}
  if(player.y>H+80||level.spikes.some(spike=>overlap(player,rect(spike[0],spike[1],spike[2],spike[3])))){toast("Ouch! Try again.");reset();return}
  if(levelIndex===0&&!progress.tutorial)updateTutorial();
  if(overlap(player,rect(level.key[0],level.key[1],30,30))){player.hasKey=true;$("#keyLabel").textContent="🔑 Key collected!"}
  if(player.hasKey&&overlap(player,rect(level.exit[0],level.exit[1],42,72))){completed=true;progress.completed[levelIndex]=true;progress.highest=Math.max(progress.highest,Math.min(3,levelIndex+1));if(levelIndex===0)progress.tutorial=true;save("progress",progress);$("#completeTitle").textContent=levelIndex===3?"You escaped!":"Level complete!";$("#completeText").textContent=levelIndex===3?"You outsmarted every bot.":"Nice jump timing. The next layout adds trouble.";$("#nextButton").classList.toggle("hidden",levelIndex===3);$("#completeModal").classList.remove("hidden")}
}
function drawKey(x,y){ctx.save();ctx.translate(x+15,y+15);ctx.rotate(-.35);ctx.strokeStyle="#ffe169";ctx.lineWidth=7;ctx.beginPath();ctx.arc(-5,0,8,0,Math.PI*2);ctx.moveTo(3,0);ctx.lineTo(16,0);ctx.moveTo(11,0);ctx.lineTo(11,7);ctx.moveTo(16,0);ctx.lineTo(16,5);ctx.stroke();ctx.restore()}
function draw(){
  ctx.clearRect(0,0,W,H);ctx.fillStyle="#bdeeff";ctx.fillRect(0,0,W,H);
  ctx.fillStyle="#9bd38c";ctx.beginPath();ctx.moveTo(0,420);for(let x=0;x<=W;x+=100)ctx.quadraticCurveTo(x+50,370+(x%200),x+100,420);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.fill();
  ctx.fillStyle="#fff9";for(const cloud of [[110,90],[530,110],[770,65]]){ctx.beginPath();ctx.arc(cloud[0],cloud[1],22,0,7);ctx.arc(cloud[0]+25,cloud[1]+5,17,0,7);ctx.arc(cloud[0]-25,cloud[1]+7,15,0,7);ctx.fill()}
  for(const p of level.platforms){ctx.fillStyle="#6b9f62";ctx.fillRect(...p);ctx.fillStyle="#a4d879";ctx.fillRect(p[0],p[1],p[2],5)}
  for(const spike of level.spikes){ctx.fillStyle="#e84d50";for(let x=spike[0];x<spike[0]+spike[2];x+=14){ctx.beginPath();ctx.moveTo(x,spike[1]+20);ctx.lineTo(x+7,spike[1]);ctx.lineTo(x+14,spike[1]+20);ctx.fill()}}
  if(levelIndex===0&&!progress.tutorial){const x=level.marker[0];ctx.strokeStyle="#ffe169";ctx.lineWidth=4;ctx.strokeRect(x,458,52,22);ctx.fillStyle="#ffe169";ctx.beginPath();ctx.moveTo(x+26,425+Math.sin(performance.now()/220)*6);ctx.lineTo(x+14,440+Math.sin(performance.now()/220)*6);ctx.lineTo(x+38,440+Math.sin(performance.now()/220)*6);ctx.fill()}
  drawKey(level.key[0],level.key[1]);ctx.fillStyle=player.hasKey?"#51c878":"#718091";ctx.fillRect(level.exit[0],level.exit[1],42,72);ctx.fillStyle="#f7fcff";ctx.fillRect(level.exit[0]+9,level.exit[1]+14,11,11);
  ctx.fillStyle="#247dcc";ctx.fillRect(player.x,player.y,player.w,player.h);for(const bot of bots){ctx.fillStyle="#f07845";ctx.fillRect(bot.x,bot.y,bot.w,bot.h);ctx.fillStyle="#fff";ctx.fillRect(bot.x+6,bot.y+9,6,6);ctx.fillRect(bot.x+19,bot.y+9,6,6)}
}
function loop(now){const raw=Math.min(.1,(now-last)/1000);last=now;acc+=raw;while(acc>=STEP){update(STEP);acc-=STEP}draw();if(!paused&&!completed)requestAnimationFrame(loop)}
function toast(message){$("#toast").textContent=message;$("#toast").classList.add("show");setTimeout(()=>$("#toast").classList.remove("show"),1200)}
async function loadModel(){try{model=await(await fetch("models/gameplay-model.json",{cache:"no-store"})).json()}catch{model={q:{},version:"fallback"}}}
async function renderTraining(){try{const response=await fetch("models/training-stats.json",{cache:"no-store"});if(response.ok){const stats=await response.json();const rounds=Math.max(1,stats.rounds);$("#rounds").textContent=stats.rounds;$("#catchRate").textContent=Math.round(stats.catches/rounds*100)+"%";$("#deathRate").textContent=Math.round(stats.deaths/rounds*100)+"%";$("#stuckRate").textContent=Math.round(stats.stuck/rounds*100)+"%"}}catch{}try{const active=await(await fetch("models/gameplay-model.json",{cache:"no-store"})).json();$("#modelVersion").textContent=`v${active.version||"unknown"} · ${active.kind||"unknown"}`;$("#modelEvaluation").textContent=active.evaluation?`${Math.round(active.evaluation.catch*100)}% catch on fixed tests`:"not recorded"}catch{$("#modelVersion").textContent="fallback";$("#modelEvaluation").textContent="unavailable"}}
addEventListener("keydown",event=>{if(["Space","ArrowUp","ArrowLeft","ArrowRight"].includes(event.code))event.preventDefault();if(event.code==="Escape"){paused=!paused;$("#pauseModal").classList.toggle("hidden",!paused);if(!paused){last=performance.now();requestAnimationFrame(loop)}}if((event.code==="Space"||event.code==="ArrowUp"||event.code==="KeyW")&&!event.repeat&&player)player.jumpBuffer=.1;keys[event.code==="KeyA"?"a":event.code==="KeyD"?"d":event.key]=true});
addEventListener("keyup",event=>{keys[event.code==="KeyA"?"a":event.code==="KeyD"?"d":event.key]=false});addEventListener("blur",()=>{if(!$("#game").classList.contains("hidden")){paused=true;$("#pauseModal").classList.remove("hidden")}});
$("#playButton").onclick=()=>startGame(Math.min(3,progress.highest));$("#tutorialButton").onclick=()=>startGame(0,true);$("#trainingButton").onclick=()=>{$("#menu").classList.add("hidden");$("#training").classList.remove("hidden");renderTraining()};$("#resetProgressButton").onclick=()=>{if(confirm("Reset completed levels and tutorial? Training stays safe.")){progress={completed:[],highest:1,tutorial:false};save("progress",progress);$("#menuStatus").textContent="Progress reset."}};$("#pauseButton").onclick=()=>{paused=true;$("#pauseModal").classList.remove("hidden")};$("#resumeButton").onclick=()=>{paused=false;$("#pauseModal").classList.add("hidden");last=performance.now();requestAnimationFrame(loop)};$("#restartButton").onclick=reset;$("#pauseMenuButton").onclick=showMenu;$("#completeMenuButton").onclick=showMenu;$("#replayButton").onclick=reset;$("#nextButton").onclick=()=>startGame(levelIndex+1);$("#skipTutorial").onclick=()=>startGame(1);$("#backMenu").onclick=showMenu;
if(previewMode)$("#trainingButton").remove();
document.querySelectorAll(".touch-controls button").forEach(button=>{const key=button.dataset.key;button.addEventListener("pointerdown",event=>{event.preventDefault();if(key==="jump"&&player)player.jumpBuffer=.1;keys[key]=true});button.addEventListener("pointerup",event=>{event.preventDefault();keys[key]=false});button.addEventListener("pointercancel",()=>keys[key]=false)});
loadModel();
