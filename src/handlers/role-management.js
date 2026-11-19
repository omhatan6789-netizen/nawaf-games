import { InlineKeyboard } from "grammy";
import { pool } from "../db.js";
import {
  OWNER_ID, NORMAL_RANKS, RANK_LEVELS, getRankLevel, getDeveloperType,
  getGroupRankUsers, getUsersByGroupRank, getSecondaryDevelopers,
  clearSecondaryDevelopers, clearRankList, clearGroupRanks, clearLowerGroupRanks,
  checkCommandPermission,
} from "../ranks.js";

const LISTS = {
  "المميزين": "مميز",
  "الادمنية": "ادمن",
  "الادمنية الاساسيين": "ادمن اساسي",
  "نواب المالك": "نائب المالك",
  "المالكين": "المالك",
};
const TITLES = {
  "مميز": "المميزين",
  "ادمن": "الادمنية",
  "ادمن اساسي": "الادمنية الاساسيين",
  "نائب المالك": "نواب المالك",
  "المالك": "المالكين",
};
const CLEAR_COMMANDS = {
  "مسح المميزين": "مميز",
  "مسح الادمنية": "ادمن",
  "مسح الادمنية الاساسيين": "ادمن اساسي",
  "مسح نواب المالك": "نائب المالك",
  "مسح المالكين": "المالك",
};
const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}
function inGroup(ctx) {
  return ["group", "supergroup"].includes(ctx.chat?.type);
}
function mention(id, name) {
  return `<a href="tg://user?id=${Number(id)}">${esc(name || id)}</a>`;
}
async function userMention(ctx, id) {
  try {
    const chat = await ctx.api.getChat(id);
    return mention(id, chat.first_name || chat.title || chat.username || id);
  } catch {
    const result = await db().query(
      "SELECT first_name, username FROM users WHERE user_id=$1",
      [String(id)]
    );
    const row = result.rows[0];
    return mention(id, row?.first_name || row?.username || id);
  }
}
async function resolveTarget(ctx) {
  const replied = ctx.message?.reply_to_message?.from;
  if (replied) return replied;
  const parts = (ctx.message?.text || "").trim().split(/\s+/);
  const token = parts.slice(1).find(part => /^\d+$/.test(part) || part.startsWith("@"));
  if (!token) return null;
  if (/^\d+$/.test(token)) {
    const result = await db().query(
      "SELECT user_id, username, first_name, is_bot FROM users WHERE user_id=$1",
      [token]
    );
    const row = result.rows[0];
    return row
      ? { id: Number(row.user_id), username: row.username, first_name: row.first_name, is_bot: row.is_bot }
      : { id: Number(token), first_name: token };
  }
  const username = token.slice(1).toLowerCase();
  const result = await db().query(
    "SELECT user_id, username, first_name, is_bot FROM users WHERE LOWER(username)=$1 LIMIT 1",
    [username]
  );
  const row = result.rows[0];
  if (row) return { id: Number(row.user_id), username: row.username, first_name: row.first_name, is_bot: row.is_bot };
  try {
    const chat = await ctx.api.getChat(token);
    return { id: chat.id, username: chat.username, first_name: chat.first_name || chat.title };
  } catch {
    return null;
  }
}

export async function handleRoleManagementCommand(ctx) {
  const text = ctx.message?.text?.trim();
  const actor = ctx.from;
  if (!text || !actor) return false;
  const chatId = inGroup(ctx) ? ctx.chat.id : null;
  const actorDev = await getDeveloperType(actor.id);

  if (text === "كشف المجموعة") {
    if (!chatId) {
      await ctx.reply("❌ استخدم الأمر داخل القروب.");
      return true;
    }
    const permission = await checkCommandPermission(actor.id, text, chatId);
    if (!permission.allowed) {
      await ctx.reply(`❌ هذا الأمر لـ ${permission.required} وفوق فقط.`);
      return true;
    }
    const rows = await getGroupRankUsers(chatId);
    const buckets = Object.fromEntries(NORMAL_RANKS.map(rank => [rank, []]));
    for (const row of rows) buckets[row.rank]?.push(await userMention(ctx, row.userId));
    const sections = [
      ["• قائمة المالك", "المالك"],
      ["• قائمة نواب المالك", "نائب المالك"],
      ["• قائمة الادمنية الاساسيين", "ادمن اساسي"],
      ["• قائمة الادمنية", "ادمن"],
      ["• قائمة المميزين", "مميز"],
    ];
    const lines = ["كشف المجموعة: 📋", ""];
    for (const [title, rank] of sections) {
      lines.push(title, "━━━━━━━━━━━━");
      const names = buckets[rank];
      lines.push(...(names.length ? names.map((name, i) => `${i + 1} - ${name}`) : ["لا يوجد"]), "");
    }
    await ctx.reply(lines.join("\n").trim(), { parse_mode: "HTML" });
    return true;
  }

  if (Object.hasOwn(LISTS, text)) {
    if (!chatId) {
      await ctx.reply("❌ قوائم الرتب تعرض داخل القروب.");
      return true;
    }
    const rank = LISTS[text];
    const level = await getRankLevel(actor.id, chatId);
    if (actor.id !== OWNER_ID && !actorDev && level <= RANK_LEVELS[rank]) {
      const denied = {
        "ادمن": "• هذا الأمر للأدمن الأساسي وفوق.",
        "ادمن اساسي": "• هذا الأمر للمالك وفوق.",
        "المالك": "• هذا الأمر للمالك وDev فقط.",
      }[rank] || "• هذا الأمر لرتبة أعلى منك.";
      await ctx.reply(denied);
      return true;
    }
    const users = await getUsersByGroupRank(chatId, rank);
    const lines = [`• قائمة ${TITLES[rank]}`, "━━━━━━━━━━━━"];
    if (users.length) {
      for (let i = 0; i < users.length; i++) lines.push(`${i + 1} - ${await userMention(ctx, users[i])}`, "");
    } else lines.push("لا يوجد");
    const keyboard = new InlineKeyboard().text("مسح القائمة", `roles_clear:${rank}`);
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: keyboard });
    return true;
  }

  if (text === "قائمة Dev") {
    if (actor.id !== OWNER_ID && actorDev !== "primary") {
      await ctx.reply("❌ هذا الأمر للمطور الأساسي فقط.");
      return true;
    }
    const developers = await getSecondaryDevelopers();
    const lines = [
      "أهلًا بك عزيزي المطور في قائمة Dev الخاص بك🎖️",
      "",
      "المطور الأساسي👇🏻",
      "",
      await userMention(ctx, OWNER_ID),
      "",
      "المساعدين 🎖️",
      "—————————————————",
      "",
    ];
    if (developers.length) {
      for (let i = 0; i < developers.length; i++) lines.push(`${i + 1} - ${await userMention(ctx, developers[i])}`, "");
    } else lines.push("ما فيه أحد رتبته Dev حاليًا.");
    const keyboard = new InlineKeyboard().text("مسح القائمة", "roles_clear:Dev");
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: keyboard });
    return true;
  }

  if (text === "مسح مطورين Dev") {
    if (actor.id !== OWNER_ID && actorDev !== "primary") {
      await ctx.reply("❌ هذا الأمر للمطور الأساسي فقط.");
      return true;
    }
    const deleted = await clearSecondaryDevelopers();
    await ctx.reply(`• تم مسح جميع مطورين Dev المساعدين بنجاح.\n「 ${deleted} 」مساعدين`);
    return true;
  }

  if (text === "تنزيل الكل") {
    if (!chatId) {
      await ctx.reply("❌ استخدم الأمر داخل القروب.");
      return true;
    }
    const target = await resolveTarget(ctx);
    if (!target) {
      await ctx.reply("❌ رد على الشخص أو اكتب آيديه/يوزره بعد الأمر.");
      return true;
    }
    if (target.id === OWNER_ID) {
      await ctx.reply("❌ لا يمكن تعديل المطور الأساسي.");
      return true;
    }
    const targetLevel = await getRankLevel(target.id, chatId);
    const actorLevel = await getRankLevel(actor.id, chatId);
    if (!actorDev && targetLevel !== actorLevel) {
      await ctx.reply("• عيب عيب احترم اللي أعلى منك.");
      return true;
    }
    if (actorDev === "secondary" && target.id === actor.id) {
      await ctx.reply("❌ لا يمكنك إزالة Dev من نفسك.");
      return true;
    }
    const deleted = await clearLowerGroupRanks(chatId, target.id, actorDev ? 6 : actorLevel);
    await ctx.reply(
      `• تم تنزيل جميع الرتب الأقل منه بنجاح.\n• المستخدم ↤︎ ${await userMention(ctx, target.id)}\n• عدد الرتب التي تم تنزيلها ↤︎「 ${deleted} 」`,
      { parse_mode: "HTML" }
    );
    return true;
  }

  if (Object.hasOwn(CLEAR_COMMANDS, text)) {
    if (!chatId) {
      await ctx.reply("❌ استخدم الأمر داخل القروب.");
      return true;
    }
    const rank = CLEAR_COMMANDS[text];
    const level = await getRankLevel(actor.id, chatId);
    const allowed = actor.id === OWNER_ID || actorDev === "primary" ||
      (rank === "المالك" ? level >= RANK_LEVELS[rank] : level > RANK_LEVELS[rank]);
    if (!allowed) {
      const denied = {
        "مميز": "• هذا الأمر للأدمن وفوق.",
        "ادمن": "• هذا الأمر للأدمن الأساسي وفوق.",
        "ادمن اساسي": "• هذا الأمر للمالك وفوق.",
        "نائب المالك": "• هذا الأمر للمالك وفوق.",
        "المالك": "• هذا الأمر للمالك وDev فقط.",
      }[rank] || "• هذا الأمر لرتبة أعلى منك.";
      await ctx.reply(denied);
      return true;
    }
    const deleted = await clearRankList(chatId, rank);
    await ctx.reply(`• تم مسح القائمة بنجاح.\n「 ${deleted} 」${TITLES[rank]}`);
    return true;
  }

  if (text === "مسح الكل") {
    if (!chatId) {
      await ctx.reply("❌ استخدم الأمر داخل القروب.");
      return true;
    }
    if (actor.id !== OWNER_ID && actorDev !== "primary") {
      await ctx.reply("❌ هذا الأمر للمطور الأساسي فقط.");
      return true;
    }
    const counts = await clearGroupRanks(chatId);
    const devCount = await clearSecondaryDevelopers();
    await ctx.reply(
      `• تم مسح الكل بنجاح.\n「 ${devCount} 」Dev/مساعدين المطور\n• المالكين ↤︎「 ${counts["المالك"]} 」\n• نواب المالك ↤︎「 ${counts["نائب المالك"]} 」\n• الادمنية الاساسيين ↤︎「 ${counts["ادمن اساسي"]} 」\n• الادمنية ↤︎「 ${counts["ادمن"]} 」\n• المميزين ↤︎「 ${counts["مميز"]} 」`
    );
    return true;
  }

  return false;
}

export async function handleRolesClearCallback(ctx) {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("roles_clear:")) return;
  const actor = ctx.from;
  const rank = data.slice("roles_clear:".length);
  const actorDev = await getDeveloperType(actor.id);
  if (rank === "Dev") {
    if (actor.id !== OWNER_ID && actorDev !== "primary") {
      await ctx.answerCallbackQuery({ text: "هذا الأمر للمطور الأساسي فقط.", show_alert: true });
      return;
    }
    const deleted = await clearSecondaryDevelopers();
    await ctx.answerCallbackQuery({ text: "تم مسح القائمة." });
    await ctx.editMessageText(`• تم مسح القائمة بنجاح.\n「 ${deleted} 」مساعدين Dev`);
    return;
  }
  if (!NORMAL_RANKS.includes(rank) || !ctx.callbackQuery.message) {
    await ctx.answerCallbackQuery();
    return;
  }
  const chatId = ctx.callbackQuery.message.chat.id;
  const level = await getRankLevel(actor.id, chatId);
  const allowed = actor.id === OWNER_ID || actorDev === "primary" ||
    (rank === "المالك" ? level >= RANK_LEVELS[rank] : level > RANK_LEVELS[rank]);
  if (!allowed) {
    await ctx.answerCallbackQuery({ text: "هذا الأمر لرتبة أعلى منك.", show_alert: true });
    return;
  }
  const deleted = await clearRankList(chatId, rank);
  await ctx.answerCallbackQuery({ text: "تم مسح القائمة." });
  await ctx.editMessageText(`• تم مسح القائمة بنجاح.\n「 ${deleted} 」${TITLES[rank]}`);
}
