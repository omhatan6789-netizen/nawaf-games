import { pool } from "./db.js";

let ready;
export async function ensureStartEditorSchema() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  if (ready) return ready;
  ready = pool.query(`
    CREATE TABLE IF NOT EXISTS start_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      message_text TEXT,
      message_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO start_settings(id,message_text,message_entities)
    VALUES(1,NULL,'[]'::jsonb) ON CONFLICT(id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS start_buttons (
      id BIGSERIAL PRIMARY KEY,
      button_text TEXT NOT NULL,
      button_url TEXT NOT NULL,
      button_order INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_start_buttons_order ON start_buttons(button_order,id);

    CREATE TABLE IF NOT EXISTS start_images (
      id BIGSERIAL PRIMARY KEY,
      file_id TEXT NOT NULL,
      image_order INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_start_images_order ON start_images(image_order,id);

    CREATE TABLE IF NOT EXISTS start_access (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT UNIQUE,
      username TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (user_id IS NOT NULL OR username IS NOT NULL)
    );
  `).then(() => console.log("Start editor schema is ready."))
    .catch(error => { ready = null; throw error; });
  return ready;
}
