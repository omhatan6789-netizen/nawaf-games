import { InlineKeyboard } from "grammy";
import { pool } from "./db.js";
import { getDeveloperType } from "./ranks.js";

const EXEMPT_USER_IDS = new Set([8453977662]);
const GROUP_CACHE_TTL = 30_000;
const MEMBER_CACHE_TTL = 15_000;
const NON_MEMBER_CACHE_TTL = 3_000;
const groupCache = new Map();
const memberCache = new Map();
const managementPattern = /^(?:ضع اجباري\s+.+|حذف اجباري\s+.+|مسح الاجباري|عرض الاجباري|الاجباري|تفعيل الاجباري|تعطيل الاجباري)$/;
const startAliases = new Set(["بدء البوت", "ابدأ البوت", "تشغيل البوت بالخاص"]);

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}
function isGroup(ctx) {
  return ["group", "supergroup"].includes(ctx.chat?.type);
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function invalidateGroup(chatId) {
  groupCache.delete(String(chatId));
}
function invalidateMembers(chatId) {
  const prefix = `${chatId}:`;
  for (const key of memberCache.keys()) if (key.startsWith(prefix)) memberCache.delete(key);
}
function parsePublicTarget(value) {
  const clean = String(value || "").trim();
  let username = clean;
  if (/^https?:\/\//i.test(clean)) {
    let parsed;
    try { parsed = new URL(clean); } catch { return null; }
    if (!["t.me", "www.t.me", "telegram.me", "www.telegram.me"].includes(parsed.hostname.toLowerCase())) return null;
    username = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
    if (!username || username.startsWith("+") || username.startsWith("joinchat/")) return null;
  }
  if (username.startsWith("@")) username = username.slice(1);
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
  if (["share", "proxy", "addstickers", "iv"].includes(username.toLowerCase())) return null;
  return username;
}
function memberStatus(member) {
  if (["creator", "administrator", "member"].includes(member.status)) return true;
  return member.status === "restricted" && Boolean(member.is_member);
}
async function getGroupConfig(chatId) {
  const key = String(chatId);
  const cached = groupCache.get(key);
  if (cached && Date.now() - cached.at < GROUP_CACHE_TTL) return cached.value;
  const [setting, requirements] = await Promise.all([
    db().query("SELECT enabled FROM mandatory_subscription_settings WHERE chat_id=$1", [key]),
    db().query(
      `SELECT id, requirement_type, target_chat_id, target, title, join_url
       FROM mandatory_subscription_requirements WHERE group_id=$1 ORDER BY id`,
      [key]
    ),
  ]);
  const value = {
    enabled: Boolean(setting.rows[0]?.enabled),
    requirements: requirements.rows,
  };
  groupCache.set(key, { at: Date.now(), value });
  return value;
}
async function isChatMember(ctx, userId, targetChatId) {
  const key = `${targetChatId}:${userId}`;
  const cached = memberCache.get(key);
  const ttl = cached?.member ? MEMBER_CACHE_TTL : NON_MEMBER_CACHE_TTL;
  if (cached && Date.now() - cached.at < ttl) return cached.member;
  try {
    const member = await ctx.api.getChatMember(Number(targetChatId), Number(userId));
    const value = memberStatus(member);
    memberCache.set(key, { at: Date.now(), member: value });
    return value;
  } catch (error) {
    console.warn("[MANDATORY] membership check failed:", error?.description || error?.message);
    memberCache.set(key, { at: Date.now(), member: false });
    return false;
  }
}
async function requirementSatisfied(ctx, userId, req) {
  if (req.requirement_type === "start") {
    const result = await db().query(
      "SELECT 1 FROM developer_private_starts WHERE user_id=$1",
      [String(userId)]
    );
    return result.rowCount > 0;
  }
  if (req.requirement_type === "chat" && req.target_chat_id != null) {
    return isChatMember(ctx, userId, req.target_chat_id);
  }
  return false;
}
async function saveRequirement(groupId, type, targetChatId, target, title, joinUrl) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    if (type === "start") {
      await client.query(
        "DELETE FROM mandatory_subscription_requirements WHERE group_id=$1 AND requirement_type='start'",
        [String(groupId)]
      );
    }
    await client.query(
      `INSERT INTO mandatory_subscription_requirements
       (group_id, requirement_type, target_chat_id, target, title, join_url)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(group_id,requirement_type,target)
       DO UPDATE SET target_chat_id=EXCLUDED.target_chat_id,
         title=EXCLUDED.title, join_url=EXCLUDED.join_url`,
      [String(groupId), type, targetChatId, target, title, joinUrl]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
async function removeRequirement(groupId, type, target = null) {
  const result = type === "start"
    ? await db().query(
      "DELETE FROM mandatory_subscription_requirements WHERE group_id=$1 AND requirement_type='start'",
      [String(groupId)]
    )
    : await db().query(
      "DELETE FROM mandatory_subscription_requirements WHERE group_id=$1 AND requirement_type='chat' AND target=$2",
      [String(groupId), target]
    );
  return result.rowCount;
}
async function setEnabled(groupId, enabled, userId) {
  await db().query(
    `INSERT INTO mandatory_subscription_settings(chat_id,enabled,updated_by,updated_at)
     VALUES($1,$2,$3,NOW())
     ON CONFLICT(chat_id) DO UPDATE SET enabled=EXCLUDED.enabled,
       updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
    [String(groupId), Boolean(enabled), String(userId)]
  );
  const cached = groupCache.get(String(groupId));
  if (cached) {
    cached.value.enabled = Boolean(enabled);
    cached.at = Date.now();
  }
}

export async function recordPrivateStart(ctx) {
  if (ctx.chat?.type !== "private" || !ctx.from || ctx.from.is_bot) return;
  await db().query(
    `INSERT INTO developer_private_starts(user_id,username,first_name,started_at,last_start_at)
     VALUES($1,$2,$3,NOW(),NOW()) ON CONFLICT(user_id) DO UPDATE SET
     username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_start_at=NOW()`,
    [String(ctx.from.id),ctx.from.username||null,ctx.from.first_name||null]
  );
}

export async function handleMandatorySubscriptionCommand(ctx) {
  const text = ctx.message?.text?.trim();
  if (!text || !managementPattern.test(text)) return false;
  if (!isGroup(ctx)) {
    await ctx.reply("• استخدم أوامر الاشتراك الإجباري داخل القروب.");
    return true;
  }
  const actorId = ctx.from?.id;
  if (!actorId || !(await getDeveloperType(actorId))) {
    await ctx.reply("• هذا الأمر للمالك والمطورين فقط.");
    return true;
  }
  const groupId = ctx.chat.id;

  if (text === "تفعيل الاجباري") {
    const config = await getGroupConfig(groupId);
    if (!config.requirements.length) {
      await ctx.reply(
        "• ما أضفت أي شرط حتى الآن.\nأضف قناة/قروب بكتابة: ضع اجباري @username\nأو أضف شرط بدء البوت: ضع اجباري بدء البوت"
      );
      return true;
    }
    await setEnabled(groupId, true, actorId);
    await ctx.reply("• تم تفعيل الاشتراك الإجباري في هذه المجموعة.");
    return true;
  }
  if (text === "تعطيل الاجباري") {
    await setEnabled(groupId, false, actorId);
    await ctx.reply("• تم تعطيل الاشتراك الإجباري في هذه المجموعة.");
    return true;
  }
  if (text === "عرض الاجباري" || text === "الاجباري") {
    const config = await getGroupConfig(groupId);
    const lines = [
      `• حالة الاشتراك الإجباري: ${config.enabled ? "مفعّل" : "معطّل"}`,
      "",
      "الشروط المسجلة:",
    ];
    if (!config.requirements.length) lines.push("• ما فيه شروط مضافة.");
    config.requirements.forEach((req, i) => {
      lines.push(req.requirement_type === "start"
        ? `${i + 1}. ${req.title} (بدء البوت بالخاص)`
        : `${i + 1}. ${req.title} — ${req.target}`);
    });
    lines.push("", "لإضافة شرط: ضع اجباري @username أو ضع اجباري بدء البوت");
    lines.push("لحذف شرط: حذف اجباري @username أو حذف اجباري بدء البوت");
    await ctx.reply(lines.join("\n"));
    return true;
  }
  if (text === "مسح الاجباري") {
    const client = await db().connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM mandatory_subscription_requirements WHERE group_id=$1", [String(groupId)]);
      await client.query(
        "UPDATE mandatory_subscription_settings SET enabled=FALSE,updated_by=$1,updated_at=NOW() WHERE chat_id=$2",
        [String(actorId), String(groupId)]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
    invalidateGroup(groupId);
    await ctx.reply("• تم حذف جميع شروط الاشتراك الإجباري وتعطيله في هذه المجموعة.");
    return true;
  }
  if (text.startsWith("حذف اجباري ")) {
    const value = text.slice("حذف اجباري ".length).trim();
    let count;
    if (startAliases.has(value)) count = await removeRequirement(groupId, "start");
    else {
      const username = parsePublicTarget(value);
      count = await removeRequirement(groupId, "chat", username ? `@${username}` : value);
    }
    invalidateGroup(groupId);
    await ctx.reply(count ? "• تم حذف الشرط." : "• ما لقيت هذا الشرط ضمن الشروط المسجلة.");
    return true;
  }
  if (text.startsWith("ضع اجباري ")) {
    const value = text.slice("ضع اجباري ".length).trim();
    if (startAliases.has(value)) {
      await saveRequirement(groupId, "start", null, "start", "بدء البوت في الخاص", "https://t.me/");
      invalidateGroup(groupId);
      await ctx.reply("• تمت إضافة شرط بدء البوت.\nأي شخص ما سبق أرسل /start للبوت لازم يفتحه ويضغط ابدأ.");
      return true;
    }

    const [targetValue, ...urlParts] = value.split(/\s+/);
    const customUrl = urlParts.join(" ").trim() || null;
    const username = parsePublicTarget(targetValue);
    const chatIdentifier = username ? `@${username}` : targetValue;
    if (!username && !/^-?\d{5,20}$/.test(chatIdentifier)) {
      await ctx.reply(
        "• ما قدرت أتحقق من هذا الهدف.\nاستخدم @username لقناة/قروب عام، أو ارسل آيدي القناة/القروب ثم رابط الدعوة الخاص.\nروابط الدعوة الخاصة وحدها لا تسمح للبوت بمعرفة القروب للتحقق من العضوية."
      );
      return true;
    }
    let targetChat;
    try {
      targetChat = await ctx.api.getChat(chatIdentifier);
    } catch (error) {
      await ctx.reply(
        "• ما قدرت أوصل للقناة/القروب. تأكد أن اليوزر أو الآيدي صحيح، وأن البوت مضاف للمكان ومشرف فيه.\nالتفاصيل: " +
        (error?.description || error?.message || "خطأ غير معروف")
      );
      return true;
    }
    if (!["channel", "group", "supergroup"].includes(targetChat.type)) {
      await ctx.reply("• الهدف لازم يكون قناة أو قروب تيليجرام، مو حساب شخصي.");
      return true;
    }
    let joinUrl = customUrl;
    if (customUrl) {
      try {
        const parsed = new URL(customUrl);
        if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) throw new Error();
      } catch {
        await ctx.reply("• رابط الدعوة غير صحيح.");
        return true;
      }
    } else if (targetChat.username) {
      joinUrl = `https://t.me/${targetChat.username}`;
    } else {
      await ctx.reply("• هذه قناة/مجموعة خاصة. استخدم الصيغة التالية مع رابط الدعوة:\nضع اجباري -1001234567890 https://t.me/+رابط_الدعوة");
      return true;
    }
    const title = targetChat.title || (targetChat.username ? `@${targetChat.username}` : String(targetChat.id));
    const storedTarget = targetChat.username ? `@${targetChat.username}` : String(targetChat.id);
    await saveRequirement(groupId, "chat", targetChat.id, storedTarget, title, joinUrl);
    invalidateGroup(groupId);
    invalidateMembers(targetChat.id);
    await ctx.reply(
      `• تمت إضافة شرط الاشتراك في <b>${escapeHtml(title)}</b>.\nتأكد أن البوت مشرف في القناة/القروب حتى يقدر يتحقق من العضوية.`,
      { parse_mode: "HTML" }
    );
    return true;
  }
  return false;
}

export async function enforceMandatorySubscription(ctx) {
  const chat = ctx.chat;
  const user = ctx.from;
  const message = ctx.message;
  if (!isGroup(ctx) || !message || !user || user.is_bot || EXEMPT_USER_IDS.has(user.id)) return false;
  if (message.new_chat_members || message.left_chat_member || message.group_chat_created || message.supergroup_chat_created || message.channel_chat_created) return false;
  const text = message.text || message.caption || "";
  if (text && managementPattern.test(text.trim())) return false;

  let config;
  try { config = await getGroupConfig(chat.id); }
  catch (error) {
    console.error("[MANDATORY] database error:", error);
    return false;
  }
  if (!config.enabled || !config.requirements.length) return false;

  const missing = [];
  for (const req of config.requirements) {
    if (!(await requirementSatisfied(ctx, user.id, req))) missing.push(req);
  }
  if (!missing.length) return false;

  try { await ctx.deleteMessage(); }
  catch (error) { console.warn("[MANDATORY] unable to delete message:", error?.description || error?.message); }

  const name = escapeHtml(user.first_name || user.username || "مستخدم");
  const lines = [
    `• يالامير ~ <a href="tg://user?id=${user.id}">${name}</a>`,
    "مايمديك ترسل أي رسالة هنا لازم تستوفي الشروط تحت ⚠️",
    "تأكد أنك مستوفي الشروط التالية:",
  ];
  const keyboard = new InlineKeyboard();
  let botUsername = null;
  if (missing.some(req => req.requirement_type === "start")) {
    try { botUsername = (await ctx.api.getMe()).username; } catch {}
  }
  for (const req of missing) {
    lines.push(`• ${escapeHtml(req.title)}`);
    if (req.requirement_type === "start") {
      if (botUsername) keyboard.url("افتح البوت واضغط ابدأ", `https://t.me/${botUsername}?start=mandatory`).row();
    } else if (req.join_url) {
      keyboard.url(`اشترك في ${String(req.title).slice(0, 45)}`, req.join_url).row();
    }
  }
  try {
    await ctx.api.sendMessage(chat.id, lines.join("\n"), {
      parse_mode: "HTML",
      reply_markup: keyboard.inline_keyboard.length ? keyboard : undefined,
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    console.warn("[MANDATORY] unable to send notice:", error?.description || error?.message);
  }
  return true;
}
