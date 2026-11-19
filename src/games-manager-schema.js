import { pool } from "./db.js";

let ready;
export async function ensureGamesManagerSchema() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  if (ready) return ready;
  ready = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        name TEXT PRIMARY KEY,
        image TEXT,
        status TEXT NOT NULL DEFAULT 'on'
      );
      ALTER TABLE games ADD COLUMN IF NOT EXISTS image TEXT;
      ALTER TABLE games ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'on';

      CREATE TABLE IF NOT EXISTS game_questions (
        id BIGSERIAL PRIMARY KEY,
        game_name TEXT NOT NULL,
        question TEXT,
        image TEXT,
        caption TEXT,
        answers JSONB NOT NULL DEFAULT '[]'::jsonb
      );
      ALTER TABLE game_questions ADD COLUMN IF NOT EXISTS question TEXT;
      ALTER TABLE game_questions ADD COLUMN IF NOT EXISTS image TEXT;
      ALTER TABLE game_questions ADD COLUMN IF NOT EXISTS caption TEXT;
      ALTER TABLE game_questions ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '[]'::jsonb;

      CREATE INDEX IF NOT EXISTS idx_game_questions_game_name ON game_questions(game_name);
      CREATE TABLE IF NOT EXISTS game_question_messages (
        chat_id BIGINT NOT NULL,
        message_id BIGINT NOT NULL,
        question_id BIGINT NOT NULL,
        PRIMARY KEY(chat_id,message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_game_question_messages_question ON game_question_messages(question_id);

      CREATE TABLE IF NOT EXISTS games_settings (
        id BIGINT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'on'
      );
      INSERT INTO games_settings(id,status) VALUES(1,'on')
      ON CONFLICT(id) DO NOTHING;
    `);
    console.log("Games manager schema is ready.");
  })().catch(error => { ready = null; throw error; });
  return ready;
}
