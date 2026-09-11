(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  const startScreen = $('startScreen');
  const finishScreen = $('finishScreen');
  const hud = $('hud');
  const mobileControls = $('mobileControls');
  const speedEl = $('speed');
  const posEl = $('position');
  const distanceEl = $('distance');
  const nitroBar = $('nitroBar');

  const CAR_SPECS = [
    { name:'V8 Phantom', color:'#ff365f', dark:'#80152c', max:205, accel:64, handling:1.75 },
    { name:'Cobra XR', color:'#31d7ff', dark:'#135270', max:198, accel:72, handling:1.62 },
    { name:'Liberty GT', color:'#ffb343', dark:'#7d4714', max:218, accel:59, handling:1.50 },
    { name:'Venom ZR', color:'#72ef8b', dark:'#206b39', max:201, accel:63, handling:1.95 }
  ];

  let DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;
  let state = 'menu';
  let selectedCar = 0;
  let last = performance.now();
  let raceTime = 0;
  let speed = 0;
  let topSpeed = 0;
  let x = 0;
  let progress = 0;
  let nitro = 1;
  let shake = 0;
  let flash = 0;
  let roadScroll = 0;
  let skylineScroll = 0;
  let opponents = [];
  let particles = [];
  let totalOpponents = 5;
  let position = 6;
  let audioCtx = null;
  let engineOsc = null;
  let engineGain = null;

  const input = { left:false, right:false, gas:false, brake:false, nitro:false };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  window.addEventListener('resize', resize); resize();

  function initOpponents() {
    opponents = [
      { lane:-.56, z:.07, pace:.78, color:'#7c62ff', name:'Razor' },
      { lane:.58, z:.15, pace:.82, color:'#ffcc3e', name:'Mara' },
      { lane:.05, z:.22, pace:.86, color:'#40e09c', name:'Knox' },
      { lane:-.27, z:.31, pace:.90, color:'#ff6a35', name:'Nova' },
      { lane:.38, z:.41, pace:.94, color:'#49a1ff', name:'Ghost' }
    ].map((o,i) => ({...o, seed:i*17.2, overtaken:false}));
    position = 6;
  }

  function resetRace() {
    raceTime = 0; speed = 0; topSpeed = 0; x = 0; progress = 0; nitro = 1;
    shake = 0; flash = 0; roadScroll = 0; particles = []; initOpponents();
  }

  function startRace() {
    resetRace(); state = 'race'; startScreen.classList.remove('active'); finishScreen.classList.remove('active');
    hud.classList.remove('hidden');
    if (matchMedia('(pointer: coarse)').matches) mobileControls.classList.remove('hidden');
    initAudio();
  }

  function endRace() {
    state = 'finish'; hud.classList.add('hidden'); mobileControls.classList.add('hidden');
    $('finishPosition').textContent = ordinal(position);
    $('finishTime').textContent = formatTime(raceTime);
    $('topSpeed').textContent = Math.round(topSpeed) + ' MPH';
    $('finishTitle').textContent = position === 1 ? 'MIDNIGHT OWNED.' : position <= 3 ? 'PODIUM UNDER NEON.' : 'RUN IT BACK.';
    finishScreen.classList.add('active');
    stopAudio();
  }

  function ordinal(n) { return n + (n%10===1&&n%100!==11?'st':n%10===2&&n%100!==12?'nd':n%10===3&&n%100!==13?'rd':'th'); }
  function formatTime(s) { const m=Math.floor(s/60), sec=s-m*60; return `${String(m).padStart(2,'0')}:${sec.toFixed(1).padStart(4,'0')}`; }

  function initAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      engineOsc = audioCtx.createOscillator(); engineGain = audioCtx.createGain();
      engineOsc.type='sawtooth'; engineGain.gain.value=.025;
      engineOsc.connect(engineGain); engineGain.connect(audioCtx.destination); engineOsc.start();
    } catch (_) {}
  }
  function stopAudio(){ try { engineOsc && engineOsc.stop(); } catch(_){} engineOsc=null; }
  function blip(freq=220, dur=.08, gain=.05) {
    if (!audioCtx) return;
    const o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.frequency.value=freq; o.type='square'; g.gain.setValueAtTime(gain,audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+dur);
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+dur);
  }

  function update(dt) {
    skylineScroll += dt * (state==='race' ? speed*.002 : .2);
    if (state !== 'race') return;
    const car = CAR_SPECS[selectedCar];
    raceTime += dt;
    const boost = input.nitro && input.gas && nitro > 0 && speed > 55;
    const maxSpeed = car.max + (boost ? 45 : 0);

    if (input.gas) speed += car.accel * dt * (1 - Math.min(speed/maxSpeed,.92)*.56);
    else speed -= 20 * dt;
    if (input.brake) speed -= 105*dt;
    if (boost) { speed += 84*dt; nitro -= .20*dt; spawnNitro(); }
    else nitro = Math.min(1, nitro + .032*dt);
    speed = Math.max(0, Math.min(maxSpeed, speed));
    topSpeed = Math.max(topSpeed, speed);

    const steerScale = (.34 + Math.min(speed/100,1)*.66) * car.handling;
    if (input.left) x -= steerScale*dt;
    if (input.right) x += steerScale*dt;
    x *= 1 - .12*dt;
    x = Math.max(-1.05, Math.min(1.05, x));
    if (Math.abs(x) > .92) speed -= 35*dt;

    roadScroll += speed * dt * .009;
    progress += speed * dt / 19000;
    flash = Math.max(0, flash - dt*3.2); shake *= Math.pow(.04,dt);

    updateOpponents(dt, car);
    updateParticles(dt);

    speedEl.textContent = Math.round(speed);
    posEl.textContent = `${position} / ${totalOpponents+1}`;
    distanceEl.textContent = `${Math.min(100, Math.floor(progress*100))}%`;
    nitroBar.style.width = `${nitro*100}%`;
    if (engineOsc) engineOsc.frequency.setTargetAtTime(45 + speed*1.55, audioCtx.currentTime, .04);
    if (progress >= 1) endRace();
  }

  function updateOpponents(dt, car) {
    let ahead = 0;
    opponents.forEach((o,i) => {
      const playerPace = speed / car.max;
      const relative = (playerPace - o.pace);
      o.z += relative * dt * .18;
      o.lane += Math.sin(raceTime*.65 + o.seed)*dt*.015;
      o.lane = Math.max(-.72, Math.min(.72, o.lane));

      if (o.z > 1.08) {
        o.z = -.08;
        if (!o.overtaken) { o.overtaken = true; blip(620,.06,.03); }
      }
      if (o.z < -.16) { o.z = .1; o.overtaken = false; }

      const nearPlayer = o.z > .84 && o.z < 1.02;
      if (nearPlayer && Math.abs(o.lane - x*.72) < .22 && speed > 45) {
        speed *= .62; shake = 1; flash = .55; o.z -= .10; o.lane += (o.lane > x*.72 ? .16 : -.16); blip(85,.16,.08);
      }
      if (!o.overtaken) ahead++;
    });
    position = Math.max(1, Math.min(6, ahead+1));
  }

  function spawnNitro(){
    if (particles.length > 100) return;
    for(let i=0;i<2;i++) particles.push({ x:W/2 + x*W*.22 + (Math.random()-.5)*40, y:H*.86+Math.random()*12, vx:(Math.random()-.5)*18, vy:35+Math.random()*60, life:.35+Math.random()*.3, age:0, size:2+Math.random()*5 });
  }
  function updateParticles(dt){ particles.forEach(p=>{p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;}); particles=particles.filter(p=>p.age<p.life); }

  function draw() {
    const t = performance.now()/1000;
    ctx.clearRect(0,0,W,H);
    ctx.save();
    if (shake>.01) ctx.translate((Math.random()-.5)*14*shake,(Math.random()-.5)*9*shake);
    drawSky(t); drawCity(t); drawRoad(t); drawOpponents(t); drawPlayer(t); drawFx(t);
    ctx.restore();
    if (flash>0){ ctx.fillStyle=`rgba(255,255,255,${flash*.3})`; ctx.fillRect(0,0,W,H); }
  }

  function drawSky(t){
    const g=ctx.createLinearGradient(0,0,0,H*.65); g.addColorStop(0,'#04050a'); g.addColorStop(.55,'#100e22'); g.addColorStop(1,'#24112b'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    const glow=ctx.createRadialGradient(W*.67,H*.23,0,W*.67,H*.23,W*.4); glow.addColorStop(0,'rgba(125,59,180,.20)'); glow.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=glow; ctx.fillRect(0,0,W,H*.7);
    for(let i=0;i<55;i++){ const sx=(i*197.31)%W, sy=(i*83.77)%(H*.4); const a=.14+((i*23)%10)/25; ctx.fillStyle=`rgba(255,255,255,${a})`; ctx.fillRect(sx,sy,1,1); }
  }

  function drawCity(t){
    const horizon=H*.43; ctx.save(); ctx.translate(-(skylineScroll*12)%120,0);
    for(let i=-2;i<Math.ceil(W/70)+4;i++){
      const bw=44+(i*19%36+36)%36, bh=70+((i*47)%170+170)%170, bx=i*72, by=horizon-bh;
      ctx.fillStyle=i%3===0?'#0a0c14':'#0d0f19'; ctx.fillRect(bx,by,bw,bh);
      ctx.fillStyle='rgba(255,58,124,.12)'; ctx.fillRect(bx+bw-2,by,2,bh);
      for(let wy=by+12;wy<by+bh-8;wy+=17) for(let wx=bx+8;wx<bx+bw-7;wx+=13){ if(((wx+wy+i*11)|0)%4===0){ctx.fillStyle=(i+wy)%2?'rgba(255,196,87,.48)':'rgba(53,211,255,.35)';ctx.fillRect(wx,wy,3,5);} }
    }
    ctx.restore();
    const haze=ctx.createLinearGradient(0,horizon-50,0,horizon+70); haze.addColorStop(0,'rgba(53,25,75,0)'); haze.addColorStop(.6,'rgba(78,33,84,.24)'); haze.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=haze; ctx.fillRect(0,horizon-50,W,120);
  }

  function roadCenterAt(yNorm) {
    const curve = Math.sin(roadScroll*.16)*.11 + Math.sin(roadScroll*.055+1.7)*.08;
    return W/2 + curve * W * Math.pow(yNorm,1.6);
  }

  function drawRoad(t){
    const horizon=H*.43, bottom=H*1.03, steps=72;
    for(let i=0;i<steps;i++){
      const a=i/steps,b=(i+1)/steps;
      const ya=horizon+(bottom-horizon)*Math.pow(a,1.62), yb=horizon+(bottom-horizon)*Math.pow(b,1.62);
      const wa=W*(.035+.56*Math.pow(a,1.18)), wb=W*(.035+.56*Math.pow(b,1.18));
      const ca=roadCenterAt(a), cb=roadCenterAt(b);
      ctx.beginPath();ctx.moveTo(ca-wa,ya);ctx.lineTo(ca+wa,ya);ctx.lineTo(cb+wb,yb);ctx.lineTo(cb-wb,yb);ctx.closePath();
      const stripe=((i+Math.floor(roadScroll*4))%2)===0; ctx.fillStyle=stripe?'#11131a':'#0d0f15';ctx.fill();
      ctx.strokeStyle='rgba(255,53,99,.35)';ctx.lineWidth=Math.max(1,a*5);ctx.beginPath();ctx.moveTo(ca-wa,ya);ctx.lineTo(cb-wb,yb);ctx.stroke();
      ctx.strokeStyle='rgba(46,211,255,.28)';ctx.beginPath();ctx.moveTo(ca+wa,ya);ctx.lineTo(cb+wb,yb);ctx.stroke();
    }
    for(let lane=-1; lane<=1; lane+=2){
      for(let i=0;i<24;i++){
        const p=((i/24 + (roadScroll*.018)%1)%1); if(((i+Math.floor(roadScroll))%2)!==0) continue;
        const yN=Math.pow(p,1.6), y=horizon+(bottom-horizon)*yN, w=W*(.035+.56*Math.pow(p,1.18)); const c=roadCenterAt(p);
        const x1=c + lane*w*.34; ctx.fillStyle=`rgba(225,230,240,${.08+.55*p})`;ctx.fillRect(x1-Math.max(1,p*2),y,Math.max(1,p*3),Math.max(2,p*26));
      }
    }
    const rg=ctx.createLinearGradient(0,horizon,0,bottom);rg.addColorStop(0,'rgba(255,255,255,0)');rg.addColorStop(1,'rgba(255,54,95,.06)');ctx.fillStyle=rg;ctx.fillRect(0,horizon,W,bottom-horizon);
  }

  function opponentScreen(o){
    const p=Math.max(0,Math.min(1,o.z)); const s=.12+.88*Math.pow(p,1.55); const horizon=H*.43; const y=horizon+(H*.52)*Math.pow(p,1.58); const roadW=W*(.035+.56*Math.pow(p,1.18)); const cx=roadCenterAt(p); const xx=cx+o.lane*roadW; return {x:xx,y,s};
  }

  function drawOpponents(t){
    const ordered=[...opponents].sort((a,b)=>a.z-b.z);
    ordered.forEach(o=>{ if(o.z<0||o.z>1.03)return; const p=opponentScreen(o); drawCar(p.x,p.y,26+48*p.s,58+94*p.s,o.color,'#101217',false,t); });
  }

  function drawPlayer(t){
    const car=CAR_SPECS[selectedCar]; const px=W/2 + x*W*.22; const py=H*.84; const size=Math.min(W,H)*.09;
    if(speed>110){ctx.save();ctx.globalAlpha=Math.min(.28,(speed-110)/220);ctx.strokeStyle='#d7f8ff';for(let i=0;i<18;i++){const xx=(i*83+t*500)%W;const yy=H*.52+((i*61)%Math.max(1,H*.48));ctx.beginPath();ctx.moveTo(xx,yy);ctx.lineTo(xx,yy+20+speed*.11);ctx.stroke();}ctx.restore();}
    drawCar(px,py,size*.66,size*1.42,car.color,car.dark,true,t);
    particles.forEach(p=>{const a=1-p.age/p.life;ctx.fillStyle=`rgba(57,222,255,${a*.65})`;ctx.beginPath();ctx.arc(p.x,p.y,p.size*a,0,Math.PI*2);ctx.fill();});
  }

  function drawCar(cx,cy,w,h,color,dark,player,t){
    ctx.save();ctx.translate(cx,cy); if(player){ const tilt=(input.left?-.035:0)+(input.right?.035:0);ctx.rotate(tilt); }
    ctx.shadowColor=color;ctx.shadowBlur=player?30:12;ctx.globalAlpha=.45;ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(0,h*.34,w*.58,h*.13,0,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.globalAlpha=1;
    ctx.fillStyle='#050608';for(const sx of [-1,1]){ctx.fillRect(sx*w*.48-w*.11,-h*.18,w*.18,h*.24);ctx.fillRect(sx*w*.48-w*.11,h*.18,w*.18,h*.24);}
    const grad=ctx.createLinearGradient(-w/2,-h/2,w/2,h/2);grad.addColorStop(0,color);grad.addColorStop(.55,dark);grad.addColorStop(1,'#090b11');ctx.fillStyle=grad;
    ctx.beginPath();ctx.moveTo(-w*.33,-h*.5);ctx.quadraticCurveTo(-w*.52,-h*.34,-w*.47,-h*.04);ctx.lineTo(-w*.42,h*.34);ctx.quadraticCurveTo(-w*.30,h*.49,0,h*.52);ctx.quadraticCurveTo(w*.30,h*.49,w*.42,h*.34);ctx.lineTo(w*.47,-h*.04);ctx.quadraticCurveTo(w*.52,-h*.34,w*.33,-h*.5);ctx.closePath();ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.22)';ctx.lineWidth=Math.max(1,w*.025);ctx.beginPath();ctx.moveTo(-w*.24,-h*.38);ctx.quadraticCurveTo(0,-h*.47,w*.24,-h*.38);ctx.stroke();
    ctx.fillStyle='rgba(7,14,22,.87)';ctx.beginPath();ctx.moveTo(-w*.26,-h*.19);ctx.lineTo(-w*.19,-h*.38);ctx.lineTo(w*.19,-h*.38);ctx.lineTo(w*.26,-h*.19);ctx.closePath();ctx.fill();
    ctx.fillStyle='rgba(31,54,68,.7)';ctx.beginPath();ctx.moveTo(-w*.29,-h*.12);ctx.lineTo(w*.29,-h*.12);ctx.lineTo(w*.25,h*.11);ctx.lineTo(-w*.25,h*.11);ctx.closePath();ctx.fill();
    ctx.shadowColor='#ff294f';ctx.shadowBlur=10;ctx.fillStyle='#ff365f';ctx.fillRect(-w*.33,h*.32,w*.16,h*.055);ctx.fillRect(w*.17,h*.32,w*.16,h*.055);ctx.shadowBlur=0;
    ctx.fillStyle='#c5c9d2';ctx.fillRect(-w*.12,h*.40,w*.24,h*.055);ctx.fillStyle='#040506';ctx.fillRect(-w*.31,h*.44,w*.12,h*.035);ctx.fillRect(w*.19,h*.44,w*.12,h*.035);
    if(player && input.nitro && nitro>0 && speed>55){ctx.shadowColor='#2bdcff';ctx.shadowBlur=16;ctx.fillStyle='#c9fbff';ctx.beginPath();ctx.moveTo(-w*.27,h*.46);ctx.lineTo(-w*.18,h*.74+Math.random()*h*.12);ctx.lineTo(-w*.12,h*.46);ctx.fill();ctx.beginPath();ctx.moveTo(w*.12,h*.46);ctx.lineTo(w*.18,h*.74+Math.random()*h*.12);ctx.lineTo(w*.27,h*.46);ctx.fill();ctx.shadowBlur=0;}
    ctx.restore();
  }

  function drawFx(t){
    const v=ctx.createRadialGradient(W/2,H*.55,Math.min(W,H)*.18,W/2,H*.55,Math.max(W,H)*.72);v.addColorStop(.45,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,.68)');ctx.fillStyle=v;ctx.fillRect(0,0,W,H);
    ctx.save();ctx.globalAlpha=.16;ctx.strokeStyle='#dfe8ff';for(let i=0;i<20;i++){const xx=(i*113+t*90)%W, yy=(i*71+t*150)%H;ctx.beginPath();ctx.moveTo(xx,yy);ctx.lineTo(xx-2,yy+10);ctx.stroke();}ctx.restore();
  }

  function loop(now){ const dt=Math.min(.033,(now-last)/1000); last=now; update(dt); draw(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);

  document.querySelectorAll('.car-card').forEach(btn=>btn.addEventListener('click',()=>{ selectedCar=+btn.dataset.car; document.querySelectorAll('.car-card').forEach(b=>b.classList.toggle('selected',b===btn)); blip(280+selectedCar*80,.05,.02); }));
  $('startBtn').addEventListener('click',startRace); $('restartBtn').addEventListener('click',startRace);

  const keyMap = { ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'gas',KeyW:'gas',ArrowDown:'brake',KeyS:'brake',ShiftLeft:'nitro',ShiftRight:'nitro' };
  addEventListener('keydown',e=>{ if(keyMap[e.code]){input[keyMap[e.code]]=true;e.preventDefault();} if(e.code==='Enter'&&state==='menu')startRace(); });
  addEventListener('keyup',e=>{ if(keyMap[e.code]){input[keyMap[e.code]]=false;e.preventDefault();} });
  addEventListener('blur',()=>Object.keys(input).forEach(k=>input[k]=false));

  function bindTouch(id,key){ const el=$(id); const on=e=>{e.preventDefault();input[key]=true;}; const off=e=>{e.preventDefault();input[key]=false;}; ['pointerdown','touchstart'].forEach(ev=>el.addEventListener(ev,on,{passive:false})); ['pointerup','pointercancel','pointerleave','touchend','touchcancel'].forEach(ev=>el.addEventListener(ev,off,{passive:false})); }
  bindTouch('leftBtn','left');bindTouch('rightBtn','right');bindTouch('gasBtn','gas');bindTouch('brakeBtn','brake');bindTouch('nitroBtn','nitro');
})();
