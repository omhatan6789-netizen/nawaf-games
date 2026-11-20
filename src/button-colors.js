import { pool } from "./db.js";
import { getRankLevel, getDeveloperType } from "./ranks.js";

const COLORS = { "احمر": "danger", "ازرق": "primary", "اخضر": "success", "شفاف": null };
const colorCache = new Map();
const sessions = new Map();
let loaded = false;

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}
function normalize(value) {
  return String(value || "").normalize("NFC").replace(/[\uFE0E\uFE0F]/g, "").trim().replace(/\s+/g, " ");
}

export async function ensureButtonColorsSchema() {
  await db().query(\`CREATE TABLE IF NOT EXISTS button_colors (
    button_text TEXT PRIMARY KEY,
    color TEXT NOT NULL DEFAULT 'شفاف',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )\`);
  await loadButtonColors();
}

async function loadButtonColors() {
  if (loaded) return;
  const result = await db().query("SELECT button_text, color FROM button_colors");
  colorCache.clear();
  for (const row of result.rows) {
    colorCache.set(normalize(row.button_text), Object.hasOwn(COLORS, row.color) ? row.color : "شفاف");
  }
  loaded = true;
}

export async function applyButtonColors(payload) {
  if (!loaded && pool) {
    try { await loadButtonColors(); } catch {}
  }
  const keyboard = payload?.reply_markup?.inline_keyboard;
  if (!Array.isArray(keyboard)) return payload;
  return {
    ...payload,
    reply_markup: {
      ...payload.reply_markup,
      inline_keyboard: keyboard.map(row => row.map(button => {
        const color = colorCache.get(normalize(button?.text));
        if (color === undefined) return button;
        const next = { ...button };
        const style = COLORS[color];
        if (style) next.style = style;
        else delete next.style;
        return next;
      }))
    }
  };
}

export async function handleButtonColorMessage(ctx) {
  const text = normalize(ctx.message?.text);
  const chat = ctx.chat;
  const user = ctx.from;
  if (!text || !user || !["group", "supergroup"].includes(chat?.type)) return false;

  const key = String(chat.id);
  const session = sessions.get(key);

  if (text === "تعديل لون") {
    const developer = await getDeveloperType(user.id);
    if (await getRankLevel(user.id, chat.id) < 5 && !developer) return false;
    sessions.set(key, { userId: String(user.id), step: "button" });
    await ctx.reply("• طيب ياحلو ارسل اسم الزر الي تبي تغير لونه،");
    return true;
  }

  if (!session || session.userId !== String(user.id)) return false;
  if (session.step === "button") {
    if (!text || text.length > 128) {
      sessions.delete(key);
      await ctx.reply("• مضيع يالحبيب، تاكد من اسم الزر.");
      return true;
    }
    session.button = text;
    session.step = "color";
    await ctx.reply("• اوكيه، ارسل اللون الي تبيه.\nملاحظة: عندك ( احمر، ازرق، اخضر، شفاف، فقط! )");
    return true;
  }

  if (!Object.hasOwn(COLORS, text)) {
    await ctx.reply("• قلت لك بس فيه احمر وازرق واخضر وشفاف!!");
    return true;
  }

  try {
    await db().query(
      \`INSERT INTO button_colors(button_text,color) VALUES($1,$2)
       ON CONFLICT(button_text) DO UPDATE SET color=EXCLUDED.color, updated_at=NOW()\`,
      [session.button, text]
    );
    colorCache.set(normalize(session.button), text);
    sessions.delete(key);
    await ctx.reply("• تم عدلت لونه ياحلو يمديك تتاكد الحين!");
  } catch (error) {
    console.error("Saving button color failed:", error);
    sessions.delete(key);
    await ctx.reply("❌ تعذر حفظ اللون، حاول مرة ثانية.");
  }
  return true;
}
