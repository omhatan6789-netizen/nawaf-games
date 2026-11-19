import { pool } from "./db.js";
import { getRankLevel } from "./ranks.js";

const OWNER_ID = 8453977662;
const pending = new Map();

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}
function isGroup(ctx) {
  return ["group", "supergroup"].includes(ctx.chat?.type);
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
}
async function rankLevel(ctx, userId = ctx.from.id) {
  try { return await getRankLevel(userId, ctx.chat.id); } catch { return 0; }
}
async function isGroupAdmin(ctx) {
  if (ctx.from.id === OWNER_ID || await rankLevel(ctx) >= 2) return true;
  try {
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    return ["administrator", "creator"].includes(member.status);
  } catch { return false; }
}
async function isOwner(ctx) {
  if (ctx.from.id === OWNER_ID || await rankLevel(ctx) >= 5) return true;
  try { return (await ctx.api.getChatMember(ctx.chat.id, ctx.from.id)).status === "creator"; }
  catch { return false; }
}
async function settings(chatId) {
  await db().query("INSERT INTO group_profile_settings(chat_id) VALUES($1) ON CONFLICT(chat_id) DO NOTHING", [String(chatId)]);
  const r = await db().query("SELECT admin_replies_enabled, owner_user_id FROM group_profile_settings WHERE chat_id=$1", [String(chatId)]);
  return r.rows[0];
}
async function sendAdminProfile(ctx, userId) {
  let user;
  try { user = await ctx.api.getChat(userId); } catch { return false; }
  const bio = esc(user.bio || "لا يوجد بايو.");
  const name = esc(user.first_name || "المستخدم");
  const caption = `USE ↦ <a href="tg://user?id=${userId}">${name}</a>\nBio ↦ ${bio}`;
  try {
    const photos = await ctx.api.getUserProfilePhotos(userId, { limit: 1 });
    const photo = photos.photos?.[0]?.at(-1);
    if (photo) await ctx.replyWithPhoto(photo.file_id, { caption, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: user.first_name || "الحساب", url: `tg://user?id=${userId}` }]] } });
    else await ctx.reply(caption, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: user.first_name || "الحساب", url: `tg://user?id=${userId}` }]] } });
    return true;
  } catch (error) {
    console.warn("Admin profile reply failed:", error?.description || error?.message);
    return false;
  }
}

export async function handleProfileReplies(ctx) {
  const text = ctx.message?.text?.trim();
  if (!text || !ctx.from || !isGroup(ctx)) return false;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const key = `${chatId}:${userId}`;
  const session = pending.get(key);

  if (session === "developer_username" || session === "owner_username") {
    pending.delete(key);
    if (!/^@[A-Za-z0-9_]{5,32}$/.test(text)) {
      await ctx.reply("• اليوزر غير صحيح، تم إلغاء العملية.");
      return true;
    }
    const found = await db().query(
      "SELECT user_id FROM users WHERE LOWER(username)=$1 LIMIT 1",
      [text.slice(1).toLowerCase()]
    );
    if (!found.rowCount) {
      await ctx.reply("• اليوزر غير موجود في المجموعة، تم إلغاء العملية.");
      return true;
    }
    const targetId = Number(found.rows[0].user_id);
    try {
      const member = await ctx.api.getChatMember(chatId, targetId);
      if (["left", "kicked"].includes(member.status)) {
        await ctx.reply("• اليوزر غير موجود في المجموعة، تم إلغاء العملية.");
        return true;
      }
      if (session === "developer_username") {
        await db().query(
          "INSERT INTO profile_settings(profile_type,user_id,username) VALUES('developer',$1,$2) ON CONFLICT(profile_type) DO UPDATE SET user_id=EXCLUDED.user_id,username=EXCLUDED.username",
          [String(targetId), text]
        );
        await ctx.reply("• تم تغيير يوزر المطور بنجاح.");
      } else {
        await db().query(
          "INSERT INTO group_profile_settings(chat_id,owner_user_id,owner_username) VALUES($1,$2,$3) ON CONFLICT(chat_id) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id,owner_username=EXCLUDED.owner_username",
          [String(chatId), String(targetId), text]
        );
        await ctx.reply("• تم تغيير يوزر المالك بنجاح.");
      }
    } catch (error) {
      console.warn("Saving profile username failed:", error?.description || error?.message);
      await ctx.reply("• تعذر التحقق من عضوية اليوزر، تم إلغاء العملية.");
    }
    return true;
  }

  if (text === "تغيير يوزر المطور") {
    if (userId !== OWNER_ID) { await ctx.reply("• هذا الأمر للمطور الأساسي فقط."); return true; }
    pending.set(key, "developer_username");
    await ctx.reply("حسنًا، ارسل يوزر المطور الجديد.");
    return true;
  }

  if (text === "تغيير يوزر المالك") {
    if (!await isOwner(ctx)) { await ctx.reply("• هذا الأمر للمالك ومن فوق."); return true; }
    pending.set(key, "owner_username");
    await ctx.reply("حسنًا، ارسل يوزر المالك الجديد.");
    return true;
  }

  if (text === "المطور") {
    const saved = await db().query("SELECT user_id FROM profile_settings WHERE profile_type='developer'");
    const devId = Number(saved.rows[0]?.user_id || OWNER_ID);
    try {
      const dev = await ctx.api.getChat(devId);
      const botInfo = await ctx.api.getMe();
      const bio = esc(dev.bio || "لا يوجد بايو.");
      const name = esc(dev.first_name || "المطور");
      const caption = `Dev Bot ↦ ${esc(botInfo.first_name || "البوت")}\n━━━━━━━━━━━━━━\nDev ↦ <a href="tg://user?id=${devId}">${name}</a>\nBio ↦ ${bio}`;
      const photos = await ctx.api.getUserProfilePhotos(devId, { limit: 1 });
      const photo = photos.photos?.[0]?.at(-1);
      if (photo) await ctx.replyWithPhoto(photo.file_id, { caption, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: dev.first_name || "الحساب", url: `tg://user?id=${devId}` }]] } });
      else await ctx.reply(caption, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: dev.first_name || "الحساب", url: `tg://user?id=${devId}` }]] } });
    } catch { await ctx.reply("• تعذر العثور على حساب المطور."); }
    return true;
  }

  if (text === "المالك") {
    let ownerId = null;
    const cfg = await settings(chatId);
    if (cfg?.owner_user_id) ownerId = Number(cfg.owner_user_id);
    if (!ownerId) {
      try {
        const admins = await ctx.api.getChatAdministrators(chatId);
        ownerId = admins.find(item => item.status === "creator")?.user?.id || null;
      } catch {}
    }
    if (!ownerId) { await ctx.reply("• تعذر العثور على مالك المجموعة."); return true; }
    try {
      const owner = await ctx.api.getChat(ownerId);
      const groupName = esc(ctx.chat.title || "المجموعة");
      const bio = esc(owner.bio || "لا يوجد بايو.");
      const name = esc(owner.first_name || "المالك");
      const caption = `Owner group ↦ ${groupName}\n━━━━━━━━━━━━━━\nUSE ↦ <a href="tg://user?id=${ownerId}">${name}</a>\nbio ↦ ${bio}`;
      const photos = await ctx.api.getUserProfilePhotos(ownerId, { limit: 1 });
      const photo = photos.photos?.[0]?.at(-1);
      if (photo) await ctx.replyWithPhoto(photo.file_id, { caption, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: owner.first_name || "الحساب", url: `tg://user?id=${ownerId}` }]] } });
      else await ctx.reply(caption, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: owner.first_name || "الحساب", url: `tg://user?id=${ownerId}` }]] } });
    } catch { await ctx.reply("• تعذر العثور على مالك المجموعة."); }
    return true;
  }

  if (session === "add") {
    pending.delete(key);
    if (!text || text.includes("\n")) { await ctx.reply("• اسم الرد غير صحيح، تم إلغاء العملية."); return true; }
    const cfg = await settings(chatId);
    if (!cfg?.admin_replies_enabled) { await ctx.reply("• ردود الادمن غير مفعلة في هذه المجموعة."); return true; }
    const old = await db().query("SELECT reply_name FROM admin_replies WHERE chat_id=$1 AND admin_user_id=$2", [String(chatId), String(userId)]);
    if (old.rowCount) { await ctx.reply(`عندك رد قديم اسمه (${old.rows[0].reply_name}) اكتب حذف ردي لحذفه وإضافة رد جديد!`); return true; }
    const dup = await db().query("SELECT 1 FROM admin_replies WHERE chat_id=$1 AND reply_name=$2", [String(chatId), text]);
    if (dup.rowCount) { await ctx.reply("• اسم الرد مستخدم بالفعل، تم إلغاء العملية."); return true; }
    await db().query("INSERT INTO admin_replies(chat_id,admin_user_id,reply_name) VALUES($1,$2,$3)", [String(chatId), String(userId), text]);
    await ctx.reply("تم إضافة ردك الجديد!\nاكتب اسم الرد في المجموعة لتجربته.");
    return true;
  }

  if (text === "تفعيل ردود الادمن" || text === "تعطيل ردود الادمن") {
    if (!await isOwner(ctx)) { await ctx.reply("• هذا الأمر للمالك ومن فوق."); return true; }
    const enabled = text === "تفعيل ردود الادمن";
    await db().query(`INSERT INTO group_profile_settings(chat_id,admin_replies_enabled) VALUES($1,$2) ON CONFLICT(chat_id) DO UPDATE SET admin_replies_enabled=EXCLUDED.admin_replies_enabled`, [String(chatId), enabled]);
    await ctx.reply(enabled ? "• تم تفعيل ردود الادمن." : "• تم تعطيل ردود الادمن.");
    return true;
  }

  if (text === "اضف ردي") {
    if (!await isGroupAdmin(ctx)) { await ctx.reply("• هذا الأمر للادمن ومن فوق."); return true; }
    const cfg = await settings(chatId);
    if (!cfg?.admin_replies_enabled) { await ctx.reply("• ردود الادمن غير مفعلة في هذه المجموعة."); return true; }
    const old = await db().query("SELECT reply_name FROM admin_replies WHERE chat_id=$1 AND admin_user_id=$2", [String(chatId), String(userId)]);
    if (old.rowCount) { await ctx.reply(`عندك رد قديم اسمه (${old.rows[0].reply_name}) اكتب حذف ردي لحذفه وإضافة رد جديد!`); return true; }
    pending.set(key, "add");
    await ctx.reply("حسنًا، ارسل كلمة الرد");
    return true;
  }

  if (text === "حذف ردي") {
    if (!await isGroupAdmin(ctx)) return true;
    const result = await db().query("DELETE FROM admin_replies WHERE chat_id=$1 AND admin_user_id=$2", [String(chatId), String(userId)]);
    await ctx.reply(result.rowCount ? "• تم حذف ردك." : "• ما عندك رد ادمن.");
    return true;
  }

  if (text === "ردود الادمن") {
    const rows = await db().query("SELECT admin_user_id,reply_name FROM admin_replies WHERE chat_id=$1 ORDER BY created_date,admin_user_id", [String(chatId)]);
    if (!rows.rowCount) { await ctx.reply("• ردود الاعضاء في المجموعة :\n\nلا يوجد ردود ادمن."); return true; }
    const lines = ["• ردود الاعضاء في المجموعة :", ""];
    for (let i=0;i<rows.rows.length;i++) {
      const row=rows.rows[i];
      let name="عضو";
      try { name=(await ctx.api.getChat(Number(row.admin_user_id))).first_name || name; } catch {}
      lines.push(`${i+1} - 〖 ${row.reply_name} 〗- ${name}`);
    }
    await ctx.reply(lines.join("\n"));
    return true;
  }

  if (text === "حذف رد ادمن" && ctx.message.reply_to_message?.from) {
    if (!await isOwner(ctx)) { await ctx.reply("• هذا الأمر للمالك ومن فوق."); return true; }
    await db().query("DELETE FROM admin_replies WHERE chat_id=$1 AND admin_user_id=$2", [String(chatId), String(ctx.message.reply_to_message.from.id)]);
    await ctx.reply("تم حذف رده.");
    return true;
  }

  const match = await db().query("SELECT admin_user_id FROM admin_replies WHERE chat_id=$1 AND reply_name=$2", [String(chatId), text]);
  if (match.rowCount) {
    await sendAdminProfile(ctx, Number(match.rows[0].admin_user_id));
    return true;
  }
  return false;
}
