export const MINI_APP_SERVER_PATCH = `# في ملف mini_app_server.py:
# 1) داخل دالة handle_mini_app_request (إضافة مسار /carrom):
    if path in ("/", "/mini-app", "/mini-app/", "/carrom"):
        file_path = WEB_ROOT / ("carrom.html" if path == "/carrom" else "index.html")
        body = file_path.read_bytes()
        handler.send_response(200)
        handler.send_header("Content-Type", "text/html; charset=utf-8")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
        return

# 2) دعم غرف الكيرم الأونلاين في mini_app_server.py:
# شغّل خادم Node/WebSocket المرفق في مشروع اللعبة الكامل على مسار /ws/carrom
# أو اربط رابط الميني آب بمسار /carrom?room=<ROOM_ID> لفتح الغرف مباشرة من تيليجرام.`;

export const MINI_APP_INDEX_PATCH = `// 1) في ملف mini_app/index.html داخل دالة showGames():
 const games=[
  ['🔴','كونكت 4','العب ضد البوت أو تحدَّ لاعبًا','connect'],
  ['🟦','المربعات','ارسم الخطوط واجمع المربعات','dots'],
  ['🧠','اختبر ذاكرتك','احفظ التسلسل وتحدَّ لاعبًا آخر','memory'],
  ['🔤','خمن الكلمة','تحدَّ حتى 10 لاعبين أو تدرب لحالك','word'],
  ['🎯','الكيرم','صوّب واضرب الأقراص نحو الجيوب','carrom'],
 ];

// 2) داخل card.onclick:
  card.onclick=()=>{
    if(type==='carrom'){location.href='/carrom';return;}
    if(type==='connect'){showConnect4Setup();return;}
    if(type==='word'){showWordSetup();return;}
    showMiniGameInstructions(type);
  };

// 3) في بداية تشغيل الميني آب لفتح غرف الكيرم من زر «فتح غرفة اللعبة»:
  if(c4StartParam.startsWith('carrom_')){
    location.href='/carrom?room='+encodeURIComponent(c4StartParam.slice(7));
    return;
  }`;

export const ONLINE_MODE_PY_PATCH = `# في ملف games/online_mode.py:
# 1) أضف الكيرم إلى GAME_INFO و _select_games:
GAME_INFO["carrom"] = ("الكيرم 🎯", "لعبة كيرم أونلاين ضد الأصدقاء (2 - 4 لاعبين)")

# في _select_games(query):
    supported_inline = ["connect", "dots", "memory", "word", "carrom"]
    if any(word in value for word in ("كيرم", "الكيرم", "carrom")):
        return ["carrom"]

# 2) داخل online_games_inline_query:
        if game_type == "carrom":
            import secrets
            cid = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
            room_url = f"https://t.me/{me.username}?startapp=carrom_{cid}"
            lobby_text = (
                f"🎮 غرفة أونلاين — الكيرم 🎯\\n\\n"
                f"أنشأ {inline.from_user.full_name or inline.from_user.first_name or 'لاعب'} غرفة كيرم أونلاين.\\n"
                "افتحوا الغرفة من الزر بالأسفل للانضمام وبدء التحدي داخل الميني آب!"
            )
            keyboard = InlineKeyboardMarkup([[
                InlineKeyboardButton("فتح غرفة اللعبة", url=room_url)
            ]])`;

export function buildStandaloneCarromReadme(): string {
  return [
    'ملفات لعبة الكيرم لبوت نواف (nawaf-bot-v2):',
    '1) لتشغيل النسخة الكاملة (React + Express + WebSocket أونلاين حقيقي + بوت نواف):',
    '   حمّل المشروع الكامل (ZIP) وشغّل:',
    '   npm install && npm run build && npm start',
    '2) طبّق التعديلات الموجودة في patches/ على mini_app/index.html و mini_app_server.py و games/online_mode.py.',
    '3) لوضع الميني آب في مسار /carrom مباشرةً، انسخ محتوى مجلد dist/ بعد البناء إلى مجلد الويب.',
  ].join('\n');
}
