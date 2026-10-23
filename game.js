/* Browser gameplay. Training is separate: trainer.py exports the JSON policy used here. */
const canvas=document.querySelector("#gameCanvas"),ctx=canvas.getContext("2d"),W=960,H=540;
const GRAVITY=1800,SPEED=250,JUMP=-650,STEP=1/60;
const LEVELS=[
  {name:"Tutorial",start:[55,430],marker:[175,440],star:[335,375],key:[820,420],exit:[900,410],platforms:[[0,480,960,60],[300,420,170,20],[570,360,170,20]],spikes:[[470,460,70,20]],bots:[[700,320]]},
  {name:"1",start:[55,430],star:[600,190],key:[820,420],exit:[900,410],platforms:[[0,480,960,60],[150,390,150,20],[330,310,170,20],[530,230,170,20],[730,300,150,20],[610,420,220,20]],spikes:[[450,460,85,20]],bots:[[690,370]]},
  {name:"2",start:[55,430],star:[490,270],key:[770,250],exit:[900,410],platforms:[[0,480,960,60],[160,390,180,20],[420,320,190,20],[700,340,190,20]],spikes:[[350,460,60,20],[610,460,70,20]],bots:[[220,350],[760,300]]},
  {name:"3",start:[45,430],star:[590,220],key:[790,195],exit:[900,410],platforms:[[0,480,960,60],[130,400,150,20],[330,335,145,20],[535,270,150,20],[735,350,185,20]],spikes:[[280,460,60,20],[475,460,60,20],[685,460,45,20]],bots:[[200,360],[390,295],[790,310]]}
];
const $=s=>document.querySelector(s);
const load=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))||f}catch{return f}};
const save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const previewMode=new URLSearchParams(location.search).has("preview")||location.hostname.endsWith(".github.io");
const reducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let levelIndex=1,level,player,bots,keys={},last=0,acc=0,paused=false,completed=false,model=null,effects=[],retryTimer=0,pendingRetry=null;
let progress=load("progress",{completed:[],highest:1,tutorial:false,stars:[]}),tutorialStep=0,failureCounts={};
const rect=(x,y,w,h)=>({x,y,w,h});
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const terrainState=x=>`${Math.floor(Math.max(0,Math.min(959,x))/160)}:${x+30>450&&x<535?1:0}`;

function startGame(index=levelIndex,tutorial=false){
  levelIndex=index;level=LEVELS[index];tutorialStep=0;
  player={x:level.start[0],y:level.start[1],w:28,h:40,vx:0,vy:0,ground:false,coyote:0,jumpBuffer:0,hasKey:false,hasStar:false,isPlayer:true,scaleX:1,scaleY:1};
  bots=level.bots.map((p,n)=>({x:p[0],y:p[1],w:30,h:38,vx:0,vy:0,ground:false,coyote:0,id:n,defeated:false}));
  effects=[];
  completed=false;paused=false;retryTimer=0;pendingRetry=null;
  $("#menu").classList.add("hidden");$("#training").classList.add("hidden");$("#game").classList.remove("hidden");
  $("#pauseModal").classList.add("hidden");$("#completeModal").classList.add("hidden");
  $("#levelLabel").textContent=`  •  ${level.name==="Tutorial"?"Tutorial":"Level "+index}`;
  const earned=progress.stars?.includes(levelIndex);$("#keyLabel").textContent="🔒 Find the key!";$("#starLabel").textContent=`${earned?"★":"☆"} ${earned?1:0}/1`;$("#tutorialCard").classList.toggle("hidden",!tutorial);
  last=performance.now();requestAnimationFrame(loop);
}
function reset(){startGame(levelIndex,levelIndex===0)}
function showMenu(){paused=true;$("#game").classList.add("hidden");$("#training").classList.add("hidden");$("#menu").classList.remove("hidden");$("#menuStatus").textContent=`Highest level unlocked: ${Math.min(3,progress.highest)}`;$("#pauseModal").classList.add("hidden")}
function failGame(message,obstacle){
  if(retryTimer>0)return;
  failureCounts[obstacle]=(failureCounts[obstacle]||0)+1;
  toast(message);effects.push({type:"defeat",x:player.x+player.w/2,y:player.y+player.h/2,life:.4,max:.4});
  if(failureCounts[obstacle]===3)window.setTimeout(()=>toast(obstacle==="spikes"?"Hint: jump before the red spikes, then keep moving.":"Hint: use one jump to send the bot over the spikes."),380);
  pendingRetry={index:levelIndex,tutorial:levelIndex===0};retryTimer=reducedMotion?.18:.42;
}
function moveBody(o,dt){
  const wasGround=o.ground;
  o.vy+=GRAVITY*dt;o.x+=o.vx*dt;
  o.y+=o.vy*dt;o.ground=false;
  for(const p of level.platforms)if(o.x<p[0]+p[2]&&o.x+o.w>p[0]&&o.y+o.h>=p[1]-8&&o.y+o.h<=p[1]+10&&o.vy>=0){o.y=p[1]-o.h;o.vy=0;o.ground=true}
  o.x=Math.max(0,Math.min(W-o.w,o.x));o.coyote=o.ground?.1:Math.max(0,o.coyote-dt);
  if(o.isPlayer&&!wasGround&&o.ground){o.scaleX=1.14;o.scaleY=.86;spawnDust(o.x+o.w/2,o.y+o.h)}
}
function playerJump(){
  if(player.jumpBuffer>0&&(player.ground||player.coyote>0)){
    player.vy=JUMP;player.ground=false;player.coyote=0;player.jumpBuffer=0;
    player.scaleX=.88;player.scaleY=1.14;spawnDust(player.x+player.w/2,player.y+player.h);
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
  else if(tutorialStep===3&&bots.some(bot=>bot.defeated))tutorialStep=4;
  else if(tutorialStep===4&&player.hasStar)tutorialStep=5;
  else if(tutorialStep===5&&player.hasKey)tutorialStep=6;
  const text=[
    ["1. Move to the marker","Walk right onto the bright outlined marker."],
    ["2. Jump the low step","Press Space, W, or Up once to jump."],
    ["3. Watch the bot","Your successful jump makes grounded bots jump too."],
    ["4. Make trouble","Jump near the bot and let it land in the spike trap."],
    ["5. Optional star","Climb up and collect the star. It is never required."],
    ["6. Find the key","Collect the key, then touch the unlocked exit."],
    ["7. Reach the exit","The green door is waiting on the far right."]
  ][Math.min(tutorialStep,6)];
  $("#tutorialTitle").textContent=text[0];$("#tutorialText").textContent=text[1];
}
function update(dt){
  if(retryTimer>0){retryTimer-=dt;if(retryTimer<=0&&pendingRetry){const retry=pendingRetry;pendingRetry=null;startGame(retry.index,retry.tutorial)}return}
  if(paused||completed)return;
  player.jumpBuffer=Math.max(0,player.jumpBuffer-dt);
  const direction=(keys.ArrowRight||keys.d?1:0)-(keys.ArrowLeft||keys.a?1:0);
  player.vx+=(direction*SPEED-player.vx)*Math.min(1,dt*14);moveBody(player,dt);playerJump();
  for(const bot of bots){if(bot.defeated)continue;bot.vx=botAction(bot)*150;moveBody(bot,dt);if((bot.x+bot.w>450&&bot.x<535&&bot.y+bot.h>=480)||bot.y>H+40){bot.defeated=true;spawnDefeat(bot);continue}if(overlap(bot,player)){failGame("Caught! Retry with a well-timed jump.","bot");return}}
  if(player.y>H+80||level.spikes.some(spike=>overlap(player,rect(spike[0],spike[1],spike[2],spike[3])))){failGame("Ouch! Try again.","spikes");return}
  if(levelIndex===0&&!progress.tutorial)updateTutorial();
  if(!player.hasStar&&overlap(player,rect(level.star[0],level.star[1],30,30))){player.hasStar=true;collectSparkle(level.star[0]+15,level.star[1]+15);$("#starLabel").textContent="★ 1/1"}
  if(!player.hasKey&&overlap(player,rect(level.key[0],level.key[1],30,30))){player.hasKey=true;collectSparkle(level.key[0]+15,level.key[1]+15);$("#keyLabel").textContent="🔑 Key collected!"}
  if(player.hasKey&&overlap(player,rect(level.exit[0],level.exit[1],42,72))){completed=true;progress.completed[levelIndex]=true;progress.highest=Math.max(progress.highest,Math.min(3,levelIndex+1));progress.stars=progress.stars||[];if(player.hasStar&&!progress.stars.includes(levelIndex))progress.stars.push(levelIndex);if(levelIndex===0)progress.tutorial=true;save("progress",progress);$("#completeTitle").textContent=levelIndex===3?"You escaped!":"Level complete!";$("#completeText").textContent=player.hasStar?"Nice! Optional star saved.":"Nice jump timing. The next layout adds trouble.";$("#nextButton").classList.toggle("hidden",levelIndex===3);$("#completeModal").classList.remove("hidden")}
}
function spawnDust(x,y){if(reducedMotion)return;for(let i=0;i<4;i++)effects.push({type:"dust",x:x+(Math.random()-.5)*18,y,vx:(Math.random()-.5)*35,vy:-25-Math.random()*25,life:.35,max:.35})}
function spawnDefeat(bot){effects.push({type:"defeat",x:bot.x+bot.w/2,y:bot.y+bot.h/2,life:.55,max:.55});if(!reducedMotion)for(let i=0;i<5;i++)effects.push({type:"spark",x:bot.x+bot.w/2,y:bot.y+bot.h/2,vx:(Math.random()-.5)*110,vy:(Math.random()-.5)*110,life:.45,max:.45})}
function collectSparkle(x,y){if(reducedMotion)return;for(let i=0;i<8;i++)effects.push({type:"spark",x,y,vx:Math.cos(i)*55,vy:Math.sin(i)*55,life:.5,max:.5})}
function updateEffects(dt){for(const effect of effects){effect.life-=dt;effect.x+=(effect.vx||0)*dt;effect.y+=(effect.vy||0)*dt;effect.vy=(effect.vy||0)+80*dt}effects=effects.filter(effect=>effect.life>0);if(player){player.scaleX+=(1-player.scaleX)*Math.min(1,dt*10);player.scaleY+=(1-player.scaleY)*Math.min(1,dt*10)}}
function drawKey(x,y){ctx.save();ctx.translate(x+15,y+15);ctx.rotate(-.35);ctx.strokeStyle="#f2b927";ctx.lineWidth=7;ctx.beginPath();ctx.arc(-5,0,8,0,Math.PI*2);ctx.moveTo(3,0);ctx.lineTo(16,0);ctx.moveTo(11,0);ctx.lineTo(11,7);ctx.moveTo(16,0);ctx.lineTo(16,5);ctx.stroke();ctx.strokeStyle="#fff4a3";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(17,-11);ctx.lineTo(17,-3);ctx.moveTo(13,-7);ctx.lineTo(21,-7);ctx.stroke();ctx.restore()}
function drawStar(x,y){ctx.save();ctx.translate(x+15,y+15);ctx.fillStyle="#ffd447";ctx.strokeStyle="#b77b15";ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<10;i++){const radius=i%2?7:14,angle=-Math.PI/2+i*Math.PI/5;ctx.lineTo(Math.cos(angle)*radius,Math.sin(angle)*radius)}ctx.closePath();ctx.fill();ctx.stroke();ctx.restore()}
function roundedPath(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function drawPlatform(x,y,w,h){ctx.fillStyle="#8b5b3e";roundedPath(x,y,w,h,8);ctx.fill();ctx.fillStyle="#70ad59";roundedPath(x,y-4,w,10,6);ctx.fill();ctx.strokeStyle="#4e8748";ctx.lineWidth=2;ctx.beginPath();for(let i=x+12;i<x+w-5;i+=24){ctx.moveTo(i,y+14);ctx.lineTo(i+5,y+18);ctx.moveTo(i+9,y+8);ctx.lineTo(i+13,y+11)}ctx.stroke()}
function drawPlayer(){const cx=player.x+player.w/2,cy=player.y+player.h/2;ctx.save();ctx.translate(cx,cy);ctx.scale(player.scaleX,player.scaleY);ctx.fillStyle="#247dcc";roundedPath(-14,-20,28,40,9);ctx.fill();ctx.strokeStyle="#14558e";ctx.lineWidth=2;ctx.stroke();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(-6,-6,4,0,7);ctx.arc(6,-6,4,0,7);ctx.fill();ctx.fillStyle="#18324a";ctx.beginPath();ctx.arc(-5,-6,1.7,0,7);ctx.arc(7,-6,1.7,0,7);ctx.fill();ctx.strokeStyle="#18324a";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-11,-13);ctx.lineTo(-3,-15);ctx.moveTo(3,-15);ctx.lineTo(11,-13);ctx.stroke();ctx.beginPath();ctx.arc(0,2,6,0,Math.PI);ctx.stroke();ctx.strokeStyle="#14558e";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-8,20);ctx.lineTo(-10,24);ctx.moveTo(8,20);ctx.lineTo(10,24);ctx.stroke();ctx.restore()}
function drawBot(bot){if(bot.defeated)return;ctx.save();ctx.translate(bot.x+bot.w/2,bot.y+bot.h/2);ctx.fillStyle="#f07845";roundedPath(-15,-19,30,38,7);ctx.fill();ctx.strokeStyle="#a84b35";ctx.lineWidth=2;ctx.stroke();ctx.strokeStyle="#a84b35";ctx.beginPath();ctx.moveTo(0,-19);ctx.lineTo(0,-27);ctx.stroke();ctx.fillStyle="#ffca3a";ctx.beginPath();ctx.arc(0,-29,3,0,7);ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(-6,-5,4,0,7);ctx.arc(6,-5,4,0,7);ctx.fill();ctx.fillStyle="#18324a";ctx.beginPath();ctx.arc(-6,-5,1.5,0,7);ctx.arc(6,-5,1.5,0,7);ctx.fill();ctx.strokeStyle="#18324a";ctx.lineWidth=2;ctx.beginPath();if(bot.vy<0){ctx.moveTo(-10,-13);ctx.lineTo(-3,-16);ctx.moveTo(3,-16);ctx.lineTo(10,-13);ctx.arc(0,3,6,.2,Math.PI-.2)}else{ctx.moveTo(-10,-14);ctx.lineTo(-3,-12);ctx.moveTo(3,-12);ctx.lineTo(10,-14);ctx.arc(0,4,6,Math.PI+.2,Math.PI*2-.2)}ctx.stroke();ctx.restore()}
function drawEffects(){for(const effect of effects){const alpha=Math.max(0,effect.life/effect.max);ctx.globalAlpha=alpha;if(effect.type==="dust"){ctx.fillStyle="#d9c3a1";ctx.beginPath();ctx.arc(effect.x,effect.y,4+alpha*4,0,7);ctx.fill()}else if(effect.type==="spark"){ctx.strokeStyle="#ffe169";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(effect.x-4,effect.y);ctx.lineTo(effect.x+4,effect.y);ctx.moveTo(effect.x,effect.y-4);ctx.lineTo(effect.x,effect.y+4);ctx.stroke()}else{ctx.fillStyle="#f07845";roundedPath(effect.x-15,effect.y-19,30,38,7);ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(effect.x-6,effect.y-5,5,0,7);ctx.arc(effect.x+6,effect.y-5,5,0,7);ctx.fill();ctx.fillStyle="#18324a";ctx.beginPath();ctx.arc(effect.x-6,effect.y-5,1.5,0,7);ctx.arc(effect.x+6,effect.y-5,1.5,0,7);ctx.fill();ctx.font="bold 16px sans-serif";ctx.fillText("!",effect.x-3,effect.y+14)}ctx.globalAlpha=1}}
function draw(){
  const palettes=[["#dff5ff","#b9e7e1","#82c78b"],["#bdeeff","#d9f2d3","#8ecf83"],["#e8e0ff","#c8d6f2","#83a9d6"],["#ffe6cf","#f6d3b2","#b8c77b"]],palette=palettes[levelIndex];ctx.clearRect(0,0,W,H);ctx.fillStyle=palette[0];ctx.fillRect(0,0,W,H);
  ctx.fillStyle=palette[1];ctx.beginPath();ctx.moveTo(0,390);for(let x=0;x<=W;x+=120)ctx.quadraticCurveTo(x+60,330+(x%180),x+120,390);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.fill();ctx.fillStyle=palette[2];ctx.beginPath();ctx.moveTo(0,430);for(let x=0;x<=W;x+=150)ctx.quadraticCurveTo(x+75,375+(x%150),x+150,430);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.fill();
  ctx.fillStyle="#fff9";for(const cloud of [[110,90],[530,110],[770,65]]){ctx.beginPath();ctx.arc(cloud[0],cloud[1],22,0,7);ctx.arc(cloud[0]+25,cloud[1]+5,17,0,7);ctx.arc(cloud[0]-25,cloud[1]+7,15,0,7);ctx.fill()}
  if(levelIndex===1){ctx.fillStyle="#294f62aa";ctx.font="bold 12px 'Comic Sans MS',sans-serif";ctx.fillText("LONG ROUTE",170,365);ctx.fillText("SHORTCUT + BOT",430,448)}
  for(const p of level.platforms)drawPlatform(...p);
  for(const spike of level.spikes){ctx.fillStyle="#e84d50";for(let x=spike[0];x<spike[0]+spike[2];x+=14){ctx.beginPath();ctx.moveTo(x,spike[1]+20);ctx.lineTo(x+7,spike[1]);ctx.lineTo(x+14,spike[1]+20);ctx.fill()}}
  if(levelIndex===0&&!progress.tutorial){const x=level.marker[0];ctx.strokeStyle="#ffe169";ctx.lineWidth=4;ctx.strokeRect(x,458,52,22);ctx.fillStyle="#ffe169";ctx.beginPath();ctx.moveTo(x+26,425+Math.sin(performance.now()/220)*6);ctx.lineTo(x+14,440+Math.sin(performance.now()/220)*6);ctx.lineTo(x+38,440+Math.sin(performance.now()/220)*6);ctx.fill()}
  if(!player.hasStar)drawStar(level.star[0],level.star[1]);drawKey(level.key[0],level.key[1]);ctx.fillStyle=player.hasKey?"#51c878":"#718091";roundedPath(level.exit[0],level.exit[1],42,72,6);ctx.fill();ctx.strokeStyle=player.hasKey?"#287e50":"#536577";ctx.lineWidth=3;ctx.stroke();ctx.fillStyle=player.hasKey?"#fff5ad":"#d9e6ee";ctx.fillRect(level.exit[0]+9,level.exit[1]+14,11,11);ctx.fillStyle="#247dcc";drawPlayer();for(const bot of bots)drawBot(bot);drawEffects();
}
function loop(now){const raw=Math.min(.1,(now-last)/1000);last=now;acc+=raw;while(acc>=STEP){update(STEP);updateEffects(STEP);acc-=STEP}draw();if(!paused&&!completed)requestAnimationFrame(loop)}
function toast(message){$("#toast").textContent=message;$("#toast").classList.add("show");setTimeout(()=>$("#toast").classList.remove("show"),1200)}
async function loadModel(){try{model=await(await fetch("models/gameplay-model.json",{cache:"no-store"})).json()}catch{model={q:{},version:"fallback"}}}
async function renderTraining(){try{const response=await fetch("models/training-stats.json",{cache:"no-store"});if(response.ok){const stats=await response.json();const rounds=Math.max(1,stats.rounds);$("#rounds").textContent=stats.rounds;$("#catchRate").textContent=Math.round(stats.catches/rounds*100)+"%";$("#deathRate").textContent=Math.round(stats.deaths/rounds*100)+"%";$("#stuckRate").textContent=Math.round(stats.stuck/rounds*100)+"%"}}catch{}try{const active=await(await fetch("models/gameplay-model.json",{cache:"no-store"})).json();$("#modelVersion").textContent=`v${active.version||"unknown"} · ${active.kind||"unknown"}`;$("#modelEvaluation").textContent=active.evaluation?`${Math.round(active.evaluation.catch*100)}% catch on fixed tests`:"not recorded"}catch{$("#modelVersion").textContent="fallback";$("#modelEvaluation").textContent="unavailable"}}
addEventListener("keydown",event=>{if(["Space","ArrowUp","ArrowLeft","ArrowRight"].includes(event.code))event.preventDefault();if(event.code==="Escape"){paused=!paused;$("#pauseModal").classList.toggle("hidden",!paused);if(!paused){last=performance.now();requestAnimationFrame(loop)}}if((event.code==="Space"||event.code==="ArrowUp"||event.code==="KeyW")&&!event.repeat&&player)player.jumpBuffer=.1;keys[event.code==="KeyA"?"a":event.code==="KeyD"?"d":event.key]=true});
addEventListener("keyup",event=>{keys[event.code==="KeyA"?"a":event.code==="KeyD"?"d":event.key]=false});addEventListener("blur",()=>{if(!$("#game").classList.contains("hidden")){paused=true;$("#pauseModal").classList.remove("hidden")}});
$("#playButton").onclick=()=>startGame(Math.min(3,progress.highest));$("#tutorialButton").onclick=()=>startGame(0,true);$("#trainingButton").onclick=()=>{$("#menu").classList.add("hidden");$("#training").classList.remove("hidden");renderTraining()};$("#resetProgressButton").onclick=()=>{if(confirm("Reset completed levels and tutorial? Training stays safe.")){progress={completed:[],highest:1,tutorial:false};save("progress",progress);$("#menuStatus").textContent="Progress reset."}};$("#pauseButton").onclick=()=>{paused=true;$("#pauseModal").classList.remove("hidden")};$("#resumeButton").onclick=()=>{paused=false;$("#pauseModal").classList.add("hidden");last=performance.now();requestAnimationFrame(loop)};$("#restartButton").onclick=reset;$("#pauseMenuButton").onclick=showMenu;$("#completeMenuButton").onclick=showMenu;$("#replayButton").onclick=reset;$("#nextButton").onclick=()=>startGame(levelIndex+1);$("#skipTutorial").onclick=()=>startGame(1);$("#backMenu").onclick=showMenu;
if(previewMode)$("#trainingButton").remove();
document.querySelectorAll(".touch-controls button").forEach(button=>{const key=button.dataset.key;button.addEventListener("pointerdown",event=>{event.preventDefault();if(key==="jump"&&player)player.jumpBuffer=.1;keys[key]=true});button.addEventListener("pointerup",event=>{event.preventDefault();keys[key]=false});button.addEventListener("pointercancel",()=>keys[key]=false)});
loadModel();
