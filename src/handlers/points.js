import {
  addPoints,
  deductPoints,
  getPoints,
  getPointsLeaderboard,
  sellPointsForMessages,
} from "../points.js";

const OWNER_ID = 8453977662;
const POINTS_PER_MESSAGE = 10;

function amountFrom(text, pattern) {
  const match = text.trim().match(pattern);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export async function handlePointsMessage(ctx) {
  const message = ctx.message;
  const user = ctx.from;
  const text = message?.text?.trim();
  if (!text || !user || text.startsWith("/")) return false;

  if (text === "نقاطي") {
    const points = await getPoints(user.id);
    await ctx.reply(`🏆 نقاطك الحالية: ${points}`);
    return true;
  }

  const sellAmount = amountFrom(text, /^بيع نقاطي\s+(\d+)$/);
  if (sellAmount !== null) {
    const result = await sellPointsForMessages(user, sellAmount, POINTS_PER_MESSAGE);
    if (!result) {
      const current = await getPoints(user.id);
      await ctx.reply(
        `❌ ما عندك نقاط كافية.\n\n🏆 نقاطك الحالية: ${current}\n💰 المطلوب: ${sellAmount}`
      );
    } else {
      await ctx.reply(
        `✅ تم بيع ${sellAmount} نقطة.\n\n💬 حصلت على ${result.messages} رسالة.\n🏆 نقاطك المتبقية: ${result.remainingPoints}`
      );
    }
    return true;
  }

  const addAmount = amountFrom(text, /^اضف\s+(\d+)$/);
  if (addAmount !== null) {
    if (user.id !== OWNER_ID) {
      await ctx.reply("❌ هذا الأمر مخصص للمالك فقط.");
      return true;
    }
    const target = message.reply_to_message?.from ?? user;
    const balance = await addPoints(target, addAmount);
    const targetName = target.first_name || "المستخدم";
    await ctx.reply(
      message.reply_to_message
        ? `✅ تمت إضافة ${addAmount} نقطة إلى ${targetName}.\n\n🏆 نقاطه الآن: ${balance}`
        : `✅ تمت إضافة ${addAmount} نقطة لك.\n\n🏆 نقاطك الآن: ${balance}`
    );
    return true;
  }

  const removeAmount = amountFrom(text, /^خصم\s+(\d+)$/);
  if (removeAmount !== null) {
    if (user.id !== OWNER_ID) {
      await ctx.reply("❌ هذا الأمر مخصص للمالك فقط.");
      return true;
    }
    const target = message.reply_to_message?.from;
    if (!target) {
      await ctx.reply("❌ يجب استخدام الأمر بالرد على الشخص.");
      return true;
    }
    const remaining = await deductPoints(target, removeAmount);
    if (remaining === null) {
      const current = await getPoints(target.id);
      await ctx.reply(
        `❌ لا يمكن الخصم.\n\n🏆 نقاطه الحالية: ${current}\n💰 المطلوب خصمه: ${removeAmount}`
      );
    } else {
      await ctx.reply(`✅ تم خصم ${removeAmount} نقطة من ${target.first_name || "المستخدم"}.\n\n🏆 نقاطه المتبقية: ${remaining}`);
    }
    return true;
  }

  if (text === "توب النقاط") {
    const rows = await getPointsLeaderboard(10);
    if (!rows.length) {
      await ctx.reply("❌ لا يوجد ترتيب حتى الآن");
    } else {
      const lines = ["🏆 ترتيب اللاعبين", ""];
      rows.forEach((row, index) => {
        lines.push(`${index + 1} - ${row.first_name || "مستخدم"} : ${row.points || 0} نقطة`);
      });
      await ctx.reply(lines.join("\n"));
    }
    return true;
  }

  return false;
}
