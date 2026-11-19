import { pool } from "./db.js";

let ready;
export async function ensureMandatorySubscriptionSchema() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  if (ready) return ready;
  ready = pool.query(`
    CREATE TABLE IF NOT EXISTS mandatory_subscription_settings (
      chat_id BIGINT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      updated_by BIGINT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS mandatory_subscription_requirements (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      requirement_type TEXT NOT NULL CHECK (requirement_type IN ('chat','start')),
      target_chat_id BIGINT,
      target TEXT NOT NULL,
      title TEXT NOT NULL,
      join_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(group_id, requirement_type, target)
    );
    CREATE INDEX IF NOT EXISTS idx_mandatory_requirements_group
      ON mandatory_subscription_requirements(group_id, id);
    CREATE TABLE IF NOT EXISTS developer_private_starts (
      user_id BIGINT PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).then(() => console.log("Mandatory subscription schema is ready."))
    .catch(error => { ready = null; throw error; });
  return ready;
}
