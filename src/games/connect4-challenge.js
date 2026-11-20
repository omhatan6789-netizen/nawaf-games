import crypto from "node:crypto";
import { pool } from "../db.js";

const DEFAULT_WAGER = 20000;
const displayName = (user) => [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.username || "مستخدم";
const formatPoints = (n) => Number(n).toLocaleString("en-US");

export async function handleConnect4ChallengeMessage(ctx) {
  const msg = ctx.message;
  if (!msg || !["group", "supergroup"].includes(ctx.chat?.type) || !/^كونكت(?:\s+[\d,]+)?$/.test((msg.text || "").trim())) return false;
  const target = msg.reply_to_message?.from;
  if (!target) { await ctx.reply("❌ استخدم «كونكت» بالرد على الشخص اللي تبي تتحداه."); return true; }
  if (target.is_bot || Number(target.id) === Number(ctx.from?.id)) {
    await ctx.reply("❌ تقدر تتحدى شخصًا آخر فقط. لمواجهة البوت افتح كونكت 4 من الميني آب."); return true;
  }
  const parts = (msg.text || "").trim().split(/\s+/);
  let wager = DEFAULT_WAGER;
  if (parts.length === 2) {
    wager = Number(parts[1].replace(/,/g, ""));
    if (!Number.isSafeInteger(wager)) { await ctx.reply("❌ مبلغ الرهان غير صحيح."); return true; }
  }
  if (wager < 1 || wager > 2000000000) {
    await ctx.reply("❌ اختر مبلغًا بين 1 و 2,000,000,000 نقطة."); return true;
  }
  if (!pool) { await ctx.reply("❌ قاعدة البيانات غير متاحة حاليًا."); return true; }
  const id = crypto.randomUUID();
  const challengerName = displayName(ctx.from), opponentName = displayName(target);
  await pool.query(
    "INSERT INTO connect4_challenges(id,chat_id,challenger_id,challenger_name,opponent_id,opponent_name,wager) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, ctx.chat.id, ctx.from.id, challengerName, target.id, opponentName, wager]
  );
  const text = "## اللعبة شغالة ↢ كونكت 4\n\nاللاعبين:\n" +
    "• ↢ " + challengerName + "\n• ↢ " + opponentName + "\n\n" +
    "الرهان على كل لاعب: " + formatPoints(wager) + " نقطة\n" +
    "جائزة الفوز: " + formatPoints(wager * 2) + " نقطة🎖️\n\n(بانتظار قبول التحدي)";
  await ctx.reply(text, { reply_markup: { inline_keyboard: [[
    { text: "قبول التحدي", callback_data: "c4a:" + id.replace(/-/g, "") },
    { text: "رفض", callback_data: "c4d:" + id.replace(/-/g, "") }
  ]] } });
  return true;
}

export async function handleConnect4ChallengeCallback(ctx) {
  const data = ctx.callbackQuery?.data || "";
  const [action, rawId] = data.split(":");
  if (!["c4a", "c4d", "c4x"].includes(action) || !rawId) return false;
  if (!pool) { await ctx.answerCallbackQuery({ text: "قاعدة البيانات غير متاحة", show_alert: true }); return true; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const q = await client.query("SELECT * FROM connect4_challenges WHERE id=$1 FOR UPDATE", [rawId]);
    const row = q.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      await ctx.answerCallbackQuery({ text: "التحدي غير موجود.", show_alert: true }); return true;
    }
    const uid = Number(ctx.from.id);
    if (action === "c4d") {
      if (uid !== Number(row.challenger_id) && uid !== Number(row.opponent_id)) {
        await client.query("ROLLBACK"); await ctx.answerCallbackQuery({ text: "هذا التحدي ليس لك.", show_alert: true }); return true;
      }
      if (row.status !== "pending") {
        await client.query("ROLLBACK"); await ctx.answerCallbackQuery({ text: "انتهى هذا التحدي.", show_alert: true }); return true;
      }
      await client.query("UPDATE connect4_challenges SET status='declined',updated_at=NOW() WHERE id=$1", [rawId]);
      await client.query("COMMIT");
      await ctx.editMessageText("تم رفض تحدي كونكت 4.", { reply_markup: { inline_keyboard: [] } });
      await ctx.answerCallbackQuery({ text: "تم رفض التحدي." }); return true;
    }
    if (action === "c4a") {
      if (uid !== Number(row.opponent_id)) {
        await client.query("ROLLBACK"); await ctx.answerCallbackQuery({ text: "اللاعب المدعو فقط يقدر يقبل التحدي.", show_alert: true }); return true;
      }
      if (row.status !== "pending") {
        await client.query("ROLLBACK"); await ctx.answerCallbackQuery({ text: "هذا التحدي لم يعد متاحًا.", show_alert: true }); return true;
      }
      const ids = [Number(row.challenger_id), Number(row.opponent_id)].sort((a, b) => a - b);
      for (const id of ids) await client.query("INSERT INTO points(user_id,points) VALUES($1,0) ON CONFLICT(user_id) DO NOTHING", [id]);
      const balances = await client.query("SELECT user_id,points FROM points WHERE user_id=ANY($1::bigint[]) ORDER BY user_id FOR UPDATE", [ids]);
      const map = new Map(balances.rows.map(x => [Number(x.user_id), Number(x.points)]));
      if ((map.get(Number(row.challenger_id)) || 0) < Number(row.wager)) {
        await client.query("ROLLBACK"); await ctx.answerCallbackQuery({ text: "صاحب التحدي ما عنده رصيد كافٍ للرهان.", show_alert: true }); return true;
      }
      if ((map.get(Number(row.opponent_id)) || 0) < Number(row.wager)) {
        await client.query("ROLLBACK"); await ctx.answerCallbackQuery({ text: "أنت ما عندك رصيد كافٍ للرهان.", show_alert: true }); return true;
      }
      await client.query("UPDATE points SET points=points-$2 WHERE user_id=ANY($1::bigint[])", [ids, Number(row.wager)]);
      await client.query("UPDATE connect4_challenges SET status='choosing',updated_at=NOW() WHERE id=$1", [rawId]);
      await client.query("COMMIT");
      const me = await ctx.api.getMe();
      const url = "https://t.me/" + me.username + "?startapp=c4c_" + rawId;
      await ctx.editMessageText(
        "✅ تم قبول تحدي كونكت 4 وحُجز الرهان.\n\n" +
        "اللاعبين: " + row.challenger_name + " × " + row.opponent_name + "\n" +
        "افتحوا الميني آب من الزر بالأسفل، واختاروا حجر ورقة مقص لتحديد من يبدأ.\n\nبعدها تبدأ مباراة كونكت 4 مباشرة.",
        { reply_markup: { inline_keyboard: [[{ text: "🎮 فتح الميني آب — حجر ورقة مقص", url }]] } }
      );
      await ctx.answerCallbackQuery({ text: "تم قبول التحدي! افتحوا الميني آب." }); return true;
    }
    if (action === "c4x") {
      if (uid !== Number(row.challenger_id) && uid !== Number(row.opponent_id)) {
        await client.query("ROLLBACK"); await ctx.answerCallbackQuery({ text: "هذا التحدي ليس لك.", show_alert: true }); return true;
      }
      if (row.status !== "choosing" || row.challenger_choice || row.opponent_choice) {
        await client.query("ROLLBACK"); await ctx.answerCallbackQuery({ text: "لا يمكن إلغاء التحدي في هذه المرحلة.", show_alert: true }); return true;
      }
      const ids = [Number(row.challenger_id), Number(row.opponent_id)];
      await client.query("UPDATE points SET points=points+$2 WHERE user_id=ANY($1::bigint[])", [ids, Number(row.wager)]);
      await client.query("UPDATE connect4_challenges SET status='cancelled',updated_at=NOW() WHERE id=$1", [rawId]);
      await client.query("COMMIT");
      await ctx.editMessageText("تم إلغاء تحدي كونكت 4 وإرجاع الرهان للاعبين.");
      await ctx.answerCallbackQuery({ text: "تم إرجاع الرهان." }); return true;
    }
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Connect4 challenge callback failed:", error);
    await ctx.answerCallbackQuery({ text: "تعذر تنفيذ الطلب.", show_alert: true }); return true;
  } finally { client.release(); }
}