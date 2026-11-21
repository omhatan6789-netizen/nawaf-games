import { pool } from "./db.js";
import { OWNER_ID } from "./ranks.js";
import { getMusicAccountClient } from "./account-clock.js";

const NAME_TRIGGER = "نواف";
const ONLINE_REPLY = "مشغول👾";
const OFFLINE_REPLY = "نايم";
let started = false;

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}

export async function ensureMusicAccountRepliesSchema() {
  await db().query(`
    CREATE TABLE IF NOT EXISTS music_account_reply_settings (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db().query(`
    INSERT INTO music_account_reply_settings(id, enabled)
    VALUES (1, TRUE)
    ON CONFLICT (id) DO NOTHING
  `);
}

async function setRepliesEnabled(enabled) {
  await db().query(
    `INSERT INTO music_account_reply_settings(id, enabled, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE
       SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [enabled],
  );
}

async function areRepliesEnabled() {
  const result = await db().query(
    "SELECT enabled FROM music_account_reply_settings WHERE id = 1",
  );
  return result.rows[0]?.enabled ?? true;
}

export async function handleMusicAccountReplyCommand(ctx) {
  const text = ctx.message?.text?.trim();
  if (text !== "فتح الردود" && text !== "قفل الردود") return false;

  if (Number(ctx.from?.id) !== OWNER_ID) {
    await ctx.reply("هذا الأمر للمالك الأساسي فقط.");
    return true;
  }

  const enabled = text === "فتح الردود";
  try {
    await setRepliesEnabled(enabled);
    await ctx.reply(enabled ? "تم فتح ردود حساب الموسيقى." : "تم قفل ردود حساب الموسيقى.");
  } catch (error) {
    console.error("[MUSIC ACCOUNT REPLIES] Could not save setting:", error?.message || error);
    await ctx.reply("تعذر حفظ إعدادات الردود، حاول مرة ثانية.");
  }
  return true;
}

async function handleMusicGroupMessage(message) {
  try {
    if (message.isOutgoing || message.isService) return;
    const chatType = message.chat?.type;
    if (chatType !== "group" && chatType !== "supergroup") return;
    if (String(message.text || "").trim() !== NAME_TRIGGER) return;
    if (!(await areRepliesEnabled())) return;

    const client = await getMusicAccountClient();
    const me = await client.getMe();
    const reply = me.status === "online" ? ONLINE_REPLY : OFFLINE_REPLY;
    await message.replyText(reply);
    console.log(`[MUSIC ACCOUNT REPLIES] Replied in group ${message.chat.id}: ${reply}`);
  } catch (error) {
    console.error("[MUSIC ACCOUNT REPLIES] Message handler failed:", error?.message || error);
  }
}

export async function startMusicAccountReplies() {
  if (started) return;
  if (!pool) {
    console.warn("[MUSIC ACCOUNT REPLIES] Disabled: database is not configured.");
    return;
  }

  await ensureMusicAccountRepliesSchema();
  const client = await getMusicAccountClient();
  client.onNewMessage.add(handleMusicGroupMessage);
  started = true;
  console.log("[MUSIC ACCOUNT REPLIES] Group name replies started.");
}
