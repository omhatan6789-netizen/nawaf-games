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
import { handleMandatorySubscriptionCommand, enforceMandatorySubscription, recordPrivateStart } from "./mandatory-subscription.js";
import { handleEmojiReactionsMessage } from "./emoji-reactions.js";
import { handleStartCommand, handleStartEditorCommand, handleStartEditorCallback, handleStartEditorMessage } from "./start-editor.js";
import { handleDeveloperPanelCommand, handleDeveloperPanelCallback, handleDeveloperPanelMessage, trackDeveloperBotChat } from "./developer-panel.js";
import { handleGamesManagerMessage } from "./handlers/games-manager.js";
import { handleInlineGamesQuery } from "./inline-games.js";
import { handleCustomCommandManagement, resolveCustomAlias, hasCustomCommandSession } from "./custom-commands.js";
import { handleTemporaryMessages, handleTemporaryMessageCallback, startTemporaryMessageScheduler } from "./temporary-messages.js";
import { handleWhisperMessage, handleWhisperStart, handleWhisperCallback } from "./whispers.js";
import { handleYouTubeAudioMessage, handleYouTubeAudioCallback } from "./youtube-audio.js";
import { handleCommandsMenuMessage, handleCommandsMenuCallback } from "./commands-menu.js";

const aliasExecutionKeys = new Set();

export function createBot() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.warn("BOT_TOKEN is not set; Telegram bot polling is disabled.");
    return null;
  }

  const bot = new Bot(token);

  // In groups, attach normal bot replies to the message that triggered them.
  bot.use(async (ctx, next) => {
    if (["group", "supergroup"].includes(ctx.chat?.type) && ctx.msg?.message_id) {
      const originalReply = ctx.reply.bind(ctx);
      ctx.reply = (text, other = {}, ...rest) => originalReply(text, {
        ...other,
        reply_parameters: other?.reply_parameters ?? { message_id: ctx.msg.message_id },
      }, ...rest);
    }
    await next();
  });

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

  // Re-dispatch aliases as a fresh Telegram update so every handler type,
  // including multi-step and dedicated command handlers, runs normally.
  bot.use(async (ctx, next) => {
    const message = ctx.message;
    if (!message?.text || !ctx.chat?.id || !message.message_id) return next();
    // A pending add/delete flow must receive the exact text the user sends,
    // even when that text happens to match an existing alias.
    if (hasCustomCommandSession(ctx.from?.id)) return next();
    const managementText = message.text.trim().replace(/\s+/g, " ");
    if (["اضف امر", "مسح امر", "الاوامر المضافة", "مسح الاوامر المضافة"].includes(managementText)) return next();
    const key = `${ctx.chat.id}:${message.message_id}`;
    if (aliasExecutionKeys.has(key)) return next();

    let originalCommand = null;
    try {
      originalCommand = await resolveCustomAlias(message.text);
    } catch (error) {
      console.error("Loading custom command aliases failed:", error);
      return next();
    }
    if (!originalCommand || originalCommand === message.text) return next();

    aliasExecutionKeys.add(key);
    try {
      await bot.handleUpdate({
        ...ctx.update,
        message: { ...message, text: originalCommand },
      });
    } finally {
      aliasExecutionKeys.delete(key);
    }
  });

  bot.on("inline_query", handleInlineGamesQuery);
  bot.callbackQuery(/^tmp:/, handleTemporaryMessageCallback);
  bot.callbackQuery(/^wh_(temp|open):/, handleWhisperCallback);
  bot.callbackQuery(/^ytpick:/, handleYouTubeAudioCallback);
  bot.callbackQuery(/^cmdmenu:/, async (ctx) => { await handleCommandsMenuCallback(ctx); });

  bot.command("start", async (ctx) => {
    if (await handleWhisperStart(ctx)) return;
    try { await recordPrivateStart(ctx); }
    catch (error) { console.error("Recording private /start failed:", error); }
    await handleStartCommand(ctx);
  });

  bot.callbackQuery(/^tasliyat:bank:/, handleEconomyCallback);
  bot.callbackQuery(/^tasliyat:transfer_message:/, handleEconomyExtraCallback);
  bot.callbackQuery(/^topmenu:/, handleTopCallback);
  bot.callbackQuery(/^statsreset:/, handleResetCallback);
  bot.callbackQuery(/^roles_clear:/, handleRolesClearCallback);
  bot.callbackQuery(/^bw:/, handleBlockedWordCallback);
  bot.callbackQuery(/^moderation:clear:/, handleModerationCallback);
  bot.callbackQuery(/^repetition_punish:/, handleRepetitionPunishmentCallback);
  bot.callbackQuery(/^startedit:/, handleStartEditorCallback);
  bot.callbackQuery(/^devpanel:/, handleDeveloperPanelCallback);
  bot.on("my_chat_member", trackDeveloperBotChat);
  bot.hears("تعديل ستارت", handleStartEditorCommand);

  bot.command("help", handleCommandsMenuMessage);

  bot.command("ping", async (ctx) => {
    await ctx.reply("البوت يعمل ✅");
  });

  bot.on("message", async (ctx) => {
    try {
      if (await handleCustomCommandManagement(ctx)) return;
      if (await handleTemporaryMessages(ctx)) return;
      if (await handleWhisperMessage(ctx)) return;
      if (await handleYouTubeAudioMessage(ctx)) return;
      if (await handleDeveloperPanelMessage(ctx)) return;
      if (await handleStartEditorMessage(ctx)) return;
      if (await handleDeveloperPanelCommand(ctx)) return;
      if (await handleMandatorySubscriptionCommand(ctx)) return;
      if (await enforceMandatorySubscription(ctx)) return;
      if (await handleEmojiReactionsMessage(ctx)) return;
      if (await handleGamesManagerMessage(ctx)) return;
      recordGroupTextMessage(ctx);
      if (await handleMutedMessage(ctx)) return;
      if (hasBlockedWordSession(ctx.from?.id, ctx.chat?.id) || await handleBlockedWords(ctx)) return;
      if (await handleCommandLockFlow(ctx)) return;

      if (hasReplySession(ctx.from?.id)) {
        await handleReplyManagement(ctx);
        return;
      }

      if (await handleEconomyExtraMessage(ctx)) return;
      if (typeof ctx.message?.text !== "string") return;
      if (await handleUserPermissionCommand(ctx)) return;
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

  startTemporaryMessageScheduler(bot.api);
  cleanupBlockedWarningsLoop().catch(error => console.error("Blocked warnings loop failed:", error));
  moderationExpiryLoop(bot).catch(error => console.error("Moderation expiry loop failed:", error));
  bot.catch((err) => console.error("Telegram bot error:", err));
  return bot;
}
