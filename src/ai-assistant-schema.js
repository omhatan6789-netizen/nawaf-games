import { pool } from "./db.js";

export async function ensureAiAssistantSchema() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_assistant_settings (
    chat_id BIGINT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}
