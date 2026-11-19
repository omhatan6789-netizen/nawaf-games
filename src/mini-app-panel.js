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
const homeKeyboard = () => new InlineKeyboard()
  .text("🎨 تعديل لون زر بالميني", "minipanel:color").row()
  .text("📋 الألوان المعدلة", "minipanel:colors").row();

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
  if (session.action === "reset" && session.step === "button") {
    if (!text) { await ctx.reply("ارسل اسم الزر."); return true; }
    const result = await pool.query("DELETE FROM mini_app_button_colors WHERE button_text=$1", [clean(text)]);
    sessions.delete(ctx.from.id);
    await ctx.reply(result.rowCount ? "تم إرجاع لون الزر الافتراضي ✅" : "ما لقيت لونًا مخصصًا لهذا الزر.", { reply_markup: back() });
    return true;
  }
  return false;
}
