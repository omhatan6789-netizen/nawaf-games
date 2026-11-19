import { InlineKeyboard } from "grammy";
import { pool } from "./db.js";
import { OWNER_ID, getRank } from "./ranks.js";

const sessions = new Map();
const MAX_IMAGES = 10;

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}
function privateChat(ctx) { return ctx.chat?.type === "private"; }
function backKeyboard() {
  return new InlineKeyboard().text("↩️ الرجوع للقائمة", "startedit:menu");
}
function mainKeyboard() {
  return new InlineKeyboard()
    .text("تعديل رسالة البدء", "startedit:message").text("اضافة ازرار", "startedit:buttons").row()
    .text("المسموحين بالوصول", "startedit:access").text("اضافة صورة", "startedit:image");
}
function buttonsKeyboard() {
  return new InlineKeyboard()
    .text("اضف زر", "startedit:add_button").text("تعديل ترتيب زر", "startedit:order_button").row()
    .text("حذف زر", "startedit:delete_button").row()
    .text("↩️ الرجوع للقائمة", "startedit:menu");
}
function imagesKeyboard() {
  return new InlineKeyboard()
    .text("اضف صورة", "startedit:image_add").text("حذف صورة", "startedit:image_delete").row()
    .text("حذف كل الصور", "startedit:image_delete_all").row()
    .text("↩️ الرجوع للقائمة", "startedit:menu");
}
async function isAllowed(user) {
  if (!user) return false;
  if (user.id === OWNER_ID) return true;
  const result = await db().query(
    `SELECT 1 FROM start_access WHERE user_id=$1 OR (username IS NOT NULL AND lower(username)=lower($2))
     UNION ALL SELECT 1 FROM developer_panel_access WHERE user_id=$1 LIMIT 1`,
    [String(user.id), user.username || null]
  );
  return result.rowCount > 0;
}
async function showMenu(ctx, edit = false) {
  const text = "اهلًا بك عزيزي المطور 🎖️\nهذي قائمة تعديل الستارت❗️";
  if (edit) await ctx.editMessageText(text, { reply_markup: mainKeyboard() });
  else await ctx.reply(text, { reply_markup: mainKeyboard() });
}
async function showAccess(ctx) {
  const rows = await db().query("SELECT id,user_id,username FROM start_access ORDER BY id");
  const lines = ["المسموحين بالوصول:", ""];
  if (!rows.rows.length) lines.push("لا يوجد أشخاص مضافين.");
  else rows.rows.forEach((r,i) => lines.push(`${i+1}. ${r.username ? "@"+r.username : r.user_id}`));
  const keyboard = new InlineKeyboard()
    .text("اضافة شخص", "startedit:access_add").text("حذف شخص", "startedit:access_delete").row()
    .text("↩️ الرجوع للقائمة", "startedit:menu");
  await ctx.editMessageText(lines.join("\n"), { reply_markup: keyboard });
}
async function showImages(ctx) {
  const rows = await db().query("SELECT id FROM start_images ORDER BY image_order,id");
  await ctx.editMessageText(
    `عدد صور الستارت الحالية: ${rows.rowCount}\n\nتقدر تضيف صور متعددة (حتى ${MAX_IMAGES})، وعند استخدام /start ترسل الصور كلها مع بعض.`,
    { reply_markup: imagesKeyboard() }
  );
}
function listButtons(rows) {
  return rows.map((r,i) => `${i+1}. ${r.button_text}`).join("\n");
}
function normalizeUsername(value) {
  let username = String(value || "").trim().replace(/^@/,"").toLowerCase();
  if (!/^[a-z0-9_]{5,32}$/.test(username)) return null;
  return username;
}
function validateUrl(value) {
  const raw = String(value || "").trim();
  if (/^@[A-Za-z0-9_]{5,32}$/.test(raw)) return "https://t.me/" + raw.slice(1);
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch { return null; }
}
function utf16Length(text) { return text.length ? new TextEncoder().encode(text).length / 2 : 0; }
function getReplacements(user, data, rank) {
  const username = user.username ? "@" + user.username : "لا يوجد";
  return {
    "#الاسم": user.first_name || "مستخدم",
    "#منشن": user.first_name || "مستخدم",
    "#يوزره": username,
    "#اليوزر": username,
    "#الرسائل": String(data.messages || 0),
    "#الايدي": String(user.id),
    "#الرتبه": rank || "عضو",
    "#التعديل": "0",
    "#النقاط": String(data.points || 0),
  };
}
function replaceVariables(original, originalEntities, replacements, user) {
  const occurrences = [];
  for (const [key,value] of Object.entries(replacements)) {
    let from = 0;
    while (true) {
      const pos = original.indexOf(key,from);
      if (pos < 0) break;
      const start = utf16Length(original.slice(0,pos));
      const length = utf16Length(key);
      occurrences.push({ key, start, end:start+length, oldLength:length, newLength:utf16Length(value), value });
      from = pos + key.length;
    }
  }
  occurrences.sort((a,b)=>a.start-b.start);
  let finalText = original;
  for (const [key,value] of Object.entries(replacements)) finalText = finalText.split(key).join(value);
  const entities = [];
  for (const entity of originalEntities || []) {
    let offset = Number(entity.offset || 0);
    let length = Number(entity.length || 0);
    const end = offset + length;
    for (const occurrence of occurrences) {
      const delta = occurrence.newLength - occurrence.oldLength;
      if (occurrence.end <= offset) offset += delta;
      else if (occurrence.start >= offset && occurrence.end <= end) length += delta;
    }
    entities.push({ ...entity, offset, length });
  }
  for (const occurrence of occurrences) {
    if (occurrence.key !== "#منشن") continue;
    let offset = occurrence.start;
    for (const previous of occurrences) {
      if (previous === occurrence) break;
      if (previous.end <= occurrence.start) offset += previous.newLength - previous.oldLength;
    }
    entities.push({ type:"text_mention", offset, length:occurrence.newLength, user:{
      id:user.id, is_bot:Boolean(user.is_bot), first_name:user.first_name || "مستخدم",
      ...(user.last_name ? {last_name:user.last_name}:{}),
      ...(user.username ? {username:user.username}:{})
    }});
  }
  return { text:finalText, entities };
}
async function getStartData() {
  const [setting, images, buttons] = await Promise.all([
    db().query("SELECT message_text,message_entities FROM start_settings WHERE id=1"),
    db().query("SELECT id,file_id FROM start_images ORDER BY image_order,id"),
    db().query("SELECT button_text,button_url FROM start_buttons ORDER BY button_order,id"),
  ]);
  return { setting:setting.rows[0], images:images.rows, buttons:buttons.rows };
}
async function sendConfiguredStart(ctx) {
  const {setting,images,buttons} = await getStartData();
  if (ctx.match) return false;
  const user=ctx.from;
  const userRow=await db().query("SELECT messages FROM users WHERE user_id=$1",[String(user.id)]);
  const pointsRow=await db().query("SELECT points FROM points WHERE user_id=$1",[String(user.id)]);
  let rank="عضو";
  try { rank=await getRank(user.id); } catch {}
  const data={messages:Number(userRow.rows[0]?.messages||0),points:Number(pointsRow.rows[0]?.points||0)};
  const baseText=setting?.message_text || `حياك الله #الاسم 🤍\nفي البوت الجديد ⭐`;
  let entities=setting?.message_entities || [];
  if (typeof entities === "string") { try { entities = JSON.parse(entities); } catch { entities = []; } }
  if (!Array.isArray(entities)) entities = [];
  const built=replaceVariables(baseText,entities,getReplacements(user,data,rank),user);
  const keyboardRows=[];
  for(let i=0;i<buttons.length;i+=2){
    keyboardRows.push(buttons.slice(i,i+2).map(b=>({text:b.button_text,url:b.button_url})));
  }
  const reply_markup=keyboardRows.length ? {inline_keyboard:keyboardRows} : undefined;
  if(images.length===1){
    await ctx.api.sendPhoto(ctx.chat.id,images[0].file_id,{
      caption:built.text,caption_entities:built.entities.length?built.entities:undefined,reply_markup
    });
  } else if(images.length>1){
    const media=images.map((img,i)=>({
      type:"photo",media:img.file_id,
      ...(i===images.length-1?{caption:built.text,caption_entities:built.entities.length?built.entities:undefined}:{})
    }));
    await ctx.api.sendMediaGroup(ctx.chat.id,media);
    if(reply_markup) await ctx.api.sendMessage(ctx.chat.id,"⠀",{reply_markup});
  } else {
    await ctx.api.sendMessage(ctx.chat.id,built.text,{
      entities:built.entities.length?built.entities:undefined,reply_markup
    });
  }
  return true;
}

export async function handleStartCommand(ctx) {
  if(ctx.chat?.type!=="private") return;
  if(ctx.match) return;
  try { await sendConfiguredStart(ctx); }
  catch(error) {
    console.error("Configured start message failed:",error);
    await ctx.reply("هلا! هذا بوت نواف بنسخته الجديدة. جاري نقل المميزات تدريجيًا.");
  }
}
export async function openStartEditorFromPanel(ctx) {
  sessions.delete(ctx.from.id);
  await showMenu(ctx, true);
}

export async function handleStartEditorCommand(ctx) {
  if(!privateChat(ctx)) return;
  if(!(await isAllowed(ctx.from))) return;
  sessions.delete(ctx.from.id);
  await showMenu(ctx);
}
export async function handleStartEditorCallback(ctx) {
  const user=ctx.from;
  const data=ctx.callbackQuery?.data || "";
  if(!(await isAllowed(user))) {
    await ctx.answerCallbackQuery({text:"لا يمكنك الدخول لهذا الزر 🚨",show_alert:true});
    return;
  }
  await ctx.answerCallbackQuery();
  if(data==="startedit:menu"){
    sessions.delete(user.id); await showMenu(ctx,true);
  } else if(data==="startedit:message"){
    sessions.set(user.id,{action:"message"});
    await ctx.editMessageText("حسنًا ارسل الرسالة", {reply_markup:backKeyboard()});
  } else if(data==="startedit:buttons"){
    sessions.delete(user.id); await ctx.editMessageText("اختر العملية التي تريدها:",{reply_markup:buttonsKeyboard()});
  } else if(data==="startedit:add_button"){
    sessions.set(user.id,{action:"button_text"});
    await ctx.editMessageText("حسنًا ارسل اسم الزر",{reply_markup:backKeyboard()});
  } else if(data==="startedit:order_button" || data==="startedit:delete_button"){
    const rows=(await db().query("SELECT id,button_text FROM start_buttons ORDER BY button_order,id")).rows;
    if(!rows.length){await ctx.editMessageText("ما فيه أزرار مضافة حاليًا.",{reply_markup:buttonsKeyboard()});return;}
    const action=data.endsWith("order_button")?"order_select":"delete_button";
    sessions.set(user.id,{action,buttons:rows.map(r=>({id:Number(r.id),text:r.button_text}))});
    await ctx.editMessageText("أزرارك الحالية:\n\n"+listButtons(rows)+"\n\n"+(action==="order_select"?"ارسل رقم الزر الذي تريد تغيير ترتيبه:":"ارسل رقم الزر الذي تريد حذفه:"),{reply_markup:backKeyboard()});
  } else if(data==="startedit:access"){
    if(user.id!==OWNER_ID){await ctx.answerCallbackQuery({text:"لا يمكنك الدخول لهذا الزر 🚨",show_alert:true});return;}
    sessions.delete(user.id); await showAccess(ctx);
  } else if(data==="startedit:image"){
    sessions.delete(user.id); await showImages(ctx);
  } else if(data==="startedit:access_add" || data==="startedit:access_delete"){
    if(user.id!==OWNER_ID){await ctx.answerCallbackQuery({text:"لا يمكنك الدخول لهذا الزر 🚨",show_alert:true});return;}
    sessions.set(user.id,{action:data.endsWith("add")?"access_add":"access_delete"});
    await ctx.editMessageText(data.endsWith("add")?"ارسل أيدي الشخص أو يوزره.\n\nمثال:\n8453977662\n@username":"ارسل أيدي الشخص أو يوزره لحذفه.",{reply_markup:backKeyboard()});
  } else if(data==="startedit:image_add"){
    sessions.set(user.id,{action:"image_add"});
    await ctx.editMessageText("ارسل الصورة.",{reply_markup:backKeyboard()});
  } else if(data==="startedit:image_delete"){
    const rows=await db().query("SELECT id FROM start_images ORDER BY image_order,id");
    if(!rows.rowCount){await ctx.editMessageText("ما فيه صور حاليًا.",{reply_markup:imagesKeyboard()});return;}
    sessions.set(user.id,{action:"image_delete"});
    await ctx.editMessageText("ارسل رقم الصورة التي تريد حذفها.",{reply_markup:backKeyboard()});
  } else if(data==="startedit:image_delete_all"){
    await db().query("DELETE FROM start_images");
    sessions.delete(user.id);
    await ctx.editMessageText("تم حذف جميع صور الستارت ✅",{reply_markup:backKeyboard()});
  }
}
async function reorderImagesAfterDelete(client) {
  const rows=(await client.query("SELECT id FROM start_images ORDER BY image_order,id")).rows;
  for(let i=0;i<rows.length;i++) await client.query("UPDATE start_images SET image_order=$1 WHERE id=$2",[i+1,rows[i].id]);
}
export async function handleStartEditorMessage(ctx) {
  if(!privateChat(ctx) || !(await isAllowed(ctx.from))) return false;
  const session=sessions.get(ctx.from.id);
  if(!session) return false;
  if(!(await isAllowed(ctx.from))) { sessions.delete(ctx.from.id); return false; }
  const msg=ctx.message;
  const text=msg.text?.trim() || "";
  const userId=ctx.from.id;
  const reply=async value=>ctx.reply(value,{reply_markup:backKeyboard()});
  if(session.action==="message"){
    const value=msg.text || msg.caption || "";
    if(!value){await reply("الرسالة ما تحتوي على نص أو كابشن.");return true;}
    const entities=msg.text?msg.entities:msg.caption_entities;
    await db().query("UPDATE start_settings SET message_text=$1,message_entities=$2,updated_at=NOW() WHERE id=1",[value,JSON.stringify(entities||[])]);
    sessions.delete(userId); await reply("تم تعديل رسالة البدء بنجاح ✅"); return true;
  }
  if(session.action==="button_text"){
    if(!text){await reply("ارسل اسم الزر كنص.");return true;}
    sessions.set(userId,{action:"button_url",button_text:text});
    await reply("حسنًا، الآن ارسل الرابط أو يوزر التليجرام:\n\nمثال:\nhttps://example.com\n@username");return true;
  }
  if(session.action==="button_url"){
    const url=validateUrl(text);
    if(!url){await reply("ارسل رابط يبدأ بـ https:// أو يوزر يبدأ بـ @");return true;}
    const order=await db().query("SELECT COALESCE(MAX(button_order),0)+1 AS next FROM start_buttons");
    await db().query("INSERT INTO start_buttons(button_text,button_url,button_order) VALUES($1,$2,$3)",[session.button_text,url,Number(order.rows[0].next)]);
    sessions.delete(userId);await reply("تمت إضافة الزر بنجاح ✅");return true;
  }
  if(session.action==="order_select" || session.action==="delete_button"){
    const n=Number(text);
    if(!/^\d+$/.test(text)||n<1||n>session.buttons.length){await reply("رقم الزر غير صحيح.");return true;}
    const selected=session.buttons[n-1];
    if(session.action==="order_select"){
      sessions.set(userId,{action:"order_position",button_id:selected.id,buttons:session.buttons});
      await reply(`الزر المحدد: ${selected.text}\n\nارسل الترتيب الجديد.\nمثال: 1`);return true;
    }
    const client=await db().connect();
    try{
      await client.query("BEGIN");
      await client.query("DELETE FROM start_buttons WHERE id=$1",[selected.id]);
      const rows=(await client.query("SELECT id FROM start_buttons ORDER BY button_order,id")).rows;
      for(let i=0;i<rows.length;i++) await client.query("UPDATE start_buttons SET button_order=$1 WHERE id=$2",[i+1,rows[i].id]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
    sessions.delete(userId);await reply("تم حذف الزر بنجاح ✅");return true;
  }
  if(session.action==="order_position"){
    const n=Number(text),buttons=session.buttons;
    if(!/^\d+$/.test(text)||n<1||n>buttons.length){await reply("الترتيب غير صحيح.");return true;}
    const ordered=buttons.filter(b=>b.id!==session.button_id);
    const selected=buttons.find(b=>b.id===session.button_id);
    ordered.splice(n-1,0,selected);
    const client=await db().connect();
    try{
      await client.query("BEGIN");
      for(let i=0;i<ordered.length;i++) await client.query("UPDATE start_buttons SET button_order=$1 WHERE id=$2",[i+1,ordered[i].id]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
    sessions.delete(userId);await reply("تم تعديل ترتيب الزر بنجاح ✅");return true;
  }
  if(session.action==="image_add"){
    if(!msg.photo?.length){await reply("ارسل صورة.");return true;}
    const count=await db().query("SELECT COUNT(*)::int AS count FROM start_images");
    if(Number(count.rows[0].count)>=MAX_IMAGES){await reply(`وصلت الحد الأعلى (${MAX_IMAGES} صور).`);return true;}
    const order=await db().query("SELECT COALESCE(MAX(image_order),0)+1 AS next FROM start_images");
    await db().query("INSERT INTO start_images(file_id,image_order) VALUES($1,$2)",[msg.photo[msg.photo.length-1].file_id,Number(order.rows[0].next)]);
    sessions.delete(userId);await reply("تمت إضافة الصورة بنجاح ✅");return true;
  }
  if(session.action==="image_delete"){
    const n=Number(text);
    if(!/^\d+$/.test(text)||n<1){await reply("ارسل رقم الصورة فقط.");return true;}
    const client=await db().connect();
    try{
      await client.query("BEGIN");
      const rows=(await client.query("SELECT id FROM start_images ORDER BY image_order,id")).rows;
      if(n>rows.length){await client.query("ROLLBACK");await reply("رقم الصورة غير صحيح.");return true;}
      await client.query("DELETE FROM start_images WHERE id=$1",[rows[n-1].id]);
      await reorderImagesAfterDelete(client);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
    sessions.delete(userId);await reply("تم حذف الصورة بنجاح ✅");return true;
  }
  if(session.action==="access_add" || session.action==="access_delete"){
    if(userId!==OWNER_ID){sessions.delete(userId);return true;}
    if(text.startsWith("@")){
      const username=normalizeUsername(text);
      if(!username){await reply("اليوزر غير صحيح.");return true;}
      if(session.action==="access_add"){
        await db().query("INSERT INTO start_access(username) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM start_access WHERE lower(username)=lower($1))",[username]);
      }else await db().query("DELETE FROM start_access WHERE lower(username)=lower($1)",[username]);
    }else{
      if(!/^\d{5,20}$/.test(text)){await reply("ارسل أيدي صحيح أو يوزر يبدأ بـ @.");return true;}
      if(session.action==="access_add"){
        await db().query("INSERT INTO start_access(user_id) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM start_access WHERE user_id=$1)",[text]);
      }else await db().query("DELETE FROM start_access WHERE user_id=$1",[text]);
    }
    sessions.delete(userId);
    await reply(session.action==="access_add"?"تمت الإضافة إلى المسموحين بالوصول ✅":"تم حذف الشخص من المسموحين ✅");return true;
  }
  return false;
}
