import { Bot } from "grammy";
import { handlePointsMessage } from "./handlers/points.js";
import { recordGroupTextMessage } from "./activity.js";

export function createBot() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.warn("BOT_TOKEN is not set; Telegram bot polling is disabled.");
    return null;
  }

  const bot = new Bot(token);

  // Delete slash-prefixed messages after their handlers have run.
  bot.use(async (ctx, next) => {
    await next();
    const text = ctx.message?.text;
    if (typeof text === "string" && text.startsWith("/")) {
      try {
        await ctx.deleteMessage();
      } catch (error) {
        console.warn("Could not delete slash command:", error?.description || error?.message);
      }
    }
  });

  bot.command("start", async (ctx) => {
    await ctx.reply("هلا! هذا بوت نواف بنسخته الجديدة. جاري نقل المميزات تدريجيًا.");
  });

  bot.command("ping", async (ctx) => {
    await ctx.reply("البوت يعمل ✅");
  });

  bot.on("message:text", async (ctx) => {
    try {
      recordGroupTextMessage(ctx);
    } catch (error) {
      console.error("Message activity tracking failed:", error);
    }
    try {
      await handlePointsMessage(ctx);
    } catch (error) {
      console.error("Points command failed:", error);
      await ctx.reply("❌ حصل خطأ أثناء تنفيذ الأمر، حاول مرة ثانية.");
    }
  });

  bot.catch((err) => console.error("Telegram bot error:", err));
  return bot;
}
