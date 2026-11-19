import { InlineKeyboard } from "grammy";
import { pool } from "./db.js";
import { getRankLevel, OWNER_ID } from "./ranks.js";

const pending = new Map();
const MAX_MESSAGES = 8;
const MIN_SECONDS = 300;
let loopStarted = false;
let schemaReady;

const isGroup = ctx => ["group", "supergroup"].includes(ctx.chat?.type);
const clean = value => String(value || "").trim();
const parseScope = (ctx, text) => text.endsWith(" عام")
  ? { scope: "global", chatId: 0, command: text.slice(0, -4).trim() }
  : { scope: "chat", chatId: ctx.chat.id, command: text };

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}

export function ensureTemporaryMessagesSchema() {
  if (!schemaReady) {
    schemaReady = db().query(`
      CREATE TABLE IF NOT EXISTS temporary_messages (
        id BIGSERIAL PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('global','chat')),
        chat_id BIGINT NOT NULL,
        creator_id BIGINT NOT NULL,
        payload JSONB NOT NULL,
        buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
        interval_seconds BIGINT,
        next_run_at DOUBLE PRECISION,
        created_at DOUBLE PRECISION NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_temporary_messages_due
        ON temporary_messages(next_run_at)
        WHERE interval_seconds IS NOT NULL AND next_run_at IS NOT NULL;
      CREATE TABLE IF NOT EXISTS temporary_message_chats (
        chat_id BIGINT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at DOUBLE PRECISION NOT NULL
      );
    `).catch(error => { schemaReady = null; throw error; });
  }
  return schemaReady;
}

async function allowed(ctx, scope) {
  if (scope === "global") return Number(ctx.from?.id) === OWNER_ID;
  return Number(ctx.from?.id) === OWNER_ID || (await getRankLevel(ctx.from.id, ctx.chat.id)) >= 2;
}

function durationSeconds(text) {
  const m = clean(text).match(/^(\d+)\s*(د|دقيقة|دقائق|ساعة|ساعه|ساعات|س|يوم|أيام|ايام|ي)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const seconds = n * (["د","دقيقة","دقائق"].includes(unit) ? 60 :
    ["ساعة","ساعه","ساعات","س"].includes(unit) ? 3600 : 86400);
  return seconds >= MIN_SECONDS ? seconds : null;
}

function formatDuration(seconds) {
  if (!seconds) return "غير محدد";
  if (seconds % 86400 === 0) return (seconds / 86400) + "ي";
  if (seconds % 3600 === 0) return (seconds / 3600) + "س";
  return Math.round(seconds / 60) + "د";
}

function parseButtons(text) {
  const rows = [];
  const kept = [];
  for (const line of String(text || "").split("\n")) {
    const matches = [...line.matchAll(/\[([^\[\]]+?)\s+-\s+([^\[\]]+?)\]/g)];
    if (!matches.length || matches.map(m => m[0]).join("").replace(/\s/g, "") !== line.replace(/\s/g, "")) {
      kept.push(line);
      continue;
    }
    const row = [];
    for (const match of matches) {
      const label = match[1].trim();
      let url = match[2].trim();
      if (url.startsWith("@")) url = "https://t.me/" + url.slice(1);
      try {
        const parsed = new URL(url);
        if (label && ["http:", "https:"].includes(parsed.protocol)) row.push({ text: label, url });
      } catch {}
    }
    if (row.length) rows.push(row);
    else kept.push(line);
  }
  return { text: kept.join("\n").trim(), buttons: rows };
}

function payloadFromMessage(message) {
  const caption = message.caption || "";
  const parsedCaption = parseButtons(caption);
  if (message.text !== undefined) {
    const parsed = parseButtons(message.text);
    return { payload: { type: "text", text: parsed.text, entities: message.entities || [] }, buttons: parsed.buttons };
  }
  const base = { caption: parsedCaption.text, caption_entities: message.caption_entities || [] };
  for (const kind of ["photo","video","animation","document","audio","voice","video_note","sticker"]) {
    let item = message[kind];
    if (!item) continue;
    if (kind === "photo") item = item.at(-1);
    const payload = { ...base, type: kind, file_id: item.file_id };
    if (kind === "audio") {
      payload.title = item.title || null;
      payload.performer = item.performer || null;
    }
    return { payload, buttons: parsedCaption.buttons };
  }
  return null;
}

function markup(buttons) {
  return buttons?.length ? new InlineKeyboard(buttons.map(row => row.map(b => ({ text: b.text, url: b.url })))) : undefined;
}

async function sendPayload(api, chatId, payload, buttons) {
  const options = { reply_markup: markup(buttons) };
  if (payload.type === "text") {
    return api.sendMessage(chatId, payload.text || " ", {
      ...options,
      entities: payload.entities?.length ? payload.entities : undefined
    });
  }
  const caption = payload.caption || undefined;
  const caption_entities = payload.caption_entities?.length ? payload.caption_entities : undefined;
  const file = payload.file_id;
  if (payload.type === "photo") return api.sendPhoto(chatId, file, { ...options, caption, caption_entities });
  if (payload.type === "video") return api.sendVideo(chatId, file, { ...options, caption, caption_entities });
  if (payload.type === "animation") return api.sendAnimation(chatId, file, { ...options, caption, caption_entities });
  if (payload.type === "document") return api.sendDocument(chatId, file, { ...options, caption, caption_entities });
  if (payload.type === "audio") return api.sendAudio(chatId, file, { ...options, caption, caption_entities, title: payload.title || undefined, performer: payload.performer || undefined });
  if (payload.type === "voice") return api.sendVoice(chatId, file, { ...options, caption, caption_entities });
  if (payload.type === "video_note") {
    const sent = await api.sendVideoNote(chatId, file);
    if (options.reply_markup) await api.sendMessage(chatId, "‎", options);
    return sent;
  }
  if (payload.type === "sticker") {
    const sent = await api.sendSticker(chatId, file);
    if (options.reply_markup) await api.sendMessage(chatId, "‎", options);
    return sent;
  }
}

async function rowsFor(scope, chatId) {
  const result = scope === "global"
    ? await db().query("SELECT * FROM temporary_messages WHERE scope='global' ORDER BY id")
    : await db().query("SELECT * FROM temporary_messages WHERE scope='chat' AND chat_id=$1 ORDER BY id", [chatId]);
  return result.rows;
}

async function listMessages(ctx, scope, chatId) {
  const rows = await rowsFor(scope, chatId);
  const title = scope === "global" ? "قائمة الرسائل المؤقتة العامة:" : "قائمة الرسائل المؤقتة بالقروب:";
  if (!rows.length) {
    await ctx.reply(title + "\n• ما فيه رسائل مؤقتة.");
    return;
  }
  const lines = [title];
  const keyboard = new InlineKeyboard();
  rows.forEach((row, i) => {
    const p = row.payload;
    const preview = (p.text || p.caption || "رسالة وسائط").split(/\s+/).slice(0, 4).join(" ");
    lines.push(`${i + 1} ~ ${preview || "رسالة وسائط"} — ${row.interval_seconds ? "كل " + formatDuration(Number(row.interval_seconds)) : "لم يحدد الوقت"}`);
    keyboard.text("عرض " + (i + 1), "tmp:view:" + scope + ":" + chatId + ":" + row.id);
    if (i % 2 === 1) keyboard.row();
  });
  await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
}

export async function handleTemporaryMessageCallback(ctx) {
  const data = ctx.callbackQuery?.data || "";
  const match = data.match(/^tmp:(view|list|edit|buttons):([^:]+):(-?\d+):(\d+)$/);
  if (!match) return false;
  const [, action, scope, chatText, idText] = match;
  const chatId = Number(chatText), rowId = Number(idText);
  if (!(Number(ctx.from.id) === OWNER_ID || (scope === "chat" && await getRankLevel(ctx.from.id, chatId) >= 2))) {
    await ctx.answerCallbackQuery({ text: "هذا للمشرفين وفوق فقط.", show_alert: true });
    return true;
  }
  await ensureTemporaryMessagesSchema();
  const result = await db().query("SELECT * FROM temporary_messages WHERE id=$1 AND scope=$2 AND chat_id=$3", [rowId, scope, chatId]);
  const row = result.rows[0];
  if (!row) {
    await ctx.answerCallbackQuery({ text: "الرسالة غير موجودة.", show_alert: true });
    return true;
  }
  await ctx.answerCallbackQuery();
  if (action === "list") return listMessages(ctx, scope, chatId);
  if (action === "edit" || action === "buttons") {
    pending.set(ctx.from.id, { scope, chatId, creatorId: ctx.from.id, rowId, stage: action === "edit" ? "edit_content" : "edit_buttons" });
    await ctx.editMessageText(action === "edit"
      ? "أرسل محتوى الرسالة الجديد في القروب.\nللإلغاء أرسل: إلغاء"
      : "أرسل الأزرار الجديدة، كل صف في سطر.\nلحذفها كلها أرسل: حذف الكل\nللإلغاء أرسل: إلغاء");
    return true;
  }
  const p = row.payload;
  const content = p.text || p.caption || "[رسالة وسائط: " + p.type + "]";
  const keyboard = new InlineKeyboard()
    .text("تعديل الرسالة", "tmp:edit:" + scope + ":" + chatId + ":" + rowId)
    .text("تعديل الأزرار", "tmp:buttons:" + scope + ":" + chatId + ":" + rowId)
    .row()
    .text("رجوع للقائمة", "tmp:list:" + scope + ":" + chatId + ":" + rowId);
  await ctx.editMessageText(("الرسالة: " + content + "\n\nالأزرار: " + (row.buttons?.flat()?.map(b => b.text).join("، ") || "لا توجد")).slice(0, 3900), { reply_markup: keyboard });
  return true;
}

export async function handleTemporaryMessages(ctx) {
  const message = ctx.message;
  if (!message || !ctx.from || !ctx.chat) return false;
  await ensureTemporaryMessagesSchema();

  if (isGroup(ctx)) {
    db().query(
      "INSERT INTO temporary_message_chats(chat_id,title,active,updated_at) VALUES($1,$2,TRUE,$3) ON CONFLICT(chat_id) DO UPDATE SET title=EXCLUDED.title,active=TRUE,updated_at=EXCLUDED.updated_at",
      [ctx.chat.id, ctx.chat.title || "", Date.now() / 1000]
    ).catch(error => console.error("Tracking temporary-message chat failed:", error));
  }

  const text = clean(message.text);
  const session = pending.get(ctx.from.id);
  if (session && session.creatorId === ctx.from.id && isGroup(ctx)) {
    if (text === "إلغاء") {
      pending.delete(ctx.from.id);
      await ctx.reply("تم إلغاء العملية.");
      return true;
    }
    if (session.stage === "duration") {
      const seconds = durationSeconds(text);
      if (!seconds) {
        await ctx.reply("• المدة غير صحيحة أو أقل من 5 دقائق. أرسل مثلًا: 5د أو 1س أو 2س أو 1ي.");
        return true;
      }
      await db().query("UPDATE temporary_messages SET interval_seconds=$1,next_run_at=$2 WHERE id=$3 AND scope=$4 AND chat_id=$5", [seconds, Date.now()/1000+seconds, session.rowId, session.scope, session.chatId]);
      pending.delete(ctx.from.id);
      await ctx.reply("• تم ضبط تكرار الرسالة كل " + formatDuration(seconds) + ".");
      return true;
    }
    if (session.stage === "edit_buttons") {
      const buttons = text === "حذف الكل" ? [] : parseButtons(message.text || "").buttons;
      if (text !== "حذف الكل" && !buttons.length) {
        await ctx.reply("ما لقيت أزرارًا بالتنسيق الصحيح. مثال:\n[قناتي 🌷 - @channel]\nولإزالة الجميع أرسل: حذف الكل");
        return true;
      }
      await db().query("UPDATE temporary_messages SET buttons=$1::jsonb WHERE id=$2 AND scope=$3 AND chat_id=$4", [JSON.stringify(buttons), session.rowId, session.scope, session.chatId]);
      pending.delete(ctx.from.id);
      await ctx.reply("تم تحديث أزرار الرسالة المؤقتة بنجاح.");
      return true;
    }
    const extracted = payloadFromMessage(message);
    if (!extracted) {
      await ctx.reply("أرسل نصًا أو صورة أو فيديو أو ملفًا أو صوتًا أو ملصقًا.");
      return true;
    }
    if (session.stage === "edit_content") {
      await db().query("UPDATE temporary_messages SET payload=$1::jsonb,buttons=$2::jsonb WHERE id=$3 AND scope=$4 AND chat_id=$5", [JSON.stringify(extracted.payload), JSON.stringify(extracted.buttons), session.rowId, session.scope, session.chatId]);
      pending.delete(ctx.from.id);
      await ctx.reply("تم تعديل الرسالة المؤقتة بنجاح.");
      return true;
    }
    const result = await db().query("SELECT COUNT(*)::int AS n FROM temporary_messages WHERE scope=$1 AND chat_id=$2", [session.scope, session.chatId]);
    if (result.rows[0].n >= MAX_MESSAGES) {
      pending.delete(ctx.from.id);
      await ctx.reply("وصلت للحد الأقصى، وهو 8 رسائل مؤقتة لهذا النطاق.");
      return true;
    }
    await db().query("INSERT INTO temporary_messages(scope,chat_id,creator_id,payload,buttons,created_at) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6)", [session.scope, session.chatId, ctx.from.id, JSON.stringify(extracted.payload), JSON.stringify(extracted.buttons), Date.now()/1000]);
    pending.delete(ctx.from.id);
    await ctx.reply("تمت إضافة الرسالة المؤقتة بنجاح.\nلتحديد وقت تكرارها استخدم: ضع الرسالة رقم" + (session.scope === "global" ? " عام" : ""));
    return true;
  }

  if (!isGroup(ctx)) return false;
  const parsed = parseScope(ctx, text);
  if (!await allowed(ctx, parsed.scope)) {
    if (/^(?:اضف رسالة مؤقتة|اضف رساله مؤقته|الرسائل المؤقتة|الرسائل المؤقته|مسح الرسالة المؤقتة|مسح الرساله المؤقته|مسح الرسائل المؤقتة|مسح الرسائل المؤقته|ضع الرسالة)\b/.test(parsed.command)) {
      await ctx.reply(parsed.scope === "global" ? "• أوامر الرسائل المؤقتة العامة للمطور فقط." : "• هذا الأمر للمشرفين وفوق فقط.");
      return true;
    }
    return false;
  }
  if (["اضف رسالة مؤقتة","اضف رساله مؤقته"].includes(parsed.command)) {
    const rows = await rowsFor(parsed.scope, parsed.chatId);
    if (rows.length >= MAX_MESSAGES) {
      await ctx.reply("• وصلت للحد الأعلى، وهو 8 رسائل مؤقتة.");
      return true;
    }
    pending.set(ctx.from.id, { scope: parsed.scope, chatId: parsed.chatId, creatorId: ctx.from.id, stage: "content" });
    await ctx.reply("• أرسل الرسالة أو الوسائط التي تبي تكرارها.\nتقدر تضيف الأزرار بهذا الشكل:\n[قناتي 🌷 - @channel]\nكل سطر صف مستقل، وأكثر من زر في السطر نفسه يظهر جنب بعض.");
    return true;
  }
  if (["الرسائل المؤقتة","الرسائل المؤقته"].includes(parsed.command)) {
    await listMessages(ctx, parsed.scope, parsed.chatId);
    return true;
  }
  let m = parsed.command.match(/^مسح الرس(?:الة|اله) المؤقت(?:ة|ه)\s+(\d+)$/);
  if (m) {
    const rows = await rowsFor(parsed.scope, parsed.chatId);
    const row = rows[Number(m[1]) - 1];
    if (!row) await ctx.reply("• مافيه رسالة يالطيب.");
    else {
      await db().query("DELETE FROM temporary_messages WHERE id=$1 AND scope=$2 AND chat_id=$3", [row.id, parsed.scope, parsed.chatId]);
      await ctx.reply("• تم مسح الرسالة المؤقتة " + m[1] + ".");
    }
    return true;
  }
  if (["مسح الرسائل المؤقتة","مسح الرسائل المؤقته"].includes(parsed.command)) {
    await db().query("DELETE FROM temporary_messages WHERE scope=$1 AND chat_id=$2", [parsed.scope, parsed.chatId]);
    await ctx.reply("• تم مسح الرسائل المؤقتة.");
    return true;
  }
  m = parsed.command.match(/^ضع الرسالة\s+(\d+)$/);
  if (m) {
    const rows = await rowsFor(parsed.scope, parsed.chatId);
    const row = rows[Number(m[1]) - 1];
    if (!row) await ctx.reply("• مافيه رسالة يالطيب.");
    else {
      pending.set(ctx.from.id, { scope: parsed.scope, chatId: parsed.chatId, creatorId: ctx.from.id, stage: "duration", rowId: row.id });
      await ctx.reply("• أرسل المدة مثل 5د أو 1س أو 2س أو 1ي. أقل مدة مسموحة 5 دقائق.");
    }
    return true;
  }
  return false;
}

export function startTemporaryMessageScheduler(api) {
  if (loopStarted) return;
  loopStarted = true;
  const tick = async () => {
    try {
      await ensureTemporaryMessagesSchema();
      const now = Date.now() / 1000;
      const due = await db().query(
        "UPDATE temporary_messages SET next_run_at=$1 + interval_seconds WHERE id IN (SELECT id FROM temporary_messages WHERE interval_seconds IS NOT NULL AND next_run_at <= $1 ORDER BY next_run_at LIMIT 100 FOR UPDATE SKIP LOCKED) RETURNING id,scope,chat_id,payload,buttons",
        [now]
      );
      for (const row of due.rows) {
        let chats = [Number(row.chat_id)];
        if (row.scope === "global") {
          const active = await db().query("SELECT chat_id FROM temporary_message_chats WHERE active=TRUE");
          chats = active.rows.map(r => Number(r.chat_id));
        }
        for (const chatId of chats) {
          try {
            await sendPayload(api, chatId, row.payload, row.buttons || []);
          } catch (error) {
            if (error?.error_code === 403 && row.scope === "global") {
              await db().query("UPDATE temporary_message_chats SET active=FALSE WHERE chat_id=$1", [chatId]);
            } else {
              console.error("Temporary message delivery failed:", row.id, chatId, error?.description || error?.message);
            }
          }
        }
      }
    } catch (error) {
      console.error("Temporary-message scheduler failed:", error);
    }
    setTimeout(tick, 5000);
  };
  tick();
}
