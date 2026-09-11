(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('gameCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const shell = $('gameShell');
  if (shell) { shell.tabIndex = 0; shell.style.outline = 'none'; }

  const ui = {
    startScreen: $('startScreen'), finishScreen: $('finishScreen'), hud: $('hud'), mobile: $('mobileControls'),
    speed: $('speed'), position: $('position'), progress: $('distance'), meters: $('distanceMeters'), nitro: $('nitroBar'),
    gear: $('gear'), raceTime: $('raceTime'), checkpoint: $('checkpointText'), countdown: $('countdown'), message: $('raceMessage'),
    selectedName: $('selectedName'), power: $('powerStat'), topStat: $('speedStat'), handling: $('handlingStat'),
    finishPosition: $('finishPosition'), finishTime: $('finishTime'), topSpeed: $('topSpeed'), finishTitle: $('finishTitle')
  };

  const CARS = [
    {name:'BLACKFIRE R/T', body:'#080a0e', body2:'#343942', stripe:'#ef1536', max:214, accel:71, handling:1.58, power:92, statSpeed:91, statHandling:76},
    {name:'REDHAWK XR', body:'#9a0a18', body2:'#ef243b', stripe:'#0d1016', max:207, accel:81, handling:1.50, power:96, statSpeed:87, statHandling:71},
    {name:'GHOSTLINE Z', body:'#d8dce3', body2:'#f8fafc', stripe:'#2455ad', max:224, accel:65, handling:1.46, power:90, statSpeed:97, statHandling:69},
    {name:'NIGHTSTALKER GT', body:'#07101b', body2:'#20334f', stripe:'#aab3c1', max:211, accel:69, handling:1.84, power:89, statSpeed:89, statHandling:91}
  ];

  const TRACK_LEN = 8000;
  const input = { left:false, right:false, gas:false, brake:false, nitro:false };
  let selectedCar = 0;
  let state = 'menu';
  let started = false;
  let countdown = 0;
  let W = 0, H = 0, DPR = 1;
  let last = performance.now();
  let speed = 0, topSpeedValue = 0, distance = 0, playerX = 0, nitro = 1, raceTime = 0;
  let roadScroll = 0, shake = 0, flash = 0, messageTimer = 0;
  let opponents = [], traffic = [], particles = [];
  let audio = null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(1).padStart(4,'0')}`;
  const ordinal = (n) => n + (n%10===1&&n%100!==11?'st':n%10===2&&n%100!==12?'nd':n%10===3&&n%100!==13?'rd':'th');

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(320, window.innerWidth);
    H = Math.max(480, window.innerHeight);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  window.addEventListener('resize', resize);
  resize();

  function makeOpponents() {
    opponents = [
      {lane:-.50, d:160, pace:.79, color:'#15191f', stripe:'#ff183e', name:'BLADE'},
      {lane:.48, d:280, pace:.82, color:'#8f101d', stripe:'#11151b', name:'ROOK'},
      {lane:.02, d:430, pace:.84, color:'#d7dde5', stripe:'#2451a4', name:'GHOST'},
      {lane:-.25, d:610, pace:.87, color:'#0c0f14', stripe:'#ff1c43', name:'VIPER'},
      {lane:.34, d:820, pace:.90, color:'#7f0f1c', stripe:'#13161b', name:'RAVEN'}
    ].map((o, i) => ({ ...o, worldD:o.d, seed:i*4.13, overtaken:false }));
    traffic = [
      {lane:.68, worldD:1100, speed:22, color:'#3b424c'},
      {lane:-.66, worldD:1700, speed:25, color:'#575963'},
      {lane:.10, worldD:2450, speed:21, color:'#313943'},
      {lane:-.52, worldD:3500, speed:24, color:'#494d55'},
      {lane:.57, worldD:4900, speed:23, color:'#2f3742'}
    ];
  }

  function resetRace() {
    speed = 0; topSpeedValue = 0; distance = 0; playerX = 0; nitro = 1; raceTime = 0;
    roadScroll = 0; shake = 0; flash = 0; particles = []; messageTimer = 0;
    countdown = 3.0; started = false; makeOpponents();
    updateHud();
  }

  function startRace() {
    resetRace();
    state = 'race';
    ui.startScreen?.classList.remove('active');
    ui.finishScreen?.classList.remove('active');
    ui.hud?.classList.remove('hidden');
    if (matchMedia('(pointer:coarse)').matches) ui.mobile?.classList.remove('hidden');
    ui.countdown?.classList.remove('hidden');
    if (shell) shell.focus({preventScroll:true});
    startAudio();
  }

  function endRace() {
    state = 'finish';
    started = false;
    clearInputs();
    ui.hud?.classList.add('hidden');
    ui.mobile?.classList.add('hidden');
    ui.countdown?.classList.add('hidden');
    const p = getPosition();
    if (ui.finishPosition) ui.finishPosition.textContent = ordinal(p);
    if (ui.finishTime) ui.finishTime.textContent = fmt(raceTime);
    if (ui.topSpeed) ui.topSpeed.textContent = Math.round(topSpeedValue) + ' MPH';
    if (ui.finishTitle) ui.finishTitle.textContent = p===1 ? 'YOU OWN THE NIGHT.' : p<=3 ? 'PODIUM UNDER NEON.' : 'THE CITY WANTS A REMATCH.';
    ui.finishScreen?.classList.add('active');
    stopAudio();
  }

  function clearInputs() {
    Object.keys(input).forEach(k => input[k] = false);
  }

  function startAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio = audio || new AC();
      if (audio.state === 'suspended') audio.resume();
    } catch (_) {}
  }
  function beep(freq=440, dur=.07, gain=.035) {
    if (!audio) return;
    try {
      const o=audio.createOscillator(), g=audio.createGain();
      o.type='square'; o.frequency.value=freq;
      g.gain.setValueAtTime(gain,audio.currentTime); g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+dur);
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime+dur);
    } catch (_) {}
  }
  function stopAudio() {}

  function courseCurve(d) {
    return Math.sin(d*.00062)*.42 + Math.sin(d*.00157+1.3)*.20 + Math.sin(d*.00021+2.1)*.24;
  }
  function roadCenter(p) {
    const curve = courseCurve(distance + p*1350);
    return W*.5 + curve*W*(.055 + .11*Math.pow(p,1.7)) - playerX*W*.055*Math.pow(p,1.1);
  }

  function getPosition() {
    let ahead = 0;
    for (const o of opponents) if (o.worldD > distance) ahead++;
    return clamp(ahead + 1, 1, 6);
  }

  function showMessage(text, color='#32d8ff') {
    if (!ui.message) return;
    ui.message.textContent = text;
    ui.message.style.borderLeftColor = color;
    ui.message.classList.remove('hidden');
    messageTimer = 1.1;
  }

  function update(dt) {
    if (state !== 'race') return;

    if (!started) {
      countdown -= dt;
      if (ui.countdown) ui.countdown.textContent = countdown > .55 ? Math.max(1, Math.ceil(countdown)) : 'GO!';
      if (countdown <= .55) {
        started = true;
        beep(760,.14,.06);
        showMessage('GO! OWN THE NIGHT','#ff183f');
      }
      if (countdown <= 0) ui.countdown?.classList.add('hidden');
      return;
    }

    const car = CARS[selectedCar];
    raceTime += dt;
    const boosting = input.nitro && input.gas && nitro > .01 && speed > 50;
    const maxSpeed = car.max + (boosting ? 46 : 0);

    if (input.gas) {
      const powerDrop = 1 - Math.min(speed/maxSpeed,.96)*.48;
      speed += car.accel * powerDrop * dt;
    } else {
      speed -= (speed > 20 ? 16 : 9) * dt;
    }
    if (input.brake) speed -= 125 * dt;
    if (boosting) {
      speed += 90 * dt;
      nitro = Math.max(0, nitro - .24*dt);
      spawnBoost();
    } else {
      nitro = Math.min(1, nitro + .02*dt);
    }
    speed = clamp(speed, 0, maxSpeed);
    topSpeedValue = Math.max(topSpeedValue, speed);

    const steering = (.45 + .72*Math.min(speed/110,1)) * car.handling;
    if (input.left) playerX -= steering*dt;
    if (input.right) playerX += steering*dt;
    const curvePull = courseCurve(distance)*.055*Math.min(speed/140,1);
    playerX -= curvePull*dt;
    playerX *= Math.max(0, 1 - .55*dt);
    playerX = clamp(playerX,-1.08,1.08);
    if (Math.abs(playerX) > .93) speed = Math.max(0, speed - 35*dt);

    const mps = speed * .44704;
    distance += mps * dt;
    roadScroll += mps * dt;

    updateOpponents(dt, car);
    updateTraffic(dt);
    updateParticles(dt);
    shake *= Math.pow(.07,dt);
    flash = Math.max(0,flash-dt*3.5);
    if (messageTimer > 0) {
      messageTimer -= dt;
      if (messageTimer <= 0) ui.message?.classList.add('hidden');
    }

    updateHud();
    if (distance >= TRACK_LEN) endRace();
  }

  function updateHud() {
    if (ui.speed) ui.speed.textContent = Math.round(speed);
    if (ui.position) ui.position.textContent = `${getPosition()} / 6`;
    if (ui.progress) ui.progress.textContent = Math.min(100,Math.floor(distance/TRACK_LEN*100))+'%';
    if (ui.meters) ui.meters.textContent = `${(distance/1000).toFixed(1)} / 8.0 KM`;
    if (ui.nitro) ui.nitro.style.width = `${Math.round(nitro*100)}%`;
    if (ui.raceTime) ui.raceTime.textContent = fmt(raceTime);
    if (ui.gear) ui.gear.textContent = speed < 8 ? 'N' : Math.min(6,Math.max(1,Math.floor(speed/38)+1));
    if (ui.checkpoint) ui.checkpoint.textContent = distance<2600?'NEON BOULEVARD':distance<5200?'DOWNTOWN EXPRESSWAY':'SKYLINE DISTRICT';
  }

  function updateOpponents(dt, car) {
    const baseMps = car.max*.44704;
    for (const o of opponents) {
      const aiMps = baseMps * (o.pace + .025*Math.sin(raceTime*.4+o.seed));
      o.worldD += aiMps*dt;
      o.lane += Math.sin(raceTime*.62 + o.seed)*dt*.018;
      o.lane = clamp(o.lane,-.72,.72);
      const rel = o.worldD - distance;
      if (rel < 12 && rel > -9 && Math.abs(o.lane-playerX*.64) < .20 && speed > 40) collision(o);
      if (!o.overtaken && rel < -4) {
        o.overtaken = true;
        nitro = Math.min(1,nitro+.12);
        showMessage('CLEAN OVERTAKE + NITRO');
      }
    }
  }

  function updateTraffic(dt) {
    traffic.forEach((o,i) => {
      o.worldD += o.speed*dt;
      if (o.worldD < distance-100) o.worldD = distance+1800+i*350;
      const rel=o.worldD-distance;
      if(rel<12&&rel>-8&&Math.abs(o.lane-playerX*.64)<.19&&speed>35) collision(o);
    });
  }

  function collision(o) {
    speed *= .60;
    shake = 1; flash = .55;
    o.lane += o.lane > playerX*.64 ? .15 : -.15;
    o.worldD += 22;
    showMessage('IMPACT! KEEP MOVING','#ff183f');
    for(let i=0;i<16;i++) particles.push({x:W*.5+playerX*W*.17+(Math.random()-.5)*70,y:H*.80,vx:(Math.random()-.5)*220,vy:-50-Math.random()*150,life:.25+Math.random()*.35,age:0,boost:false});
  }

  function spawnBoost() {
    if (particles.length > 100) return;
    for(let i=0;i<2;i++) particles.push({x:W*.5+playerX*W*.17+(Math.random()-.5)*45,y:H*.90,vx:(Math.random()-.5)*20,vy:75+Math.random()*80,life:.18+Math.random()*.25,age:0,boost:true});
  }
  function updateParticles(dt){
    for(const p of particles){p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;if(!p.boost)p.vy+=340*dt;}
    particles=particles.filter(p=>p.age<p.life);
  }

  function draw() {
    const t=performance.now()/1000;
    ctx.clearRect(0,0,W,H);
    ctx.save();
    if(shake>.01)ctx.translate((Math.random()-.5)*14*shake,(Math.random()-.5)*10*shake);
    drawSky(t); drawCity(); drawPalms(t); drawHelicopter(t); drawRoad(); drawStreetLights(); drawWorldCars(); drawPlayer(); drawRain(t); drawParticles(); drawSpeedLines();
    ctx.restore();
    if(flash>0){ctx.fillStyle=`rgba(255,245,240,${flash*.24})`;ctx.fillRect(0,0,W,H);}
  }

  function drawSky(t){
    const g=ctx.createLinearGradient(0,0,0,H*.72);g.addColorStop(0,'#02050d');g.addColorStop(.52,'#07101c');g.addColorStop(.78,'#171322');g.addColorStop(1,'#28101c');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    const moon=ctx.createRadialGradient(W*.78,H*.18,0,W*.78,H*.18,W*.32);moon.addColorStop(0,'rgba(70,125,195,.17)');moon.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=moon;ctx.fillRect(0,0,W,H*.55);
    for(let i=0;i<14;i++){const x=((i*181+t*4)%(W+400))-200,y=40+(i%7)*32,w=180+(i%4)*90;const fog=ctx.createRadialGradient(x,y,5,x,y,w);fog.addColorStop(0,'rgba(73,83,105,.09)');fog.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=fog;ctx.fillRect(x-w,y-50,w*2,100);}
  }

  function drawCity(){
    const horizon=H*.37;
    for(let layer=0;layer<3;layer++){
      const step=[72,98,126][layer], par=[.06,.11,.18][layer], shift=(distance*par)%step;
      ctx.save();ctx.translate(-shift-step,0);
      for(let i=-1;i<W/step+4;i++){
        const seed=i+layer*41,bw=step*.62+((seed*17)%21+21)%21,bh=75+((seed*53)%230+230)%230*(.52+layer*.18),x=i*step,y=horizon+layer*14-bh;
        ctx.fillStyle=layer===0?'#07101a':layer===1?'#09111a':'#0a0f17';ctx.fillRect(x,y,bw,bh);
        if(layer>0){ctx.fillStyle=seed%3===0?'rgba(255,35,90,.26)':'rgba(35,192,255,.19)';ctx.fillRect(x+bw-2,y,2,bh);for(let wy=y+15;wy<horizon-5;wy+=17){for(let wx=x+8;wx<x+bw-6;wx+=12){if(((wx+wy+seed)|0)%5===0){ctx.fillStyle=(seed+wy)%3===0?'rgba(255,210,115,.58)':'rgba(67,206,255,.42)';ctx.fillRect(wx,wy,3,4);}}}}
      }
      ctx.restore();
    }
  }

  function drawPalms(t){
    const horizon=H*.39;
    for(let side=-1;side<=1;side+=2){for(let i=0;i<7;i++){
      const p=((i/7+(roadScroll*.0018)%1)%1),q=Math.pow(p,1.65),y=lerp(horizon,H*1.02,q),rw=W*(.05+.56*Math.pow(p,1.12)),x=roadCenter(p)+side*(rw+30+75*p),s=.18+1.25*Math.pow(p,1.45);
      ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle='#080a0c';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(-side*3,-30,-side*2,-65);ctx.stroke();ctx.translate(-side*2,-65);ctx.fillStyle='#050708';for(let k=0;k<8;k++){ctx.save();ctx.rotate(k*Math.PI/4+.12*Math.sin(t+i));ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(19,-5,33,5);ctx.quadraticCurveTo(17,1,0,2);ctx.fill();ctx.restore();}ctx.restore();
    }}
  }

  function drawHelicopter(t){
    const x=W*.82+Math.sin(t*.25)*W*.03,y=H*.10+Math.sin(t*.8)*3,s=clamp(W/1600,.5,1.0);ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle='#090c12';ctx.beginPath();ctx.ellipse(0,0,38,12,0,0,Math.PI*2);ctx.fill();ctx.fillRect(30,-3,44,6);ctx.strokeStyle='#252a33';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-45,-16);ctx.lineTo(45,-16);ctx.stroke();const beam=ctx.createLinearGradient(0,10,0,120);beam.addColorStop(0,'rgba(235,248,255,.26)');beam.addColorStop(1,'rgba(170,225,255,0)');ctx.fillStyle=beam;ctx.beginPath();ctx.moveTo(-5,9);ctx.lineTo(-40,120);ctx.lineTo(25,120);ctx.closePath();ctx.fill();ctx.restore();
  }

  function drawRoad(){
    const horizon=H*.39,bottom=H*1.04,steps=90;
    for(let i=0;i<steps;i++){
      const a=i/steps,b=(i+1)/steps,qa=Math.pow(a,1.62),qb=Math.pow(b,1.62),ya=lerp(horizon,bottom,qa),yb=lerp(horizon,bottom,qb),wa=W*(.045+.55*Math.pow(a,1.12)),wb=W*(.045+.55*Math.pow(b,1.12)),ca=roadCenter(a),cb=roadCenter(b);
      ctx.beginPath();ctx.moveTo(ca-wa,ya);ctx.lineTo(ca+wa,ya);ctx.lineTo(cb+wb,yb);ctx.lineTo(cb-wb,yb);ctx.closePath();ctx.fillStyle=((i+Math.floor(roadScroll*.16))%2)?'#0b0e13':'#0d1016';ctx.fill();
      ctx.strokeStyle=`rgba(255,25,62,${.08+.23*a})`;ctx.lineWidth=1+4*a;ctx.beginPath();ctx.moveTo(ca-wa,ya);ctx.lineTo(cb-wb,yb);ctx.stroke();ctx.strokeStyle=`rgba(40,202,255,${.06+.18*a})`;ctx.beginPath();ctx.moveTo(ca+wa,ya);ctx.lineTo(cb+wb,yb);ctx.stroke();
    }
    for(let lane=-1;lane<=1;lane+=2){for(let i=0;i<30;i++){
      const p=((i/30+(roadScroll*.0045)%1)%1);if((i+Math.floor(roadScroll*.18))%2)continue;const q=Math.pow(p,1.62),y=lerp(horizon,bottom,q),w=W*(.045+.55*Math.pow(p,1.12)),x=roadCenter(p)+lane*w*.335;ctx.fillStyle=`rgba(238,241,245,${.08+.70*p})`;ctx.fillRect(x-(1+2*p),y,2+3*p,4+30*p);
    }}
    for(let i=0;i<12;i++){const p=.42+((i*.081+roadScroll*.0019)% .58),q=Math.pow(p,1.7),y=lerp(horizon,bottom,q),x=roadCenter(p)+Math.sin(i*3.9)*W*.22*p,w=35+150*p*p;const g=ctx.createLinearGradient(x,y,x,y+90*p);const c=i%2?'255,24,74':'38,190,255';g.addColorStop(0,`rgba(${c},${.12*p})`);g.addColorStop(1,`rgba(${c},0)`);ctx.fillStyle=g;ctx.fillRect(x-w/2,y,w,90*p);}
  }

  function drawStreetLights(){
    const horizon=H*.39;for(let side=-1;side<=1;side+=2){for(let i=0;i<8;i++){
      const p=((i/8+(roadScroll*.0024)%1)%1),q=Math.pow(p,1.62),y=lerp(horizon,H*1.02,q),rw=W*(.045+.55*Math.pow(p,1.12)),x=roadCenter(p)+side*(rw+45*p),s=.16+1.35*Math.pow(p,1.5);ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle='#0d1014';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-65);ctx.lineTo(-side*18,-65);ctx.stroke();ctx.fillStyle=i%3===0?'#ff315d':'#ffd5a1';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=15;ctx.fillRect(-side*22-3,-69,8,5);ctx.shadowBlur=0;ctx.restore();
    }}
  }

  function projectCar(worldD,lane){
    const rel=worldD-distance;if(rel<-40||rel>1700)return null;const z=clamp(1-rel/1700,0,1),p=.04+.96*z,s=.10+1.08*Math.pow(p,1.72),y=H*.39+H*.53*Math.pow(p,1.62),rw=W*(.045+.55*Math.pow(p,1.12)),x=roadCenter(p)+lane*rw;return{x,y,s,p};
  }
  function drawWorldCars(){
    const list=[];for(const o of opponents){const p=projectCar(o.worldD,o.lane);if(p)list.push({...p,o,race:true});}for(const o of traffic){const p=projectCar(o.worldD,o.lane);if(p)list.push({...p,o,race:false});}list.sort((a,b)=>a.p-b.p);for(const c of list)drawAICar(c.x,c.y,c.s,c.o,c.race);
  }
  function drawAICar(x,y,s,o,race){
    ctx.save();ctx.translate(x,y);ctx.scale(s,s);const w=race?84:74,h=38;ctx.shadowColor='rgba(0,0,0,.7)';ctx.shadowBlur=18;ctx.fillStyle=o.color||'#333943';ctx.beginPath();ctx.moveTo(-w*.48,0);ctx.lineTo(-w*.43,-h*.72);ctx.quadraticCurveTo(-w*.28,-h,w*.02,-h*1.02);ctx.quadraticCurveTo(w*.3,-h,w*.45,-h*.62);ctx.lineTo(w*.52,0);ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#090c11';ctx.beginPath();ctx.moveTo(-w*.23,-h*.72);ctx.lineTo(-w*.14,-h*.94);ctx.lineTo(w*.17,-h*.91);ctx.lineTo(w*.28,-h*.68);ctx.closePath();ctx.fill();if(race){ctx.fillStyle=o.stripe||'#777';ctx.fillRect(-5,-h,4,h);ctx.fillRect(3,-h,4,h);}ctx.fillStyle='#ff153b';ctx.shadowColor='#ff153b';ctx.shadowBlur=12;ctx.fillRect(-w*.38,-h*.2,20,5);ctx.fillRect(w*.14,-h*.2,20,5);ctx.shadowBlur=0;ctx.restore();
  }

  function drawPlayer(){
    const car=CARS[selectedCar],cx=W*.5+playerX*W*.19,cy=H*.91,scale=clamp(W/1250,.72,1.30);ctx.save();ctx.translate(cx,cy);ctx.scale(scale,scale);
    if(input.nitro&&nitro>0&&speed>50&&started){const g=ctx.createLinearGradient(0,0,0,65);g.addColorStop(0,'rgba(238,255,255,.95)');g.addColorStop(.24,'rgba(40,210,255,.78)');g.addColorStop(1,'rgba(48,95,255,0)');ctx.fillStyle=g;for(const xx of[-28,28]){ctx.beginPath();ctx.moveTo(xx-5,-4);ctx.lineTo(xx+5,-4);ctx.lineTo(xx+13,60+Math.random()*14);ctx.lineTo(xx-12,60+Math.random()*14);ctx.closePath();ctx.fill();}}
    ctx.shadowColor='rgba(0,0,0,.86)';ctx.shadowBlur=30;const bg=ctx.createLinearGradient(-90,-80,90,20);bg.addColorStop(0,car.body2);bg.addColorStop(.45,car.body);bg.addColorStop(1,'#020305');ctx.fillStyle=bg;ctx.beginPath();ctx.moveTo(-92,0);ctx.lineTo(-84,-50);ctx.quadraticCurveTo(-70,-80,-45,-87);ctx.lineTo(-31,-105);ctx.quadraticCurveTo(-17,-122,0,-123);ctx.quadraticCurveTo(20,-123,36,-104);ctx.lineTo(49,-87);ctx.quadraticCurveTo(72,-80,85,-51);ctx.lineTo(94,0);ctx.quadraticCurveTo(54,17,0,19);ctx.quadraticCurveTo(-54,17,-92,0);ctx.closePath();ctx.fill();ctx.shadowBlur=0;
    ctx.fillStyle='#071019';ctx.beginPath();ctx.moveTo(-29,-106);ctx.quadraticCurveTo(-16,-119,0,-119);ctx.quadraticCurveTo(18,-119,32,-104);ctx.lineTo(45,-76);ctx.lineTo(-43,-76);ctx.closePath();ctx.fill();ctx.fillStyle=car.stripe;ctx.fillRect(-12,-122,8,137);ctx.fillRect(4,-122,8,137);ctx.fillStyle='#050608';ctx.fillRect(-74,-73,148,7);ctx.fillStyle='#ff1238';ctx.shadowColor='#ff1238';ctx.shadowBlur=22;ctx.fillRect(-69,-41,43,9);ctx.fillRect(26,-41,43,9);ctx.shadowBlur=0;ctx.fillStyle='#05070a';ctx.fillRect(-66,-15,132,15);ctx.fillStyle='#020203';ctx.fillRect(-99,-49,18,49);ctx.fillRect(81,-49,18,49);ctx.restore();
  }

  function drawRain(t){ctx.save();ctx.lineWidth=1;const intensity=state==='race'?.42:.22;for(let i=0;i<90;i++){const x=(i*97.3+t*(300+speed*1.6))%(W+120)-60,y=(i*53.7+t*(500+speed*1.8))%(H+120)-60,l=8+speed*.04+(i%5)*4;ctx.strokeStyle=`rgba(185,215,235,${intensity*(.25+(i%7)/10)})`;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-5-speed*.014,y+l);ctx.stroke();}ctx.restore();}
  function drawParticles(){for(const p of particles){const a=1-p.age/p.life;if(p.boost){ctx.fillStyle=`rgba(64,218,255,${a})`;ctx.shadowColor='#43dfff';ctx.shadowBlur=10;ctx.fillRect(p.x,p.y,3+3*a,8+10*a);ctx.shadowBlur=0;}else{ctx.fillStyle=`rgba(255,176,58,${a})`;ctx.shadowColor='#ff6b23';ctx.shadowBlur=8;ctx.fillRect(p.x,p.y,3,3);ctx.shadowBlur=0;}}}
  function drawSpeedLines(){if(speed<90||state!=='race')return;const a=clamp((speed-90)/150,0,.35);ctx.strokeStyle=`rgba(255,255,255,${a})`;for(let i=0;i<24;i++){const x=(i*83.7+roadScroll*4)%W,y=H*.2+(i*47.3)%(H*.72),len=12+(i%7)*7+speed*.07;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(x-W/2)*.04,y+len);ctx.stroke();}}

  function frame(now){
    const dt=Math.min(.04,Math.max(0,(now-last)/1000));last=now;update(dt);draw();requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const controlCodes = {
    ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right', ArrowUp:'gas', KeyW:'gas', ArrowDown:'brake', KeyS:'brake', ShiftLeft:'nitro', ShiftRight:'nitro', Space:'nitro'
  };
  function keyHandler(e, down){
    const action = controlCodes[e.code];
    if (!action) return;
    e.preventDefault();
    input[action] = down;
    if (state === 'menu' && down && (action==='gas' || action==='nitro')) startRace();
  }
  window.addEventListener('keydown',e=>keyHandler(e,true),{passive:false});
  window.addEventListener('keyup',e=>keyHandler(e,false),{passive:false});
  window.addEventListener('blur',clearInputs);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInputs();});

  function bindHold(id, action){
    const el=$(id); if(!el)return;
    const on=(e)=>{e.preventDefault();input[action]=true;if(el.setPointerCapture&&e.pointerId!==undefined)try{el.setPointerCapture(e.pointerId)}catch(_){}};
    const off=(e)=>{e.preventDefault();input[action]=false;};
    el.addEventListener('pointerdown',on,{passive:false});
    ['pointerup','pointercancel','lostpointercapture'].forEach(ev=>el.addEventListener(ev,off,{passive:false}));
  }
  bindHold('leftBtn','left');bindHold('rightBtn','right');bindHold('gasBtn','gas');bindHold('brakeBtn','brake');bindHold('nitroBtn','nitro');

  $('startBtn')?.addEventListener('click',startRace);
  $('restartBtn')?.addEventListener('click',startRace);
  document.querySelectorAll('.car-card').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.car-card').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');selectedCar=Number(btn.dataset.car)||0;const c=CARS[selectedCar];
    if(ui.selectedName)ui.selectedName.textContent=c.name;if(ui.power)ui.power.textContent=c.power;if(ui.topStat)ui.topStat.textContent=c.statSpeed;if(ui.handling)ui.handling.textContent=c.statHandling;beep(260+selectedCar*55,.04,.02);
  }));

  setInterval(()=>{if(state==='menu')roadScroll+=.45;},30);
})();