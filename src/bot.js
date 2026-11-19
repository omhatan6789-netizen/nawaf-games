import { Bot } from "grammy";

export function createBot() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.warn("BOT_TOKEN is not set; Telegram bot polling is disabled.");
    return null;
  }

  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await ctx.reply("هلا! هذا بوت نواف بنسخته الجديدة. جاري نقل المميزات تدريجيًا.");
  });

  bot.command("ping", async (ctx) => {
    await ctx.reply("البوت يعمل ✅");
  });

  bot.catch((err) => console.error("Telegram bot error:", err));
  return bot;
}
