import { InlineKeyboard } from "grammy";
import { pool } from "../db.js";
import { flushPendingActivity } from "../activity.js";
import { OWNER_ID } from "../ranks.js";

const confirm = (action) => new InlineKeyboard()
  .text("تأكيد التصفير", `statsreset:yes:${action}`)
  .row()
  .text("إلغاء", "statsreset:no");

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}

export async function handleResetCommand(ctx) {
  const text = ctx.message?.text?.trim();
  if (!["تصفير المتفاعلين", "تصفير المتفاعلين عام", "تصفير النقاط"].includes(text)) return false;
  if (ctx.from?.id !== OWNER_ID) {
    await ctx.reply("❌ هذا الأمر مخصص للمالك فقط.");
    return true;
  }
  if (text === "تصفير المتفاعلين" && !["group", "supergroup"].includes(ctx.chat?.type)) {
    await ctx.reply("❌ استخدم هذا الأمر داخل القروب المطلوب.");
    return true;
  }

  const action = text === "تصفير المتفاعلين"
    ? "active_local"
    : text === "تصفير المتفاعلين عام" ? "active_global" : "points";
  const prompt = action === "active_local"
    ? "⚠️ بتصفر توب المتفاعلين في هذا القروب فقط. متأكد؟"
    : action === "active_global"
      ? "⚠️ بتصفر توب المتفاعلين العام في كل القروبات. متأكد؟"
      : "⚠️ بتصفر نقاط جميع المستخدمين فقط، بدون تغيير أي بيانات ثانية. متأكد؟";
  await ctx.reply(prompt, { reply_markup: confirm(action) });
  return true;
}

export async function handleResetCallback(ctx) {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("statsreset:")) return;
  if (ctx.from?.id !== OWNER_ID) {
    await ctx.answerCallbackQuery({ text: "هذا الزر مخصص للمالك فقط.", show_alert: true });
    return;
  }
  if (data === "statsreset:no") {
    await ctx.answerCallbackQuery({ text: "تم الإلغاء" });
    await ctx.editMessageText("تم إلغاء التصفير.");
    return;
  }
  if (!data.startsWith("statsreset:yes:")) {
    await ctx.answerCallbackQuery();
    return;
  }

  const action = data.slice("statsreset:yes:".length);
  await flushPendingActivity();
  if (action === "active_local") {
    const chat = ctx.callbackQuery.message?.chat;
    if (!chat || !["group", "supergroup"].includes(chat.type)) {
      await ctx.answerCallbackQuery({ text: "تعذر تحديد القروب.", show_alert: true });
      return;
    }
    await db().query(
      "UPDATE chat_activity SET message_count=0, updated_at=NOW() WHERE chat_id=$1",
      [String(chat.id)]
    );
    await ctx.answerCallbackQuery({ text: "تم التصفير" });
    await ctx.editMessageText("✅ تم تصفير توب المتفاعلين في هذا القروب.");
    return;
  }

  if (action === "active_global") {
    const client = await db().connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE users SET activity_messages=0, updated_at=NOW()");
      await client.query("UPDATE chat_activity SET message_count=0, updated_at=NOW()");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await ctx.answerCallbackQuery({ text: "تم التصفير" });
    await ctx.editMessageText("✅ تم تصفير توب المتفاعلين العام في كل القروبات.");
    return;
  }

  if (action === "points") {
    await db().query("UPDATE points SET points=0");
    await ctx.answerCallbackQuery({ text: "تم التصفير" });
    await ctx.editMessageText("✅ تم تصفير نقاط جميع المستخدمين فقط.");
    return;
  }

  await ctx.answerCallbackQuery({ text: "طلب غير معروف.", show_alert: true });
}
