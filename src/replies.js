import { pool } from "./db.js";
import { getRank, getRankLevel, getDeveloperType } from "./ranks.js";

const sessions = new Map();
let normalCache = null;
let specialCache = null;
const PLACEHOLDERS = ["#الاسم", "#يوزره", "#اليوزر", "#الرسائل", "#الايدي", "#الرتبه", "#التعديل", "#النقاط"];

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}
function isAdmin(userId) {
  return getDeveloperType(userId).then(dev => Boolean(dev)).then(async dev => dev || (await getRankLevel(userId, null)) >= 2);
}
function invalidateCache() {
  normalCache = null;
  specialCache = null;
}
async function loadCache() {
  if (normalCache && specialCache) return;
  const [normal, special] = await Promise.all([
    db().query("SELECT name, text, type, caption, entities FROM replies ORDER BY name"),
    db().query("SELECT name, text, type, caption, entities FROM special_replies ORDER BY name"),
  ]);
  normalCache = new Map(normal.rows.map(row => [row.name, {
    text: row.text, type: row.type, caption: row.caption, entities: row.entities,
  }]));
  specialCache = special.rows.map(row => ({
    name: row.name, text: row.text, type: row.type, caption: row.caption, entities: row.entities,
  }));
}
function parseMetadata(value) {
  if (!value) return { entities: undefined, sourceChatId: null, sourceMessageId: null, copyable: false };
  let data = value;
  if (typeof value === "string") {
    try { data = JSON.parse(value); } catch { data = null; }
  }
  if (Array.isArray(data)) return { entities: data, sourceChatId: null, sourceMessageId: null, copyable: false };
  if (!data || typeof data !== "object") return { entities: undefined, sourceChatId: null, sourceMessageId: null, copyable: false };
  return {
    entities: Array.isArray(data.entities) ? data.entities : undefined,
    sourceChatId: data.source_chat_id ?? null,
    sourceMessageId: data.source_message_id ?? null,
    copyable: Boolean(data.copyable),
  };
}
function extractMessageContent(message, allowSticker = false) {
  if (typeof message.text === "string") {
    const text = message.text;
    const entities = (message.entities || []).map(entity => ({
      type: entity.type, offset: entity.offset, length: entity.length,
      ...(entity.url ? { url: entity.url } : {}),
      ...(entity.language ? { language: entity.language } : {}),
      ...(entity.custom_emoji_id ? { custom_emoji_id: entity.custom_emoji_id } : {}),
      ...(entity.user?.id ? { user: { id: entity.user.id, is_bot: entity.user.is_bot, first_name: entity.user.first_name } } : {}),
    }));
    const copyable = !PLACEHOLDERS.some(token => text.includes(token));
    return {
      content: text, type: "text", caption: null,
      metadata: { entities, source_chat_id: message.chat.id, source_message_id: message.message_id, copyable },
    };
  }
  if (message.photo?.length) return { content: message.photo[message.photo.length - 1].file_id, type: "photo", caption: message.caption ?? null, metadata: null };
  if (message.video) return { content: message.video.file_id, type: "video", caption: message.caption ?? null, metadata: null };
  if (message.animation) return { content: message.animation.file_id, type: "animation", caption: message.caption ?? null, metadata: null };
  if (allowSticker && message.sticker) return { content: message.sticker.file_id, type: "sticker", caption: null, metadata: null };
  if (message.voice) return { content: message.voice.file_id, type: "voice", caption: null, metadata: null };
  if (message.audio) return { content: message.audio.file_id, type: "audio", caption: message.caption ?? null, metadata: null };
  if (message.document) return { content: message.document.file_id, type: "document", caption: message.caption ?? null, metadata: null };
  return null;
}
async function saveReply(name, item, special) {
  const table = special ? "special_replies" : "replies";
  await db().query(
    `INSERT INTO ${table}(name,text,type,caption,entities)
     VALUES($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT(name) DO UPDATE SET text=EXCLUDED.text,type=EXCLUDED.type,
       caption=EXCLUDED.caption,entities=EXCLUDED.entities`,
    [name, item.content, item.type, item.caption, item.metadata ? JSON.stringify(item.metadata) : null]
  );
  invalidateCache();
}
async function deleteReply(name, special) {
  const table = special ? "special_replies" : "replies";
  const result = await db().query(`DELETE FROM ${table} WHERE name=$1`, [name]);
  if (result.rowCount) invalidateCache();
  return result.rowCount;
}
async function startSession(ctx, mode, special) {
  if (!(await isAdmin(ctx.from.id))) {
    await ctx.reply(special ? "❌ هذا الأمر للإدارة فقط." : "❌ ليس لديك صلاحية.");
    return true;
  }
  sessions.set(ctx.from.id, { mode, special, step: mode === "delete" ? "name" : "name" });
  const prompt = mode === "add"
    ? special ? "⭐ أرسل اسم الرد المميز" : "حسنًا، أرسل اسم الرد"
    : mode === "edit"
      ? special ? "⭐ أرسل اسم الرد المميز الذي تريد تعديله" : "✏️ أرسل اسم الرد الذي تريد تعديله"
      : special ? "⭐ أرسل اسم الرد المميز الذي تريد حذفه" : "🗑️ أرسل اسم الرد الذي تريد حذفه";
  await ctx.reply(prompt);
  return true;
}
async function handleSession(ctx, session) {
  const message = ctx.message;
  const text = message.text?.trim();
  const trigger = session.mode === "add"
    ? session.special ? "اضف رد مميز" : "اضف رد"
    : session.mode === "edit"
      ? session.special ? "تعديل رد مميز" : "تعديل رد"
      : session.special ? "مسح رد مميز" : "مسح رد";
  if (text === trigger) return true;

  if (session.step === "name") {
    if (!text) {
      await ctx.reply("❌ أرسل اسم الرد كنص.");
      return true;
    }
    if (session.mode === "edit") {
      const table = session.special ? "special_replies" : "replies";
      const exists = await db().query(`SELECT 1 FROM ${table} WHERE name=$1`, [text]);
      if (!exists.rowCount) {
        sessions.delete(ctx.from.id);
        await ctx.reply(session.special ? "❌ لا يوجد رد مميز بهذا الاسم." : "❌ لا يوجد رد بهذا الاسم.");
        return true;
      }
    }
    if (session.mode === "delete") {
      const deleted = await deleteReply(text, session.special);
      sessions.delete(ctx.from.id);
      await ctx.reply(deleted
        ? session.special ? `✅ تم حذف الرد المميز: ${text}` : `✅ تم حذف الرد: ${text}`
        : session.special ? "❌ لم أجد ردًا مميزًا بهذا الاسم." : "❌ لا يوجد رد بهذا الاسم.");
      return true;
    }
    session.name = text;
    session.step = "content";
    await ctx.reply(
      "• حسنًا، أرسل محتوى الرد الآن\n" +
      (session.special ? "(نص، صورة، فيديو، متحركة، بصمة، أغنية، ملف، ملصق)" : "(نص، صورة، فيديو، متحركة، بصمة، أغنية، ملف)") +
      "\n\nيمكنك استخدام المتغيرات:\n" +
      "▹ #الاسم - اسم العضو\n▹ #يوزره - يوزر العضو\n▹ #اليوزر - يوزر مرسل الرسالة\n" +
      "▹ #الرسائل - عدد رسائله\n▹ #الايدي - آيدي العضو\n▹ #الرتبه - رتبته\n" +
      "▹ #التعديل - عدد تعديلاته\n▹ #النقاط - نقاطه"
    );
    return true;
  }

  if (session.step === "content") {
    const item = extractMessageContent(message, session.special);
    if (!item) {
      await ctx.reply("❌ هذا النوع غير مدعوم.");
      return true;
    }
    if (session.special && item.type === "audio") item.caption = null;
    await saveReply(session.name, item, session.special);
    sessions.delete(ctx.from.id);
    await ctx.reply(session.mode === "edit"
      ? session.special ? `⭐ تم تعديل الرد المميز: ${session.name}` : `✅ تم تعديل الرد: ${session.name}`
      : session.special ? `⭐ تم حفظ الرد المميز: ${session.name}` : `✅ تم إضافة الرد: ${session.name}`);
    return true;
  }
  return false;
}

export function hasReplySession(userId) {
  return sessions.has(Number(userId));
}

export async function handleReplyManagement(ctx) {
  const message = ctx.message;
  const user = ctx.from;
  if (!message || !user) return false;
  const text = message.text?.trim();
  const session = sessions.get(user.id);
  if (session) return handleSession(ctx, session);
  if (!text) return false;

  if (text === "اضف رد") return startSession(ctx, "add", false);
  if (text === "اضف رد مميز") return startSession(ctx, "add", true);
  if (text === "تعديل رد") return startSession(ctx, "edit", false);
  if (text === "تعديل رد مميز") return startSession(ctx, "edit", true);
  if (text === "مسح رد") return startSession(ctx, "delete", false);
  if (text === "مسح رد مميز") return startSession(ctx, "delete", true);

  if (text === "الردود" || text === "الردود المميزة") {
    if (!(await isAdmin(user.id))) {
      await ctx.reply("❌ ليس لديك صلاحية.");
      return true;
    }
    const special = text === "الردود المميزة";
    const table = special ? "special_replies" : "replies";
    const result = await db().query(`SELECT name FROM ${table} ORDER BY name`);
    if (!result.rows.length) {
      await ctx.reply(special ? "📭 لا توجد ردود مميزة." : "📭 لا يوجد ردود.");
      return true;
    }
    await ctx.reply((special ? "⭐ قائمة الردود المميزة:\n\n" : "📋 الردود:\n\n") +
      result.rows.map(row => `• ${row.name}`).join("\n"));
    return true;
  }

  if (text === "مسح الردود" || text === "مسح الردود المميزة") {
    if (!(await isAdmin(user.id))) {
      await ctx.reply("❌ ليس لديك صلاحية.");
      return true;
    }
    const special = text === "مسح الردود المميزة";
    const table = special ? "special_replies" : "replies";
    const result = await db().query(`DELETE FROM ${table}`);
    invalidateCache();
    await ctx.reply(special ? `⭐ تم حذف جميع الردود المميزة (${result.rowCount}).` : `✅ تم حذف جميع الردود العادية (${result.rowCount}).`);
    return true;
  }
  return false;
}

function replaceUserData(value, user, messages, rank, points) {
  if (!value) return value;
  const username = user.username ? `@${user.username}` : "لا يوجد";
  return value
    .replaceAll("#الاسم", user.first_name || "مستخدم")
    .replaceAll("#يوزره", username)
    .replaceAll("#اليوزر", username)
    .replaceAll("#الرسائل", String(messages))
    .replaceAll("#الايدي", String(user.id))
    .replaceAll("#الرتبه", rank)
    .replaceAll("#التعديل", "0")
    .replaceAll("#النقاط", String(points));
}
async function replyUserData(user, content, caption) {
  const needs = ["#الرسائل", "#الرتبه", "#النقاط"].some(token => (content || "").includes(token) || (caption || "").includes(token));
  if (!needs) return { messages: 0, rank: "عضو", points: 0 };
  const [userRow, pointRow] = await Promise.all([
    db().query("SELECT messages FROM users WHERE user_id=$1", [String(user.id)]),
    db().query("SELECT points FROM points WHERE user_id=$1", [String(user.id)]),
  ]);
  return {
    messages: Number(userRow.rows[0]?.messages ?? 0),
    rank: await getRank(user.id, null),
    points: Number(pointRow.rows[0]?.points ?? 0),
  };
}
async function sendReply(ctx, row, user) {
  const metadata = parseMetadata(row.entities);
  const data = await replyUserData(user, row.text, row.caption);
  const content = replaceUserData(row.text, user, data.messages, data.rank, data.points);
  const caption = replaceUserData(row.caption, user, data.messages, data.rank, data.points);
  if (row.type === "text") {
    if (metadata.copyable && metadata.sourceChatId && metadata.sourceMessageId) {
      try {
        await ctx.api.copyMessage(ctx.chat.id, Number(metadata.sourceChatId), Number(metadata.sourceMessageId), {
          reply_parameters: { message_id: ctx.message.message_id },
        });
        return;
      } catch {}
    }
    await ctx.reply(content, {
      ...(metadata.entities ? { entities: metadata.entities } : {}),
      reply_parameters: { message_id: ctx.message.message_id },
    });
    return;
  }
  const options = {
    ...(caption ? { caption } : {}),
    reply_parameters: { message_id: ctx.message.message_id },
  };
  switch (row.type) {
    case "photo": await ctx.replyWithPhoto(row.text, options); break;
    case "video": await ctx.replyWithVideo(row.text, options); break;
    case "animation": await ctx.replyWithAnimation(row.text, options); break;
    case "sticker": await ctx.replyWithSticker(row.text, { reply_parameters: options.reply_parameters }); break;
    case "voice": await ctx.replyWithVoice(row.text, options); break;
    case "audio": await ctx.replyWithAudio(row.text, options); break;
    case "document": await ctx.replyWithDocument(row.text, options); break;
  }
}

export async function checkAutoReplies(ctx) {
  const message = ctx.message;
  const user = ctx.from;
  if (!message?.text || !user || sessions.has(user.id)) return false;
  await loadCache();
  const lowered = message.text.toLowerCase();
  for (const row of specialCache) {
    if (!lowered.includes(row.name.toLowerCase())) continue;
    await sendReply(ctx, row, user);
    return true;
  }
  const row = normalCache.get(message.text);
  if (!row) return false;
  await sendReply(ctx, row, user);
  return true;
}
