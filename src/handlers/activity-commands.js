import { InlineKeyboard } from "grammy";
import { pool } from "../db.js";
import { getPointsLeaderboard } from "../points.js";

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}

const topKeyboard = new InlineKeyboard()
  .text("🏆 النقاط", "topmenu:points")
  .row()
  .text("🕵️ الحرامية", "topmenu:robbers")
  .row()
  .text("💬 المتفاعلين", "topmenu:active");

const backKeyboard = new InlineKeyboard().text("↩️ رجوع لقائمة التوب", "topmenu:back");

export async function handleActivityCommand(ctx) {
  const text = ctx.message?.text?.trim();
  if (!text || !ctx.from) return false;

  if (text === "رسائلي" || text === "رسايلي") {
    const result = await db().query("SELECT messages FROM users WHERE user_id = $1", [String(ctx.from.id)]);
    const count = Number(result.rows[0]?.messages ?? 0);
    await ctx.reply(`💬 عدد رسائلك المسجلة: ${count}`);
    return true;
  }

  if (text === "توب") {
    await ctx.reply("اختر الترتيب الذي تبي تعرضه:", { reply_markup: topKeyboard });
    return true;
  }

  if (text === "توب المتفاعلين") {
    await sendActiveLeaderboard(ctx);
    return true;
  }

  if (text === "توب الحرامية") {
    await sendRobbersLeaderboard(ctx);
    return true;
  }

  return false;
}

async function sendPointsLeaderboard(ctx) {
  const rows = await getPointsLeaderboard(10);
  if (!rows.length) return ctx.reply("🏆 توب النقاط\n\nلا يوجد ترتيب حتى الآن.");
  const lines = ["🏆 توب النقاط", ""];
  rows.forEach((row, index) => {
    lines.push(`${index + 1} - ${row.first_name || row.username || "مستخدم"} : ${Number(row.points || 0)} نقطة`);
  });
  await ctx.reply(lines.join("\n"));
}

async function sendRobbersLeaderboard(ctx) {
  const rows = await db().query(
    `SELECT b.user_id, b.robbery_balance, u.first_name, u.username
     FROM bank_accounts b JOIN users u ON u.user_id = b.user_id
     WHERE b.robbery_balance > 0
       AND COALESCE(u.is_bot, FALSE) = FALSE
       AND COALESCE(u.first_name, '') <> 'Deleted Account'
     ORDER BY b.robbery_balance DESC, b.user_id ASC LIMIT 10`
  );
  if (!rows.rows.length) return ctx.reply("🕵️ توب الحرامية\n\nلا يوجد ترتيب حتى الآن.");
  const lines = ["🕵️ توب الحرامية", ""];
  rows.rows.forEach((row, index) => {
    lines.push(`${index + 1} - ${row.first_name || row.username || "مستخدم"} : ${Number(row.robbery_balance || 0)} نقطة مسروقة`);
  });
  await ctx.reply(lines.join("\n"));
}

async function sendActiveLeaderboard(ctx) {
  const inGroup = ["group", "supergroup"].includes(ctx.chat?.type);
  const result = inGroup
    ? await db().query(
        `SELECT u.first_name, u.username, ca.message_count AS count
         FROM chat_activity ca JOIN users u ON u.user_id = ca.user_id
         WHERE ca.chat_id = $1 AND ca.message_count > 0
           AND COALESCE(u.is_bot, FALSE) = FALSE
           AND COALESCE(u.first_name, '') <> 'Deleted Account'
         ORDER BY ca.message_count DESC, u.user_id ASC LIMIT 10`,
        [String(ctx.chat.id)]
      )
    : await db().query(
        `SELECT first_name, username, activity_messages AS count
         FROM users WHERE activity_messages > 0
           AND COALESCE(is_bot, FALSE) = FALSE
           AND COALESCE(first_name, '') <> 'Deleted Account'
         ORDER BY activity_messages DESC, user_id ASC LIMIT 10`
      );

  const title = inGroup ? "💬 توب المتفاعلين في هذا القروب" : "💬 توب المتفاعلين العام";
  if (!result.rows.length) return ctx.reply(title + "\n\nلا يوجد ترتيب حتى الآن.");
  const lines = [title, ""];
  result.rows.forEach((row, index) => {
    lines.push(`${index + 1} - ${row.first_name || row.username || "مستخدم"} : (رسالة ${Number(row.count || 0)})`);
  });
  await ctx.reply(lines.join("\n"));
}

export async function handleTopCallback(ctx) {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("topmenu:")) return;
  await ctx.answerCallbackQuery();

  if (data === "topmenu:back") {
    await ctx.editMessageText("اختر الترتيب الذي تبي تعرضه:", { reply_markup: topKeyboard });
    return;
  }

  const inGroup = ["group", "supergroup"].includes(ctx.chat?.type);
  if (data === "topmenu:points") {
    const rows = await getPointsLeaderboard(10);
    const lines = ["🏆 توب النقاط", ""];
    rows.forEach((row, index) => lines.push(`${index + 1} - ${row.first_name || row.username || "مستخدم"} : ${Number(row.points || 0)} نقطة`));
    await ctx.editMessageText(rows.length ? lines.join("\n") : "🏆 توب النقاط\n\nلا يوجد ترتيب حتى الآن.", { reply_markup: backKeyboard });
    return;
  }

  if (data === "topmenu:robbers") {
    const rows = await db().query(
      `SELECT b.robbery_balance, u.first_name, u.username
       FROM bank_accounts b JOIN users u ON u.user_id = b.user_id
       WHERE b.robbery_balance > 0 AND COALESCE(u.is_bot, FALSE) = FALSE
         AND COALESCE(u.first_name, '') <> 'Deleted Account'
       ORDER BY b.robbery_balance DESC, b.user_id ASC LIMIT 10`
    );
    const lines = ["🕵️ توب الحرامية", ""];
    rows.rows.forEach((row, index) => lines.push(`${index + 1} - ${row.first_name || row.username || "مستخدم"} : ${Number(row.robbery_balance || 0)} نقطة مسروقة`));
    await ctx.editMessageText(rows.rows.length ? lines.join("\n") : "🕵️ توب الحرامية\n\nلا يوجد ترتيب حتى الآن.", { reply_markup: backKeyboard });
    return;
  }

  if (data === "topmenu:active") {
    const result = inGroup
      ? await db().query(
          `SELECT u.first_name, u.username, ca.message_count AS count
           FROM chat_activity ca JOIN users u ON u.user_id = ca.user_id
           WHERE ca.chat_id = $1 AND ca.message_count > 0
             AND COALESCE(u.is_bot, FALSE) = FALSE
             AND COALESCE(u.first_name, '') <> 'Deleted Account'
           ORDER BY ca.message_count DESC, u.user_id ASC LIMIT 10`,
          [String(ctx.chat.id)]
        )
      : await db().query(
          `SELECT first_name, username, activity_messages AS count FROM users
           WHERE activity_messages > 0 AND COALESCE(is_bot, FALSE) = FALSE
             AND COALESCE(first_name, '') <> 'Deleted Account'
           ORDER BY activity_messages DESC, user_id ASC LIMIT 10`
        );
    const title = inGroup ? "💬 توب المتفاعلين في هذا القروب" : "💬 توب المتفاعلين العام";
    const lines = [title, ""];
    result.rows.forEach((row, index) => lines.push(`${index + 1} - ${row.first_name || row.username || "مستخدم"} : (رسالة ${Number(row.count || 0)})`));
    await ctx.editMessageText(result.rows.length ? lines.join("\n") : title + "\n\nلا يوجد ترتيب حتى الآن.", { reply_markup: backKeyboard });
  }
}
