import { pool } from "../db.js";
import { changeRank, getRank, getDeveloperType, OWNER_ID, NORMAL_RANKS } from "../ranks.js";

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}

async function resolveTarget(ctx) {
  const replied = ctx.message?.reply_to_message?.from;
  if (replied) return replied;
  const parts = (ctx.message?.text ?? "").trim().split(/\s+/);
  const token = parts.slice(2).find((part) => /^\d+$/.test(part) || part.startsWith("@"));
  if (!token) return null;

  if (/^\d+$/.test(token)) {
    const result = await db().query(
      "SELECT user_id, username, first_name, is_bot FROM users WHERE user_id = $1",
      [token]
    );
    const row = result.rows[0];
    return row ? { id: Number(row.user_id), username: row.username, first_name: row.first_name, is_bot: row.is_bot } : { id: Number(token), first_name: token };
  }

  const username = token.slice(1).toLowerCase();
  const result = await db().query(
    "SELECT user_id, username, first_name, is_bot FROM users WHERE LOWER(username) = $1 LIMIT 1",
    [username]
  );
  const row = result.rows[0];
  if (row) return { id: Number(row.user_id), username: row.username, first_name: row.first_name, is_bot: row.is_bot };
  try {
    const chat = await ctx.api.getChat(token);
    return { id: chat.id, first_name: chat.first_name ?? chat.title ?? token, username: chat.username };
  } catch {
    return null;
  }
}

export async function handleRankCommand(ctx) {
  const text = ctx.message?.text?.trim();
  const actor = ctx.from;
  if (!text || !actor) return false;
  const chat = ctx.chat;
  const chatId = ["group", "supergroup"].includes(chat?.type) ? chat.id : null;

  if (text === "رتبتي") {
    const rank = await getRank(actor.id, chatId);
    await ctx.reply(`• رتبتك هي: ${rank}`);
    return true;
  }

  if (text === "رتبته" || text.startsWith("رتبته ")) {
    const target = await resolveTarget(ctx);
    if (!target) {
      await ctx.reply("❌ رد على رسالة الشخص أو اكتب رتبته مع الآيدي أو اليوزر.");
      return true;
    }
    const rank = await getRank(target.id, chatId);
    await ctx.reply(`• رتبة ${target.first_name || target.username || target.id}: ${rank}`);
    return true;
  }

  const match = text.match(/^(رفع|تنزيل)\s+(Dev|المالك|نائب المالك|ادمن اساسي|ادمن|مميز)(?:\s+(.+))?$/);
  if (!match) return false;

  const [, action, rank, targetToken] = match;
  const target = await resolveTarget(ctx);
  if (!target) {
    await ctx.reply("❌ استخدم الأمر بالرد على الشخص أو أضف الآيدي/اليوزر.");
    return true;
  }

  if (rank !== "Dev" && !chatId) {
    await ctx.reply("❌ الرتب العادية تُدار داخل القروب.");
    return true;
  }

  const result = await changeRank({
    actorId: actor.id,
    targetId: target.id,
    chatId,
    rank,
    promote: action === "رفع",
  });
  const name = target.first_name || target.username || target.id;
  await ctx.reply(`${result.ok ? "✅" : "❌"} ${result.message}\nالمستخدم: ${name}`);
  return true;
}
