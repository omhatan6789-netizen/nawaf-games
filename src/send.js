import { pool } from "./db.js";
import { OWNER_ID, getRank } from "./ranks.js";

const mediaSessions = new Map();
const MEDIA_TYPES = {
  "صورة": "photo", "صور": "photo",
  "فيديو": "video", "فديو": "video",
  "gif": "animation", "جيف": "animation", "جي اي اف": "animation",
  "ملصق": "sticker", "ستيكر": "sticker",
  "فويس": "voice", "رسالة صوتية": "voice",
  "صوت": "audio", "اغنية": "audio", "أغنية": "audio",
  "ملف": "document", "مستند": "document",
};
const MEDIA_LABELS = {
  photo: "الصورة 📷", video: "الفيديو 🎥", animation: "الـ GIF 🎞️",
  sticker: "الملصق 🧩", voice: "الفويس 🎤", audio: "المقطع الصوتي 🎵",
  document: "الملف 📎",
};
const isPrivate = ctx => ctx.chat?.type === "private";
const escapeHtml = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");

function getMedia(message) {
  if (message.photo?.length) return ["photo", message.photo.at(-1).file_id];
  for (const type of ["video","animation","sticker","voice","audio","document","video_note"]) {
    if (message[type]?.file_id) return [type, message[type].file_id];
  }
  return [null, null];
}
function messageContent(message) {
  return message.text ?? message.caption ?? "";
}
function getTextEntities(source, text) {
  if (!text) return undefined;
  if (source.text != null) {
    const start = source.text.indexOf(text);
    if (start < 0) return undefined;
    return (source.entities || [])
      .filter(entity => entity.offset >= start && entity.offset + entity.length <= start + text.length)
      .map(entity => ({ ...entity, offset: entity.offset - start }));
  }
  return source.caption_entities?.length ? source.caption_entities : undefined;
}
function replaceVariables(value, chat, repliedUser) {
  const targetName = repliedUser
    ? [repliedUser.first_name, repliedUser.last_name].filter(Boolean).join(" ") || repliedUser.username || String(repliedUser.id)
    : chat.title || chat.username && "@" + chat.username || chat.first_name || "";
  return String(value ?? "").replaceAll("#الاسم", targetName).replaceAll("#منشن", targetName);
}
async function sendToChat(api, chatId, source, text, { replyTo, targetChat } = {}) {
  const [type, fileId] = getMedia(source);
  const finalText = replaceVariables(text, targetChat || {}, source.reply_to_message?.from);
  const hasVariables = /#(?:الاسم|منشن)/.test(text || "");
  if (!type) {
    if (!finalText) return null;
    return api.sendMessage(chatId, finalText, {
      entities: !hasVariables ? getTextEntities(source, text) : undefined,
      reply_parameters: replyTo ? { message_id: replyTo, allow_sending_without_reply: true } : undefined,
      link_preview_options: { is_disabled: false },
    });
  }
  const caption = finalText || undefined;
  const common = {
    caption,
    caption_entities: !hasVariables ? getTextEntities(source, text) : undefined,
    reply_parameters: replyTo ? { message_id: replyTo, allow_sending_without_reply: true } : undefined,
  };
  if (type === "photo") return api.sendPhoto(chatId, fileId, common);
  if (type === "video") return api.sendVideo(chatId, fileId, common);
  if (type === "animation") return api.sendAnimation(chatId, fileId, common);
  if (type === "sticker") return api.sendSticker(chatId, fileId, { reply_parameters: common.reply_parameters });
  if (type === "voice") return api.sendVoice(chatId, fileId, common);
  if (type === "audio") return api.sendAudio(chatId, fileId, common);
  if (type === "document") return api.sendDocument(chatId, fileId, common);
  if (type === "video_note") return api.sendVideoNote(chatId, fileId, { reply_parameters: common.reply_parameters });
  return null;
}
async function broadcast(api, source, text) {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  const { rows } = await pool.query(
    "SELECT chat_id,chat_type,title,username FROM developer_bot_chats WHERE active=TRUE AND chat_type IN ('group','supergroup','channel') ORDER BY chat_id"
  );
  let sent = 0, failed = 0;
  for (const target of rows) {
    try {
      await sendToChat(api, Number(target.chat_id), source, text, { targetChat: target });
      sent++;
    } catch (error) {
      failed++;
      console.warn("Broadcast send failed:", target.chat_id, error?.description || error?.message || "unknown");
      if (error?.error_code === 403 || error?.error_code === 400 && /chat not found|bot was kicked|deactivated/i.test(error?.description || "")) {
        await pool.query("UPDATE developer_bot_chats SET active=FALSE,updated_at=NOW() WHERE chat_id=$1", [String(target.chat_id)]).catch(() => {});
      }
    }
    await new Promise(resolve => setTimeout(resolve, 45));
  }
  return { sent, failed, total: rows.length };
}
async function handleWaitingMedia(ctx) {
  const session = mediaSessions.get(ctx.from?.id);
  if (!session || !isPrivate(ctx)) return false;
  if (Number(ctx.from.id) !== OWNER_ID) {
    mediaSessions.delete(ctx.from.id);
    return true;
  }
  const [type] = getMedia(ctx.message);
  if (type !== session.type) {
    mediaSessions.delete(ctx.from.id);
    await ctx.reply("تم إلغاء العملية لاختلاف نوع الوسائط. أرسل /send من جديد.");
    return true;
  }
  mediaSessions.delete(ctx.from.id);
  try {
    const result = await broadcast(ctx.api, ctx.message, messageContent(ctx.message));
    try { await ctx.deleteMessage(); } catch {}
    await ctx.reply(`تمت الإذاعة ✅\n\nنجح الإرسال: ${result.sent}\nفشل الإرسال: ${result.failed}`);
  } catch (error) {
    console.error("Media broadcast failed:", error?.message || error);
    await ctx.reply("❌ تعذر تنفيذ الإذاعة. حاول مرة ثانية.");
  }
  return true;
}

export async function handleSendMessage(ctx) {
  const message = ctx.message;
  if (!message || !ctx.from || !ctx.chat) return false;
  if (await handleWaitingMedia(ctx)) return true;

  const raw = message.text ?? message.caption ?? "";
  const match = raw.match(/^\/send(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return false;
  const payload = (match[1] || "").trim();

  if (isPrivate(ctx)) {
    if (Number(ctx.from.id) !== OWNER_ID) return true;
    const requestedType = MEDIA_TYPES[payload.toLowerCase()];
    if (requestedType) {
      mediaSessions.set(ctx.from.id, { type: requestedType });
      try { await ctx.deleteMessage(); } catch {}
      await ctx.api.sendMessage(ctx.chat.id, `حسنًا، أرسل ${MEDIA_LABELS[requestedType]}.`);
      return true;
    }
    const [type] = getMedia(message);
    if (!payload && !type) {
      await ctx.reply("اكتب نص الإذاعة بعد /send أو اختر نوع الوسائط، مثل /send صورة.");
      return true;
    }
    try {
      const result = await broadcast(ctx.api, message, message.caption ?? payload);
      try { await ctx.deleteMessage(); } catch {}
      await ctx.api.sendMessage(ctx.chat.id,
        `تمت الإذاعة ✅\n\nنجح الإرسال: ${result.sent}\nفشل الإرسال: ${result.failed}\nإجمالي الوجهات: ${result.total}`);
    } catch (error) {
      console.error("Broadcast failed:", error?.message || error);
      await ctx.reply("❌ تعذر تنفيذ الإذاعة. تأكد من قاعدة البيانات وحاول مرة ثانية.");
    }
    return true;
  }

  const rank = await getRank(ctx.from.id, ctx.chat.id);
  if (!["ادمن اساسي","نائب المالك","المالك","Dev"].includes(rank)) return true;
  const [type] = getMedia(message);
  if (!payload && !type) return true;
  const text = message.caption ?? payload;
  try {
    await sendToChat(ctx.api, ctx.chat.id, message, text, {
      replyTo: message.reply_to_message?.message_id,
      targetChat: ctx.chat,
    });
  } catch (error) {
    console.warn("Local /send failed:", error?.description || error?.message || "unknown");
  }
  try { await ctx.deleteMessage(); } catch {}
  return true;
}
