import { InlineKeyboard } from "grammy";
import { pool } from "./db.js";
import { OWNER_ID } from "./ranks.js";
import { getSanctionRows, clearSanctionTable } from "./moderation-store.js";
import { openStartEditorFromPanel } from "./start-editor.js";

const sessions = new Map();
const LISTS = {
  mute: ["bot_mutes", "المكتومين"],
  restrict: ["restrictions", "المقيدين"],
  ban: ["moderation_bans", "المحظورين"],
};
const escapeHtml = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
function db() { if (!pool) throw new Error("DATABASE_URL is not configured"); return pool; }
function privateChat(ctx) { return ctx.chat?.type === "private"; }
function back() { return new InlineKeyboard().text("↩️ رجوع للقائمة","devpanel:menu"); }
function menuKeyboard(userId) {
  const kb = new InlineKeyboard()
    .text("الإحصائيات","devpanel:stats").text("الإذاعة","devpanel:broadcast").row()
    .text("المكتومين","devpanel:list:mute").text("المحظورين","devpanel:list:ban").row()
    .text("تعديل ستارت","devpanel:startedit").row()
    .text("سجل الإذاعة","devpanel:logs").text("المقيدين","devpanel:list:restrict");
  if (userId === OWNER_ID) kb.row().text("المسموحين بالوصول","devpanel:access");
  return kb;
}
async function allowed(userId) {
  if (Number(userId) === OWNER_ID) return true;
  const r = await db().query("SELECT 1 FROM developer_panel_access WHERE user_id=$1",[String(userId)]);
  return r.rowCount > 0;
}
async function showMenu(ctx, edit=false) {
  const first = escapeHtml(ctx.from?.first_name || "مطور");
  const text = `أهلًا يا <a href="tg://user?id=${ctx.from.id}">${first}</a> 👋`;
  const opts = {parse_mode:"HTML",reply_markup:menuKeyboard(ctx.from.id)};
  if (edit) await ctx.editMessageText(text,opts); else await ctx.reply(text,opts);
}
export async function handleDeveloperPanelCommand(ctx) {
  if (!privateChat(ctx) || ctx.message?.text?.trim() !== "اوامر المطور") return false;
  if (!(await allowed(ctx.from?.id))) return true;
  sessions.delete(ctx.from.id);
  await showMenu(ctx);
  return true;
}
async function showStats(ctx) {
  const [p,g,c] = await Promise.all([
    db().query("SELECT COUNT(*)::int n FROM developer_private_starts"),
    db().query("SELECT COUNT(*)::int n FROM developer_bot_chats WHERE active=TRUE AND chat_type IN ('group','supergroup')"),
    db().query("SELECT COUNT(*)::int n FROM developer_bot_chats WHERE active=TRUE AND chat_type='channel'"),
  ]);
  await ctx.editMessageText(
    `📊 الإحصائيات\n━━━━━━━━━━━━\n\n👤 عدد المشتركين: ${p.rows[0].n}\n👥 عدد المجموعات: ${g.rows[0].n}\n📢 عدد القنوات: ${c.rows[0].n}`,
    {reply_markup:back()}
  );
}
async function showAccess(ctx) {
  const r=await db().query("SELECT user_id,username,first_name FROM developer_panel_access ORDER BY id");
  const lines=["المسموحين بالوصول:",""];
  if(!r.rowCount) lines.push("لا يوجد أشخاص مضافين.");
  else r.rows.forEach((x,i)=>lines.push(`${i+1}. ${x.username?"@"+escapeHtml(x.username):escapeHtml(x.first_name||x.user_id)} — ${x.user_id}`));
  const kb=new InlineKeyboard().text("إضافة شخص","devpanel:access:add").text("حذف شخص","devpanel:access:delete").row().text("↩️ رجوع للقائمة","devpanel:menu");
  await ctx.editMessageText(lines.join("\n"),{reply_markup:kb});
}
async function showList(ctx,kind) {
  const [table,title]=LISTS[kind];
  const chats=await db().query("SELECT chat_id,title FROM developer_bot_chats WHERE active=TRUE AND chat_type IN ('group','supergroup') ORDER BY title");
  const lines=[`• قائمة ${title}`,"━━━━━━━━━━━━",""];
  let total=0;
  for(const chat of chats.rows) {
    const rows=await getSanctionRows(table,Number(chat.chat_id));
    if(!rows.length) continue;
    lines.push(`📍 ${escapeHtml(chat.title||chat.chat_id)} — <code>${chat.chat_id}</code>`);
    for(const row of rows) {
      const label=row.username?"@"+row.username:(row.first_name||row.user_id);
      lines.push(`• ${escapeHtml(label)} (<code>${row.user_id}</code>)`);
      total++;
    }
    lines.push("");
  }
  if(!total) lines.push("لا يوجد.");
  let output=lines.join("\n");
  if(output.length>3900) output=output.slice(0,3800)+"\n… تم اختصار القائمة.";
  const kb=new InlineKeyboard().text("مسح القائمة من جميع المجموعات","devpanel:clear:confirm:"+kind).row().text("↩️ رجوع للقائمة","devpanel:menu");
  await ctx.editMessageText(output,{parse_mode:"HTML",reply_markup:kb});
}
async function askBroadcast(ctx,userId,kind) {
  sessions.set(userId,{action:"broadcast",kind});
  await ctx.editMessageText("ارسل الآن رسالة الإذاعة (نص أو صورة أو فيديو أو ملف).",{reply_markup:back()});
}
const allPermissions = {
  can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,
  can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,
  can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true,
  can_change_info:true,can_invite_users:true,can_pin_messages:true,can_manage_topics:true,
};
async function clearAll(kind,api) {
  const [table,title]=LISTS[kind];
  const chats=await db().query("SELECT chat_id FROM developer_bot_chats WHERE active=TRUE AND chat_type IN ('group','supergroup')");
  let total=0;
  for(const chat of chats.rows) {
    const chatId=Number(chat.chat_id);
    const ids=await clearSanctionTable(table,chatId);
    total+=ids.length;
    for(const uid of ids) {
      try {
        if(kind==="restrict") await api.restrictChatMember(chatId,uid,allPermissions);
        else if(kind==="ban") await api.unbanChatMember(chatId,uid,{only_if_banned:false});
      } catch(error) { console.warn("Could not clear platform sanction",kind,chatId,uid,error?.description||error?.message); }
    }
  }
  return {total,title};
}
export async function handleDeveloperPanelCallback(ctx) {
  const data=ctx.callbackQuery?.data||"";
  if(!data.startsWith("devpanel:")) return false;
  const user=ctx.from;
  if(!(await allowed(user.id))) { await ctx.answerCallbackQuery({text:"لا يمكنك استخدام هذه اللوحة.",show_alert:true}); return true; }
  await ctx.answerCallbackQuery();
  try {
    if(data==="devpanel:menu") { sessions.delete(user.id); await showMenu(ctx,true); }
    else if(data==="devpanel:stats") await showStats(ctx);
    else if(data==="devpanel:startedit") {
      sessions.delete(user.id);
      await openStartEditorFromPanel(ctx);
    }
    else if(data==="devpanel:access" && user.id===OWNER_ID) await showAccess(ctx);
    else if(data==="devpanel:access:add" && user.id===OWNER_ID) {
      sessions.set(user.id,{action:"access_add"});
      await ctx.editMessageText("ارسل ID الشخص أو يوزره لإضافته.",{reply_markup:back()});
    }
    else if(data==="devpanel:access:delete" && user.id===OWNER_ID) {
      sessions.set(user.id,{action:"access_delete"});
      await ctx.editMessageText("ارسل ID الشخص أو يوزره لحذفه.",{reply_markup:back()});
    }
    else if(data.startsWith("devpanel:list:")) {
      const kind=data.split(":").at(-1); if(LISTS[kind]) await showList(ctx,kind);
    }
    else if(data.startsWith("devpanel:clear:confirm:")) {
      const kind=data.split(":").at(-1);
      if(LISTS[kind]) {
        const kb=new InlineKeyboard().text("نعم، تأكيد المسح","devpanel:clear:execute:"+kind).row().text("إلغاء","devpanel:list:"+kind);
        await ctx.editMessageText("⚠️ هل أنت متأكد من مسح هذه القائمة من جميع المجموعات؟",{reply_markup:kb});
      }
    }
    else if(data.startsWith("devpanel:clear:execute:")) {
      const kind=data.split(":").at(-1);
      if(LISTS[kind]) { const result=await clearAll(kind,ctx.api); await ctx.editMessageText(`تم مسح ${result.title} من جميع المجموعات ✅\nعدد السجلات: ${result.total}`,{reply_markup:back()}); }
    }
    else if(data==="devpanel:broadcast") {
      const kb=new InlineKeyboard().text("الخاص","devpanel:broadcast:private").text("المجموعات","devpanel:broadcast:groups").row()
        .text("القنوات","devpanel:broadcast:channels").text("الكل","devpanel:broadcast:all").row().text("↩️ رجوع للقائمة","devpanel:menu");
      await ctx.editMessageText("اختر وجهة الإذاعة:",{reply_markup:kb});
    }
    else if(data.startsWith("devpanel:broadcast:")) {
      const kind=data.split(":").at(-1);
      if(["private","groups","channels","all"].includes(kind)) await askBroadcast(ctx,user.id,kind);
    }
    else if(data==="devpanel:logs") {
      const r=await db().query("SELECT id,broadcast_type,created_at FROM developer_broadcasts ORDER BY id DESC LIMIT 15");
      if(!r.rowCount) await ctx.editMessageText("لا توجد إذاعات مسجلة.",{reply_markup:back()});
      else {
        const kb=new InlineKeyboard();
        const lines=["سجل الإذاعة:"];
        for(const row of r.rows) { lines.push(`• إذاعة ${row.id} — ${row.broadcast_type} — ${new Date(row.created_at).toLocaleString("ar-SA")}`); kb.text("عرض الإذاعة "+row.id,"devpanel:log:view:"+row.id).row(); }
        kb.text("↩️ رجوع للقائمة","devpanel:menu");
        await ctx.editMessageText(lines.join("\n"),{reply_markup:kb});
      }
    }
    else if(data.startsWith("devpanel:log:view:")) {
      const id=Number(data.split(":").at(-1));
      const r=await db().query("SELECT source_chat_id,source_message_id FROM developer_broadcasts WHERE id=$1",[id]);
      if(r.rowCount) {
        try { await ctx.api.copyMessage(ctx.chat.id,Number(r.rows[0].source_chat_id),Number(r.rows[0].source_message_id)); await ctx.reply("↩️",{reply_markup:back()}); }
        catch { await ctx.editMessageText("تعذر إظهار الرسالة الأصلية.",{reply_markup:back()}); }
      }
    }
  } catch(error) {
    console.error("Developer panel callback failed:",error);
    try { await ctx.editMessageText("❌ تعذر تنفيذ العملية. تحقق من السجلات وحاول مرة أخرى.",{reply_markup:back()}); } catch {}
  }
  return true;
}
async function handleAccessMessage(ctx,session) {
  if(ctx.from.id!==OWNER_ID) { sessions.delete(ctx.from.id); return true; }
  const value=(ctx.message.text||"").trim();
  if(!value) { await ctx.reply("ارسل ID أو يوزر صحيح.",{reply_markup:back()}); return true; }
  if(session.action==="access_add") {
    const r=/^\d+$/.test(value)
      ? await db().query("SELECT user_id,username,first_name FROM users WHERE user_id=$1",[value])
      : await db().query("SELECT user_id,username,first_name FROM users WHERE LOWER(username)=$1",[value.replace(/^@/,"").toLowerCase()]);
    const row=r.rows[0];
    if(!row) { await ctx.reply("ما لقيت المستخدم ضمن المستخدمين المسجلين.",{reply_markup:back()}); return true; }
    await db().query(`INSERT INTO developer_panel_access(user_id,username,first_name,added_by)
      VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name`,
      [String(row.user_id),row.username,row.first_name,String(ctx.from.id)]);
    sessions.delete(ctx.from.id); await ctx.reply("تمت إضافته للمسموحين بالوصول ✅",{reply_markup:back()}); return true;
  }
  const r=/^\d+$/.test(value)
    ? await db().query("DELETE FROM developer_panel_access WHERE user_id=$1",[value])
    : await db().query("DELETE FROM developer_panel_access WHERE LOWER(username)=$1",[value.replace(/^@/,"").toLowerCase()]);
  sessions.delete(ctx.from.id);
  await ctx.reply(r.rowCount?"تم حذف الشخص من المسموحين بالوصول ✅":"لم يتم العثور على الشخص.",{reply_markup:back()});
  return true;
}
async function sendBroadcast(ctx,session) {
  const kind=session.kind;
  let targets;
  if(kind==="private") targets=await db().query("SELECT user_id chat_id,'private' chat_type,'' title,'' username FROM developer_private_starts");
  else if(kind==="groups") targets=await db().query("SELECT chat_id,chat_type,title,username FROM developer_bot_chats WHERE active=TRUE AND chat_type IN ('group','supergroup')");
  else if(kind==="channels") targets=await db().query("SELECT chat_id,chat_type,title,username FROM developer_bot_chats WHERE active=TRUE AND chat_type='channel'");
  else targets=await db().query("SELECT user_id chat_id,'private' chat_type,'' title,'' username FROM developer_private_starts UNION ALL SELECT chat_id,chat_type,title,username FROM developer_bot_chats WHERE active=TRUE");
  const record=await db().query(`INSERT INTO developer_broadcasts(sender_id,sender_name,source_chat_id,source_message_id,broadcast_type)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [String(ctx.from.id),ctx.from.first_name||"",String(ctx.chat.id),ctx.message.message_id,kind]);
  const id=record.rows[0].id;
  let ok=0,failed=0;
  for(const target of targets.rows) {
    try {
      const sent=await ctx.api.copyMessage(Number(target.chat_id),ctx.chat.id,ctx.message.message_id);
      await db().query(`INSERT INTO developer_broadcast_targets(broadcast_id,chat_id,chat_type,title,username,sent_message_id,success)
        VALUES($1,$2,$3,$4,$5,$6,TRUE)`,
        [id,String(target.chat_id),target.chat_type,target.title||"",target.username||"",sent.message_id]);
      ok++;
    } catch(error) {
      await db().query(`INSERT INTO developer_broadcast_targets(broadcast_id,chat_id,chat_type,title,username,success,error)
        VALUES($1,$2,$3,$4,$5,FALSE,$6)`,
        [id,String(target.chat_id),target.chat_type,target.title||"",target.username||"",String(error?.description||error?.message||error).slice(0,1000)]);
      failed++;
    }
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  sessions.delete(ctx.from.id);
  await ctx.reply(`تمت الإذاعة ✅\n\nنجح الإرسال: ${ok}\nفشل الإرسال: ${failed}`,{reply_markup:back()});
}
export async function handleDeveloperPanelMessage(ctx) {
  if(!privateChat(ctx)) return false;
  const session=sessions.get(ctx.from?.id);
  if(!session) return false;
  if(!(await allowed(ctx.from.id))) { sessions.delete(ctx.from.id); return true; }
  try {
    if(session.action==="access_add"||session.action==="access_delete") return await handleAccessMessage(ctx,session);
    if(session.action==="broadcast") { await sendBroadcast(ctx,session); return true; }
  } catch(error) {
    console.error("Developer panel message failed:",error);
    await ctx.reply("❌ تعذر تنفيذ العملية، حاول مرة أخرى.",{reply_markup:back()});
  }
  return true;
}
export async function trackDeveloperBotChat(ctx) {
  const member=ctx.myChatMember;
  if(!member||!["group","supergroup","channel"].includes(member.chat.type)) return;
  const chat=member.chat;
  const active=!["left","kicked"].includes(member.new_chat_member.status);
  await db().query(`INSERT INTO developer_bot_chats(chat_id,chat_type,title,username,active)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(chat_id) DO UPDATE SET
    chat_type=EXCLUDED.chat_type,title=EXCLUDED.title,username=EXCLUDED.username,
    active=EXCLUDED.active,updated_at=NOW()`,
    [String(chat.id),chat.type,chat.title||"",chat.username||"",active]);
}
