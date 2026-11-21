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
        chatId: message.chat.id,
        msgId: message.id,
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
  console.log("[NAME REACTION] Started successfully.");
}
