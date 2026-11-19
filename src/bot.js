import { Bot } from "grammy";
import { handlePointsMessage } from "./handlers/points.js";
import { recordGroupTextMessage } from "./activity.js";
import { handleActivityCommand, handleTopCallback } from "./handlers/activity-commands.js";
import { handleRankCommand } from "./handlers/ranks.js";
import { handleResetCommand, handleResetCallback } from "./handlers/reset-stats.js";
import { handleRoleManagementCommand, handleRolesClearCallback } from "./handlers/role-management.js";
import { handleCommandLockFlow, enforceCommandLock, handleUserPermissionCommand } from "./handlers/command-permissions.js";
import { handleReplyManagement, checkAutoReplies, hasReplySession } from "./replies.js";
import { handleBlockedWords, handleBlockedWordCallback, hasBlockedWordSession, cleanupBlockedWarningsLoop } from "./handlers/blocked-words.js";
import { handleModerationCommand, handleModerationCallback, handleRepetitionPunishmentCallback, handleMutedMessage, moderationExpiryLoop } from "./handlers/moderation.js";
import { handleRepetitionCommand, handleRepetitionMessage } from "./handlers/repetition.js";
import { handleDeleteMessages } from "./handlers/delete-messages.js";
import { handleUserIdCommand } from "./handlers/user-id.js";
import { handleProfileReplies } from "./profile-replies.js";
import { handleEconomyMessage, handleEconomyCallback } from "./handlers/economy.js";
import { handleEconomyExtraMessage, handleEconomyExtraCallback } from "./handlers/economy-extra.js";

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

  bot.callbackQuery(/^tasliyat:bank:/, handleEconomyCallback);
  bot.callbackQuery(/^tasliyat:transfer_message:/, handleEconomyExtraCallback);
  bot.callbackQuery(/^topmenu:/, handleTopCallback);
  bot.callbackQuery(/^statsreset:/, handleResetCallback);
  bot.callbackQuery(/^roles_clear:/, handleRolesClearCallback);
  bot.callbackQuery(/^bw:/, handleBlockedWordCallback);
  bot.callbackQuery(/^moderation:clear:/, handleModerationCallback);
  bot.callbackQuery(/^repetition_punish:/, handleRepetitionPunishmentCallback);

  bot.command("ping", async (ctx) => {
    await ctx.reply("البوت يعمل ✅");
  });

  bot.on("message", async (ctx) => {
    try {
      recordGroupTextMessage(ctx);
      if (await handleMutedMessage(ctx)) return;
      if (hasBlockedWordSession(ctx.from?.id, ctx.chat?.id) || await handleBlockedWords(ctx)) return;
      if (await handleCommandLockFlow(ctx)) return;

      if (hasReplySession(ctx.from?.id)) {
        await handleReplyManagement(ctx);
        return;
      }

      if (typeof ctx.message?.text !== "string") return;
      if (await handleUserPermissionCommand(ctx)) return;
      if (await handleEconomyExtraMessage(ctx)) return;
      if (await handleEconomyMessage(ctx)) return;
      if (await handleProfileReplies(ctx)) return;
      if (await enforceCommandLock(ctx)) return;
      if (await handleReplyManagement(ctx)) return;

      if (await handleRepetitionCommand(ctx)) return;
      await handleRoleManagementCommand(ctx);
      if (await handleModerationCommand(ctx)) return;
      if (await handleDeleteMessages(ctx)) return;
      if (await handleUserIdCommand(ctx)) return;
      await handleResetCommand(ctx);
      await handleRankCommand(ctx);
      await handleActivityCommand(ctx);
      await handlePointsMessage(ctx);
      await checkAutoReplies(ctx);
      await handleRepetitionMessage(ctx);
    } catch (error) {
      console.error("Message handler failed:", error);
      try { await ctx.reply("❌ حصل خطأ أثناء تنفيذ الأمر، حاول مرة ثانية."); } catch {}
    }
  });

  cleanupBlockedWarningsLoop().catch(error => console.error("Blocked warnings loop failed:", error));
  moderationExpiryLoop(bot).catch(error => console.error("Moderation expiry loop failed:", error));
  bot.catch((err) => console.error("Telegram bot error:", err));
  return bot;
}
