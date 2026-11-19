import { pool } from "./db.js";

let ready;
export async function ensureDeveloperPanelSchema() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  if (ready) return ready;
  ready = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS developer_panel_access (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE NOT NULL,
        username TEXT,
        first_name TEXT,
        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        added_by BIGINT
      );
      CREATE TABLE IF NOT EXISTS developer_private_starts (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE developer_private_starts ADD COLUMN IF NOT EXISTS username TEXT;
      ALTER TABLE developer_private_starts ADD COLUMN IF NOT EXISTS first_name TEXT;
      ALTER TABLE developer_private_starts ADD COLUMN IF NOT EXISTS last_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

      CREATE TABLE IF NOT EXISTS developer_bot_chats (
        chat_id BIGINT PRIMARY KEY,
        chat_type TEXT NOT NULL,
        title TEXT,
        username TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS developer_broadcasts (
        id BIGSERIAL PRIMARY KEY,
        sender_id BIGINT NOT NULL,
        sender_name TEXT,
        source_chat_id BIGINT NOT NULL,
        source_message_id BIGINT NOT NULL,
        broadcast_type TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS developer_broadcast_targets (
        id BIGSERIAL PRIMARY KEY,
        broadcast_id BIGINT NOT NULL REFERENCES developer_broadcasts(id) ON DELETE CASCADE,
        chat_id BIGINT NOT NULL,
        chat_type TEXT NOT NULL,
        title TEXT,
        username TEXT,
        sent_message_id BIGINT,
        success BOOLEAN NOT NULL DEFAULT FALSE,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      DO $do$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema=current_schema() AND table_name='developer_bot_chats'
            AND column_name='active' AND data_type <> 'boolean'
        ) THEN
          ALTER TABLE developer_bot_chats ALTER COLUMN active DROP DEFAULT;
          ALTER TABLE developer_bot_chats
            ALTER COLUMN active TYPE BOOLEAN
            USING (active::text IN ('1','true','t'));
          ALTER TABLE developer_bot_chats ALTER COLUMN active SET DEFAULT TRUE;
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema=current_schema() AND table_name='developer_broadcast_targets'
            AND column_name='success' AND data_type <> 'boolean'
        ) THEN
          ALTER TABLE developer_broadcast_targets ALTER COLUMN success DROP DEFAULT;
          ALTER TABLE developer_broadcast_targets
            ALTER COLUMN success TYPE BOOLEAN
            USING (success::text IN ('1','true','t'));
          ALTER TABLE developer_broadcast_targets ALTER COLUMN success SET DEFAULT FALSE;
        END IF;
      END $do$;
      CREATE INDEX IF NOT EXISTS idx_developer_bot_chats_active
        ON developer_bot_chats(active,chat_type);
      CREATE INDEX IF NOT EXISTS idx_developer_broadcast_targets_broadcast
        ON developer_broadcast_targets(broadcast_id,id);
    `);
    console.log("Developer panel schema is ready.");
  })().catch(error => { ready = null; throw error; });
  return ready;
}
