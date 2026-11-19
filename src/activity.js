import { pool } from "./db.js";

const FLUSH_DELAY_MS = 500;
const pendingUsers = new Map();
const pendingChats = new Map();
const pendingChatUsers = new Map();
let flushTimer = null;
let flushPromise = null;
let schemaPromise = null;

function database() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}

async function ensureActivitySchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = database();
      await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_messages BIGINT NOT NULL DEFAULT 0");
      await db.query(`
        CREATE TABLE IF NOT EXISTS chat_activity (
          chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
          user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
          message_count BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (chat_id, user_id)
        )
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_chat_activity_leaderboard ON chat_activity(chat_id, message_count DESC)");
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export function recordGroupTextMessage(ctx) {
  const message = ctx.message;
  const chat = ctx.chat;
  const user = ctx.from;
  const text = message?.text;

  if (!message || !chat || !user || user.is_bot) return;
  if (!["group", "supergroup"].includes(chat.type)) return;
  if (typeof text !== "string" || !text.length || text.startsWith("/")) return;

  const userId = String(user.id);
  const chatId = String(chat.id);
  const oldUser = pendingUsers.get(userId);
  pendingUsers.set(userId, {
    username: user.username ?? oldUser?.username ?? null,
    firstName: user.first_name ?? oldUser?.firstName ?? "",
    lastName: user.last_name ?? oldUser?.lastName ?? null,
    count: (oldUser?.count ?? 0) + 1,
  });

  pendingChats.set(chatId, {
    type: chat.type,
    title: chat.title ?? null,
    username: chat.username ?? null,
  });
  const key = chatId + ":" + userId;
  pendingChatUsers.set(key, {
    chatId,
    userId,
    count: (pendingChatUsers.get(key)?.count ?? 0) + 1,
  });

  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPendingActivity().catch((error) => {
      console.error("Activity flush failed:", error);
      scheduleFlush();
    });
  }, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

export async function flushPendingActivity() {
  if (flushPromise) return flushPromise;
  if (!pendingUsers.size && !pendingChats.size && !pendingChatUsers.size) return;

  flushPromise = (async () => {
    await ensureActivitySchema();
    const users = new Map(pendingUsers);
    const chats = new Map(pendingChats);
    const chatUsers = new Map(pendingChatUsers);
    pendingUsers.clear();
    pendingChats.clear();
    pendingChatUsers.clear();

    const client = await database().connect();
    try {
      await client.query("BEGIN");

      for (const [chatId, chat] of chats) {
        await client.query(
          `INSERT INTO chats(chat_id, chat_type, title, username)
           VALUES($1, $2, $3, $4)
           ON CONFLICT(chat_id) DO UPDATE SET
             chat_type = EXCLUDED.chat_type,
             title = COALESCE(EXCLUDED.title, chats.title),
             username = COALESCE(EXCLUDED.username, chats.username),
             is_active = TRUE,
             updated_at = NOW()`,
          [chatId, chat.type, chat.title, chat.username]
        );
      }

      for (const [userId, user] of users) {
        await client.query(
          `INSERT INTO users(user_id, username, first_name, last_name, is_bot, messages, activity_messages, rank, joined_date)
           VALUES($1, $2, $3, $4, FALSE, $5, $5, 'عضو', NOW())
           ON CONFLICT(user_id) DO UPDATE SET
             username = COALESCE(EXCLUDED.username, users.username),
             first_name = COALESCE(EXCLUDED.first_name, users.first_name),
             last_name = COALESCE(EXCLUDED.last_name, users.last_name),
             messages = COALESCE(users.messages, 0) + EXCLUDED.messages,
             activity_messages = COALESCE(users.activity_messages, 0) + EXCLUDED.activity_messages,
             updated_at = NOW()`,
          [userId, user.username, user.firstName, user.lastName, user.count]
        );
      }

      for (const entry of chatUsers.values()) {
        await client.query(
          `INSERT INTO chat_activity(chat_id, user_id, message_count)
           VALUES($1, $2, $3)
           ON CONFLICT(chat_id, user_id) DO UPDATE SET
             message_count = chat_activity.message_count + EXCLUDED.message_count,
             updated_at = NOW()`,
          [entry.chatId, entry.userId, entry.count]
        );
        await client.query(
          `INSERT INTO chat_members(chat_id, user_id, member_status)
           VALUES($1, $2, 'member')
           ON CONFLICT(chat_id, user_id) DO UPDATE SET
             member_status = 'member', updated_at = NOW()`,
          [entry.chatId, entry.userId]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      for (const [userId, user] of users) {
        const newer = pendingUsers.get(userId);
        pendingUsers.set(userId, {
          ...user,
          username: newer?.username ?? user.username,
          firstName: newer?.firstName || user.firstName,
          lastName: newer?.lastName ?? user.lastName,
          count: user.count + (newer?.count ?? 0),
        });
      }
      for (const [chatId, chat] of chats) {
        if (!pendingChats.has(chatId)) pendingChats.set(chatId, chat);
      }
      for (const [key, entry] of chatUsers) {
        const newer = pendingChatUsers.get(key);
        pendingChatUsers.set(key, { ...entry, count: entry.count + (newer?.count ?? 0) });
      }
      throw error;
    } finally {
      client.release();
    }
  })();

  try {
    await flushPromise;
  } finally {
    flushPromise = null;
    if (pendingUsers.size || pendingChats.size || pendingChatUsers.size) scheduleFlush();
  }
}
