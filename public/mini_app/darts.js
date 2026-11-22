(() => {
  const SECTORS = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
  const SCORES = [200,300,350,501];
  const COLORS = { red: '#ef4444', blue: '#38bdf8' };
  let running = false, mode = 'bot', gameId = '', side = 'red', canControl = true;
  let scoreStart = 300, difficulty = 'متوسط', redScore = 300, blueScore = 300;
  let redName = 'أنت', blueName = 'بوت نواف', activeSide = 'red', phase = 'turn_intro';
  let aimX = 0, aimY = 0, lockedX = 0, round = 1, phaseAt = 0;
  let history = [], darts = [], cursor = '0', frame = 0, pollTimer = null, botTimer = null;
  let aimSpeed = 2.6, help = false, lastHit = null, ended = false, shell = null;

  const tg = () => window.Telegram?.WebApp;
  const initData = () => tg()?.initData || '';
  const playerName = () => {
    const u = tg()?.initDataUnsafe?.user || {};
    return [u.first_name,u.last_name].filter(Boolean).join(' ').trim() || u.username || 'أنت';
  };
  const escape = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const polar = (angle, radius) => {
    const a = angle * Math.PI / 180;
    return [220 + Math.sin(a) * radius, 220 - Math.cos(a) * radius];
  };
  const annular = (a0, a1, r0, r1) => {
    const p1=polar(a0,r1),p2=polar(a1,r1),p3=polar(a1,r0),p4=polar(a0,r0);
    return `M${p1[0]},${p1[1]} A${r1},${r1} 0 0 1 ${p2[0]},${p2[1]} L${p3[0]},${p3[1]} A${r0},${r0} 0 0 0 ${p4[0]},${p4[1]} Z`;
  };
  function boardSvg() {
    let paths = '';
    SECTORS.forEach((n,i) => {
      const a0=i*18-9, a1=a0+18, alt=i%2===0;
      const single=alt?'#17191d':'#eee9dc', other=alt?'#eee9dc':'#17191d';
      paths += `<path d="${annular(a0,a1,28,105)}" fill="${single}" stroke="#8e8b83" stroke-width="1"/>`;
      paths += `<path d="${annular(a0,a1,120,178)}" fill="${other}" stroke="#8e8b83" stroke-width="1"/>`;
      paths += `<path d="${annular(a0,a1,105,120)}" fill="${i%2===0?'#b91c32':'#16734b'}" stroke="#e2c17a" stroke-width="1"/>`;
      paths += `<path d="${annular(a0,a1,178,196)}" fill="${i%2===0?'#16734b':'#b91c32'}" stroke="#e2c17a" stroke-width="1"/>`;
      const [tx,ty]=polar(i*18,218);
      paths += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" fill="#f8e9bf" font-size="15" font-weight="900">${n}</text>`;
    });
    return `<svg id="darts-board" viewBox="0 0 440 440" role="img" aria-label="لوحة السهام">
      <defs><radialGradient id="darts-rim"><stop offset="0" stop-color="#25282d"/><stop offset=".82" stop-color="#101216"/><stop offset="1" stop-color="#050608"/></radialGradient>
      <filter id="darts-shadow"><feGaussianBlur stdDeviation="7"/></filter></defs>
      <circle cx="220" cy="220" r="218" fill="#000" opacity=".6" filter="url(#darts-shadow)"/>
      <circle cx="220" cy="220" r="214" fill="url(#darts-rim)" stroke="#c5a35f" stroke-width="4"/>
      <circle cx="220" cy="220" r="202" fill="#0b0d10" stroke="#e5d2a0" stroke-width="1.5"/>
      ${paths}
      <circle cx="220" cy="220" r="28" fill="#187b50" stroke="#d8b86e" stroke-width="2"/>
      <circle cx="220" cy="220" r="13" fill="#bd2036" stroke="#f4d78f" stroke-width="2"/>
      <circle cx="220" cy="220" r="4" fill="#f6e6b6"/>
      <circle cx="220" cy="220" r="198" fill="none" stroke="#d7c18f" stroke-width="2"/>
      <g id="darts-pins"></g>
      <g id="darts-help-targets"></g>
      <g id="darts-aim-layer"><circle id="darts-aim-glow" cx="220" cy="220" r="13" fill="#fff" opacity=".2"/><circle id="darts-aim" cx="220" cy="220" r="5" fill="#fff" stroke="#111" stroke-width="2"/><path id="darts-aim-cross" d="M205 220h30M220 205v30" stroke="#fff" stroke-width="1.4" opacity=".85"/></g>
    </svg>`;
  }
  function injectStyles() {
    if (document.getElementById('darts-style')) return;
    const style=document.createElement('style');style.id='darts-style';
    style.textContent=`
      .darts-wrap{width:100%;max-width:560px;margin:0 auto;padding:8px 0 22px;color:#fff}
      .darts-heading{text-align:right;margin:3px 0 14px}.darts-heading h2{font-size:clamp(25px,7vw,34px);font-weight:950;margin:0 0 4px}.darts-heading p{margin:0;color:#ffffff9c;font-size:12px}
      .darts-panel{background:linear-gradient(145deg,#281014,#12090c);border:1px solid #ffffff24;border-radius:22px;padding:14px;box-shadow:0 12px 30px #0006}
      .darts-label{font-size:12px;font-weight:850;color:#ffffffc7;margin:4px 0 9px}
      .darts-options{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:14px}
      .darts-options button,.darts-levels button{border:1px solid #ffffff30;border-radius:12px;background:#09080b;color:white;padding:11px 4px;font-weight:900}
      .darts-options button.active,.darts-levels button.active{border-color:#f5c76d;background:#8b5b22;color:#fff4d5;box-shadow:0 0 0 1px #f5c76d55}
      .darts-levels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:12px}
      .darts-levels small{display:block;font-size:9px;color:#ffffffa0;margin-top:4px}
      .darts-primary,.darts-secondary{width:100%;min-height:54px;border-radius:15px;font-weight:950;font-size:16px;border:1px solid #fff3}
      .darts-primary{background:linear-gradient(135deg,#dc293d,#84101d);color:#fff;box-shadow:0 5px 0 #4a0a12}
      .darts-secondary{background:#17232c;color:#e4f5ff;border-color:#55b9ec55;box-shadow:0 5px 0 #08131b}
      .darts-game{min-height:calc(100dvh - 8px);display:flex;flex-direction:column;gap:10px;padding:4px 0 14px}
      .darts-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:7px}
      .darts-player{border:1px solid #ffffff28;background:#100d11;border-radius:15px;padding:8px 6px;text-align:center;min-width:0}
      .darts-player.active{border-color:#f6cf78;box-shadow:0 0 0 1px #f6cf783d,0 0 18px #f6cf7822}
      .darts-player .name{font-size:11px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .darts-player .score{font-size:26px;line-height:1.2;font-weight:1000;font-variant-numeric:tabular-nums}
      .darts-player.red .score{color:#fb5264}.darts-player.blue .score{color:#50c5ff}
      .darts-vs{font-size:11px;color:#f4d48c;font-weight:1000}
      .darts-board-wrap{width:min(88vw,430px);margin:0 auto;position:relative;filter:drop-shadow(0 13px 20px #0009)}
      #darts-board{display:block;width:100%;height:auto;touch-action:manipulation}
      .darts-status{border:1px solid #ffffff22;background:#100c10;border-radius:14px;padding:10px;text-align:center;font-size:13px;font-weight:900;min-height:42px}
      .darts-hit{color:#f5d58e;font-size:12px;margin-top:3px}
      .darts-actions{display:grid;grid-template-columns:1fr 1.6fr;gap:9px}
      .darts-actions button{border-radius:13px;min-height:48px;font-size:13px;font-weight:900;border:1px solid #ffffff30}
      .darts-help{background:#22202a;color:#f5d58e}.darts-throw{background:linear-gradient(135deg,#e02b40,#8b0d1d);color:#fff;box-shadow:0 4px 0 #510912}
      .darts-history{display:flex;gap:6px;overflow:auto;padding:2px 0 5px}
      .darts-history span{flex:none;border:1px solid #ffffff1c;border-radius:9px;background:#ffffff0b;padding:5px 8px;font-size:10px;color:#ffffffbd}
      .darts-exit{position:fixed;right:0;top:calc(env(safe-area-inset-top,0px) + 12px);z-index:10020;border:1px solid #ffffff70;background:#fff;color:#20191b;border-radius:13px 0 0 13px;padding:9px 12px;font-size:12px;font-weight:950;box-shadow:0 4px 0 #0006}
      .darts-toast{position:fixed;top:calc(env(safe-area-inset-top,0px) + 12px);left:50%;transform:translateX(-50%);z-index:10050;background:#1c1013;border:1px solid #e8b96c;color:#ffe9bd;padding:10px 14px;border-radius:12px;font-size:12px;font-weight:800}
      @media(min-height:760px){.darts-board-wrap{width:min(92vw,470px)}}
    `;
    document.head.appendChild(style);
  }
  function setup() {
    injectStyles();stop();
    document.body.classList.add('c4-active');
    shell=window.c4Shell?window.c4Shell():document.getElementById('page-content');
    shell.innerHTML=`<div class="darts-wrap"><div class="darts-heading"><h2>السهام 🎯</h2><p>&nbsp;</p></div><div class="darts-panel">
      <div class="darts-label">نقاط البداية — من يصل إلى الصفر أولًا يفوز</div><div class="darts-options" id="darts-scores"></div>
      <div class="darts-label">مستوى صعوبة البوت</div><div class="darts-levels" id="darts-levels"></div>
      <button class="darts-primary" id="darts-start">ابدأ اللعب الآن</button></div></div>`;
    const scoreRoot=shell.querySelector('#darts-scores');
    SCORES.forEach(v=>{const b=document.createElement('button');b.textContent=v;b.className=v===scoreStart?'active':'';b.onclick=()=>{scoreStart=v;scoreRoot.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));};scoreRoot.appendChild(b);});
    const levels=shell.querySelector('#darts-levels');
    [['سهل','تحدي بسيط'],['متوسط','متوازن'],['صعب','أدق تصويب']].forEach(([v,desc])=>{const b=document.createElement('button');b.className=v===difficulty?'active':'';b.innerHTML=`${v}<small>${desc}</small>`;b.onclick=()=>{difficulty=v;levels.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));};levels.appendChild(b);});
    shell.querySelector('#darts-start').onclick=()=>startBot();
  }
  function renderGame() {
    if(!shell)return;
    shell.innerHTML=`<div class="darts-wrap"><div class="darts-game">
      <div class="darts-top">
        <div class="darts-player red" id="darts-red"><div class="name" id="darts-red-name"></div><div class="score" id="darts-red-score"></div></div>
        <div class="darts-vs">VS</div>
        <div class="darts-player blue" id="darts-blue"><div class="name" id="darts-blue-name"></div><div class="score" id="darts-blue-score"></div></div>
      </div>
      <div class="darts-board-wrap" id="darts-board-wrap">${boardSvg()}</div>
      <div class="darts-status"><div id="darts-status-text"></div><div class="darts-hit" id="darts-hit"></div></div>
      <div class="darts-actions"><button class="darts-help" id="darts-help">شرح النقاط</button><button class="darts-throw" id="darts-throw">ثبّت التصويب</button></div>
      <div class="darts-history" id="darts-history"></div>
    </div></div><button class="darts-exit" id="darts-exit">${mode==='online'?'انسحاب':'خروج'}</button>`;
    shell.querySelector('#darts-throw').onclick=tap;
    shell.querySelector('#darts-board-wrap').onclick=(event)=>{if(event.target.closest('svg'))tap();};
    shell.querySelector('#darts-help').onclick=()=>{help=!help;drawHelp();};
    shell.querySelector('#darts-exit').onclick=exit;
    updateHud();
  }
  function updateHud() {
    if(!shell)return;
    const red=shell.querySelector('#darts-red'),blue=shell.querySelector('#darts-blue');
    if(!red)return;
    shell.querySelector('#darts-red-name').textContent=redName;
    shell.querySelector('#darts-blue-name').textContent=blueName;
    shell.querySelector('#darts-red-score').textContent=redScore;
    shell.querySelector('#darts-blue-score').textContent=blueScore;
    red.classList.toggle('active',activeSide==='red');
    blue.classList.toggle('active',activeSide==='blue');
    const isMyTurn=mode==='bot'?activeSide==='red':side===activeSide&&canControl;
    const status=shell.querySelector('#darts-status-text');
    if(status){
      if(phase==='turn_intro')status.textContent=`استعد يا ${activeSide==='red'?redName:blueName}...`;
      else if(phase==='aim_x')status.textContent=isMyTurn?'اضغط لتثبيت الاتجاه الأفقي':'دور '+(activeSide==='red'?redName:blueName);
      else if(phase==='aim_y')status.textContent=isMyTurn?'اضغط لتثبيت الارتفاع':'الخصم يحدد ارتفاع السهم';
      else if(phase==='bot_aim')status.textContent='🤖 البوت يصوّب...';
      else if(phase==='impact_zoom')status.textContent='🎯 تم تسجيل الرمية';
      else if(phase==='finished')status.textContent='انتهت المباراة';
      else status.textContent='بانتظار الحركة...';
    }
    const hit=shell.querySelector('#darts-hit');if(hit)hit.textContent=lastHit||'';
    const btn=shell.querySelector('#darts-throw');if(btn){btn.disabled=!isMyTurn||!['aim_x','aim_y'].includes(phase);btn.textContent=phase==='aim_x'?'ثبّت الاتجاه الأفقي':'ثبّت الارتفاع';}
    const helpBtn=shell.querySelector('#darts-help');if(helpBtn)helpBtn.textContent=help?'إخفاء الشرح':'شرح النقاط';
    const hist=shell.querySelector('#darts-history');if(hist)hist.innerHTML=history.slice(-6).map(h=>`<span>${escape(h.playerName)} · ${escape(h.shortTag)} · ${h.remainingAfter}</span>`).join('');
    drawHelp();
  }
  function drawHelp(){
    const g=shell?.querySelector('#darts-help-targets');if(!g)return;
    if(!help){g.innerHTML='';return;}
    const remain=activeSide==='red'?redScore:blueScore;const targets=[];
    if(remain===50)targets.push([0,0]);
    if(remain===25)targets.push([.08,-.06]);
    if(remain>=1&&remain<=20){const i=SECTORS.indexOf(remain);if(i>=0){const a=i*18;targets.push([Math.sin(a*Math.PI/180)*.73,-Math.cos(a*Math.PI/180)*.73]);}}
    if(remain%2===0&&remain<=40){const n=remain/2,i=SECTORS.indexOf(n);if(i>=0){const a=i*18;targets.push([Math.sin(a*Math.PI/180)*.94,-Math.cos(a*Math.PI/180)*.94]);}}
    if(remain%3===0&&remain<=60){const n=remain/3,i=SECTORS.indexOf(n);if(i>=0){const a=i*18;targets.push([Math.sin(a*Math.PI/180)*.535,-Math.cos(a*Math.PI/180)*.535]);}}
    g.innerHTML=targets.map(([x,y])=>`<circle cx="${220+x*178}" cy="${220+y*178}" r="8" fill="#facc15" stroke="#fff" stroke-width="2" opacity=".95"/>`).join('');
  }
  function drawAim() {
    const aim=shell?.querySelector('#darts-aim'),cross=shell?.querySelector('#darts-aim-cross'),glow=shell?.querySelector('#darts-aim-glow');
    if(!aim)return;
    const x=220+aimX*178,y=220+aimY*178;
    aim.setAttribute('cx',x);aim.setAttribute('cy',y);cross.setAttribute('transform',`translate(${x-220} ${y-220})`);glow.setAttribute('cx',x);glow.setAttribute('cy',y);
    const pins=shell.querySelector('#darts-pins');
    pins.innerHTML=darts.map(d=>`<g transform="translate(${220+d.x*178} ${220+d.y*178}) rotate(${d.side==='red'?-35:35})"><path d="M-4 3 L0 -22 L4 3 Z" fill="${COLORS[d.side]}" stroke="#101116" stroke-width="1.4"/><path d="M-7 -18 L0 -30 L7 -18 Z" fill="#d8bd7e" stroke="#111" stroke-width="1.2"/></g>`).join('');
  }
  function frameLoop(now) {
    if(!running)return;
    if(mode!=='online'){
      const elapsed=now-phaseAt;
      if(phase==='turn_intro'&&elapsed>1000){
        if(mode==='bot'&&activeSide==='blue'){phase='bot_aim';phaseAt=now;updateHud();scheduleBotTurn();}
        else {phase='aim_x';phaseAt=now;updateHud();}
      }else if(phase==='aim_x'){aimX=Math.sin(now/1000*aimSpeed)*1.08;aimY=0;}
      else if(phase==='aim_y'){aimY=Math.sin(now/1000*aimSpeed)*1.08;}
    }else{
      if(phase==='aim_x')aimX=Math.sin(now/1000*aimSpeed)*1.08;
      if(phase==='aim_y')aimY=Math.sin(now/1000*aimSpeed)*1.08;
    }
    drawAim();
    frame=requestAnimationFrame(frameLoop);
  }
  function startLoop(){if(frame)cancelAnimationFrame(frame);frame=requestAnimationFrame(frameLoop);}
  function startTurn(nextSide) {
    activeSide=nextSide;phase='turn_intro';phaseAt=performance.now();aimX=0;aimY=0;lockedX=0;lastHit=null;help=false;updateHud();
  }
  function tap() {
    if(!running||ended)return;
    if(mode==='bot'&&activeSide==='blue')return;
    if(mode==='online'&&(!canControl||activeSide!==side))return;
    if(phase==='aim_x'){
      lockedX=aimX;phase='aim_y';phaseAt=performance.now();updateHud();
      if(mode==='online')sendAction('lock_x',lockedX);
    }else if(phase==='aim_y'){
      const y=aimY;
      if(mode==='online'){phase='waiting';updateHud();sendAction('lock_y',y);}
      else localThrow(lockedX,y,activeSide);
    }
  }
  function scoreHit(x,y){
    const r=Math.hypot(x,y);let score=0,tag='خارج',label='خارج اللوحة!';
    if(r<=.068){score=50;tag='50';label='في المنتصف! 50';}
    else if(r<=.132){score=25;tag='25';label='منتصف خارجي 25';}
    else if(r<=1){
      const deg=((Math.atan2(x,-y)*180/Math.PI)+360)%360,n=SECTORS[Math.floor(((deg+9)%360)/18)];
      score=n;tag=String(n);label=`${n} نقطة`;
      if(r>=.48&&r<=.59){score=n*3;tag='T'+n;label=`تربل ×3 (${score})`;}
      else if(r>=.88&&r<=1){score=n*2;tag='D'+n;label=`دبل ×2 (${score})`;}
    }
    const remain=activeSide==='red'?redScore:blueScore,after=remain-score;
    if(after<0)return {score:0,shortTag:tag,labelAr:`تجاوز الصفر! (${score})`,isBust:true,isCheckout:false};
    if(after===0&&score>0)return {score,shortTag:tag,labelAr:`إقفال مثالي! (${score})`,isBust:false,isCheckout:true};
    return {score,shortTag:tag,labelAr:label,isBust:false,isCheckout:false};
  }
  function localThrow(x,y,throwSide) {
    const hit=scoreHit(x,y),remaining=throwSide==='red'?redScore:blueScore;
    const after=hit.isBust?remaining:remaining-hit.score;
    if(throwSide==='red')redScore=after;else blueScore=after;
    const name=throwSide==='red'?redName:blueName;
    const record={round,side:throwSide,playerName:name,hitScore:hit.isBust?0:hit.score,shortTag:hit.shortTag,labelAr:hit.labelAr,remainingAfter:after,isBust:hit.isBust,isCheckout:hit.isCheckout,xNorm:x,yNorm:y};
    history.push(record);darts.push({side:throwSide,x,y});lastHit=hit.labelAr;phase='impact_zoom';phaseAt=performance.now();updateHud();
    if(hit.isCheckout){setTimeout(()=>finish(name,throwSide),1200);return;}
    setTimeout(()=>{if(!running||ended)return;const next=throwSide==='red'?'blue':'red';if(next==='red')round++;startTurn(next);},1500);
  }
  function botTarget(remaining) {
    let ideal={x:0,y:-.535};
    const center=(n,r)=>{const i=SECTORS.indexOf(n);const a=(i<0?0:i*18)*Math.PI/180;return{x:Math.sin(a)*r,y:-Math.cos(a)*r};};
    if(remaining===50)ideal={x:0,y:0};
    else if(remaining===25)ideal={x:.08,y:-.06};
    else if(remaining<=20)ideal=center(remaining,.73);
    else if(remaining%2===0&&remaining<=40)ideal=center(remaining/2,.94);
    else if(remaining%3===0&&remaining<=60)ideal=center(remaining/3,.535);
    else if(remaining<60)ideal=center(Math.max(1,Math.min(20,remaining-1)),.73);
    const sigma=difficulty==='سهل'?.21:difficulty==='متوسط'?.105:.042;
    const mag=Math.sqrt(-2*Math.log(Math.max(.001,Math.random())))*sigma,theta=2*Math.PI*Math.random();
    return {x:Math.max(-1.08,Math.min(1.08,ideal.x+Math.cos(theta)*mag)),y:Math.max(-1.08,Math.min(1.08,ideal.y+Math.sin(theta)*mag))};
  }
  function scheduleBotTurn(){
    if(botTimer)clearTimeout(botTimer);
    botTimer=setTimeout(()=>{
      if(!running||phase!=='bot_aim')return;
      const target=botTarget(blueScore);lockedX=target.x;aimX=target.x;phase='bot_aim_y';updateHud();
      botTimer=setTimeout(()=>{if(!running||phase!=='bot_aim_y')return;localThrow(target.x,target.y,'blue');},850);
    },850);
  }
  function finish(name,winnerSide) {
    if(ended)return;ended=true;phase='finished';updateHud();stopTimers();
    window.showGameEndOverlay?.({winnerName:name,isDraw:false,title:'🎯 انتهت لعبة السهام',subtitle:`🏆 فاز ${name} ووصل إلى الصفر!`});
  }
  function showToast(message){const old=document.querySelector('.darts-toast');old?.remove();const el=document.createElement('div');el.className='darts-toast';el.textContent=message;document.body.appendChild(el);setTimeout(()=>el.remove(),2300);}
  async function sendAction(action,value){
    try{await request('/api/darts/action',{game_id:gameId,action,value});}
    catch(e){showToast(e.message||'تعذر إرسال الحركة');}
  }
  async function request(url,body){
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,initData:initData()})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw new Error(data.error||'تعذر الاتصال بالسيرفر');
    return data;
  }
  function applyEvent(event){
    const p=event.payload||event;
    if(p.type==='state_sync'){
      redScore=Number(p.redScore??redScore);blueScore=Number(p.blueScore??blueScore);round=Number(p.round??round);
      activeSide=p.activeSide||activeSide;redName=p.redName||redName;blueName=p.blueName||blueName;
      if(p.phase==='turn_intro'){phase='turn_intro';phaseAt=performance.now();aimX=0;aimY=0;lockedX=0;}
      else if(p.phase==='aim_x'){phase='aim_x';phaseAt=performance.now();aimX=0;aimY=0;}
      else if(p.phase==='aim_y'){lockedX=Number(p.lockedX||lockedX);phase='aim_y';phaseAt=performance.now();aimY=0;}
      updateHud();
    }else if(p.type==='opponent_lock_x'){
      lockedX=Number(p.value||0);aimX=lockedX;aimY=0;phase='aim_y';phaseAt=performance.now();updateHud();
    }else if(p.type==='throw_resolved'){
      redScore=Number(p.redScore??redScore);blueScore=Number(p.blueScore??blueScore);
      const record=p.record||{};history.push(record);darts.push({side:p.side,x:Number(p.xNorm||0),y:Number(p.yNorm||0)});
      lastHit=record.labelAr||'';phase='impact_zoom';phaseAt=performance.now();updateHud();
    }else if(p.type==='match_end'){
      redScore=Number(p.redScore??redScore);blueScore=Number(p.blueScore??blueScore);
      history=Array.isArray(p.history)?p.history:history;
      finish(p.winnerName||'الفائز',p.winnerSide||'red');
    }
  }
  async function poll(){
    if(!running||mode!=='online')return;
    try{
      const data=await request('/api/darts/state',{game_id:gameId,after:cursor});
      (data.events||[]).forEach(ev=>{applyEvent(ev);cursor=String(ev.id);});
    }catch(e){showToast(e.message||'انقطع الاتصال');}
    if(running)pollTimer=setTimeout(poll,650);
  }
  function startBot(){
    mode='bot';gameId='';canControl=true;side='red';redName=playerName();blueName='بوت نواف';
    redScore=scoreStart;blueScore=scoreStart;activeSide='red';round=1;history=[];darts=[];lastHit='';ended=false;phase='turn_intro';phaseAt=performance.now();running=true;
    shell=window.c4Shell();renderGame();startLoop();updateHud();
  }
  async function startOnline(id){
    mode='online';gameId=id;running=true;ended=false;history=[];darts=[];lastHit='';cursor='0';
    shell=window.c4Shell();shell.innerHTML='<div class="darts-wrap"><div class="darts-heading"><h2>السهام 🎯</h2><p>جاري تحميل المباراة...</p></div></div>';
    try{
      const data=await request('/api/darts/state',{game_id:gameId,after:'0'}),g=data.game||{};
      side=g.side||'red';canControl=Boolean(g.is_player);
      redName=g.red_player_name||'اللاعب الأحمر';blueName=g.blue_player_name||'اللاعب الأزرق';
      scoreStart=Number(g.starting_score||300);redScore=scoreStart;blueScore=scoreStart;activeSide=g.active_side||'red';phase=g.phase||'turn_intro';phaseAt=performance.now();
      renderGame();startLoop();poll();
    }catch(e){shell.innerHTML=`<div class="darts-panel"><div class="darts-heading"><h2>تعذر فتح المباراة</h2><p>${escape(e.message)}</p></div><button class="darts-secondary" id="darts-back">رجوع للألعاب</button></div>`;shell.querySelector('#darts-back').onclick=()=>document.getElementById('back-home')?.click();}
  }
  function exit(){
    if(mode==='online'&&canControl)void sendAction('withdraw');
    stop();document.querySelector('.online-end-overlay')?.remove();
    document.getElementById('back-home')?.click();
  }
  function stopTimers(){if(pollTimer)clearTimeout(pollTimer);if(botTimer)clearTimeout(botTimer);if(frame)cancelAnimationFrame(frame);pollTimer=botTimer=frame=null;}
  function stop(){running=false;stopTimers();ended=false;help=false;document.querySelector('.darts-exit')?.remove();}
  window.startDartsSetup=setup;
  window.startDartsGame=(gameMode,id)=>{injectStyles();stop();document.body.classList.add('c4-active');if(gameMode==='online')void startOnline(id);else startBot();};
  window.stopDartsGame=stop;
})();