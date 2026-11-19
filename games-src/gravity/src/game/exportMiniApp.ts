export const MINI_APP_SERVER_PATCH = `# في ملف mini_app_server.py:
# 1) داخل دالة handle_mini_app_request (إضافة مسار /gravity):
    if path in ("/", "/mini-app", "/mini-app/", "/carrom", "/gravity"):
        if path == "/carrom":
            file_path = WEB_ROOT / "carrom.html"
        elif path == "/gravity":
            file_path = WEB_ROOT / "gravity.html"
        else:
            file_path = WEB_ROOT / "index.html"

# 2) إدارة غرف تحدي الجاذبية الأونلاين (2 إلى 5 لاعبين) في mini_app_server.py:
_GRAVITY_ROOMS = {}
_GRAVITY_LOCK = threading.Lock()
_GRAVITY_COLORS = [
    {"id": "red", "label": "أحمر", "main": "#ef233c", "dark": "#b91c1c"},
    {"id": "blue", "label": "أزرق", "main": "#0ea5e9", "dark": "#1d4ed8"},
    {"id": "purple", "label": "بنفسجي", "main": "#a855f7", "dark": "#6b21a8"},
    {"id": "green", "label": "أخضر", "main": "#22c55e", "dark": "#15803d"},
    {"id": "yellow", "label": "أصفر", "main": "#eab308", "dark": "#a16207"},
]

def _gravity_room_view(room, uid):
    players = []
    for idx, p in enumerate(room["players"]):
        col = _GRAVITY_COLORS[idx]
        players.append({
            "id": p["id"], "name": p["name"], "slotIndex": idx,
            "colorId": col["id"], "colorLabel": col["label"],
            "mainColor": col["main"], "score": p["score"],
            "dead": p["dead"], "withdrawn": p["withdrawn"],
            "x": p["x"], "worldY": p["worldY"], "vx": p["vx"], "grav": p["grav"],
        })
    return {
        "id": room["id"], "hostId": room["hostId"], "status": room["status"],
        "targetScore": room["targetScore"], "roundNumber": room["roundNumber"],
        "roundSeed": room["roundSeed"], "startedAt": room["startedAt"],
        "winnerName": room.get("winnerName"), "players": players,
        "isJoined": any(p["id"] == uid for p in room["players"]),
    }

# داخل POST handler في mini_app_server.py:
        elif path == "/api/gravity/lobby":
            uid = str(user["id"])
            uname = (user.get("first_name") or "") + (" " + user.get("last_name") if user.get("last_name") else "")
            uname = uname.strip() or user.get("username") or "لاعب"
            action = payload.get("action", "state")
            room_id = str(payload.get("room_id", "")).strip().upper()
            with _GRAVITY_LOCK:
                if action == "create":
                    import secrets
                    rid = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
                    room = {
                        "id": rid, "hostId": uid, "status": "lobby",
                        "targetScore": 5 if payload.get("targetScore") == 5 else 3,
                        "roundNumber": 1, "roundSeed": int(time.time()) % 1000,
                        "startedAt": time.time(), "winnerName": None,
                        "players": [{"id": uid, "name": uname, "score": 0, "dead": False, "withdrawn": False, "x": 37, "worldY": 590, "vx": 0, "grav": -1}],
                    }
                    _GRAVITY_ROOMS[rid] = room
                    result = _gravity_room_view(room, uid)
                else:
                    room = _GRAVITY_ROOMS.get(room_id)
                    if not room:
                        raise ValueError("الغرفة غير موجودة أو انتهت")
                    if action == "join":
                        if not any(p["id"] == uid for p in room["players"]):
                            if room["status"] != "lobby":
                                raise ValueError("بدأت المباراة بالفعل")
                            if len(room["players"]) >= 5:
                                raise ValueError("الغرفة مكتملة (5/5 لاعبين)")
                            idx = len(room["players"])
                            room["players"].append({
                                "id": uid, "name": uname, "score": 0, "dead": False, "withdrawn": False,
                                "x": 37 if idx % 2 == 0 else 373, "worldY": 590 - (idx // 2) * 42,
                                "vx": 0, "grav": -1 if idx % 2 == 0 else 1,
                            })
                    elif action == "start":
                        if uid != room["hostId"]:
                            raise ValueError("بدء التحدي لصاحب الغرفة فقط")
                        if len(room["players"]) < 2:
                            raise ValueError("الحد الأدنى 2 لاعبين")
                        room["status"] = "playing"
                        room["startedAt"] = time.time()
                    elif action == "flip":
                        p = next((x for x in room["players"] if x["id"] == uid and not x["dead"]), None)
                        if p:
                            p["grav"] = -p["grav"]
                            p["vx"] = p["grav"] * 230
                            p["x"] = float(payload.get("x", p["x"]))
                            p["worldY"] = float(payload.get("worldY", p["worldY"]))
                    elif action == "dead":
                        p = next((x for x in room["players"] if x["id"] == uid), None)
                        if p:
                            p["dead"] = True
                    elif action == "leave":
                        room["players"] = [x for x in room["players"] if x["id"] != uid]
                        if not room["players"]:
                            _GRAVITY_ROOMS.pop(room_id, None)
                        elif room["hostId"] == uid:
                            room["hostId"] = room["players"][0]["id"]
                    result = _gravity_room_view(room, uid) if room_id in _GRAVITY_ROOMS else {"left": True}`;

export const MINI_APP_INDEX_PATCH = `// 1) في ملف mini_app/index.html داخل دالة showGames():
 const games=[
  ['🔴','كونكت 4','العب ضد البوت أو تحدَّ لاعبًا','connect'],
  ['🟦','المربعات','ارسم الخطوط واجمع المربعات','dots'],
  ['🧠','اختبر ذاكرتك','احفظ التسلسل وتحدَّ لاعبًا آخر','memory'],
  ['🔤','خمن الكلمة','تحدَّ حتى 10 لاعبين أو تدرب لحالك','word'],
  ['🎯','الكيرم','صوّب واضرب الأقراص نحو الجيوب','carrom'],
  ['⚡','تحدي الجاذبية','ضد البوت أو أونلاين (2 - 5 لاعبين)','gravity'],
 ];

// 2) داخل card.onclick:
  card.onclick=()=>{
    if(type==='carrom'){location.href='/carrom';return;}
    if(type==='gravity'){location.href='/gravity';return;}
    if(type==='connect'){showConnect4Setup();return;}
    if(type==='word'){showWordSetup();return;}
    showMiniGameInstructions(type);
  };

// 3) في بداية تشغيل الميني آب لفتح غرف تحدي الجاذبية من زر «فتح غرفة اللعبة»:
  if(c4StartParam.startsWith('gravity_')){
    location.href='/gravity?room='+encodeURIComponent(c4StartParam.slice(8));
    return;
  }`;

export const ONLINE_MODE_PY_PATCH = `# في ملف games/online_mode.py:
# 1) أضف اللعبة إلى GAME_INFO و _select_games:
GAME_INFO["gravity"] = ("تحدي الجاذبية ⚡", "تحدي الجاذبية أونلاين (2 - 5 لاعبين)")

# في _select_games(query):
    supported_inline = ["connect", "dots", "memory", "word", "gravity"]
    if any(word in value for word in ("جاذبية", "الجاذبية", "gravity")):
        return ["gravity"]

# 2) داخل online_games_inline_query:
        if game_type == "gravity":
            import secrets
            gid = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
            room_url = f"https://t.me/{me.username}?startapp=gravity_{gid}"
            lobby_text = (
                f"🎮 غرفة أونلاين — تحدي الجاذبية ⚡\\n\\n"
                f"أنشأ {inline.from_user.full_name or inline.from_user.first_name or 'لاعب'} غرفة تحدي الجاذبية (2 - 5 لاعبين).\\n"
                "افتحوا الغرفة من الزر بالأسفل للانضمام وبدء التحدي داخل الميني آب!"
            )
            keyboard = InlineKeyboardMarkup([[
                InlineKeyboardButton("فتح غرفة اللعبة", url=room_url)
            ]])`;

export function buildStandaloneGravityHtml(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
  <meta name="theme-color" content="#35090d">
  <title>تحدي الجاذبية | بوت نواف</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root{color-scheme:dark;--red:#b81728;--gold:#e5bb76}
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    html,body{margin:0;min-height:100%;background:#120508;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    body{min-height:100dvh;background:radial-gradient(ellipse at 50% 0,#78121b,#24090d 58%,#100709);overflow-x:hidden}
    .app{width:min(100%,520px);margin:auto;padding:12px}
    .top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 0 12px}
    .brand{font-weight:950;font-size:21px;text-align:center}
    .brand small{display:block;color:#ffffff80;font-size:10px;font-weight:650;letter-spacing:1.8px}
    .pill{border:1px solid #ffffff30;background:#ffffff12;color:#fff;border-radius:30px;padding:8px 13px;font-weight:800;cursor:pointer}
    .panel{border:1px solid #ffffff22;background:linear-gradient(145deg,#ffffff13,#09040670);border-radius:20px;padding:16px;box-shadow:0 12px 30px #0005}
    h1{font-size:25px;margin:4px 0 5px;text-align:center}
    .sub{text-align:center;color:#ffffff9a;font-size:13px;margin:0 0 14px}
    .choices{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .choices.three{grid-template-columns:repeat(3,1fr)}
    .choice{border:1px solid #ffffff35;border-radius:15px;background:#17090c;color:#fff;padding:12px 8px;min-height:50px;font-weight:850;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .choice.active{border-color:#ff9ba3;background:linear-gradient(135deg,#a81321,#4d0a11);box-shadow:0 0 0 2px #ff5b672b}
    .primary{width:100%;border:0;border-radius:14px;min-height:52px;margin-top:14px;font-size:16px;font-weight:900;background:linear-gradient(135deg,#ef4858,#9e0d1c);color:#fff;box-shadow:0 4px 0 #560811;cursor:pointer}
    .secondary{width:100%;border:1px solid #ffffff30;border-radius:14px;min-height:46px;margin-top:10px;font-size:14px;font-weight:800;background:#ffffff14;color:#fff;cursor:pointer}
    #setup,#game{display:none}
    #setup.show{display:block}
    #game.show{display:flex;position:fixed;inset:0;justify-content:center;align-items:center;background:#0d0508}
    .arena-wrap{position:relative;width:min(100%,460px);height:100dvh;overflow:hidden;background:#100709}
    #arena{display:block;width:100%;height:100%;touch-action:none}
    .hud-score{position:absolute;top:calc(env(safe-area-inset-top) + 10px);left:12px;background:#fff;color:#111;border-radius:999px;padding:6px 14px;font-weight:950;font-size:17px;box-shadow:0 4px 12px #0005;display:flex;align-items:center;gap:6px;pointer-events:none}
    .hud-stage{position:absolute;top:calc(env(safe-area-inset-top) + 12px);left:50%;transform:translateX(-50%);background:rgba(0,0,0,.55);border:1px solid #ffffff30;color:#fff;border-radius:999px;padding:4px 12px;font-weight:800;font-size:11px;white-space:nowrap;pointer-events:none}
    .hud-exit{position:absolute;top:calc(env(safe-area-inset-top) + 10px);right:12px;background:#fff;color:#111;border:0;border-radius:999px;padding:7px 14px;font-weight:950;font-size:12px;box-shadow:0 4px 12px #0005;cursor:pointer}
    .spectator-bar{position:absolute;bottom:14px;left:12px;right:12px;background:rgba(0,0,0,.82);border:1px solid #ffffff33;border-radius:16px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;font-weight:800}
    .spectator-bar button{background:#ef233c;border:0;color:#fff;border-radius:999px;padding:6px 14px;font-weight:900;cursor:pointer}
    .toast{position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 56px);transform:translateX(-50%);background:#16090c;border:1px solid #ffffff40;border-radius:14px;padding:10px 16px;z-index:90;box-shadow:0 8px 30px #0009;max-width:90%;text-align:center;font-weight:800;font-size:13px}
    .online-end-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(5,3,7,.72);backdrop-filter:blur(15px)}
    .online-end-card{width:min(100%,440px);padding:30px 20px 22px;border:1px solid #ffffff35;border-radius:28px;background:radial-gradient(ellipse at 50% 0%,#721a2d 0%,transparent 58%),linear-gradient(145deg,#281018,#0d080d);box-shadow:0 22px 85px #000d,0 0 38px #b5122030;text-align:center}
    .online-end-card h2{font-size:clamp(25px,7vw,34px);line-height:1.25;margin:0 0 13px;color:#fff;font-weight:1000}
    .online-end-winner{margin:8px auto 12px;padding:12px 14px;border:1px solid #e94a5b70;border-radius:17px;background:#080508a8;color:#ff5264;font-size:clamp(23px,6vw,31px);font-weight:1000}
    .online-end-winner.is-blue{color:#38bdf8;border-color:#38bdf870}
    .online-end-card p{color:#ffffffd1;font-size:15px;line-height:1.8;margin:0 0 24px}
    .online-end-actions{display:grid;gap:11px}
    .online-end-actions button{width:100%;min-height:58px;border:1px solid #ffffff20;border-radius:17px;font-size:17px;font-weight:950;color:#fff;background:linear-gradient(135deg,#ed4054,#94152a);cursor:pointer}
    .online-end-actions button:last-child{background:linear-gradient(135deg,#45404a,#211d25)}
  </style>
</head>
<body>
  <main class="app">
    <section id="setup" class="show">
      <header class="top">
        <button class="pill" id="back">رجوع</button>
        <div class="brand">تحدي الجاذبية <small>NAWAF GAME</small></div>
        <button class="pill" id="start-top">ابدأ</button>
      </header>
      <div class="panel">
        <h1>يمين ويسار ⚡</h1>
        <p class="sub">تحدَّ البوت أو العب أونلاين (2 إلى 5 لاعبين) بنفس الشاشة!</p>
        <div class="sub">طريقة اللعب</div>
        <div class="choices three" id="modes">
          <button class="choice active" data-mode="bot">🤖 ضد البوت</button>
          <button class="choice" data-mode="local">👥 نفس الجهاز</button>
          <button class="choice" data-mode="online">🌐 أونلاين</button>
        </div>
        <div class="sub" style="margin-top:14px">نقاط الفوز</div>
        <div class="choices" id="targets">
          <button class="choice active" data-target="3">الأول لـ 3 نقاط</button>
          <button class="choice" data-target="5">الأول لـ 5 نقاط</button>
        </div>
        <div id="diff-wrap">
          <div class="sub" style="margin-top:14px">مستوى الصعوبة</div>
          <div class="choices three" id="diffs">
            <button class="choice active" data-diff="سهل">سهل</button>
            <button class="choice" data-diff="متوسط">متوسط</button>
            <button class="choice" data-diff="صعب">صعب</button>
          </div>
        </div>
        <div id="online-box" style="display:none;margin-top:14px">
          <button class="primary" id="online-create">👥 أنشئ غرفة أونلاين (2-5 لاعبين)</button>
          <div id="online-lobby-info" style="margin-top:10px;font-size:13px;line-height:1.8"></div>
        </div>
        <button class="primary" id="start">ابدأ اللعب</button>
      </div>
    </section>
    <section id="game">
      <div class="arena-wrap">
        <canvas id="arena" width="440" height="780"></canvas>
        <div class="hud-score"><span style="color:#ef233c" id="s-red">0</span><span>•</span><span style="color:#0ea5e9" id="s-blue">0</span></div>
        <div class="hud-stage" id="hud-stage">جولة 1 · مرحلة الفضاء</div>
        <button class="hud-exit" id="exit-game">خروج</button>
        <div class="spectator-bar" id="spec-bar" style="display:none">
          <span>👀 وضع المشاهدة — تشاهد بقية اللاعبين</span>
          <button id="spec-exit">خروج</button>
        </div>
      </div>
    </section>
  </main>
  <script>
    const tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();const $=id=>document.getElementById(id);
    const u=tg?.initDataUnsafe?.user||{};const me=[u.first_name,u.last_name].filter(Boolean).join(' ').trim()||u.username||'أنت';
    const PALETTE=[{id:'red',m:'#ef233c',d:'#b91c1c'},{id:'blue',m:'#0ea5e9',d:'#1d4ed8'},{id:'purple',m:'#a855f7',d:'#6b21a8'},{id:'green',m:'#22c55e',d:'#15803d'},{id:'yellow',m:'#eab308',d:'#a16207'}];
    let mode='bot',target=3,diff='سهل',raf=0,lastT=0,redScore=0,blueScore=0,round=1,elapsed=0,camY=0,nextY=780,chunkIdx=0,rects=[],players=[],rings=[],parts=[],state='intro',timer=0,fade=0,onlineRoom=null,onlinePoll=null;
    const W=440,H=780,WALL=36,canvas=$('arena'),ctx=canvas.getContext('2d');
    const DIFF={'سهل':{safe:30,slip:0.45},'متوسط':{safe:40,slip:0.36},'صعب':{safe:60,slip:0.28}};
    const BIOMES=[
      {name:'مرحلة الفضاء',sky:'#5cb5f9',hill:'rgba(255,255,255,0.16)',wall:'#3b4056',trim:'#5c6384',beam:'#854824',out:'#141621'},
      {name:'مرحلة الغابة',sky:'#bce994',hill:'#98d26a',wall:'#7c4322',trim:'#39a833',beam:'#854824',out:'#16161c'},
      {name:'مرحلة الصحراء',sky:'#fde569',hill:'#f1c73e',wall:'#7d3e1e',trim:'#e58b2b',beam:'#854824',out:'#181414'},
      {name:'مرحلة نواف الخاصة',sky:'#d8b4fe',hill:'#a855f7',wall:'#3b1521',trim:'#b81728',beam:'#854824',out:'#16080d'}
    ];
    function scrollSpeed(el,rn){return Math.min(246,160+Math.min(82,el*2.25)+Math.min(10,Math.max(0,rn-1)*3.5));}
    $('modes').onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;mode=b.dataset.mode;document.querySelectorAll('#modes .choice').forEach(x=>x.classList.toggle('active',x===b));$('diff-wrap').style.display=mode==='bot'?'block':'none';$('online-box').style.display=mode==='online'?'block':'none';$('start').style.display=mode==='online'?'none':'block';};
    $('targets').onclick=e=>{const b=e.target.closest('[data-target]');if(!b)return;target=Number(b.dataset.target);document.querySelectorAll('#targets .choice').forEach(x=>x.classList.toggle('active',x===b));};
    $('diffs').onclick=e=>{const b=e.target.closest('[data-diff]');if(!b)return;diff=b.dataset.diff;document.querySelectorAll('#diffs .choice').forEach(x=>x.classList.toggle('active',x===b));};
    async function gApi(action,extra={}){const r=await fetch('/api/gravity/lobby',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg?.initData||'',action,room_id:onlineRoom?.id||'',...extra})});const d=await r.json();if(!d.ok)throw new Error(d.error||'خطأ');return d.result;}
    $('online-create').onclick=async()=>{try{onlineRoom=await gApi('create',{targetScore:target});renderLobby();}catch(e){toast(e.message);}};
    function renderLobby(){if(!onlineRoom)return;const pls=onlineRoom.players||[];$('online-lobby-info').innerHTML='<div>غرفة: <b>'+onlineRoom.id+'</b> ('+pls.length+'/5)</div>'+pls.map((p,i)=>'<div>• '+p.name+' ('+p.colorLabel+')</div>').join('')+'<button class="secondary" id="o-share">مشاركة دعوة الغرفة</button>'+(onlineRoom.hostId===String(u.id)?'<button class="primary" id="o-start" '+(pls.length<2?'disabled':'')+'>ابدأ التحدي ('+pls.length+' لاعبين)</button>':'');if($('o-share'))$('o-share').onclick=()=>{const link='https://t.me/Lewadbot?startapp=gravity_'+onlineRoom.id;if(tg?.openTelegramLink)tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(link));else navigator.clipboard?.writeText(link);};if($('o-start'))$('o-start').onclick=async()=>{onlineRoom=await gApi('start');startOnlineGame();};if(!onlinePoll)onlinePoll=setInterval(async()=>{try{onlineRoom=await gApi('state');if(onlineRoom.status==='playing'){clearInterval(onlinePoll);onlinePoll=null;startOnlineGame();}else renderLobby();}catch{}},1500);}
    function toast(s){const d=document.createElement('div');d.className='toast';d.textContent=s;document.body.appendChild(d);setTimeout(()=>d.remove(),1400);}
    function showEnd(isBotWin,winnerName){
      document.querySelector('.online-end-overlay')?.remove();
      const o=document.createElement('div');o.className='online-end-overlay';
      o.innerHTML='<div class="online-end-card"><h2>'+(isBotWin?'💀 انتهى التحدي!':'🎉 مبروك الفوز!')+'</h2><div class="online-end-winner'+(isBotWin?' is-blue':'')+'">'+(isBotWin?'فاز البوت':winnerName)+'</div><p>النتيجة النهائية: '+redScore+' - '+blueScore+' · عدد الجولات: '+round+' 🏆</p><div class="online-end-actions"><button id="again">↻ العب مرة ثانية</button><button id="home">خروج للقائمة الرئيسية</button></div></div>';
      document.body.appendChild(o);
      o.querySelector('#again').onclick=()=>{o.remove();startGame();};
      o.querySelector('#home').onclick=()=>{o.remove();cancelAnimationFrame(raf);$('game').classList.remove('show');$('setup').classList.add('show');};
    }
    function genChunk(by,idx,seed){
      const r=[];
      if(idx===0){const ty=by-520;r.push({x:0,y:ty,w:WALL,h:520,k:'wl'},{x:W-WALL,y:ty,w:WALL,h:520,k:'wr'});return{r,ny:ty};}
      if(idx===1){const ty=by-620;r.push({x:0,y:by-220,w:WALL,h:220,k:'wl'},{x:0,y:by-430,w:68,h:210,k:'wl'},{x:0,y:ty,w:WALL,h:190,k:'wl'},{x:W-68,y:by-260,w:68,h:260,k:'wr'},{x:W-WALL,y:ty,w:WALL,h:360,k:'wr'},{x:W/2-11,y:ty+130,w:22,h:280,k:'b'},{x:WALL,y:by-140,w:30,h:30,k:'c'},{x:W-WALL-30,y:ty+85,w:30,h:30,k:'c'});return{r,ny:ty};}
      if(idx<=2){const p=(idx+seed)%3;if(p===0){const ty=by-700;r.push({x:0,y:by-235,w:WALL,h:235,k:'wl'},{x:0,y:by-385,w:72,h:150,k:'wl'},{x:0,y:ty,w:WALL,h:190,k:'wl'},{x:W-WALL,y:by-205,w:WALL,h:205,k:'wr'},{x:W-72,y:by-495,w:72,h:170,k:'wr'},{x:W-WALL,y:ty,w:WALL,h:205,k:'wr'},{x:250,y:by-420,w:22,h:300,k:'b'},{x:164,y:ty+80,w:22,h:300,k:'b'},{x:WALL,y:by-125,w:30,h:30,k:'c'});return{r,ny:ty};}if(p===1){const ty=by-660;r.push({x:0,y:by-300,w:WALL,h:300,k:'wl'},{x:0,y:ty,w:74,h:360,k:'wl'},{x:W-74,y:by-320,w:74,h:320,k:'wr'},{x:W-WALL,y:ty,w:WALL,h:340,k:'wr'},{x:WALL,y:by-175,w:30,h:30,k:'c'},{x:W-WALL-30,y:ty+185,w:30,h:30,k:'c'},{x:74,y:ty+70,w:30,h:30,k:'c'});return{r,ny:ty};}const ty=by-680;r.push({x:0,y:by-230,w:WALL,h:230,k:'wl'},{x:0,y:by-470,w:72,h:240,k:'wl'},{x:0,y:ty,w:WALL,h:210,k:'wl'},{x:W-72,y:by-180,w:72,h:180,k:'wr'},{x:W-WALL,y:by-440,w:WALL,h:260,k:'wr'},{x:W-WALL,y:ty,w:WALL,h:240,k:'wr'},{x:WALL,y:by-135,w:30,h:30,k:'c'},{x:W-WALL-30,y:by-325,w:30,h:30,k:'c'},{x:72,y:by-460,w:30,h:30,k:'c'},{x:W-WALL-30,y:ty+75,w:30,h:30,k:'c'});return{r,ny:ty};}
      const p=(idx+seed)%8;
      if(p===0){const ty=by-680;r.push({x:0,y:ty,w:WALL,h:680,k:'wl'},{x:W-WALL,y:ty,w:WALL,h:680,k:'wr'},{x:WALL,y:by-230,w:30,h:30,k:'c'},{x:W-WALL-30,y:by-230,w:30,h:30,k:'c'},{x:W/2-11,y:ty+105,w:22,h:460,k:'b'},{x:WALL,y:ty+150,w:30,h:30,k:'c'},{x:W-WALL-30,y:ty+60,w:30,h:30,k:'c'});return{r,ny:ty};}
      if(p===1){const ty=by-700;r.push({x:0,y:by-210,w:WALL,h:210,k:'wl'},{x:0,y:ty,w:WALL,h:210,k:'wl'},{x:W-WALL,y:by-210,w:WALL,h:210,k:'wr'},{x:W-WALL,y:ty,w:WALL,h:210,k:'wr'},{x:124,y:by-430,w:22,h:335,k:'b'},{x:W-146,y:by-430,w:22,h:335,k:'b'},{x:W/2-11,y:ty+95,w:22,h:355,k:'b'},{x:W-WALL-30,y:ty+75,w:30,h:30,k:'c'});return{r,ny:ty};}
      if(p===2){const ty=by-680;r.push({x:0,y:by-195,w:WALL,h:195,k:'wl'},{x:0,y:ty,w:WALL,h:195,k:'wl'},{x:W-WALL,y:by-195,w:WALL,h:195,k:'wr'},{x:W-WALL,y:ty,w:WALL,h:195,k:'wr'},{x:146,y:ty+85,w:22,h:505,k:'b'},{x:W-168,y:ty+85,w:22,h:505,k:'b'},{x:WALL,y:by-120,w:30,h:30,k:'c'},{x:W-WALL-30,y:ty+70,w:30,h:30,k:'c'});return{r,ny:ty};}
      if(p===3){const ty=by-720;r.push({x:0,y:by-220,w:WALL,h:220,k:'wl'},{x:0,y:by-500,w:WALL,h:145,k:'wl'},{x:0,y:ty,w:WALL,h:110,k:'wl'},{x:W-WALL,y:by-220,w:WALL,h:220,k:'wr'},{x:W-WALL,y:by-500,w:WALL,h:145,k:'wr'},{x:W-WALL,y:ty,w:WALL,h:110,k:'wr'},{x:244,y:by-460,w:22,h:360,k:'b'},{x:174,y:ty+40,w:22,h:375,k:'b'});return{r,ny:ty};}
      if(p===4){const ty=by-720;r.push({x:0,y:by-250,w:WALL,h:250,k:'wl'},{x:0,y:by-395,w:74,h:145,k:'wl'},{x:0,y:ty,w:WALL,h:205,k:'wl'},{x:W-WALL,y:by-205,w:WALL,h:205,k:'wr'},{x:W-74,y:by-500,w:74,h:175,k:'wr'},{x:W-WALL,y:ty,w:WALL,h:210,k:'wr'},{x:252,y:by-430,w:22,h:315,k:'b'},{x:166,y:ty+85,w:22,h:315,k:'b'},{x:WALL,y:by-125,w:30,h:30,k:'c'},{x:W-WALL-30,y:ty+80,w:30,h:30,k:'c'});return{r,ny:ty};}
      if(p===5){const ty=by-740;r.push({x:0,y:by-210,w:WALL,h:210,k:'wl'},{x:0,y:ty,w:WALL,h:210,k:'wl'},{x:W-WALL,y:by-210,w:WALL,h:210,k:'wr'},{x:W-WALL,y:ty,w:WALL,h:210,k:'wr'},{x:124,y:by-410,w:22,h:315,k:'b'},{x:W-146,y:by-410,w:22,h:315,k:'b'},{x:W/2-11,y:ty+115,w:22,h:355,k:'b'},{x:WALL,y:by-125,w:30,h:30,k:'c'},{x:W-WALL-30,y:ty+85,w:30,h:30,k:'c'});return{r,ny:ty};}
      if(p===6){const ty=by-680;r.push({x:0,y:by-220,w:WALL,h:220,k:'wl'},{x:0,y:by-460,w:78,h:240,k:'wl'},{x:0,y:ty,w:WALL,h:220,k:'wl'},{x:W-78,y:by-175,w:78,h:175,k:'wr'},{x:W-WALL,y:by-430,w:WALL,h:255,k:'wr'},{x:W-WALL,y:ty,w:WALL,h:250,k:'wr'},{x:W/2-11,y:ty+140,w:22,h:390,k:'b'},{x:WALL,y:by-135,w:30,h:30,k:'c'},{x:W-WALL-30,y:by-315,w:30,h:30,k:'c'},{x:78,y:by-445,w:30,h:30,k:'c'},{x:W-WALL-30,y:ty+75,w:30,h:30,k:'c'});return{r,ny:ty};}
      const ty=by-680;r.push({x:0,y:by-210,w:WALL,h:210,k:'wl'},{x:0,y:ty,w:WALL,h:220,k:'wl'},{x:W-WALL,y:by-210,w:WALL,h:210,k:'wr'},{x:W-WALL,y:ty,w:WALL,h:220,k:'wr'},{x:132,y:ty+115,w:22,h:455,k:'b'},{x:W-154,y:ty+115,w:22,h:455,k:'b'},{x:154,y:by-330,w:28,h:28,k:'c'},{x:W-154-28,y:ty+210,w:28,h:28,k:'c'});return{r,ny:ty};
    }
    function initRound(rn){
      round=rn;elapsed=0;camY=0;rects=[];nextY=H;chunkIdx=0;rings=[];parts=[];state='intro';timer=1.3;fade=0.8;
      while(nextY>-H*1.8){const g=genChunk(nextY,chunkIdx,rn-1);rects.push(...g.r);nextY=g.ny;chunkIdx++;}
      players=[{id:'red',name:me,col:PALETTE[0],x:WALL+1,y:H-190,vx:0,g:-1,on:true,dead:false,cd:0,ph:0},{id:'blue',name:mode==='bot'?'البوت':'اللاعب الثاني',col:PALETTE[1],x:W-WALL-31,y:H-190,vx:0,g:1,on:true,dead:false,cd:0,ph:3}];
      const bm=BIOMES[(round-1)%BIOMES.length];
      $('s-red').textContent=redScore;$('s-blue').textContent=blueScore;$('hud-stage').textContent='جولة '+round+' · 0ث · '+bm.name;
    }
    function flip(id){if(state!=='playing')return;if(mode==='bot'&&id==='blue')return;const p=players.find(x=>x.id===id);if(!p||p.dead||p.cd>0)return;if(p.on||Math.abs(p.vx)<190){p.g*=-1;p.on=false;p.vx=p.g*230;p.cd=0.12;}}
    function startGame(){redScore=0;blueScore=0;$('setup').classList.remove('show');$('game').classList.add('show');initRound(1);lastT=performance.now();cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);}
    function startOnlineGame(){$('setup').classList.remove('show');$('game').classList.add('show');initRound(1);players=(onlineRoom.players||[]).map((op,i)=>({id:op.id,name:op.name,col:PALETTE[i],x:i%2===0?WALL+1:W-WALL-31,y:H-190-Math.floor(i/2)*42,vx:0,g:i%2===0?-1:1,on:true,dead:false,cd:0,ph:i}));lastT=performance.now();cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);}
    function simPath(bot,spd,doFlip,steps){
      let sx=bot.x,sy=bot.y,sg=doFlip?-bot.g:bot.g,svx=doFlip?sg*230:bot.vx,lg=-1;const dt=1/60;
      for(let s=0;s<steps;s++){
        const ty=camY-spd*dt*s+H-190,bh=sy-ty,cu=bh>10?Math.min(18,(bh-10)*0.14):0,ny=sy-(spd+cu)*dt;
        for(let i=0;i<rects.length;i++){const r=rects[i];if(sx+30>r.x+5&&sx<r.x+r.w-5&&sy>=r.y+r.h-6&&ny<r.y+r.h)return false;}
        sy=ny;svx=Math.max(-780,Math.min(780,svx+sg*2450*dt));let nx=sx+svx*dt,land=false;
        for(let i=0;i<rects.length;i++){const r=rects[i];if(sy+28>r.y+3&&sy<r.y+r.h-3){if(svx>0&&sx+30<=r.x+12&&nx+30>=r.x){nx=r.x-30;svx=0;if(sg===1)land=true;}else if(svx<0&&sx>=r.x+r.w-12&&nx<=r.x+r.w){nx=r.x+r.w;svx=0;if(sg===-1)land=true;}}}
        sx=nx;if(sx<-16||sx>W+16)return false;
        if(doFlip&&land&&lg<0)lg=5;if(lg>=0){if(lg===0)return true;lg--;}
      }
      return !(doFlip&&lg<0);
    }
    function loop(ts){
      const dt=Math.min(0.035,(ts-lastT)/1000||0.016);lastT=ts;fade=Math.max(0,fade-dt*2.1);
      const b=BIOMES[(round-1)%BIOMES.length],dp=DIFF[diff],spd=scrollSpeed(elapsed,round);
      if(state==='intro'){timer-=dt;camY-=spd*0.4*dt;players.forEach(p=>{p.y-=spd*0.4*dt;p.ph+=dt*14;});if(timer<=0)state='playing';}
      else if(state==='over'){timer-=dt;if(timer<=0){if(redScore>=target||blueScore>=target){state='done';const rw=redScore>=target;showEnd(!rw&&mode==='bot',rw?me:'اللاعب الثاني');return;}initRound(round+1);}}
      else if(state==='playing'){
        elapsed+=dt;camY-=spd*dt;
        $('hud-stage').textContent='جولة '+round+' · '+Math.floor(elapsed)+'ث · '+b.name;
        while(nextY>camY-H*1.5){const g=genChunk(nextY,chunkIdx,round-1);rects.push(...g.r);nextY=g.ny;chunkIdx++;}
        rects=rects.filter(r=>r.y<camY+H+180);
        if(mode==='bot'){
          const bot=players[1];bot.cd=Math.max(0,bot.cd-dt);
          if(!bot.dead&&bot.cd<=0&&(bot.on||Math.abs(bot.vx)<190)){
            const past=elapsed>=dp.safe;
            if(!simPath(bot,spd,false,past?10:34)){
              if(past&&Math.random()<dp.slip){bot.cd=0.68;}
              else if(simPath(bot,spd,true,54)){bot.g*=-1;bot.on=false;bot.vx=bot.g*230;bot.cd=past?0.14:0.04;}
            }
          }
        }
        players.forEach(p=>{
          if(p.dead)return;p.cd=Math.max(0,p.cd-dt);
          const ty=camY+H-190,bh=p.y-ty,cu=bh>10?Math.min(18,(bh-10)*0.14):0;
          let ny=p.y-(spd+cu)*dt;
          rects.forEach(r=>{if(p.x+30>r.x+5&&p.x<r.x+r.w-5&&p.y>=r.y+r.h-6&&ny<r.y+r.h)ny=r.y+r.h;});p.y=ny;
          p.vx=Math.max(-780,Math.min(780,p.vx+p.g*2450*dt));let nx=p.x+p.vx*dt,land=false;
          rects.forEach(r=>{if(p.y+28>r.y+3&&p.y<r.y+r.h-3){if(p.vx>0&&p.x+30<=r.x+12&&nx+30>=r.x){nx=r.x-30;p.vx=0;if(p.g===1)land=true;}else if(p.vx<0&&p.x>=r.x+r.w-12&&nx<=r.x+r.w){nx=r.x+r.w;p.vx=0;if(p.g===-1)land=true;}}});
          p.x=nx;p.on=land;if(land)p.ph+=dt*18;
          if(p.x<-34||p.x>W+34||p.y-camY>H+18){
            p.dead=true;const sx=Math.max(24,Math.min(W-24,p.x+15)),sy=Math.max(28,Math.min(H-28,p.y-camY+14)),col=p.col.m;
            rings.push({x:sx,y:sy,r:10,c:col,l:0.45});
            for(let i=0;i<14;i++){const a=(i/14)*6.28,sp=110+Math.random()*180;parts.push({x:sx,y:sy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,c:col,l:0.5});}
          }
        });
        if(players[0].dead||players[1].dead){
          if(players[0].dead&&!players[1].dead){blueScore++;toast(mode==='bot'?'🔵 نقطة للبوت!':'🔵 نقطة لـ '+players[1].name);}
          else if(players[1].dead&&!players[0].dead){redScore++;toast('🔴 نقطة لـ '+me);}
          else toast('💥 سقوط مزدوج — إعادة الجولة!');
          $('s-red').textContent=redScore;$('s-blue').textContent=blueScore;state='over';timer=0.95;
        }
      }
      ctx.fillStyle=b.sky;ctx.fillRect(0,0,W,H);
      ctx.fillStyle=b.hill;ctx.beginPath();ctx.arc(W*0.25,H*0.48,85,0,6.28);ctx.arc(W*0.72,H*0.75,95,0,6.28);ctx.fill();
      if(state==='intro'){ctx.fillStyle='rgba(0,0,0,.22)';ctx.font='900 175px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(round),W/2,H/2);}
      rects.forEach(r=>{const sy=r.y-camY;if(sy+r.h<-30||sy>H+30)return;ctx.fillStyle=r.k==='c'?'#9b5431':r.k==='b'?b.beam:b.wall;ctx.fillRect(r.x,sy,r.w,r.h);if(r.k==='wl'||r.k==='wr'){ctx.fillStyle=b.trim;ctx.fillRect(r.k==='wl'?r.x+r.w-12:r.x,sy,12,r.h);}ctx.strokeStyle=b.out;ctx.lineWidth=3;ctx.strokeRect(r.x,sy,r.w,r.h);});
      players.forEach(p=>{if(p.dead)return;const sy=p.y-camY;ctx.save();ctx.translate(p.x+15,sy+14);ctx.rotate(p.g===-1?Math.PI/2:-Math.PI/2);if(p.g===1)ctx.scale(-1,1);ctx.fillStyle=p.col.m;ctx.strokeStyle='#141621';ctx.lineWidth=2.5;ctx.fillRect(-13,-13,26,25);ctx.strokeRect(-13,-13,26,25);ctx.fillStyle='#0f172a';ctx.fillRect(-11,-4,18,10);ctx.fillStyle='#fff';ctx.fillRect(-6,-2,4,6);ctx.fillRect(1,-2,4,6);ctx.fillStyle='#facc15';ctx.beginPath();ctx.moveTo(-7,-13);ctx.lineTo(-7,-20);ctx.lineTo(0,-16);ctx.lineTo(7,-20);ctx.lineTo(7,-13);ctx.fill();ctx.stroke();ctx.restore();});
      rings.forEach(rg=>{rg.l-=dt;rg.r+=190*dt;ctx.strokeStyle=rg.c;ctx.lineWidth=6;ctx.beginPath();ctx.arc(rg.x,rg.y,rg.r,0,6.28);ctx.stroke();});rings=rings.filter(rg=>rg.l>0);
      parts.forEach(pt=>{pt.l-=dt;pt.x+=pt.vx*dt;pt.y+=pt.vy*dt;ctx.fillStyle=pt.c;ctx.fillRect(pt.x-4,pt.y-4,8,8);});parts=parts.filter(pt=>pt.l>0);
      if(fade>0){ctx.fillStyle='rgba(0,0,0,'+fade+')';ctx.fillRect(0,0,W,H);}
      raf=requestAnimationFrame(loop);
    }
    canvas.addEventListener('pointerdown',e=>{e.preventDefault();if(mode==='bot'){flip('red');return;}if(mode==='online'){flip(String(u.id));return;}const r=canvas.getBoundingClientRect();flip(e.clientX-r.left<r.width/2?'red':'blue');});
    window.addEventListener('keydown',e=>{if(e.code==='Space'||e.code==='KeyW'||e.code==='KeyA'||e.code==='KeyD')flip('red');if(e.code==='ArrowUp'||e.code==='ArrowLeft'||e.code==='ArrowRight')flip(mode==='bot'?'red':'blue');});
    $('start').onclick=$('start-top').onclick=startGame;
    $('exit-game').onclick=$('spec-exit').onclick=()=>{cancelAnimationFrame(raf);$('game').classList.remove('show');$('setup').classList.add('show');};
    $('back').onclick=()=>{location.href='/mini-app';};
    const roomParam=new URLSearchParams(location.search).get('room')||(tg?.initDataUnsafe?.start_param?.startsWith('gravity_')?tg.initDataUnsafe.start_param.slice(8):'');
    if(roomParam){mode='online';document.querySelector('[data-mode="online"]').click();gApi('join',{room_id:roomParam}).then(r=>{onlineRoom=r;renderLobby();}).catch(e=>toast(e.message));}
  </script>
</body>
</html>`;
}
