import { InlineKeyboard } from "grammy";
import { randomBytes } from "node:crypto";
import { pool } from "./db.js";
import { getRankLevel, OWNER_ID } from "./ranks.js";

const DRAFT_TTL = 5 * 60 * 1000;
const drafts = new Map();
let schemaPromise;

const db = () => {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
};
const group = ctx => ["group", "supergroup"].includes(ctx.chat?.type);
const token = () => randomBytes(12).toString("base64url");
const nameOf = user => (user?.first_name || user?.username || "مستخدم").trim();
const esc = value => String(value || "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
const mention = (id, name) => `<a href="tg://user?id=${id}">${esc(name)}</a>`;

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = db().query(`
      CREATE TABLE IF NOT EXISTS whispers (
        id TEXT PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        message_id BIGINT NOT NULL DEFAULT 0,
        sender_id BIGINT NOT NULL,
        receiver_id BIGINT NOT NULL,
        sender_name TEXT NOT NULL,
        receiver_name TEXT NOT NULL,
        sender_username TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        temporary BOOLEAN NOT NULL DEFAULT FALSE,
        content TEXT,
        pages JSONB NOT NULL DEFAULT '[]'::jsonb,
        media_type TEXT,
        media_file_id TEXT,
        caption TEXT,
        receiver_opened BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_whispers_created ON whispers(created_at DESC);
      CREATE TABLE IF NOT EXISTS whisper_chat_settings (
        chat_id BIGINT PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT TRUE
      );
    `).catch(error => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

async function whispersEnabled(chatId) {
  const r = await db().query("SELECT enabled FROM whisper_chat_settings WHERE chat_id=$1", [String(chatId)]);
  return r.rows[0]?.enabled !== false;
}
async function canManage(userId, chatId) {
  try { return Number(userId) === OWNER_ID || await getRankLevel(userId, chatId) >= 2; }
  catch { return Number(userId) === OWNER_ID; }
}
function splitPages(value) {
  const max = 180, lines = String(value).split(/\r?\n/), chunks = [];
  let current = [];
  for (let line of lines) {
    while (line.length > max) {
      if (current.length) { chunks.push(current.join("\n")); current = []; }
      chunks.push(line.slice(0, max));
      line = line.slice(max);
    }
    if (current.length >= 6 || (current.join("\n").length + line.length + 1 > max && current.length)) {
      chunks.push(current.join("\n")); current = [];
    }
    current.push(line);
  }
  if (current.length || !chunks.length) chunks.push(current.join("\n"));
  return chunks;
}
function startKeyboard(botName, id) {
  return new InlineKeyboard()
    .url("همسة نصية 💬", `https://t.me/${botName}?start=whisper_text_${id}`)
    .row()
    .url("همسة وسائط 🖼️", `https://t.me/${botName}?start=whisper_media_${id}`);
}
function viewKeyboard(id, senderName, botName, replyToken) {
  return new InlineKeyboard()
    .text("فتح الهمسة", `wh_open:${id}`)
    .row()
    .url(`اهمس لـ ${senderName}`.slice(0, 64), `https://t.me/${botName}?start=whisper_text_${replyToken}`);
}
function privateKeyboard(id, temporary) {
  return new InlineKeyboard().text(temporary ? "🟢 همسة مؤقتة (مفعلة)" : "🔴 همسة مؤقتة (معطلة)", `wh_temp:${id}`);
}
function extractMedia(message, kind) {
  if (kind === "text") {
    if (!message.text || message.text.startsWith("/")) return null;
    const pages = splitPages(message.text);
    if (pages.length > 7) return { tooLong: true };
    return { content: message.text, pages, temporary: false };
  }
  for (const type of ["photo", "animation", "sticker"]) {
    const media = message[type];
    if (!media) continue;
    return { mediaType: type, mediaFileId: type === "photo" ? media.at(-1).file_id : media.file_id, caption: message.caption || null, pages: [], temporary: false };
  }
  return null;
}

export async function handleWhisperStart(ctx) {
  if (ctx.chat?.type !== "private") return false;
  const parts = String(ctx.message?.text || "").trim().split(/\s+/, 2);
  if (parts.length < 2 || !parts[1].startsWith("whisper_")) return false;
  const match = parts[1].match(/^whisper_(text|media)_([A-Za-z0-9_-]+)$/);
  if (!match) return false;
  const [, kind, id] = match;
  const draft = drafts.get(id);
  if (!draft || draft.creatorId !== ctx.from.id || Date.now() - draft.createdAt > DRAFT_TTL) {
    drafts.delete(id);
    await ctx.reply("❌ انتهت جلسة الهمسة، ارجع للقروب واكتب اهمس من جديد.");
    return true;
  }
  draft.kind = kind;
  draft.createdAt = Date.now();
  await ctx.reply("تمام، ارسل همستك الحين.", {
    reply_markup: kind === "text" ? privateKeyboard(id, draft.temporary) : undefined
  });
  return true;
}

export async function handleWhisperCallback(ctx) {
  const data = ctx.callbackQuery?.data || "";
  if (data.startsWith("wh_temp:")) {
    const id = data.slice(8), draft = drafts.get(id);
    if (!draft || Date.now() - draft.createdAt > DRAFT_TTL) {
      await ctx.answerCallbackQuery({ text: "انتهت جلسة الهمسة.", show_alert: true });
      return true;
    }
    if (ctx.from.id !== draft.creatorId || draft.kind !== "text") {
      await ctx.answerCallbackQuery({ text: "هذه الهمسة ليست لك.", show_alert: true });
      return true;
    }
    draft.temporary = !draft.temporary;
    await ctx.answerCallbackQuery({ text: draft.temporary ? "تم تفعيل الهمسة المؤقتة" : "تم إيقاف الهمسة المؤقتة" });
    try { await ctx.editMessageReplyMarkup({ reply_markup: privateKeyboard(id, draft.temporary) }); } catch {}
    return true;
  }
  if (data.startsWith("wh_open:")) {
    await ensureSchema();
    const id = data.slice(8);
    const result = await db().query("SELECT * FROM whispers WHERE id=$1", [id]);
    const w = result.rows[0];
    if (!w) {
      await ctx.answerCallbackQuery({ text: "❌ الهمسة غير موجودة.", show_alert: true });
      return true;
    }
    if (![String(w.sender_id), String(w.receiver_id)].includes(String(ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: "❌ هذه الهمسة ليست لك.", show_alert: true });
      return true;
    }
    if (w.temporary && w.receiver_opened && String(ctx.from.id) === String(w.receiver_id)) {
      await ctx.answerCallbackQuery({ text: "الهمسة اختفت… الهمسة كانت مؤقتة❕", show_alert: true });
      return true;
    }
    if (w.kind === "text") {
      const pages = Array.isArray(w.pages) ? w.pages : [];
      const page = pages[0] || w.content || "";
      const label = pages.length > 1 ? `\n\n📄 الصفحة 1/${pages.length}` : "";
      await ctx.answerCallbackQuery({ text: (page + label).slice(0, 200), show_alert: true });
      if (w.temporary && String(ctx.from.id) === String(w.receiver_id)) {
        await db().query("UPDATE whispers SET receiver_opened=TRUE WHERE id=$1", [id]);
        try {
          await ctx.api.editMessageText(w.chat_id, Number(w.message_id), "الهمسة اختفت… الهمسة كانت مؤقتة❕");
        } catch {
          try { await ctx.api.editMessageReplyMarkup(w.chat_id, Number(w.message_id), { reply_markup: { inline_keyboard: [] } }); } catch {}
        }
      }
      return true;
    }
    try {
      if (w.media_type === "photo") await ctx.api.sendPhoto(ctx.from.id, w.media_file_id, { caption: w.caption || undefined });
      else if (w.media_type === "animation") await ctx.api.sendAnimation(ctx.from.id, w.media_file_id, { caption: w.caption || undefined });
      else if (w.media_type === "sticker") await ctx.api.sendSticker(ctx.from.id, w.media_file_id);
      await ctx.answerCallbackQuery({ text: "تم فتح الهمسة في الخاص." });
    } catch (error) {
      await ctx.answerCallbackQuery({ text: "افتح محادثة البوت أولًا ثم حاول مرة ثانية.", show_alert: true });
    }
    return true;
  }
  return false;
}

export async function handleWhisperMessage(ctx) {
  if (!ctx.message || !ctx.from || !ctx.chat) return false;
  await ensureSchema();
  const text = String(ctx.message.text || "").trim().replace(/\s+/g, " ");

  if (group(ctx)) {
    if (["تفعيل الهمسات", "تعطيل الهمسات"].includes(text)) {
      if (!await canManage(ctx.from.id, ctx.chat.id)) {
        await ctx.reply("• هذا الأمر للمشرفين وفوق فقط.");
        return true;
      }
      const enabled = text === "تفعيل الهمسات";
      await db().query(
        "INSERT INTO whisper_chat_settings(chat_id,enabled) VALUES($1,$2) ON CONFLICT(chat_id) DO UPDATE SET enabled=EXCLUDED.enabled",
        [String(ctx.chat.id), enabled]
      );
      await ctx.reply(enabled ? "• تم تفعيل الهمسات بنجاح ." : "• تم تعطيل الهمسات بنجاح .");
      return true;
    }
    if (text === "الهمسات" && ctx.chat.type === "private" && ctx.from.id === OWNER_ID) return false;
    if (!["اهمس", "همسه", "همسة"].includes(text)) return false;
    if (!await whispersEnabled(ctx.chat.id)) return true;
    const target = ctx.message.reply_to_message?.from;
    if (!target || target.is_bot || target.id === ctx.from.id) {
      await ctx.reply("• لازم ترد على رسالة الشخص اللي تبي تهمس له.");
      return true;
    }
    const id = token();
    drafts.set(id, {
      id, chatId: ctx.chat.id, creatorId: ctx.from.id, targetId: target.id,
      targetName: nameOf(target), creatorName: nameOf(ctx.from),
      creatorUsername: ctx.from.username || "", kind: "pending",
      temporary: false, createdAt: Date.now()
    });
    const me = await ctx.api.getMe();
    await ctx.reply(
      `• تم تحديد الهمسة لـ ↤︎ ${mention(target.id, nameOf(target))}\n• اضغط الزر لكتابة الهمسة\n-`,
      { parse_mode: "HTML", reply_markup: startKeyboard(me.username, id) }
    );
    return true;
  }

  if (ctx.chat.type !== "private") return false;
  if (text === "الهمسات" && ctx.from.id === OWNER_ID) {
    const result = await db().query("SELECT * FROM whispers ORDER BY created_at DESC LIMIT 30");
    if (!result.rows.length) await ctx.reply("• لا توجد همسات مسجلة حاليًا.");
    for (const w of result.rows) {
      const content = w.kind === "text" ? w.content : "[" + w.media_type + "]";
      await ctx.reply(`الاسم: ${w.sender_name}\nاليوزر: ${w.sender_username ? "@" + w.sender_username : "لا يوجد"}\nهمسته: ${content || ""}\nمستلم الهمسة: ${w.receiver_name}`.slice(0, 4000));
    }
    return true;
  }

  const active = [...drafts.values()]
    .filter(d => d.creatorId === ctx.from.id && d.kind !== "pending" && Date.now() - d.createdAt < DRAFT_TTL)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!active) return false;
  const content = extractMedia(ctx.message, active.kind);
  if (!content) {
    await ctx.reply(active.kind === "text" ? "• أرسل نص الهمسة فقط." : "• أرسل صورة أو GIF أو ملصقًا.");
    return true;
  }
  if (content.tooLong) {
    await ctx.reply("❌ الهمسة طويلة جدًا. الحد الأقصى 7 صفحات.");
    return true;
  }

  const id = token();
  const me = await ctx.api.getMe();
  const replyId = token();
  drafts.set(replyId, {
    id: replyId, chatId: active.chatId, creatorId: active.targetId, targetId: active.creatorId,
    targetName: active.creatorName, creatorName: active.targetName, creatorUsername: "",
    kind: "pending", temporary: false, createdAt: Date.now()
  });
  const keyboard = viewKeyboard(id, active.creatorName, me.username, replyId);
  const announcement = await ctx.api.sendMessage(
    active.chatId,
    `• الهمسة لـ ↤︎ ${mention(active.targetId, active.targetName)}\n• من ↤︎ ${mention(active.creatorId, active.creatorName)}\n-`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
  await db().query(
    `INSERT INTO whispers(id,chat_id,message_id,sender_id,receiver_id,sender_name,receiver_name,sender_username,kind,temporary,content,pages,media_type,media_file_id,caption)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)`,
    [id, String(active.chatId), announcement.message_id, String(active.creatorId), String(active.targetId),
      active.creatorName, active.targetName, active.creatorUsername, active.kind,
      active.kind === "text" && active.temporary, content.content || null,
      JSON.stringify(content.pages || []), content.mediaType || null, content.mediaFileId || null, content.caption || null]
  );
  drafts.delete(active.id);
  drafts.delete(replyId);
  try { await ctx.deleteMessage(); } catch {}
  await ctx.reply(`تمام، ارسلت همستك لـ ${active.targetName} بنجاح .`);
  return true;
}
