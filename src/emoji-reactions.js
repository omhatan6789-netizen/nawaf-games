import { pool } from "./db.js";
import { getDeveloperType } from "./ranks.js";

const LEGACY_OWNER_ID = 6496915877;
const pending = new Map();
let cachedRules = [];
let loaded = false;

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}
async function canManage(userId) {
  return Number(userId) === LEGACY_OWNER_ID || Boolean(await getDeveloperType(userId));
}
async function loadRules() {
  const result = await db().query(
    `SELECT match_type, keyword, emoji, custom_emoji_id, created_by
     FROM emoji_reaction_rules ORDER BY match_type, keyword`
  );
  cachedRules = result.rows;
  loaded = true;
}
async function saveRule(matchType, keyword, emoji, customEmojiId, userId) {
  await db().query(
    `INSERT INTO emoji_reaction_rules(match_type,keyword,emoji,custom_emoji_id,created_by)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(match_type,keyword) DO UPDATE SET
       emoji=EXCLUDED.emoji, custom_emoji_id=EXCLUDED.custom_emoji_id,
       created_by=EXCLUDED.created_by`,
    [matchType, keyword, emoji, customEmojiId, String(userId)]
  );
  await loadRules();
}
async function deleteRule(matchType, keyword) {
  const result = await db().query(
    "DELETE FROM emoji_reaction_rules WHERE match_type=$1 AND keyword=$2",
    [matchType, keyword]
  );
  await loadRules();
  return result.rowCount > 0;
}
function customEmojiId(message) {
  return (message.entities || []).find(entity => entity.type === "custom_emoji")?.custom_emoji_id ?? null;
}
function formatRules() {
  const normal = cachedRules.filter(rule => rule.match_type === "exact");
  const special = cachedRules.filter(rule => rule.match_type === "contains");
  const lines = ["قائمة الايموجيات المضافة بالبوت:", "", "الايموجيات العادية:"];
  if (normal.length) normal.forEach((rule, i) => lines.push(`${i + 1} ~ ${rule.keyword} ${rule.emoji}`));
  else lines.push("لا توجد ايموجيات عادية مضافة.");
  lines.push("", "—————————————————————", "", "الايموجيات المميزة:");
  if (special.length) special.forEach((rule, i) => lines.push(`${i + 1} ~ ${rule.keyword} ${rule.emoji}`));
  else lines.push("لا توجد ايموجيات مميزة مضافة.");
  return lines.join("\n");
}

export async function handleEmojiReactionsMessage(ctx) {
  const message = ctx.message;
  const user = ctx.from;
  const text = message?.text?.trim();
  if (!message || !user || !text) return false;
  if (!loaded) await loadRules();

  const isManagement = text === "الايموجيات المضافة" ||
    /^(اضف ايموجي(?: مميز)?|مسح ايموجي(?: مميز)?)(?:\s|$)/.test(text);
  if (isManagement) {
    if (!(await canManage(user.id))) return false;
    if (text === "الايموجيات المضافة") {
      await ctx.reply(formatRules());
      return true;
    }
    let match = text.match(/^اضف ايموجي مميز\s+(.+)$/);
    if (match) {
      pending.set(user.id, { matchType: "contains", keyword: match[1].trim() });
      await ctx.reply("• تمام، ارسل الإيموجي المميز الحين…");
      return true;
    }
    match = text.match(/^اضف ايموجي\s+(.+)$/);
    if (match) {
      pending.set(user.id, { matchType: "exact", keyword: match[1].trim() });
      await ctx.reply("• تمام ارسل الايموجي الحين…");
      return true;
    }
    match = text.match(/^مسح ايموجي مميز\s+(.+)$/);
    if (match) {
      const keyword = match[1].trim();
      const deleted = await deleteRule("contains", keyword);
      await ctx.reply(`• ${deleted ? "تم مسح" : "ما لقيت"} الإيموجي المميز للكلمة: ${keyword}`);
      return true;
    }
    match = text.match(/^مسح ايموجي\s+(.+)$/);
    if (match) {
      const keyword = match[1].trim();
      const deleted = await deleteRule("exact", keyword);
      await ctx.reply(`• ${deleted ? "تم مسح" : "ما لقيت"} الإيموجي العادي للكلمة: ${keyword}`);
      return true;
    }
    await ctx.reply(
      "الأوامر:\nاضف ايموجي الكلمة\nاضف ايموجي مميز الكلمة\nمسح ايموجي الكلمة\nمسح ايموجي مميز الكلمة\nالايموجيات المضافة"
    );
    return true;
  }

  const pendingRule = pending.get(user.id);
  if (pendingRule) {
    if (!(await canManage(user.id))) {
      pending.delete(user.id);
      return false;
    }
    const customId = customEmojiId(message);
    if (!customId && (text.length > 8 || text.split(/\s+/).length !== 1)) {
      await ctx.reply("• ارسل إيموجي واحد فقط.");
      return true;
    }
    try {
      await saveRule(pendingRule.matchType, pendingRule.keyword, text, customId, user.id);
      pending.delete(user.id);
      const kind = pendingRule.matchType === "contains" ? "المميز" : "العادي";
      await ctx.reply(`• تم حفظ الإيموجي ${kind} للكلمة: ${pendingRule.keyword} ${text}`);
    } catch (error) {
      console.error("Saving emoji reaction rule failed:", error);
      await ctx.reply("• صار خطأ أثناء حفظ الإيموجي، حاول مرة ثانية.");
    }
    return true;
  }

  const lowered = text.toLocaleLowerCase();
  for (const rule of cachedRules) {
    const keyword = String(rule.keyword).toLocaleLowerCase();
    const matched = rule.match_type === "exact" ? lowered === keyword : lowered.includes(keyword);
    if (!matched) continue;
    try {
      const reaction = rule.custom_emoji_id
        ? [{ type: "custom_emoji", custom_emoji_id: rule.custom_emoji_id }]
        : [{ type: "emoji", emoji: rule.emoji }];
      await ctx.api.setMessageReaction(ctx.chat.id, message.message_id, reaction);
    } catch (error) {
      console.warn(
        `Emoji reaction failed | chat=${ctx.chat.id} | message=${message.message_id}:`,
        error?.description || error?.message
      );
    }
    return false;
  }
  return false;
}

export async function preloadEmojiReactionRules() {
  await loadRules();
}
