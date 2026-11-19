import { pool } from "./db.js";

let ready;
export async function ensureEmojiReactionSchema() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  if (ready) return ready;
  ready = pool.query(`
    CREATE TABLE IF NOT EXISTS emoji_reaction_rules (
      match_type TEXT NOT NULL CHECK (match_type IN ('exact','contains')),
      keyword TEXT NOT NULL,
      emoji TEXT NOT NULL,
      custom_emoji_id TEXT,
      created_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(match_type, keyword)
    );
  `).then(() => console.log("Emoji reaction schema is ready."))
    .catch(error => { ready = null; throw error; });
  return ready;
}
