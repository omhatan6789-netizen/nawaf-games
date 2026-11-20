import { pool } from "./db.js";

export async function ensureImageQuizSchema() {
  if (!pool) return;
  await pool.query("CREATE TABLE IF NOT EXISTS image_quiz_images (id BIGSERIAL PRIMARY KEY, file_id TEXT NOT NULL UNIQUE, answer TEXT NOT NULL, alternative_answers JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
}
