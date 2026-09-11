(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  const startScreen=$('startScreen'), finishScreen=$('finishScreen'), hud=$('hud'), mobileControls=$('mobileControls');
  const speedEl=$('speed'), posEl=$('position'), distanceEl=$('distance'), distanceMeters=$('distanceMeters'), nitroBar=$('nitroBar'), gearEl=$('gear'), raceTimeEl=$('raceTime'), checkpointText=$('checkpointText'), countdownEl=$('countdown'), raceMessage=$('raceMessage');

  const CARS = [
    {name:'BLACKFIRE R/T', body:'#0a0c10', body2:'#262b32', stripe:'#e51635', max:214, accel:69, handling:1.60, power:92, statSpeed:91, statHandling:76},
    {name:'REDHAWK XR', body:'#a50d1d', body2:'#ff3147', stripe:'#111319', max:207, accel:79, handling:1.50, power:96, statSpeed:87, statHandling:71},
    {name:'GHOSTLINE Z', body:'#d9dee6', body2:'#f6f8fb', stripe:'#244b9d', max:224, accel:64, handling:1.46, power:90, statSpeed:97, statHandling:69},
    {name:'NIGHTSTALKER GT', body:'#09111d', body2:'#1b2b44', stripe:'#9fa9b9', max:211, accel:68, handling:1.82, power:89, statSpeed:89, statHandling:91}
  ];

  const TRACK_LEN=8000;
  let W=0,H=0,DPR=1,last=performance.now(),state='menu',selectedCar=0;
  let speed=0, topSpeed=0, nitro=1, playerX=0, distance=0, raceTime=0, roadScroll=0, curvePhase=0, shake=0, flash=0, rainPhase=0, messageTimer=0, countdown=0, raceStarted=false;
  let opponents=[], traffic=[], sparks=[];
  let audioCtx=null, engineOsc=null, engineGain=null, bassOsc=null, bassGain=null;
  const input={left:false,right:false,gas:false,brake:false,nitro:false};

  function resize(){DPR=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;canvas.width=Math.floor(W*DPR);canvas.height=Math.floor(H*DPR);canvas.style.width=W+'px';canvas.style.height=H+'px';ctx.setTransform(DPR,0,0,DPR,0,0)}
  addEventListener('resize',resize);resize();

  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const ordinal=n=>n+(n%10===1&&n%100!==11?'st':n%10===2&&n%100!==12?'nd':n%10===3&&n%100!==13?'rd':'th');
  const fmt=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(1).padStart(4,'0')}`;

  function courseCurve(d){return Math.sin(d*.0007)*.46+Math.sin(d*.00193+1.2)*.23+Math.sin(d*.00019+2.7)*.34}
  function roadCenter(p){const c=courseCurve(distance+p*1050);return W*.5 + c*W*(.08+.13*Math.pow(p,1.9)) - playerX*W*.09*Math.pow(p,1.1)}

  function resetRace(){
    speed=0;topSpeed=0;nitro=1;playerX=0;distance=0;raceTime=0;roadScroll=0;curvePhase=0;shake=0;flash=0;sparks=[];raceStarted=false;countdown=3.75;
    opponents=[
      {lane:-.48,d:180,pace:.84,color:'#3b4657',stripe:'#ff243f',name:'BLADE'},
      {lane:.47,d:315,pace:.87,color:'#8d101b',stripe:'#111',name:'ROOK'},
      {lane:.02,d:510,pace:.89,color:'#d8dde6',stripe:'#244b9d',name:'GHOST'},
      {lane:-.28,d:730,pace:.92,color:'#15171b',stripe:'#ff233e',name:'VIPER'},
      {lane:.36,d:960,pace:.95,color:'#7e121e',stripe:'#1a1a1a',name:'RAVEN'}
    ].map((o,i)=>({...o,seed:i*2.17,overtaken:false,worldD:o.d}));
    traffic=[{lane:.67,worldD:1250,color:'#37404a'},{lane:-.7,worldD:1920,color:'#5c5961'},{lane:.13,worldD:2720,color:'#343941'},{lane:-.55,worldD:4100,color:'#4d4e54'},{lane:.58,worldD:5660,color:'#2f3743'}];
  }

  function initAudio(){
    try{
      audioCtx=audioCtx||new(AudioContext||webkitAudioContext)(); if(audioCtx.state==='suspended')audioCtx.resume();
      engineOsc=audioCtx.createOscillator();engineGain=audioCtx.createGain();engineOsc.type='sawtooth';engineGain.gain.value=.026;engineOsc.connect(engineGain);engineGain.connect(audioCtx.destination);engineOsc.start();
      bassOsc=audioCtx.createOscillator();bassGain=audioCtx.createGain();bassOsc.type='square';bassGain.gain.value=.008;bassOsc.connect(bassGain);bassGain.connect(audioCtx.destination);bassOsc.start();
    }catch(e){}
  }
  function stopAudio(){try{engineOsc&&engineOsc.stop();bassOsc&&bassOsc.stop()}catch(e){}engineOsc=bassOsc=null}
  function beep(freq=440,dur=.08,g=.04,type='square'){if(!audioCtx)return;const o=audioCtx.createOscillator(),gn=audioCtx.createGain();o.type=type;o.frequency.value=freq;gn.gain.setValueAtTime(g,audioCtx.currentTime);gn.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+dur);o.connect(gn);gn.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+dur)}

  function startRace(){resetRace();state='race';startScreen.classList.remove('active');finishScreen.classList.remove('active');hud.classList.remove('hidden');if(matchMedia('(pointer:coarse)').matches)mobileControls.classList.remove('hidden');countdownEl.classList.remove('hidden');initAudio()}
  function endRace(){state='finish';hud.classList.add('hidden');mobileControls.classList.add('hidden');countdownEl.classList.add('hidden');const p=getPosition();$('finishPosition').textContent=ordinal(p);$('finishTime').textContent=fmt(raceTime);$('topSpeed').textContent=Math.round(topSpeed)+' MPH';$('finishTitle').textContent=p===1?'YOU OWN THE NIGHT.':p<=3?'PODIUM UNDER NEON.':'THE CITY WANTS A REMATCH.';finishScreen.classList.add('active');stopAudio()}

  function getPosition(){let ahead=0;opponents.forEach(o=>{if(o.worldD>distance)ahead++});return clamp(ahead+1,1,6)}
  function showMessage(text,color='#35d8ff'){raceMessage.textContent=text;raceMessage.style.borderLeftColor=color;raceMessage.classList.remove('hidden');messageTimer=1.25}

  function update(dt){
    rainPhase+=dt;curvePhase+=dt*.15;
    if(state!=='race')return;
    if(countdown>0){countdown-=dt;const n=Math.ceil(countdown);countdownEl.textContent=countdown>.65?n:'GO!';if(countdown<=.65&&!raceStarted){raceStarted=true;beep(720,.16,.07);showMessage('GO! OWN THE NIGHT','#ff183f')}if(countdown<=0)countdownEl.classList.add('hidden');}
    if(!raceStarted)return;

    const car=CARS[selectedCar];raceTime+=dt;
    const boosting=input.nitro&&input.gas&&nitro>0&&speed>55;
    const max=car.max+(boosting?48:0);
    if(input.gas)speed+=car.accel*dt*(1-Math.min(speed/max,.94)*.55);else speed-=18*dt;
    if(input.brake)speed-=115*dt;
    if(boosting){speed+=93*dt;nitro=Math.max(0,nitro-.23*dt);spawnBoost()}else nitro=Math.min(1,nitro+.018*dt);
    speed=clamp(speed,0,max);topSpeed=Math.max(topSpeed,speed);

    const steer=(.38+.72*Math.min(speed/120,1))*car.handling;
    if(input.left)playerX-=steer*dt;if(input.right)playerX+=steer*dt;
    const roadPull=courseCurve(distance)*.08*Math.min(speed/160,1);playerX-=roadPull*dt;
    playerX*=1-.08*dt;playerX=clamp(playerX,-1.2,1.2);
    if(Math.abs(playerX)>.94){speed-=48*dt;shake=Math.max(shake,.18)}

    const metersPerSec=speed*.44704;distance+=metersPerSec*dt;roadScroll+=speed*dt*.018;
    updateOpponents(dt,car);updateTraffic(dt);updateSparks(dt);
    shake*=Math.pow(.055,dt);flash=Math.max(0,flash-dt*3.2);if(messageTimer>0){messageTimer-=dt;if(messageTimer<=0)raceMessage.classList.add('hidden')}

    const pos=getPosition();speedEl.textContent=Math.round(speed);posEl.textContent=`${pos} / 6`;distanceEl.textContent=Math.min(100,Math.floor(distance/TRACK_LEN*100))+'%';distanceMeters.textContent=`${(distance/1000).toFixed(1)} / 8.0 KM`;nitroBar.style.width=(nitro*100)+'%';raceTimeEl.textContent=fmt(raceTime);gearEl.textContent=Math.min(6,Math.max(1,Math.floor(speed/38)+1));
    checkpointText.textContent=distance<2600?'NEON BOULEVARD':distance<5200?'DOWNTOWN EXPRESSWAY':'SKYLINE DISTRICT';
    if(engineOsc&&audioCtx){engineOsc.frequency.setTargetAtTime(48+speed*1.9,audioCtx.currentTime,.035);bassOsc.frequency.setTargetAtTime(27+speed*.22,audioCtx.currentTime,.05)}
    if(distance>=TRACK_LEN)endRace();
  }

  function updateOpponents(dt,car){
    opponents.forEach(o=>{
      const aiMps=(car.max*.44704)*(o.pace+.025*Math.sin(raceTime*.17+o.seed));o.worldD+=aiMps*dt;
      o.lane+=Math.sin(raceTime*.48+o.seed)*dt*.022;o.lane=clamp(o.lane,-.73,.73);
      const rel=o.worldD-distance;
      if(rel<20&&rel>-10&&Math.abs(o.lane-playerX*.65)<.22&&speed>45){collision(o)}
      if(!o.overtaken&&rel<0){o.overtaken=true;nitro=Math.min(1,nitro+.16);beep(690,.05,.025);showMessage('CLEAN OVERTAKE + NITRO')}
    })
  }
  function updateTraffic(dt){traffic.forEach((o,i)=>{o.worldD+=23*dt;if(o.worldD<distance-150)o.worldD=distance+2200+i*330;const rel=o.worldD-distance;if(rel<18&&rel>-10&&Math.abs(o.lane-playerX*.65)<.2&&speed>35)collision(o)})}
  function collision(o){speed*=.56;shake=1;flash=.7;o.lane+=o.lane>playerX*.65?.18:-.18;o.worldD+=20;beep(85,.18,.08,'sawtooth');showMessage('IMPACT! KEEP MOVING','#ff183f');for(let i=0;i<18;i++)sparks.push({x:W*.5+playerX*W*.17+(Math.random()-.5)*70,y:H*.77+Math.random()*30,vx:(Math.random()-.5)*240,vy:-40-Math.random()*180,life:.25+Math.random()*.4,age:0})}
  function spawnBoost(){if(sparks.length>120)return;for(let i=0;i<2;i++)sparks.push({boost:true,x:W*.5+playerX*W*.17+(Math.random()-.5)*42,y:H*.91,vx:(Math.random()-.5)*25,vy:65+Math.random()*95,life:.22+Math.random()*.25,age:0})}
  function updateSparks(dt){sparks.forEach(p=>{p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=p.boost?0:370*dt});sparks=sparks.filter(p=>p.age<p.life)}

  function draw(){
    const t=performance.now()/1000;ctx.clearRect(0,0,W,H);ctx.save();if(shake>.01)ctx.translate((Math.random()-.5)*16*shake,(Math.random()-.5)*11*shake);
    drawSky(t);drawMoonGlow();drawCity(t);drawPalms(t);drawHelicopter(t);drawRoad(t);drawStreetLights(t);drawCars(t);drawPlayer(t);drawRain(t);drawParticles();drawSpeedStreaks();ctx.restore();
    if(flash>0){ctx.fillStyle=`rgba(255,240,235,${flash*.28})`;ctx.fillRect(0,0,W,H)}
  }

  function drawSky(t){
    const g=ctx.createLinearGradient(0,0,0,H*.7);g.addColorStop(0,'#030711');g.addColorStop(.45,'#07101d');g.addColorStop(.78,'#111424');g.addColorStop(1,'#271321');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    for(let i=0;i<18;i++){const x=((i*173+Math.sin(t*.02+i)*240)% (W+500))-250,y=H*(.05+(i%7)*.045),w=220+(i%5)*85,h=45+(i%4)*20;const grd=ctx.createRadialGradient(x,y,10,x,y,w);grd.addColorStop(0,'rgba(73,87,115,.15)');grd.addColorStop(1,'rgba(10,15,24,0)');ctx.fillStyle=grd;ctx.fillRect(x-w,y-h,w*2,h*2)}
  }
  function drawMoonGlow(){const g=ctx.createRadialGradient(W*.78,H*.2,0,W*.78,H*.2,W*.34);g.addColorStop(0,'rgba(65,115,190,.18)');g.addColorStop(.55,'rgba(20,48,82,.06)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,W,H*.55)}

  function drawCity(t){
    const horizon=H*.37;ctx.save();const shift=(distance*.012)%104;
    for(let layer=0;layer<3;layer++){
      const alpha=[.55,.75,1][layer], baseY=horizon+layer*14, step=[72,96,122][layer], par=[.16,.3,.48][layer];ctx.save();ctx.translate(-((shift*par)%step)-step,0);
      for(let i=-1;i<W/step+3;i++){
        const seed=i+layer*43;const bw=step*.62+((seed*17)%20+20)%20;const bh=65+((seed*61)%240+240)%240*(.55+layer*.18);const x=i*step,y=baseY-bh;ctx.fillStyle=layer===0?'#07101a':layer===1?'#09111b':'#0a1018';ctx.globalAlpha=alpha;ctx.fillRect(x,y,bw,bh);ctx.globalAlpha=1;
        if(layer>0){ctx.fillStyle=seed%3===0?'rgba(255,32,92,.25)':'rgba(33,193,255,.18)';ctx.fillRect(x+bw-2,y,2,bh);for(let wy=y+13;wy<baseY-7;wy+=15)for(let wx=x+7;wx<x+bw-6;wx+=11){if(((wx+wy+seed)|0)%5===0){ctx.fillStyle=(seed+wy)%3===0?'rgba(255,203,102,.62)':'rgba(75,207,255,.48)';ctx.fillRect(wx,wy,2.5,4)}}}
        if(layer===2&&seed%7===0){ctx.fillStyle='#ff236b';ctx.shadowColor='#ff236b';ctx.shadowBlur=8;ctx.fillRect(x+bw*.2,y+22,bw*.6,3);ctx.shadowBlur=0}
      }ctx.restore();
    }ctx.restore();
    const fog=ctx.createLinearGradient(0,horizon-50,0,horizon+80);fog.addColorStop(0,'rgba(0,0,0,0)');fog.addColorStop(.5,'rgba(115,36,82,.16)');fog.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=fog;ctx.fillRect(0,horizon-50,W,130)
  }

  function drawPalms(t){
    const horizon=H*.38;for(let side=-1;side<=1;side+=2){for(let i=0;i<7;i++){const p=((i/7+(roadScroll*.004)%1)%1);const d=Math.pow(p,1.65);const y=horizon+(H*.6)*d;const roadW=W*(.05+.57*Math.pow(p,1.12));const x=roadCenter(p)+side*(roadW+22+80*p);const s=.2+1.3*Math.pow(p,1.4);ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle='rgba(8,9,11,.96)';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(-side*4,-30,-side*2,-64);ctx.stroke();ctx.translate(-side*2,-64);ctx.fillStyle='rgba(4,7,8,.98)';for(let k=0;k<8;k++){const a=k*Math.PI/4+.2*Math.sin(t*.8+i);ctx.save();ctx.rotate(a);ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(18,-5,32,5);ctx.quadraticCurveTo(18,1,0,2);ctx.fill();ctx.restore()}ctx.restore()}}
  }

  function drawHelicopter(t){const x=W*.82+Math.sin(t*.24)*W*.035,y=H*.095+Math.sin(t*.8)*3,s=Math.max(.55,W/1700);ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle='#090c12';ctx.beginPath();ctx.ellipse(0,0,38,12,0,0,Math.PI*2);ctx.fill();ctx.fillRect(30,-3,42,6);ctx.beginPath();ctx.moveTo(72,-3);ctx.lineTo(86,-14);ctx.lineTo(82,2);ctx.closePath();ctx.fill();ctx.strokeStyle='#1a1e25';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-45,-16);ctx.lineTo(45,-16);ctx.stroke();ctx.strokeStyle='rgba(230,245,255,.18)';ctx.beginPath();ctx.moveTo(-8,10);ctx.lineTo(-20,92);ctx.lineTo(3,92);ctx.closePath();ctx.stroke();const beam=ctx.createLinearGradient(0,10,0,110);beam.addColorStop(0,'rgba(235,249,255,.3)');beam.addColorStop(1,'rgba(170,225,255,0)');ctx.fillStyle=beam;ctx.beginPath();ctx.moveTo(-5,9);ctx.lineTo(-38,115);ctx.lineTo(22,115);ctx.closePath();ctx.fill();ctx.restore()}

  function drawRoad(t){
    const horizon=H*.39,bottom=H*1.04,steps=88;
    for(let i=0;i<steps;i++){
      const a=i/steps,b=(i+1)/steps,pa=Math.pow(a,1.62),pb=Math.pow(b,1.62),ya=lerp(horizon,bottom,pa),yb=lerp(horizon,bottom,pb),wa=W*(.045+.55*Math.pow(a,1.12)),wb=W*(.045+.55*Math.pow(b,1.12)),ca=roadCenter(a),cb=roadCenter(b);
      ctx.beginPath();ctx.moveTo(ca-wa,ya);ctx.lineTo(ca+wa,ya);ctx.lineTo(cb+wb,yb);ctx.lineTo(cb-wb,yb);ctx.closePath();ctx.fillStyle=((i+Math.floor(roadScroll*2.2))%2)?'#0b0e13':'#0d1016';ctx.fill();
      if(i%2===0){const wet=ctx.createLinearGradient(ca,ya,cb,yb);wet.addColorStop(0,'rgba(255,255,255,.005)');wet.addColorStop(.5,'rgba(255,255,255,.025)');wet.addColorStop(1,'rgba(255,255,255,.006)');ctx.fillStyle=wet;ctx.fill()}
      ctx.strokeStyle=`rgba(255,25,62,${.08+.25*a})`;ctx.lineWidth=1+4*a;ctx.beginPath();ctx.moveTo(ca-wa,ya);ctx.lineTo(cb-wb,yb);ctx.stroke();ctx.strokeStyle=`rgba(40,202,255,${.06+.18*a})`;ctx.beginPath();ctx.moveTo(ca+wa,ya);ctx.lineTo(cb+wb,yb);ctx.stroke();
    }
    for(let lane=-1;lane<=1;lane+=2){for(let i=0;i<26;i++){const p=((i/26+(roadScroll*.013)%1)%1);if((i+Math.floor(roadScroll))%2)continue;const q=Math.pow(p,1.62),y=lerp(horizon,bottom,q),w=W*(.045+.55*Math.pow(p,1.12)),x=roadCenter(p)+lane*w*.335;ctx.fillStyle=`rgba(235,238,242,${.05+.72*p})`;ctx.fillRect(x-(1+2*p),y,2+3*p,3+30*p)}}
    for(let i=0;i<14;i++){const p=.42+((i*.071+roadScroll*.006)% .58),q=Math.pow(p,1.7),y=lerp(horizon,bottom,q),w=25+180*p*p,x=roadCenter(p)+Math.sin(i*4.3)*W*.24*p;const g=ctx.createLinearGradient(x,y,x,y+70*p);const c=i%2?'255,24,74':'38,190,255';g.addColorStop(0,`rgba(${c},${.10*p})`);g.addColorStop(1,`rgba(${c},0)`);ctx.fillStyle=g;ctx.fillRect(x-w/2,y,w,80*p)}
  }

  function drawStreetLights(t){const horizon=H*.39;for(let side=-1;side<=1;side+=2)for(let i=0;i<8;i++){const p=((i/8+(roadScroll*.0067)%1)%1),q=Math.pow(p,1.62),y=lerp(horizon,H*1.02,q),rw=W*(.045+.55*Math.pow(p,1.12)),x=roadCenter(p)+side*(rw+45*p),s=.16+1.4*Math.pow(p,1.5);ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle='rgba(12,14,18,.98)';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-65);ctx.lineTo(-side*18,-65);ctx.stroke();ctx.fillStyle=i%3===0?'#ff315d':'#ffcf98';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=15;ctx.fillRect(-side*22-3,-69,8,5);ctx.shadowBlur=0;ctx.restore()}}

  function carProjection(worldD,lane){const rel=worldD-distance;if(rel<-30||rel>1500)return null;const z=clamp(1-rel/1500,0,1),p=.04+.96*z,s=.10+1.05*Math.pow(p,1.7),y=H*.39+H*.53*Math.pow(p,1.62),rw=W*(.045+.55*Math.pow(p,1.12)),x=roadCenter(p)+lane*rw;return{x,y,s,p,rel}}
  function drawCars(t){
    const list=[];opponents.forEach(o=>{const pr=carProjection(o.worldD,o.lane);if(pr)list.push({...pr,o,type:'race'})});traffic.forEach(o=>{const pr=carProjection(o.worldD,o.lane);if(pr)list.push({...pr,o,type:'traffic'})});list.sort((a,b)=>a.p-b.p);list.forEach(item=>drawAICar(item.x,item.y,item.s,item.o,item.p,item.type))
  }
  function drawAICar(x,y,s,o,p,type){ctx.save();ctx.translate(x,y);ctx.scale(s,s);const w=type==='traffic'?72:82,h=36;ctx.shadowColor='rgba(0,0,0,.65)';ctx.shadowBlur=20;ctx.fillStyle=o.color||'#30353c';ctx.beginPath();ctx.moveTo(-w*.48,0);ctx.lineTo(-w*.43,-h*.72);ctx.quadraticCurveTo(-w*.28,-h,w*.02,-h*1.02);ctx.quadraticCurveTo(w*.3,-h,w*.45,-h*.62);ctx.lineTo(w*.52,0);ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#090c11';ctx.beginPath();ctx.moveTo(-w*.23,-h*.72);ctx.lineTo(-w*.14,-h*.94);ctx.lineTo(w*.17,-h*.91);ctx.lineTo(w*.28,-h*.68);ctx.closePath();ctx.fill();ctx.fillStyle=o.stripe||'#777';ctx.globalAlpha=.85;ctx.fillRect(-5,-h,5,h);ctx.fillRect(3,-h,5,h);ctx.globalAlpha=1;ctx.fillStyle='#ff153b';ctx.shadowColor='#ff153b';ctx.shadowBlur=14;ctx.fillRect(-w*.38,-h*.2,19,5);ctx.fillRect(w*.15,-h*.2,19,5);ctx.shadowBlur=0;ctx.fillStyle='#05070a';ctx.fillRect(-w*.32,-2,w*.64,6);ctx.restore()}

  function drawPlayer(t){
    const car=CARS[selectedCar],cx=W*.5+playerX*W*.17,cy=H*.91,scale=clamp(W/1250,.72,1.35);ctx.save();ctx.translate(cx,cy);ctx.scale(scale,scale);
    if(input.nitro&&nitro>0&&speed>55&&raceStarted){const g=ctx.createLinearGradient(0,0,0,58);g.addColorStop(0,'rgba(230,255,255,.9)');g.addColorStop(.25,'rgba(40,209,255,.75)');g.addColorStop(1,'rgba(49,97,255,0)');ctx.fillStyle=g;for(const xx of [-28,28]){ctx.beginPath();ctx.moveTo(xx-5,-3);ctx.lineTo(xx+5,-3);ctx.lineTo(xx+13,55+Math.random()*18);ctx.lineTo(xx-12,55+Math.random()*18);ctx.closePath();ctx.fill()}}
    ctx.shadowColor='rgba(0,0,0,.85)';ctx.shadowBlur=28;const bodyGrad=ctx.createLinearGradient(-80,-70,90,10);bodyGrad.addColorStop(0,car.body2);bodyGrad.addColorStop(.45,car.body);bodyGrad.addColorStop(1,'#020305');ctx.fillStyle=bodyGrad;ctx.beginPath();ctx.moveTo(-91,0);ctx.lineTo(-83,-50);ctx.quadraticCurveTo(-69,-79,-44,-87);ctx.lineTo(-31,-105);ctx.quadraticCurveTo(-17,-122,0,-123);ctx.quadraticCurveTo(20,-123,36,-104);ctx.lineTo(49,-87);ctx.quadraticCurveTo(72,-80,85,-51);ctx.lineTo(93,0);ctx.quadraticCurveTo(54,16,0,18);ctx.quadraticCurveTo(-54,16,-91,0);ctx.closePath();ctx.fill();ctx.shadowBlur=0;
    const glass=ctx.createLinearGradient(0,-114,0,-67);glass.addColorStop(0,'#06090f');glass.addColorStop(1,'#151e2a');ctx.fillStyle=glass;ctx.beginPath();ctx.moveTo(-29,-106);ctx.quadraticCurveTo(-16,-119,0,-119);ctx.quadraticCurveTo(18,-119,32,-104);ctx.lineTo(45,-76);ctx.lineTo(-43,-76);ctx.closePath();ctx.fill();
    ctx.fillStyle=car.stripe;ctx.globalAlpha=.95;ctx.beginPath();ctx.moveTo(-11,-123);ctx.lineTo(-4,-123);ctx.lineTo(-5,12);ctx.lineTo(-15,12);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(4,-123);ctx.lineTo(11,-123);ctx.lineTo(15,12);ctx.lineTo(5,12);ctx.closePath();ctx.fill();ctx.globalAlpha=1;
    ctx.fillStyle='#050608';ctx.fillRect(-74,-73,148,7);ctx.fillRect(-58,-79,8,13);ctx.fillRect(50,-79,8,13);
    ctx.fillStyle='#ff1238';ctx.shadowColor='#ff1238';ctx.shadowBlur=22;ctx.fillRect(-69,-41,43,9);ctx.fillRect(26,-41,43,9);ctx.shadowBlur=0;ctx.fillStyle='rgba(255,230,230,.8)';ctx.fillRect(-63,-39,25,2);ctx.fillRect(38,-39,25,2);
    ctx.fillStyle='#05070a';ctx.fillRect(-66,-15,132,15);ctx.fillStyle='#3a3f46';ctx.fillRect(-54,0,16,5);ctx.fillRect(38,0,16,5);
    ctx.fillStyle='#020203';ctx.fillRect(-99,-49,18,49);ctx.fillRect(81,-49,18,49);
    ctx.fillStyle='#dce2e7';ctx.fillRect(-17,-20,34,12);ctx.fillStyle='#111';ctx.font='7px Inter';ctx.textAlign='center';ctx.fillText('MIDN8',0,-11);
    ctx.restore()
  }

  function drawRain(t){ctx.save();ctx.lineWidth=1;const intensity=state==='race'?.42:.22;for(let i=0;i<100;i++){const x=(i*97.3+t*(310+speed*1.8))%(W+120)-60,y=(i*53.7+t*(520+speed*2.2))%(H+120)-60,l=8+speed*.05+(i%5)*4;ctx.strokeStyle=`rgba(185,215,235,${intensity*(.25+(i%7)/10)})`;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-5-speed*.018,y+l);ctx.stroke()}ctx.restore()}
  function drawParticles(){sparks.forEach(p=>{const a=1-p.age/p.life;if(p.boost){ctx.fillStyle=`rgba(64,218,255,${a})`;ctx.shadowColor='#43dfff';ctx.shadowBlur=10;ctx.fillRect(p.x,p.y,2+4*a,8+10*a);ctx.shadowBlur=0}else{ctx.fillStyle=`rgba(255,176,58,${a})`;ctx.shadowColor='#ff6b23';ctx.shadowBlur=8;ctx.fillRect(p.x,p.y,2.5,2.5);ctx.shadowBlur=0}})}
  function drawSpeedStreaks(){if(speed<95||state!=='race')return;const a=clamp((speed-95)/150,0,.35);ctx.strokeStyle=`rgba(255,255,255,${a})`;ctx.lineWidth=1;for(let i=0;i<26;i++){const x=(i*83.7+roadScroll*50)%W,y=H*.2+(i*47.3)% (H*.75),len=15+(i%7)*7+speed*.08;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(x-W/2)*.045,y+len);ctx.stroke()}}

  function loop(now){const dt=Math.min(.034,(now-last)/1000||0);last=now;update(dt);draw();requestAnimationFrame(loop)}requestAnimationFrame(loop);

  function setKey(e,v){const k=e.key.toLowerCase();if(['arrowleft','arrowright','arrowup','arrowdown',' ','shift','a','d','w','s'].includes(k))e.preventDefault();if(k==='a'||k==='arrowleft')input.left=v;if(k==='d'||k==='arrowright')input.right=v;if(k==='w'||k==='arrowup')input.gas=v;if(k==='s'||k==='arrowdown')input.brake=v;if(k==='shift'||k===' ')input.nitro=v}
  addEventListener('keydown',e=>setKey(e,true),{passive:false});addEventListener('keyup',e=>setKey(e,false),{passive:false});
  function touch(id,key){const el=$(id);const on=e=>{e.preventDefault();input[key]=true},off=e=>{e.preventDefault();input[key]=false};['pointerdown','touchstart'].forEach(ev=>el.addEventListener(ev,on,{passive:false}));['pointerup','pointercancel','pointerleave','touchend'].forEach(ev=>el.addEventListener(ev,off,{passive:false}))}
  touch('leftBtn','left');touch('rightBtn','right');touch('gasBtn','gas');touch('brakeBtn','brake');touch('nitroBtn','nitro');

  $('startBtn').addEventListener('click',startRace);$('restartBtn').addEventListener('click',startRace);
  document.querySelectorAll('.car-card').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.car-card').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');selectedCar=Number(btn.dataset.car);const c=CARS[selectedCar];$('selectedName').textContent=c.name;$('powerStat').textContent=c.power;$('speedStat').textContent=c.statSpeed;$('handlingStat').textContent=c.statHandling;beep(260+selectedCar*55,.045,.02)}));

  setInterval(()=>{if(state==='menu')roadScroll+=.055},30);
})();
