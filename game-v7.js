(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('gameCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const shell = $('gameShell');
  canvas.tabIndex = 0;
  if (shell) shell.tabIndex = 0;

  const ui = {
    start:$('startScreen'), finish:$('finishScreen'), hud:$('hud'), mobile:$('mobileControls'),
    speed:$('speed'), pos:$('position'), progress:$('distance'), meters:$('distanceMeters'), gear:$('gear'), nitro:$('nitroBar'),
    timer:$('raceTime'), checkpoint:$('checkpointText'), message:$('raceMessage'), countdown:$('countdown'),
    finishPos:$('finishPosition'), finishTime:$('finishTime'), topSpeed:$('topSpeed'), finishTitle:$('finishTitle'),
    selected:$('selectedName'), power:$('powerStat'), speedStat:$('speedStat'), handling:$('handlingStat')
  };

  const CARS = [
    {name:'BLACKFIRE R/T', body:'#07090d', body2:'#303641', stripe:'#ef1537', max:214, accel:78, handling:1.55, power:92, s:91, h:76},
    {name:'REDHAWK XR', body:'#9f0a18', body2:'#f42a40', stripe:'#111318', max:208, accel:88, handling:1.45, power:96, s:87, h:71},
    {name:'GHOSTLINE Z', body:'#dce1e8', body2:'#ffffff', stripe:'#2458ba', max:226, accel:72, handling:1.42, power:90, s:97, h:69},
    {name:'NIGHTSTALKER GT', body:'#07101c', body2:'#233852', stripe:'#aeb7c5', max:212, accel:76, handling:1.78, power:89, s:89, h:91}
  ];

  const TRACK = 8000;
  const input = {left:false,right:false,gas:false,brake:false,nitro:false};
  let state='menu', selectedCar=0, W=0, H=0, DPR=1, last=performance.now();
  let speed=0, top=0, distance=0, playerX=0, nitro=1, raceTime=0, roadScroll=0, shake=0, flash=0;
  let opponents=[], traffic=[], particles=[], noticeTime=0;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const fmt=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(1).padStart(4,'0')}`;
  const ordinal=n=>n+(n%10===1&&n%100!==11?'st':n%10===2&&n%100!==12?'nd':n%10===3&&n%100!==13?'rd':'th');

  function resize(){
    DPR=Math.min(devicePixelRatio||1,2); W=Math.max(320,innerWidth); H=Math.max(480,innerHeight);
    canvas.width=Math.floor(W*DPR); canvas.height=Math.floor(H*DPR); canvas.style.width=W+'px'; canvas.style.height=H+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  addEventListener('resize',resize); resize();

  function resetWorld(){
    speed=0; top=0; distance=0; playerX=0; nitro=1; raceTime=0; roadScroll=0; shake=0; flash=0; particles=[];
    opponents=[
      {lane:-.52,worldD:120,pace:.74,color:'#14181f',stripe:'#ff183e'},
      {lane:.48,worldD:240,pace:.78,color:'#8e101e',stripe:'#111'},
      {lane:.02,worldD:390,pace:.81,color:'#dce1e8',stripe:'#2458ba'},
      {lane:-.26,worldD:560,pace:.84,color:'#0c0f14',stripe:'#ff1c43'},
      {lane:.35,worldD:760,pace:.87,color:'#7e101d',stripe:'#15171b'}
    ].map((o,i)=>({...o,seed:i*2.91,overtaken:false}));
    traffic=[
      {lane:.68,worldD:1000,v:22,color:'#38414b'},{lane:-.67,worldD:1650,v:24,color:'#565b64'},
      {lane:.10,worldD:2350,v:20,color:'#313a44'},{lane:-.53,worldD:3400,v:23,color:'#494d55'},
      {lane:.58,worldD:4700,v:22,color:'#2f3742'}
    ];
    hud();
  }

  function startRace(){
    resetWorld(); state='race';
    ui.start?.classList.remove('active'); ui.finish?.classList.remove('active'); ui.hud?.classList.remove('hidden');
    ui.mobile?.classList.remove('hidden');
    if(ui.countdown){ui.countdown.textContent='GO!';ui.countdown.classList.remove('hidden');setTimeout(()=>ui.countdown?.classList.add('hidden'),500);}
    try{canvas.focus({preventScroll:true});}catch(_){ }
    notice('W / ↑ ACCELERATE  •  A/D STEER','#ff183f');
  }

  function finishRace(){
    state='finish'; clearInput(); ui.hud?.classList.add('hidden'); ui.mobile?.classList.add('hidden');
    const p=position(); if(ui.finishPos)ui.finishPos.textContent=ordinal(p); if(ui.finishTime)ui.finishTime.textContent=fmt(raceTime);
    if(ui.topSpeed)ui.topSpeed.textContent=Math.round(top)+' MPH'; if(ui.finishTitle)ui.finishTitle.textContent=p===1?'YOU OWN THE NIGHT.':p<=3?'PODIUM UNDER NEON.':'RUN IT BACK.';
    ui.finish?.classList.add('active');
  }

  function clearInput(){for(const k of Object.keys(input))input[k]=false;}
  function position(){let ahead=0;for(const o of opponents)if(o.worldD>distance)ahead++;return clamp(ahead+1,1,6);}
  function notice(text,color='#35d8ff'){if(!ui.message)return;ui.message.textContent=text;ui.message.style.borderLeftColor=color;ui.message.classList.remove('hidden');noticeTime=1.15;}
  function curve(d){return Math.sin(d*.00075)*.42+Math.sin(d*.0017+1.1)*.20+Math.sin(d*.00023+2.4)*.26;}
  function roadCenter(p){return W*.5+curve(distance+p*1250)*W*(.05+.11*Math.pow(p,1.7))-playerX*W*.045*Math.pow(p,1.2);}

  function update(dt){
    if(state!=='race') return;
    const car=CARS[selectedCar]; raceTime+=dt;
    const boosting=input.nitro&&input.gas&&nitro>0.01&&speed>45; const max=car.max+(boosting?48:0);
    if(input.gas) speed+=car.accel*(1-Math.min(speed/max,.97)*.47)*dt; else speed-=16*dt;
    if(input.brake) speed-=140*dt;
    if(boosting){speed+=98*dt;nitro=Math.max(0,nitro-.26*dt);spawnBoost();}else nitro=Math.min(1,nitro+.025*dt);
    speed=clamp(speed,0,max); top=Math.max(top,speed);

    const steer=(.52+.78*Math.min(speed/110,1))*car.handling;
    if(input.left)playerX-=steer*dt; if(input.right)playerX+=steer*dt;
    playerX-=curve(distance)*.03*Math.min(speed/120,1)*dt; playerX*=Math.max(0,1-.38*dt); playerX=clamp(playerX,-1.05,1.05);
    if(Math.abs(playerX)>.95)speed=Math.max(0,speed-42*dt);

    const mps=speed*.44704; distance+=mps*dt; roadScroll+=mps*dt*2.2;
    const base=car.max*.44704;
    for(const o of opponents){
      o.worldD+=base*(o.pace+.025*Math.sin(raceTime*.5+o.seed))*dt; o.lane+=Math.sin(raceTime*.55+o.seed)*dt*.02; o.lane=clamp(o.lane,-.72,.72);
      const rel=o.worldD-distance; if(rel<12&&rel>-8&&Math.abs(o.lane-playerX*.64)<.19&&speed>35)hit(o);
      if(!o.overtaken&&rel<-5){o.overtaken=true;nitro=Math.min(1,nitro+.12);notice('CLEAN OVERTAKE + NITRO');}
    }
    traffic.forEach((o,i)=>{o.worldD+=o.v*dt;if(o.worldD<distance-120)o.worldD=distance+1700+i*380;const rel=o.worldD-distance;if(rel<11&&rel>-8&&Math.abs(o.lane-playerX*.64)<.18&&speed>30)hit(o);});
    particles.forEach(p=>{p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;if(!p.boost)p.vy+=360*dt;}); particles=particles.filter(p=>p.age<p.life);
    shake*=Math.pow(.06,dt); flash=Math.max(0,flash-dt*3.8); if(noticeTime>0){noticeTime-=dt;if(noticeTime<=0)ui.message?.classList.add('hidden');}
    hud(); if(distance>=TRACK)finishRace();
  }

  function hit(o){speed*=.58;shake=1;flash=.55;o.worldD+=22;o.lane+=o.lane>playerX*.64?.15:-.15;notice('IMPACT!','#ff183f');for(let i=0;i<15;i++)particles.push({x:W*.5+playerX*W*.18,y:H*.8,vx:(Math.random()-.5)*220,vy:-60-Math.random()*150,age:0,life:.25+Math.random()*.35,boost:false});}
  function spawnBoost(){if(particles.length>100)return;for(let i=0;i<2;i++)particles.push({x:W*.5+playerX*W*.18+(Math.random()-.5)*40,y:H*.9,vx:(Math.random()-.5)*18,vy:70+Math.random()*90,age:0,life:.2+Math.random()*.22,boost:true});}
  function hud(){if(ui.speed)ui.speed.textContent=Math.round(speed);if(ui.pos)ui.pos.textContent=`${position()} / 6`;if(ui.progress)ui.progress.textContent=Math.min(100,Math.floor(distance/TRACK*100))+'%';if(ui.meters)ui.meters.textContent=`${(distance/1000).toFixed(1)} / 8.0 KM`;if(ui.gear)ui.gear.textContent=speed<5?'N':Math.min(6,Math.max(1,Math.floor(speed/38)+1));if(ui.nitro)ui.nitro.style.width=Math.round(nitro*100)+'%';if(ui.timer)ui.timer.textContent=fmt(raceTime);if(ui.checkpoint)ui.checkpoint.textContent=distance<2600?'NEON BOULEVARD':distance<5200?'DOWNTOWN EXPRESSWAY':'SKYLINE DISTRICT';}

  function draw(){
    ctx.clearRect(0,0,W,H);ctx.save();if(shake>.01)ctx.translate((Math.random()-.5)*14*shake,(Math.random()-.5)*9*shake);
    sky();city();palms();road();lights();worldCars();player();rain();fx();ctx.restore();if(flash>0){ctx.fillStyle=`rgba(255,245,240,${flash*.24})`;ctx.fillRect(0,0,W,H);}
  }
  function sky(){const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#02050d');g.addColorStop(.48,'#07101c');g.addColorStop(.72,'#151421');g.addColorStop(1,'#241018');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);const m=ctx.createRadialGradient(W*.77,H*.16,0,W*.77,H*.16,W*.33);m.addColorStop(0,'rgba(78,133,205,.18)');m.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=m;ctx.fillRect(0,0,W,H*.55);}
  function city(){const hor=H*.37;for(let layer=0;layer<3;layer++){const step=[74,100,126][layer],shift=(distance*[.05,.09,.14][layer])%step;ctx.save();ctx.translate(-shift-step,0);for(let i=-1;i<W/step+4;i++){const seed=i+layer*37,bw=step*.65+((seed*17)%20+20)%20,bh=70+((seed*59)%230+230)%230*(.55+layer*.18),x=i*step,y=hor+layer*14-bh;ctx.fillStyle=layer===0?'#07101a':layer===1?'#09111a':'#0a0f17';ctx.fillRect(x,y,bw,bh);if(layer){ctx.fillStyle=seed%3?'rgba(35,198,255,.16)':'rgba(255,35,90,.23)';ctx.fillRect(x+bw-2,y,2,bh);for(let yy=y+15;yy<hor;yy+=17)for(let xx=x+8;xx<x+bw-5;xx+=12)if(((xx+yy+seed)|0)%5===0){ctx.fillStyle=(seed+yy)%3?'rgba(70,205,255,.42)':'rgba(255,210,112,.58)';ctx.fillRect(xx,yy,3,4);}}}ctx.restore();}}
  function palms(){const hor=H*.39;for(const side of[-1,1])for(let i=0;i<7;i++){const p=((i/7+(roadScroll*.009)%1)%1),q=Math.pow(p,1.62),y=lerp(hor,H*1.03,q),rw=W*(.05+.56*Math.pow(p,1.12)),x=roadCenter(p)+side*(rw+30+75*p),s=.18+1.25*Math.pow(p,1.45);ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle='#07090b';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(-side*3,-30,-side*2,-65);ctx.stroke();ctx.translate(-side*2,-65);ctx.fillStyle='#040607';for(let k=0;k<8;k++){ctx.save();ctx.rotate(k*Math.PI/4);ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(18,-5,33,5);ctx.quadraticCurveTo(17,1,0,2);ctx.fill();ctx.restore();}ctx.restore();}}
  function road(){const hor=H*.39,bot=H*1.04,steps=88;for(let i=0;i<steps;i++){const a=i/steps,b=(i+1)/steps,qa=Math.pow(a,1.62),qb=Math.pow(b,1.62),ya=lerp(hor,bot,qa),yb=lerp(hor,bot,qb),wa=W*(.045+.55*Math.pow(a,1.12)),wb=W*(.045+.55*Math.pow(b,1.12)),ca=roadCenter(a),cb=roadCenter(b);ctx.beginPath();ctx.moveTo(ca-wa,ya);ctx.lineTo(ca+wa,ya);ctx.lineTo(cb+wb,yb);ctx.lineTo(cb-wb,yb);ctx.closePath();ctx.fillStyle=((i+Math.floor(roadScroll*.18))%2)?'#0a0d12':'#0d1016';ctx.fill();ctx.strokeStyle=`rgba(255,25,62,${.08+.25*a})`;ctx.lineWidth=1+4*a;ctx.beginPath();ctx.moveTo(ca-wa,ya);ctx.lineTo(cb-wb,yb);ctx.stroke();ctx.strokeStyle=`rgba(40,202,255,${.06+.18*a})`;ctx.beginPath();ctx.moveTo(ca+wa,ya);ctx.lineTo(cb+wb,yb);ctx.stroke();}
    for(const lane of[-1,1])for(let i=0;i<28;i++){const p=((i/28+(roadScroll*.025)%1)%1);if((i+Math.floor(roadScroll*.9))%2)continue;const q=Math.pow(p,1.62),y=lerp(hor,bot,q),w=W*(.045+.55*Math.pow(p,1.12)),x=roadCenter(p)+lane*w*.335;ctx.fillStyle=`rgba(240,242,246,${.08+.72*p})`;ctx.fillRect(x-(1+2*p),y,2+3*p,4+32*p);}}
  function lights(){const hor=H*.39;for(const side of[-1,1])for(let i=0;i<8;i++){const p=((i/8+(roadScroll*.014)%1)%1),q=Math.pow(p,1.62),y=lerp(hor,H*1.03,q),rw=W*(.045+.55*Math.pow(p,1.12)),x=roadCenter(p)+side*(rw+45*p),s=.16+1.35*Math.pow(p,1.5);ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle='#0d1014';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-65);ctx.lineTo(-side*18,-65);ctx.stroke();ctx.fillStyle=i%3===0?'#ff315d':'#ffd5a1';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=14;ctx.fillRect(-side*22-3,-69,8,5);ctx.restore();}}
  function project(worldD,lane){const rel=worldD-distance;if(rel<-40||rel>1700)return null;const z=clamp(1-rel/1700,0,1),p=.04+.96*z,s=.1+1.08*Math.pow(p,1.72),y=H*.39+H*.53*Math.pow(p,1.62),rw=W*(.045+.55*Math.pow(p,1.12));return{x:roadCenter(p)+lane*rw,y,s,p};}
  function worldCars(){const all=[];for(const o of opponents){const p=project(o.worldD,o.lane);if(p)all.push({...p,o,r:true});}for(const o of traffic){const p=project(o.worldD,o.lane);if(p)all.push({...p,o,r:false});}all.sort((a,b)=>a.p-b.p);for(const c of all)aiCar(c.x,c.y,c.s,c.o,c.r);}
  function aiCar(x,y,s,o,r){ctx.save();ctx.translate(x,y);ctx.scale(s,s);const w=r?84:74,h=38;ctx.fillStyle=o.color||'#363d46';ctx.shadowColor='rgba(0,0,0,.7)';ctx.shadowBlur=18;ctx.beginPath();ctx.moveTo(-w*.48,0);ctx.lineTo(-w*.43,-h*.72);ctx.quadraticCurveTo(-w*.28,-h,w*.02,-h);ctx.quadraticCurveTo(w*.3,-h,w*.45,-h*.62);ctx.lineTo(w*.52,0);ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#080b10';ctx.fillRect(-w*.24,-h*.76,w*.5,h*.35);if(r){ctx.fillStyle=o.stripe;ctx.fillRect(-5,-h,4,h);ctx.fillRect(3,-h,4,h);}ctx.fillStyle='#ff163b';ctx.shadowColor='#ff163b';ctx.shadowBlur=12;ctx.fillRect(-w*.38,-h*.2,20,5);ctx.fillRect(w*.14,-h*.2,20,5);ctx.restore();}
  function player(){const c=CARS[selectedCar],x=W*.5+playerX*W*.2,y=H*(.915-Math.min(speed/260,1)*.024),sc=clamp(W/1250,.72,1.3);ctx.save();ctx.translate(x,y);ctx.rotate((input.left?-1:input.right?1:0)*-.02*Math.min(speed/70,1));ctx.scale(sc,sc);if(input.nitro&&input.gas&&nitro>0&&speed>45){const g=ctx.createLinearGradient(0,0,0,70);g.addColorStop(0,'rgba(240,255,255,.95)');g.addColorStop(.25,'rgba(40,210,255,.8)');g.addColorStop(1,'rgba(45,90,255,0)');ctx.fillStyle=g;for(const xx of[-28,28]){ctx.beginPath();ctx.moveTo(xx-5,-3);ctx.lineTo(xx+5,-3);ctx.lineTo(xx+13,65);ctx.lineTo(xx-12,65);ctx.closePath();ctx.fill();}}const g=ctx.createLinearGradient(-90,-80,90,20);g.addColorStop(0,c.body2);g.addColorStop(.45,c.body);g.addColorStop(1,'#020305');ctx.fillStyle=g;ctx.shadowColor='rgba(0,0,0,.85)';ctx.shadowBlur=28;ctx.beginPath();ctx.moveTo(-92,0);ctx.lineTo(-84,-50);ctx.quadraticCurveTo(-70,-80,-45,-87);ctx.lineTo(-31,-105);ctx.quadraticCurveTo(-17,-122,0,-123);ctx.quadraticCurveTo(20,-123,36,-104);ctx.lineTo(49,-87);ctx.quadraticCurveTo(72,-80,85,-51);ctx.lineTo(94,0);ctx.quadraticCurveTo(54,17,0,19);ctx.quadraticCurveTo(-54,17,-92,0);ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#071019';ctx.beginPath();ctx.moveTo(-29,-106);ctx.quadraticCurveTo(-16,-119,0,-119);ctx.quadraticCurveTo(18,-119,32,-104);ctx.lineTo(45,-76);ctx.lineTo(-43,-76);ctx.closePath();ctx.fill();ctx.fillStyle=c.stripe;ctx.fillRect(-12,-122,8,137);ctx.fillRect(4,-122,8,137);ctx.fillStyle='#ff1238';ctx.shadowColor='#ff1238';ctx.shadowBlur=20;ctx.fillRect(-69,-41,43,9);ctx.fillRect(26,-41,43,9);ctx.restore();}
  function rain(){const t=performance.now()/1000;ctx.lineWidth=1;for(let i=0;i<85;i++){const x=(i*97+t*(300+speed*2))%(W+120)-60,y=(i*54+t*(520+speed*2))%(H+120)-60,l=8+speed*.05+(i%5)*4;ctx.strokeStyle='rgba(190,220,240,.26)';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-5-speed*.016,y+l);ctx.stroke();}}
  function fx(){for(const p of particles){const a=1-p.age/p.life;ctx.fillStyle=p.boost?`rgba(65,220,255,${a})`:`rgba(255,176,58,${a})`;ctx.shadowColor=p.boost?'#43dfff':'#ff6b23';ctx.shadowBlur=9;ctx.fillRect(p.x,p.y,p.boost?4:3,p.boost?12:3);}ctx.shadowBlur=0;if(speed>90){const a=clamp((speed-90)/150,0,.34);ctx.strokeStyle=`rgba(255,255,255,${a})`;for(let i=0;i<24;i++){const x=(i*84+roadScroll*20)%W,y=H*.2+(i*47)%(H*.72),len=14+(i%7)*7+speed*.08;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(x-W/2)*.04,y+len);ctx.stroke();}}}

  function frame(now){const dt=Math.min(.04,Math.max(0,(now-last)/1000));last=now;update(dt);draw();requestAnimationFrame(frame);}requestAnimationFrame(frame);

  const codes={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'gas',KeyW:'gas',ArrowDown:'brake',KeyS:'brake',ShiftLeft:'nitro',ShiftRight:'nitro',Space:'nitro'};
  const names={a:'left',A:'left',d:'right',D:'right',w:'gas',W:'gas',s:'brake',S:'brake',ArrowLeft:'left',ArrowRight:'right',ArrowUp:'gas',ArrowDown:'brake',Shift:'nitro',' ':'nitro'};
  const legacy={37:'left',39:'right',38:'gas',40:'brake',65:'left',68:'right',87:'gas',83:'brake',16:'nitro',32:'nitro'};
  function actionFor(e){return codes[e.code]||names[e.key]||legacy[e.keyCode]||null;}
  function key(e,down){const a=actionFor(e);if(!a)return;e.preventDefault();input[a]=down;if(down&&state==='menu'&&(a==='gas'||a==='nitro'))startRace();}
  document.addEventListener('keydown',e=>key(e,true),true);document.addEventListener('keyup',e=>key(e,false),true);
  window.addEventListener('keydown',e=>key(e,true),{passive:false});window.addEventListener('keyup',e=>key(e,false),{passive:false});
  window.onblur=clearInput;document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});

  function hold(id,a){const el=$(id);if(!el)return;const on=e=>{e.preventDefault();input[a]=true;if(state==='menu')startRace();};const off=e=>{e.preventDefault();input[a]=false;};el.addEventListener('pointerdown',on,{passive:false});el.addEventListener('pointerup',off,{passive:false});el.addEventListener('pointercancel',off,{passive:false});el.addEventListener('pointerleave',off,{passive:false});}
  hold('leftBtn','left');hold('rightBtn','right');hold('gasBtn','gas');hold('brakeBtn','brake');hold('nitroBtn','nitro');
  $('startBtn')?.addEventListener('click',startRace);$('restartBtn')?.addEventListener('click',startRace);canvas.addEventListener('click',()=>canvas.focus());
  document.querySelectorAll('.car-card').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.car-card').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');selectedCar=Number(btn.dataset.car)||0;const c=CARS[selectedCar];if(ui.selected)ui.selected.textContent=c.name;if(ui.power)ui.power.textContent=c.power;if(ui.speedStat)ui.speedStat.textContent=c.s;if(ui.handling)ui.handling.textContent=c.h;}));
  setInterval(()=>{if(state==='menu')roadScroll+=.6;},30);
})();