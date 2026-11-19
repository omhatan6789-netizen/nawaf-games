import { pool } from "../db.js";
import {
  RANK_LEVELS, getRank, getRankLevel, getDeveloperType,
  getCommandLocks, getUserPermissions, setCommandLock, removeCommandLock, setUserPermission,
} from "../ranks.js";

const RANKS = ["Dev", "المالك", "نائب المالك", "ادمن اساسي", "ادمن", "مميز"];
const pendingLocks = new Map();

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}
function isGroup(ctx) {
  return ["group", "supergroup"].includes(ctx.chat?.type);
}
async function resolveTarget(ctx, token) {
  if (!token) return null;
  if (/^\d+$/.test(token)) {
    try {
      const chat = await ctx.api.getChat(Number(token));
      return { id: chat.id, first_name: chat.first_name || chat.title || token };
    } catch {
      const result = await db().query("SELECT user_id, first_name, username FROM users WHERE user_id=$1", [token]);
      const row = result.rows[0];
      return row ? { id: Number(row.user_id), first_name: row.first_name || row.username || token } : null;
    }
  }
  if (token.startsWith("@")) {
    try {
      const chat = await ctx.api.getChat(token);
      return { id: chat.id, first_name: chat.first_name || chat.title || token };
    } catch {
      const result = await db().query("SELECT user_id, first_name, username FROM users WHERE LOWER(username)=$1", [token.slice(1).toLowerCase()]);
      const row = result.rows[0];
      return row ? { id: Number(row.user_id), first_name: row.first_name || row.username || token } : null;
    }
  }
  return null;
}

export async function handleCommandLockFlow(ctx) {
  const text = ctx.message?.text?.trim();
  const actor = ctx.from;
  if (!text || !actor) return false;

  if (pendingLocks.has(actor.id) && RANKS.includes(text)) {
    const command = pendingLocks.get(actor.id);
    try {
      await setCommandLock(command, text);
      pendingLocks.delete(actor.id);
      await ctx.reply(`✅ تم قفل الأمر ${command} على رتبة ${text} وفوق.`);
    } catch (error) {
      console.error("Saving command lock failed:", error);
      await ctx.reply("❌ تعذر حفظ قفل الأمر.");
    }
    return true;
  }

  if (text.startsWith("قفل امر ")) {
    if (!isGroup(ctx)) {
      await ctx.reply("❌ استخدم الأمر داخل القروب.");
      return true;
    }
    const level = await getRankLevel(actor.id, ctx.chat.id);
    if (level < RANK_LEVELS["المالك"]) {
      await ctx.reply("• اعذرني بس هذا الأمر للمالك وفوق فقط.");
      return true;
    }
    const command = text.slice("قفل امر ".length).trim().replace(/\s+/g, " ");
    if (!command) {
      await ctx.reply("❌ اكتب اسم الأمر.\nمثال:\nقفل امر اضف رد");
      return true;
    }
    pendingLocks.set(actor.id, command);
    await ctx.reply(
      `• حسنًا اختر الرتبة التي تريدها:\n${RANKS.map((rank, i) => `${i + 1} - ${rank}`).join("\n")}\n\n- سيتم وضع الأمر ↤︎ ${command} لهذه الرتبة وفوق`
    );
    return true;
  }

  if (text.startsWith("فتح امر ")) {
    if (!isGroup(ctx)) {
      await ctx.reply("❌ استخدم الأمر داخل القروب.");
      return true;
    }
    const level = await getRankLevel(actor.id, ctx.chat.id);
    if (level < RANK_LEVELS["المالك"]) {
      await ctx.reply("• اعذرني بس هذا الأمر للمالك وفوق فقط.");
      return true;
    }
    const command = text.slice("فتح امر ".length).trim().replace(/\s+/g, " ");
    if (!command) return true;
    try {
      await removeCommandLock(command);
      await ctx.reply(`✅ تم فتح الأمر ${command}.`);
    } catch (error) {
      console.error("Removing command lock failed:", error);
      await ctx.reply("❌ تعذر فتح الأمر.");
    }
    return true;
  }
  return false;
}

export async function enforceCommandLock(ctx) {
  const text = ctx.message?.text?.trim();
  const actor = ctx.from;
  if (!text || !actor || !isGroup(ctx) || /^(منع|سماح)(?:\\s|$)/.test(text) || /^(قفل امر|فتح امر)\\s/.test(text)) return false;

  const [locks, overrides] = await Promise.all([
    getCommandLocks(),
    getUserPermissions(ctx.chat.id, actor.id),
  ]);
  const candidates = [
    ...Object.keys(locks).map(command => ({ command, allowed: null, source: "lock" })),
    ...overrides.map(item => ({ ...item, source: "user" })),
  ];
  const command = candidates
    .filter(item => text === item.command || text.startsWith(item.command + " "))
    .sort((a, b) => b.command.length - a.command.length || (a.source === "user" ? -1 : 1))[0];
  if (!command) return false;

  // A personal permission explicitly overrides the rank lock for this command.
  if (command.source === "user") {
    if (command.allowed) return false;
    await ctx.reply(`🚫 ليس لديك صلاحية استخدام الأمر: ${command.command}`);
    return true;
  }

  if (await getDeveloperType(actor.id)) return false;
  const level = await getRankLevel(actor.id, ctx.chat.id);
  const required = locks[command.command];
  if (level >= (RANK_LEVELS[required] ?? 0)) return false;

  const messages = {
    "Dev": "• اعذرني هذا الأمر للـ Dev فقط.",
    "المالك": "• اعذرني بس هذا الأمر للمالك وفوق فقط.",
    "نائب المالك": "• اعذرني بس هذا الأمر لنائب المالك وفوق فقط.",
    "ادمن اساسي": "• اعذرني بس هذا الأمر للأدمن الأساسي وفوق فقط.",
    "ادمن": "• اعذرني بس هذا الأمر للأدمن وفوق فقط.",
    "مميز": "• اعذرني بس هذا الأمر للمميز وفوق فقط.",
  };
  await ctx.reply(messages[required] || "• اعذرني بس ما عندك الصلاحية لهذا الأمر.");
  return true;
}

export async function handleUserPermissionCommand(ctx) {
  const text = ctx.message?.text?.trim();
  const actor = ctx.from;
  if (!text || !actor || !/^(منع|سماح)\s+/.test(text)) return false;
  const parts = text.split(/\s+/);
  const action = parts[0];
  const actorDev = await getDeveloperType(actor.id);
  const actorGlobalRank = await getRank(actor.id, null);
  if (!actorDev && actorGlobalRank !== "المالك" && actorGlobalRank !== "Dev") {
    await ctx.reply("❌ هذا الأمر للمطور والمالك فقط.");
    return true;
  }

  let target;
  let command;
  const replied = ctx.message?.reply_to_message?.from;
  if (replied) {
    target = replied;
    command = parts.slice(1).join(" ").trim();
  } else {
    if (parts.length < 3) {
      await ctx.reply("❌ الاستخدام:\nمنع حظر @username\nمنع حظر 123456789\nأو بالرد على الشخص: منع حظر");
      return true;
    }
    target = await resolveTarget(ctx, parts[parts.length - 1]);
    command = parts.slice(1, -1).join(" ").trim();
    if (!target) {
      await ctx.reply("❌ لم أستطع العثور على الشخص.");
      return true;
    }
  }
  if (!command) {
    await ctx.reply("❌ اكتب اسم الأمر الذي تريد منعه أو السماح به.");
    return true;
  }
  if (target.id === actor.id) {
    await ctx.reply("❌ لا يمكنك تعديل صلاحيات نفسك.");
    return true;
  }
  if (Number(target.id) === 8453977662) {
    await ctx.reply("❌ لا يمكنك تعديل صلاحيات Dev الأساسي.");
    return true;
  }

  const actorLevel = actorDev === "primary" ? 7 : actorDev === "secondary" ? 6 : 5;
  const targetDev = await getDeveloperType(target.id);
  const targetLevel = targetDev === "primary" ? 7 : targetDev === "secondary" ? 6 : await getRankLevel(target.id, null);
  if (actorLevel < 5 || targetLevel >= actorLevel) {
    await ctx.reply("❌ لا يمكنك تعديل صلاحيات هذا الشخص.");
    return true;
  }

  await setUserPermission(ctx.chat.id, target.id, command, action === "سماح");
  const name = target.first_name || target.username || target.id;
  await ctx.reply(action === "منع"
    ? `🚫 تم منع ${name} من الأمر:\n↤︎ ${command}`
    : `✅ تم السماح لـ ${name} بالأمر:\n↤︎ ${command}`);
  return true;
}
