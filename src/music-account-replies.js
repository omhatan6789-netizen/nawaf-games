import { pool } from "./db.js";
import { getMusicAccountClient } from "./account-clock.js";

const TARGET_WORD = "نواف";
const REACTION_EMOJI = "💯";
const ONLINE_REPLY = "مشغول👾";
const OFFLINE_REPLY = "نايم";
const ENABLE_REPLY = "طيب لا تنفخ فعلت لك الردود";
const DISABLE_REPLY = "طيب عطلته";

const WORD_PATTERN = /(?<![\p{L}\p{N}_])نواف(?![\p{L}\p{N}_])/u;
let started = false;
let repliesEnabled = true;

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}

export async function ensureMusicAccountRepliesSchema() {
  await db().query(`
    CREATE TABLE IF NOT EXISTS name_reaction_settings (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      settings JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db().query(`
    INSERT INTO name_reaction_settings (id, settings)
    VALUES (1, '{"replies_enabled": true, "muted": {}, "restricted": {}}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);
  await db().query(`
    CREATE TABLE IF NOT EXISTS music_account_scheduled_messages (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      message_text TEXT NOT NULL,
      hour SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
      minute SMALLINT NOT NULL CHECK (minute BETWEEN 0 AND 59),
      last_sent_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Collapse duplicate schedules created by earlier versions/repeated commands.
  // Preserve today's sent marker if any duplicate row already ran.
  await db().query(`
    WITH duplicates AS (
      SELECT MIN(id) AS keep_id, MAX(last_sent_date) AS sent_date
        FROM music_account_scheduled_messages
       GROUP BY chat_id, message_text, hour, minute
      HAVING COUNT(*) > 1
    )
    UPDATE music_account_scheduled_messages AS scheduled
       SET last_sent_date = duplicates.sent_date
      FROM duplicates
     WHERE scheduled.id = duplicates.keep_id
  `);
  await db().query(`
    DELETE FROM music_account_scheduled_messages AS older
     USING music_account_scheduled_messages AS newer
     WHERE older.chat_id = newer.chat_id
       AND older.message_text = newer.message_text
       AND older.hour = newer.hour
       AND older.minute = newer.minute
       AND older.id > newer.id
  `);
  await db().query(`
    CREATE UNIQUE INDEX IF NOT EXISTS music_account_scheduled_messages_unique
      ON music_account_scheduled_messages (chat_id, message_text, hour, minute)
  `);

  const result = await db().query(
    "SELECT COALESCE((settings->>'replies_enabled')::boolean, TRUE) AS enabled FROM name_reaction_settings WHERE id = 1",
  );
  repliesEnabled = result.rows[0]?.enabled ?? true;
  console.log(`[NAME REACTION] Settings loaded from PostgreSQL. Replies enabled: ${repliesEnabled}`);
}

async function saveRepliesEnabled(enabled) {
  await db().query(
    `INSERT INTO name_reaction_settings (id, settings, updated_at)
     VALUES (1, jsonb_build_object('replies_enabled', $1::boolean), NOW())
     ON CONFLICT (id) DO UPDATE
       SET settings = jsonb_set(
         COALESCE(name_reaction_settings.settings, '{}'::jsonb),
         '{replies_enabled}',
         to_jsonb($1::boolean),
         TRUE
       ),
       updated_at = NOW()`,
    [enabled],
  );
  repliesEnabled = enabled;
}

async function getAccountReply() {
  try {
    const client = await getMusicAccountClient();
    const me = await client.getMe();
    if (me.status === "offline") return OFFLINE_REPLY;
    return ONLINE_REPLY;
  } catch (error) {
    console.error("[NAME REACTION] Status error:", error?.message || error);
    return ONLINE_REPLY;
  }
}

async function handleMusicAccountMessage(message) {
  const client = await getMusicAccountClient();
  try {
    const text = String(message.text || message.caption || "").trim();

    // Scheduled daily messages are configured by sending a two-line command
    // from the music account in the chat where the message should be posted.
    if (message.isOutgoing && text.startsWith("اضف رسالة -")) {
      const chatType = message.chat?.chatType || message.chat?.type;
      if (chatType !== "group" && chatType !== "supergroup") {
        await client.replyText(message, "أرسل أمر إضافة الرسالة داخل القروب المطلوب، وليس في الخاص.");
        return;
      }

      const lines = text.split(/\r?\n/).map((line) => line.trim());
      const firstLine = lines[0] || "";
      const messageText = [
        firstLine.slice("اضف رسالة -".length).trim(),
        ...lines.slice(1, -1),
      ].filter(Boolean).join("\n").trim();
      const timeLine = lines.at(-1) || "";
      const timeMatch = timeLine.match(/^(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)$/i);

      if (!messageText || !timeMatch) {
        await client.replyText(
          message,
          "الصيغة غير صحيحة. اكتب الرسالة ثم الوقت في السطر الثاني، مثال:\nاضف رسالة - هاي نيوف\n5:00 PM",
        );
        return;
      }

      let hour = Number(timeMatch[1]) % 12;
      if (timeMatch[3].toUpperCase() === "PM") hour += 12;
      const minute = Number(timeMatch[2]);

      const { date: todayInRiyadh, minutes: currentRiyadhMinutes } = getRiyadhDateAndTime();
      // If the requested time has already arrived today, the first delivery
      // is tomorrow. Adding a schedule must never send it immediately.
      const lastSentDate = hour * 60 + minute <= currentRiyadhMinutes
        ? todayInRiyadh
        : null;

      await db().query(
        `INSERT INTO music_account_scheduled_messages
           (chat_id, message_text, hour, minute, last_sent_date)
         VALUES ($1, $2, $3, $4, $5::date)
         ON CONFLICT (chat_id, message_text, hour, minute) DO NOTHING`,
        [String(message.chat.id), messageText, hour, minute, lastSentDate],
      );

      try {
        await client.sendReaction({ message, emoji: "👍" });
      } catch (error) {
        console.error("[MUSIC SCHEDULE] Could not react to the add command:", error?.message || error);
      }
      console.log(
        `[MUSIC SCHEDULE] Added daily message for chat ${message.chat.id} at ${timeMatch[1]}:${timeMatch[2]} ${timeMatch[3].toUpperCase()} Riyadh time.`,
      );
      return;
    }

    // Original Python behavior: only messages sent by the music account
    // itself can control the replies setting.
    if (message.isOutgoing) {
      if (text === "فتح الردود") {
        await saveRepliesEnabled(true);
        await client.replyText(message, ENABLE_REPLY);
        console.log("[NAME REACTION] Replies enabled by the music account.");
      } else if (text === "قفل الردود") {
        await saveRepliesEnabled(false);
        await client.replyText(message, DISABLE_REPLY);
        console.log("[NAME REACTION] Replies disabled by the music account.");
      }
      return;
    }

    if (message.isService || !text) return;

    const chatType = message.chat?.chatType || message.chat?.type;
    if (chatType !== "group" && chatType !== "supergroup") return;
    if (!WORD_PATTERN.test(text)) return;

    // The original script reacts to the name even while replies are disabled.
    try {
      await client.sendReaction({
        message,
        emoji: REACTION_EMOJI,
      });
      console.log(`[NAME REACTION] Reacted in chat ${message.chat.id}`);
    } catch (error) {
      console.error("[NAME REACTION] Reaction error:", error?.message || error);
    }

    if (!repliesEnabled) return;

    const reply = await getAccountReply();
    await client.replyText(message, reply);
    console.log(`[NAME REACTION] Replied: ${reply}`);
  } catch (error) {
    console.error("[NAME REACTION] Message handler failed:", error?.message || error);
  }
}


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getRiyadhDateAndTime() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function millisecondsUntilNextMinute() {
  const now = new Date();
  return Math.max(50, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 25);
}

async function startScheduledMessagesLoop(client) {
  console.log("[MUSIC SCHEDULE] Daily message scheduler started (Asia/Riyadh).");
  while (true) {
    try {
      const { date, minutes } = getRiyadhDateAndTime();
      // Claim due group messages atomically. This prevents two overlapping
      // Render instances during a deploy from sending the same message twice.
      const due = await db().query(
        `WITH due AS (
           SELECT id
             FROM music_account_scheduled_messages
            WHERE chat_id < 0
              AND last_sent_date IS DISTINCT FROM $1::date
              AND (hour * 60 + minute) <= $2
            ORDER BY hour, minute, id
            FOR UPDATE SKIP LOCKED
         )
         UPDATE music_account_scheduled_messages AS scheduled
            SET last_sent_date = $1::date
           FROM due
          WHERE scheduled.id = due.id
         RETURNING scheduled.id, scheduled.chat_id, scheduled.message_text`,
        [date, minutes],
      );

      for (const item of due.rows) {
        try {
          // Pass a numeric marked Telegram chat ID; a string is interpreted
          // by mtcute as a username (e.g. "-100...").
          await client.sendText(Number(item.chat_id), item.message_text);
          console.log(`[MUSIC SCHEDULE] Sent daily message ${item.id} to group ${item.chat_id}.`);
        } catch (error) {
          await db().query(
            "UPDATE music_account_scheduled_messages SET last_sent_date = NULL WHERE id = $1 AND last_sent_date = $2::date",
            [item.id, date],
          );
          console.error(
            `[MUSIC SCHEDULE] Failed to send message ${item.id}; it will retry: `,
            error?.message || error,
          );
        }
      }
    } catch (error) {
      console.error("[MUSIC SCHEDULE] Scheduler check failed:", error?.message || error);
    }
    // Wake at the next minute boundary, so 5:20 AM is sent at 5:20,
    // rather than up to 15 seconds late.
    await sleep(millisecondsUntilNextMinute());
  }
}

export async function startMusicAccountReplies() {
  if (started) return;
  if (!pool) {
    console.warn("[NAME REACTION] Disabled: database is not configured.");
    return;
  }

  await ensureMusicAccountRepliesSchema();
  const client = await getMusicAccountClient();
  client.onNewMessage.add(handleMusicAccountMessage);
  started = true;
  startScheduledMessagesLoop(client).catch((error) => {
    console.error("[MUSIC SCHEDULE] Scheduler stopped unexpectedly:", error?.message || error);
  });
  console.log("[NAME REACTION] Started successfully.");
}
