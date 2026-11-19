import { pool } from "./db.js";

const AUTHORIZED_OWNER_IDS = new Set([8453977662, 6496915877]);
const sessions = new Map();
let aliases = new Map();
let schemaReady;

function database() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}

export function ensureCustomCommandsSchema() {
  if (!schemaReady) {
    schemaReady = database().query(`
      CREATE TABLE IF NOT EXISTS custom_commands (
        new_command TEXT PRIMARY KEY,
        old_command TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => loadCustomCommands()).catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function loadCustomCommands() {
  const result = await database().query("SELECT old_command,new_command FROM custom_commands ORDER BY old_command");
  aliases = new Map(result.rows.map(row => [row.new_command.trim(), row.old_command.trim()]));
  return aliases;
}

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export async function resolveCustomAlias(text) {
  await ensureCustomCommandsSchema();
  const value = clean(text);
  return aliases.get(value) || null;
}

export async function handleCustomCommandManagement(ctx) {
  const text = clean(ctx.message?.text);
  const userId = Number(ctx.from?.id);
  if (!text || !userId) return false;

  const session = sessions.get(userId);
  if (session?.step === "old") {
    if (!text) return true;
    session.oldCommand = text;
    session.step = "new";
    await ctx.reply("حسنًا، أرسل الأمر الجديد");
    return true;
  }
  if (session?.step === "new") {
    const newCommand = text;
    if (newCommand === session.oldCommand) {
      await ctx.reply("• الأمر الجديد لازم يكون مختلف عن الأمر القديم");
      return true;
    }
    try {
      await ensureCustomCommandsSchema();
      await database().query(
        `INSERT INTO custom_commands(old_command,new_command) VALUES($1,$2)
         ON CONFLICT(new_command) DO UPDATE SET old_command=EXCLUDED.old_command`,
        [session.oldCommand, newCommand]
      );
      aliases.set(newCommand, session.oldCommand);
      sessions.delete(userId);
      await ctx.reply(`✅ تم إضافة الأمر\n\n${newCommand} يعمل الآن مثل ${session.oldCommand}`);
    } catch (error) {
      console.error("Saving custom command failed:", error);
      await ctx.reply("❌ حصل خطأ أثناء حفظ الأمر.");
    }
    return true;
  }
  if (session?.step === "delete") {
    try {
      await ensureCustomCommandsSchema();
      const result = await database().query("DELETE FROM custom_commands WHERE new_command=$1", [text]);
      aliases.delete(text);
      sessions.delete(userId);
      await ctx.reply(result.rowCount
        ? "✅ تم حذف الأمر المضاف"
        : "• ما لقيت هذا الأمر ضمن الأوامر المضافة");
    } catch (error) {
      console.error("Deleting custom command failed:", error);
      sessions.delete(userId);
      await ctx.reply("❌ حصل خطأ أثناء حذف الأمر.");
    }
    return true;
  }

  if (text === "اضف امر") {
    if (!AUTHORIZED_OWNER_IDS.has(userId)) {
      await ctx.reply("❌ هذا الأمر للمطور فقط.");
      return true;
    }
    sessions.set(userId, { step: "old" });
    await ctx.reply("حسنًا، أرسل الأمر القديم");
    return true;
  }
  if (text === "الاوامر المضافة") {
    await ensureCustomCommandsSchema();
    const rows = [...aliases.entries()].sort((a, b) => a[1].localeCompare(b[1], "ar"));
    await ctx.reply(rows.length
      ? "📌 الأوامر المضافة:\n\n" + rows.map(([alias, original]) => `${alias} ➜ ${original}`).join("\n")
      : "لا توجد أوامر مضافة");
    return true;
  }
  if (text === "مسح امر") {
    sessions.set(userId, { step: "delete" });
    await ctx.reply("أرسل الأمر الجديد الذي تريد حذفه");
    return true;
  }
  if (text === "مسح الاوامر المضافة") {
    await ensureCustomCommandsSchema();
    await database().query("DELETE FROM custom_commands");
    aliases.clear();
    await ctx.reply("✅ تم حذف جميع الأوامر المضافة");
    return true;
  }
  return false;
}
