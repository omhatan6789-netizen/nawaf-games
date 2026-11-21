import { pool } from "./db.js";
import { getMusicAccountClient } from "./account-clock.js";

const REPLY_TEXT = "الملك مشغول شوي لو فضى لك بيرد عليك🙏🏻";
const REPLY_INTERVAL_SECONDS = 24 * 60 * 60;
let started = false;

async function ensureSchema() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auto_private_replied (
      user_id BIGINT PRIMARY KEY,
      replied_at BIGINT NOT NULL
    )
  `);
}

async function claimReplySlot(userId, now) {
  const result = await pool.query(
    `INSERT INTO auto_private_replied(user_id, replied_at)
     VALUES($1, $2)
     ON CONFLICT(user_id) DO UPDATE
       SET replied_at = EXCLUDED.replied_at
       WHERE auto_private_replied.replied_at <= EXCLUDED.replied_at - $3
     RETURNING user_id`,
    [String(userId), now, REPLY_INTERVAL_SECONDS],
  );
  return result.rowCount > 0;
}

async function handlePrivateMessage(message) {
  try {
    if (message.isOutgoing || message.isService) return;
    if (message.chat?.type !== "private") return;

    const sender = message.sender;
    if (!sender || sender.type !== "user" || sender.isBot) return;
    const userId = Number(sender.id);
    if (!Number.isSafeInteger(userId) || userId <= 0) return;

    const claimed = await claimReplySlot(userId, Math.floor(Date.now() / 1000));
    if (!claimed) return;

    try {
      await message.replyText(REPLY_TEXT);
      console.log(`[AUTO REPLY] Replied to private user ${userId}.`);
    } catch (error) {
      await pool.query("DELETE FROM auto_private_replied WHERE user_id=$1", [String(userId)]);
      console.error("[AUTO REPLY] Could not send reply:", error?.message || error);
    }
  } catch (error) {
    console.error("[AUTO REPLY] Message handler failed:", error?.message || error);
  }
}

export async function startAutoPrivateReply() {
  if (started) return;
  if (!pool) {
    console.warn("[AUTO REPLY] Disabled: database is not configured.");
    return;
  }

  await ensureSchema();
  const client = await getMusicAccountClient();
  client.onNewMessage.add(handlePrivateMessage);
  started = true;
  console.log("[AUTO REPLY] Music account private auto-reply started (24-hour cooldown).");
}
