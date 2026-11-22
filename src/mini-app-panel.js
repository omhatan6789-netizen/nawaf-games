import { InlineKeyboard } from "grammy";
import { pool } from "./db.js";
import { OWNER_ID } from "./ranks.js";

const sessions = new Map();
const PALETTE = [
  ["🔴 أحمر", "#ef4444"], ["🍷 خمري", "#991b1b"], ["🟠 برتقالي", "#f97316"],
  ["🟡 ذهبي", "#f59e0b"], ["💛 أصفر", "#eab308"], ["🟢 أخضر", "#22c55e"],
  ["🌿 زيتي", "#65a30d"], ["🩵 تركواز", "#14b8a6"], ["🩵 سماوي", "#06b6d4"],
  ["🔵 أزرق", "#3b82f6"], ["🟣 نيلي", "#6366f1"], ["💜 بنفسجي", "#a855f7"],
  ["🩷 وردي", "#ec4899"], ["🌺 فوشي", "#f43f5e"], ["⚫ أسود", "#171717"],
  ["⚪ أبيض", "#ffffff"], ["🩶 رمادي", "#6b7280"], ["🤎 بني", "#92400e"],
];
const clean = value => String(value ?? "").replace(/\s+/g, " ").replace(/^\W+/, "").trim();
const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const back = () => new InlineKeyboard().text("↩️ لوحة الميني", "minipanel:menu");
const homeText = "⚙️ لوحة التحكم الخاصة بالميني آب\nاختر القسم اللي تبي تديره:";
const GAME_IMAGES = [["connect","كونكت 4 🔴"],["dots","المربعات 🟦"],["memory","اختبر ذاكرتك 🧠"],["word","خمن الكلمة 🔤"],["match","تطابق البطاقات 🃏"],["find","Find Match 🔎"],["number","خمن الرقم 🔢"],["sort","ترتيب الأرقام 🔢"],["carrom","الكيرم 🎯"],["gravity","جري الجاذبية 🏃"],["snowball","كرة الثلج ❄️"],["darts","السهام 🎯"]];
const gameImagesKeyboard = () => { const kb=new InlineKeyboard(); for(const [type,label] of GAME_IMAGES) kb.text(label,"minipanel:game-image:"+type).row(); return kb.text("↩️ لوحة الميني","minipanel:menu"); };
const homeKeyboard = () => new InlineKeyboard()
  .text("🎨 تعديل لون زر بالميني", "minipanel:color").row()
  .text("📋 الألوان المعدلة", "minipanel:colors").row()
  .text("🔘 إدارة الأزرار", "minipanel:buttons").row()
  .text("🎧 إدارة الأصوات", "minipanel:sounds").row()
  .text("🖼️ صورة الميني آب", "minipanel:banner").row()
  .text("🎮 صور الألعاب", "minipanel:game-images").row()
  .text("🔢 تخصيص لعبة ترتيب الأرقام", "minipanel:number-sort");

function paletteKeyboard() {
  const kb = new InlineKeyboard();
  PALETTE.forEach(([label, color], i) => {
    kb.text(label, "minipanel:pick:" + color);
    if (i % 3 === 2) kb.row();
  });
  return kb.row().text("✏️ لون مخصص HEX", "minipanel:custom").row()
    .text("↩️ إلغاء", "minipanel:menu");
}
async function saveColor(ctx, button, color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    await ctx.reply("صيغة اللون غير صحيحة. استخدم #RRGGBB.");
    return;
  }
  await pool.query(`INSERT INTO mini_app_button_colors(button_text,color_hex,updated_by,updated_at)
    VALUES($1,$2,$3,NOW()) ON CONFLICT(button_text) DO UPDATE
    SET color_hex=EXCLUDED.color_hex,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
    [clean(button), color.toLowerCase(), ctx.from.id]);
  sessions.delete(ctx.from.id);
  await ctx.reply(`تم تغيير لون زر «${esc(button)}» إلى <code>${color.toLowerCase()}</code> ✅\nافتح الميني آب من جديد لتطبيق اللون.`,
    { parse_mode: "HTML", reply_markup: back() });
}

export async function ensureMiniAppPanelSchema() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  await pool.query(`CREATE TABLE IF NOT EXISTS mini_app_button_colors (
    button_text TEXT PRIMARY KEY,
    color_hex TEXT NOT NULL,
    updated_by BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS online_game_images (
    game_type TEXT PRIMARY KEY,
    photo_file_id TEXT NOT NULL,
    updated_by BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("ALTER TABLE online_game_images DROP CONSTRAINT IF EXISTS online_game_images_game_type_check");
  await pool.query(`ALTER TABLE online_game_images ADD CONSTRAINT online_game_images_game_type_check
    CHECK (game_type IN ('connect','dots','memory','word','match','find','number','sort','carrom','gravity','snowball','darts'))`);
}

export async function handleMiniAppPanelCallback(ctx) {
  const data = ctx.callbackQuery?.data || "";
  if (!data.startsWith("minipanel:")) return false;
  if (Number(ctx.from?.id) !== OWNER_ID) {
    await ctx.answerCallbackQuery({ text: "هذه اللوحة للمالك فقط", show_alert: true });
    return true;
  }
  await ctx.answerCallbackQuery();
  try {
    if (data === "minipanel:menu") {
      sessions.delete(ctx.from.id);
      await ctx.editMessageText(homeText, { reply_markup: homeKeyboard() });
    } else if (data === "minipanel:buttons") {
      const { rows } = await pool.query("SELECT id,title,button_type FROM mini_app_buttons ORDER BY button_type DESC,button_order,id");
      const lines = ["🔘 أزرار الميني آب", "━━━━━━━━━━━━", ...rows.map((r,i) => `${i+1}. ${esc(r.title)} — ${r.button_type === "large" ? "كبير" : "صغير"}`)];
      if (!rows.length) lines.push("ما فيه أزرار مضافة حاليًا.");
      const kb = new InlineKeyboard().text("➕ إضافة زر صغير", "minipanel:add:small").text("➕ إضافة زر كبير", "minipanel:add:large").row();
      for (const r of rows) kb.text("🗑️ " + String(r.title).slice(0,28), "minipanel:delbutton:" + r.id).row();
      kb.text("↩️ لوحة الميني", "minipanel:menu");
      await ctx.editMessageText(lines.join("\n"), { parse_mode: "HTML", reply_markup: kb });
    } else if (data.startsWith("minipanel:add:")) {
      const kind = data.split(":").at(-1);
      if (!["small","large"].includes(kind)) return true;
      sessions.set(ctx.from.id, { action: "add_button", step: "title", type: kind });
      await ctx.editMessageText("ارسل اسم الزر الجديد:", { reply_markup: back() });
    } else if (data.startsWith("minipanel:delbutton:")) {
      const id = Number(data.split(":").at(-1));
      const result = await pool.query("DELETE FROM mini_app_buttons WHERE id=$1 RETURNING title", [id]);
      await ctx.editMessageText(result.rows[0] ? `تم حذف «${esc(result.rows[0].title)}» ✅` : "الزر غير موجود.", { parse_mode: "HTML", reply_markup: back() });
    } else if (data === "minipanel:sounds") {
      const { rows } = await pool.query("SELECT id,title,media_kind FROM mini_app_sounds ORDER BY id");
      const lines = ["🎧 أصوات الميني آب", "━━━━━━━━━━━━", ...rows.map((r,i) => `${i+1}. ${esc(r.title)} — ${r.media_kind === "video" ? "فيديو" : "صوت"}`)];
      if (!rows.length) lines.push("ما فيه أصوات مضافة.");
      const kb = new InlineKeyboard().text("➕ إضافة صوت", "minipanel:addsound").row();
      for (const r of rows) kb.text("🗑️ " + String(r.title).slice(0,28), "minipanel:delsound:" + r.id).row();
      kb.text("↩️ لوحة الميني", "minipanel:menu");
      await ctx.editMessageText(lines.join("\n"), { parse_mode: "HTML", reply_markup: kb });
    } else if (data === "minipanel:addsound") {
      sessions.set(ctx.from.id, { action: "add_sound", step: "media" });
      await ctx.editMessageText("ارسل ملف صوت أو فيديو (حتى 20 ميجابايت):", { reply_markup: back() });
    } else if (data.startsWith("minipanel:delsound:")) {
      const id = Number(data.split(":").at(-1));
      const result = await pool.query("DELETE FROM mini_app_sounds WHERE id=$1 RETURNING title", [id]);
      await ctx.editMessageText(result.rows[0] ? `تم حذف الصوت «${esc(result.rows[0].title)}» ✅` : "الصوت غير موجود.", { parse_mode: "HTML", reply_markup: back() });
    } else if (data === "minipanel:number-sort") {
      const q=await pool.query("SELECT background_file_id,tile_color FROM number_sort_settings WHERE id=1");
      const cfg=q.rows[0]||{};
      const kb=new InlineKeyboard()
        .text("🖼️ تغيير الخلفية بصورة","minipanel:sortbg").row()
        .text("🎨 تغيير لون المربعات","minipanel:sortcolor").row()
        .text("↩️ استعادة الخلفية الافتراضية","minipanel:sortresetbg").row()
        .text("↩️ استعادة اللون الافتراضي","minipanel:sortresetcolor").row()
        .text("↩️ لوحة الميني","minipanel:menu");
      await ctx.editMessageText("🔢 تخصيص لعبة ترتيب الأرقام\n━━━━━━━━━━━━\nلون المربعات: "+(cfg.tile_color||"#7f1d2d")+"\nالخلفية: "+(cfg.background_file_id?"صورة مخصصة":"الافتراضية"),{reply_markup:kb});
    } else if (data === "minipanel:sortbg") {
      sessions.set(ctx.from.id,{action:"number_sort_bg",step:"media"});
      await ctx.editMessageText("أرسل صورة الخلفية الجديدة للعبة ترتيب الأرقام فقط. اكتب إلغاء للتراجع.",{reply_markup:back()});
    } else if (data === "minipanel:sortcolor") {
      const kb=new InlineKeyboard();
      PALETTE.forEach(([label,color],i)=>{kb.text(label,"minipanel:sortpick:"+color);if(i%3===2)kb.row();});
      kb.row().text("✏️ إدخال لون #RRGGBB","minipanel:sortcustom").row().text("↩️ رجوع","minipanel:number-sort");
      sessions.set(ctx.from.id,{action:"number_sort_color",step:"palette"});
      await ctx.editMessageText("اختر لون مربعات الأرقام أو أدخل كود HEX. الأرقام ستبقى بيضاء.",{reply_markup:kb});
    } else if (data.startsWith("minipanel:sortpick:")) {
      const color=data.slice("minipanel:sortpick:".length);
      if(!/^#[0-9a-fA-F]{6}$/.test(color))return true;
      await pool.query("UPDATE number_sort_settings SET tile_color=$1,updated_at=NOW() WHERE id=1",[color.toLowerCase()]);
      sessions.delete(ctx.from.id);
      await ctx.editMessageText("تم تغيير لون المربعات إلى "+color.toLowerCase()+" ✅",{reply_markup:back()});
    } else if (data === "minipanel:sortcustom") {
      sessions.set(ctx.from.id,{action:"number_sort_color",step:"custom"});
      await ctx.editMessageText("أرسل كود اللون بصيغة #RRGGBB، مثال #12a4ff.",{reply_markup:back()});
    } else if (data === "minipanel:sortresetbg") {
      await pool.query("UPDATE number_sort_settings SET background_file_id=NULL,updated_at=NOW() WHERE id=1");
      await ctx.editMessageText("تمت استعادة خلفية اللعبة الافتراضية ✅",{reply_markup:back()});
    } else if (data === "minipanel:sortresetcolor") {
      await pool.query("UPDATE number_sort_settings SET tile_color='#7f1d2d',updated_at=NOW() WHERE id=1");
      await ctx.editMessageText("تمت استعادة لون المربعات الافتراضي ✅",{reply_markup:back()});
    } else if (data === "minipanel:game-images") {
      await ctx.editMessageText("اختر اللعبة التي تريد إضافة صورتها أو استبدالها:",{reply_markup:gameImagesKeyboard()});
    } else if (data.startsWith("minipanel:game-image:")) {
      const gameType=data.split(":").at(-1);
      const allowed=["connect","dots","memory","word","match","find","number","sort","carrom","gravity","snowball","darts"];
      if(!allowed.includes(gameType)) return true;
      sessions.set(ctx.from.id,{action:"game_image",step:"photo",gameType});
      await ctx.editMessageText("أرسل الآن صورة اللعبة. ستظهر في بطاقة القائمة وواجهة الدخول ودعوة تيليجرام.",{reply_markup:back()});
    } else if (data === "minipanel:banner") {
      sessions.set(ctx.from.id, { action: "banner", step: "media" });
      await ctx.editMessageText("ارسل صورة أو فيديو أو GIF للميني آب (حتى 20 ميجابايت):", { reply_markup: back() });
    } else if (data === "minipanel:color") {
      sessions.set(ctx.from.id, { action: "color", step: "button" });
      await ctx.editMessageText("ارسل اسم الزر كما يظهر داخل الميني آب. تقدر تختار أي زر، حتى زر الرجوع أو أزرار الألعاب.", { reply_markup: back() });
    } else if (data === "minipanel:colors") {
      const { rows } = await pool.query("SELECT button_text,color_hex FROM mini_app_button_colors ORDER BY button_text");
      const lines = ["🎨 الألوان المخصصة", "━━━━━━━━━━━━", ...(rows.map(r => `• ${esc(r.button_text)}: <code>${esc(r.color_hex)}</code>`) || ["ما عدلت ألوان أي أزرار حتى الآن."])];
      const kb = new InlineKeyboard().text("🗑️ حذف لون زر", "minipanel:reset").row().text("↩️ لوحة الميني", "minipanel:menu");
      await ctx.editMessageText(lines.join("\n"), { parse_mode: "HTML", reply_markup: kb });
    } else if (data.startsWith("minipanel:pick:")) {
      const session = sessions.get(ctx.from.id);
      if (session?.action !== "color" || session.step !== "palette") return true;
      await saveColor(ctx, session.button, data.slice("minipanel:pick:".length));
    } else if (data === "minipanel:custom") {
      const session = sessions.get(ctx.from.id);
      if (session?.action !== "color") return true;
      session.step = "custom";
      await ctx.editMessageText("ارسل كود اللون بصيغة HEX مثل #12a4ff:", { reply_markup: back() });
    } else if (data === "minipanel:reset") {
      sessions.set(ctx.from.id, { action: "reset", step: "button" });
      await ctx.editMessageText("ارسل اسم الزر اللي تبي ترجع لونه الافتراضي:", { reply_markup: back() });
    }
  } catch (error) {
    console.error("Mini App panel callback failed:", error?.message || error);
    try { await ctx.reply("❌ تعذر تنفيذ العملية. حاول مرة ثانية."); } catch {}
  }
  return true;
}

export async function handleMiniAppPanelMessage(ctx) {
  if (ctx.chat?.type !== "private" || Number(ctx.from?.id) !== OWNER_ID) return false;
  const text = ctx.message?.text?.trim() || "";
  if (text === "اضف صورة لعبة") {
    sessions.set(ctx.from.id,{action:"game_image_select"});
    await ctx.reply("اختر اللعبة التي تريد إضافة صورتها أو استبدالها:",{reply_markup:gameImagesKeyboard()});
    return true;
  }
  if (["لوحة الميني", "لوحة الميني آب", "لوحة الميني اب"].includes(text)) {
    sessions.delete(ctx.from.id);
    await ctx.reply(homeText, { reply_markup: homeKeyboard() });
    return true;
  }
  if (["تعديل لون زر بالميني", "تعديل لون الميني"].includes(text)) {
    sessions.set(ctx.from.id, { action: "color", step: "button" });
    await ctx.reply("ارسل اسم الزر كما يظهر داخل الميني آب.");
    return true;
  }
  const session = sessions.get(ctx.from.id);
  if (!session) return false;
  if (["إلغاء", "الغاء", "الغاء الامر"].includes(text)) {
    sessions.delete(ctx.from.id);
    await ctx.reply("تم الإلغاء.", { reply_markup: back() });
    return true;
  }
  if (session.action === "color" && session.step === "button") {
    if (!text) { await ctx.reply("ارسل اسم الزر كنص."); return true; }
    session.button = clean(text);
    session.step = "palette";
    await ctx.reply(`اختر لون زر «${esc(session.button)}» أو أدخل لونًا مخصصًا:`, { parse_mode: "HTML", reply_markup: paletteKeyboard() });
    return true;
  }
  if (session.action === "color" && session.step === "custom") {
    await saveColor(ctx, session.button, text);
    return true;
  }
  if (session.action === "number_sort_bg" && session.step === "media") {
    const msg=ctx.message;
    const media=msg?.photo?.at(-1)||(msg?.document&&/^image\//.test(msg.document.mime_type||"")?msg.document:null);
    if(!media){await ctx.reply("أرسل صورة عادية أو ملف صورة، أو اكتب إلغاء.");return true;}
    if((media.file_size||0)>20*1024*1024){await ctx.reply("الصورة أكبر من 20 ميجابايت.");return true;}
    await pool.query("UPDATE number_sort_settings SET background_file_id=$1,updated_at=NOW() WHERE id=1",[media.file_id]);
    sessions.delete(ctx.from.id);
    await ctx.reply("تم تحديث خلفية لعبة ترتيب الأرقام فقط ✅",{reply_markup:back()});
    return true;
  }
  if (session.action === "number_sort_color" && session.step === "custom") {
    if(!/^#[0-9a-fA-F]{6}$/.test(text)){await ctx.reply("اللون غير صحيح. أرسله بصيغة #RRGGBB.");return true;}
    await pool.query("UPDATE number_sort_settings SET tile_color=$1,updated_at=NOW() WHERE id=1",[text.toLowerCase()]);
    sessions.delete(ctx.from.id);
    await ctx.reply("تم تغيير لون المربعات إلى "+text.toLowerCase()+"، والأرقام ستبقى بيضاء دائمًا ✅",{reply_markup:back()});
    return true;
  }
  if (session.action === "game_image_select") return true;
  if (session.action === "game_image" && session.step === "photo") {
    const photo=ctx.message?.photo?.at(-1);
    if(!photo){await ctx.reply("أرسل صورة عادية للعبة، أو اكتب إلغاء.");return true;}
    await pool.query(`INSERT INTO online_game_images(game_type,photo_file_id,updated_by,updated_at)
      VALUES($1,$2,$3,NOW()) ON CONFLICT(game_type) DO UPDATE
      SET photo_file_id=EXCLUDED.photo_file_id,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [session.gameType,photo.file_id,ctx.from.id]);
    const labels={connect:"كونكت 4",dots:"المربعات",memory:"اختبر ذاكرتك",word:"خمن الكلمة",match:"تطابق البطاقات",find:"Find Match",number:"خمن الرقم",sort:"ترتيب الأرقام",carrom:"الكيرم",gravity:"جري الجاذبية",snowball:"كرة الثلج",darts:"السهام"};
    sessions.delete(ctx.from.id);
    await ctx.reply("تم حفظ صورة لعبة "+(labels[session.gameType]||session.gameType)+"، وستظهر في القائمة وواجهة اللعبة ودعوات تيليجرام ✅",{reply_markup:back()});
    return true;
  }
  if (session.action === "banner") {
    const msg = ctx.message;
    let media = msg.photo?.at(-1) || msg.video || msg.animation;
    if (msg.document && /^(image|video)\//.test(msg.document.mime_type || "")) media = msg.document;
    if (!media) { await ctx.reply("ارسل صورة أو فيديو أو GIF، أو اكتب إلغاء."); return true; }
    if ((media.file_size || 0) > 20 * 1024 * 1024) { await ctx.reply("الملف أكبر من 20 ميجابايت."); return true; }
    const mime = media.mime_type || (msg.photo ? "image/jpeg" : "video/mp4");
    const kind = mime.startsWith("video/") ? "video" : "image";
    await pool.query("UPDATE mini_app_settings SET banner_file_id=$1,banner_media_kind=$2,banner_mime_type=$3,updated_at=NOW() WHERE id=1", [media.file_id,kind,mime]);
    sessions.delete(ctx.from.id);
    await ctx.reply("تم تحديث وسيط أعلى الميني آب بنجاح ✅", { reply_markup: back() });
    return true;
  }
  if (session.action === "add_button") {
    if (session.step === "title") {
      if (!text) { await ctx.reply("ارسل اسم الزر."); return true; }
      session.title = text.slice(0,80); session.step = "target";
      await ctx.reply("ارسل رابط الموقع أو يوزر تيليجرام مثل @username.");
    } else if (session.step === "target") {
      let target = text;
      if (/^@[A-Za-z0-9_]{5,32}$/.test(target)) target = "https://t.me/" + target.slice(1);
      else if (/^(https?:\/\/)?t\.me\//i.test(target) && !/^https?:\/\//i.test(target)) target = "https://" + target;
      if (!/^https?:\/\//i.test(target)) { await ctx.reply("الرابط غير صحيح. ارسل رابطًا يبدأ بـ https:// أو @username."); return true; }
      session.target = target; session.step = "color";
      await ctx.reply("ارسل لون خلفية الزر بصيغة HEX مثل #ffffff.");
    } else if (session.step === "color") {
      if (!/^#[0-9a-fA-F]{6}$/.test(text)) { await ctx.reply("اكتب اللون بصيغة #RRGGBB."); return true; }
      session.color = text.toLowerCase(); session.step = "image";
      await ctx.reply(session.type === "large" ? "ارسل صورة أو فيديو أو GIF للزر الكبير، أو اكتب تخطي." : "ارسل صورة للزر الصغير أو اكتب تخطي.");
    } else if (session.step === "image") {
      const msg = ctx.message;
      let media = msg.photo?.at(-1) || msg.video || msg.animation;
      if (msg.document && /^(image|video)\//.test(msg.document.mime_type || "")) media = msg.document;
      let fileId = null, mediaKind = "image", mime = null;
      if (text.toLowerCase() !== "تخطي") {
        if (session.type === "large" && !media) { await ctx.reply("ارسل صورة أو فيديو أو GIF، أو اكتب تخطي."); return true; }
        if (session.type === "small" && !msg.photo) { await ctx.reply("ارسل صورة للزر الصغير أو اكتب تخطي."); return true; }
        if (media && (media.file_size || 0) > 20 * 1024 * 1024) { await ctx.reply("الملف أكبر من 20 ميجابايت."); return true; }
        if (media) {
          mime = media.mime_type || (msg.photo ? "image/jpeg" : "video/mp4");
          mediaKind = mime.startsWith("video/") ? "video" : "image";
          fileId = media.file_id;
        }
      }
      const order = await pool.query("SELECT COALESCE(MAX(button_order),0)+1 AS n FROM mini_app_buttons WHERE button_type=$1", [session.type]);
      await pool.query(`INSERT INTO mini_app_buttons(title,target,button_type,color,image_file_id,button_order,created_by,media_kind,mime_type)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [session.title,session.target,session.type,session.color,fileId,Number(order.rows[0].n),ctx.from.id,mediaKind,mime]);
      sessions.delete(ctx.from.id);
      await ctx.reply("تمت إضافة الزر للميني آب بنجاح ✅", { reply_markup: back() });
    }
    return true;
  }
  if (session.action === "add_sound") {
    if (session.step === "media") {
      const msg = ctx.message;
      let media = msg.audio || msg.voice || msg.video;
      if (msg.document && /^(audio|video)\//.test(msg.document.mime_type || "")) media = msg.document;
      if (!media) { await ctx.reply("ارسل ملف صوتي أو فيديو."); return true; }
      if ((media.file_size || 0) > 20 * 1024 * 1024) { await ctx.reply("الملف أكبر من 20 ميجابايت."); return true; }
      const mime = media.mime_type || (msg.video ? "video/mp4" : msg.voice ? "audio/ogg" : "audio/mpeg");
      Object.assign(session,{step:"title",file_id:media.file_id,mime_type:mime,media_kind:mime.startsWith("video/") ? "video" : "audio",file_size:media.file_size || 0});
      await ctx.reply("وش الاسم اللي تبيه يظهر للصوت؟");
    } else if (session.step === "title") {
      if (!text) { await ctx.reply("اكتب اسمًا للصوت."); return true; }
      await pool.query("INSERT INTO mini_app_sounds(title,file_id,mime_type,media_kind,file_size,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [text.slice(0,80),session.file_id,session.mime_type,session.media_kind,session.file_size,ctx.from.id]);
      sessions.delete(ctx.from.id);
      await ctx.reply("تمت إضافة الصوت للميني آب ✅", { reply_markup: back() });
    }
    return true;
  }
  if (session.action === "reset" && session.step === "button") {
    if (!text) { await ctx.reply("ارسل اسم الزر."); return true; }
    const result = await pool.query("DELETE FROM mini_app_button_colors WHERE button_text=$1", [clean(text)]);
    sessions.delete(ctx.from.id);
    await ctx.reply(result.rowCount ? "تم إرجاع لون الزر الافتراضي ✅" : "ما لقيت لونًا مخصصًا لهذا الزر.", { reply_markup: back() });
    return true;
  }
  return false;
}
