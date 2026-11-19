import { InlineKeyboard } from "grammy";
import { OWNER_ID, getRankLevel, getDeveloperType } from "../ranks.js";
import {
  getBlockedWords, mutateBlockedWords, getBlockedSettings, updateBlockedSettings,
  addBlockedWarning, clearBlockedWarnings, cleanupExpiredBlockedWarnings,
  saveSanction, deleteSanction,
} from "../moderation-store.js";

const LISTS = new Map([
  ["الكلمات المحظورة",1],["الكلمات المحظورة/ه",1],["الكلمات المحظورة2",2],["الكلمات المحظورة/ه2",2],
]);
const sessions = new Map();
const regexCache = new Map();
const FULL_PERMISSIONS = {
  can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,
  can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,
  can_send_other_messages:true,can_add_web_page_previews:true,can_invite_users:true,
  can_manage_topics:true,
};
const esc = v => String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const key = (userId,chatId) => `${userId}:${chatId}`;
const group = ctx => ["group","supergroup"].includes(ctx.chat?.type);
const listTitle = id => id===1?"قائمة الكلمات المحظورة":"قائمة الكلمات المحظورة2";
const listName = id => id===1?"الكلمات المحظورة":"الكلمات المحظورة2";
function normalizeWord(v){return String(v??"").replace(/[\r\n]+/g," ").replace(/\s+/g," ").trim();}
function splitWords(text){return [...new Set(String(text??"").split(/\r?\n/).map(normalizeWord).filter(Boolean))];}
function parseDuration(token){
 const m=String(token??"").trim().match(/^(\d+(?:\.\d+)?)\s*(ث|ثانية|ثواني|د|دقيقة|دقائق|س|ساعة|ساعات|ي|يوم|أيام)$/);
 if(!m)return null;const n=Number(m[1]);if(n<1)return null;
 const u=m[2],mul=["ث","ثانية","ثواني"].includes(u)?1:["د","دقيقة","دقائق"].includes(u)?60:["س","ساعة","ساعات"].includes(u)?3600:86400;
 return Math.floor(n*mul);
}
function formatUntil(until){return until?new Date(until*1000).toLocaleString("en-GB",{timeZone:"Asia/Riyadh",hour12:false}):"لا توجد مدة";}
function mention(user){return `<a href="tg://user?id=${Number(user.id)}">${esc(user.first_name||user.username||user.id)}</a>`;}
async function canManage(userId,chatId){if(Number(userId)===OWNER_ID||await getDeveloperType(userId))return true;return await getRankLevel(userId,chatId)>=4;}
async function canBeAffected(userId,chatId){if(Number(userId)===OWNER_ID||await getDeveloperType(userId))return false;return await getRankLevel(userId,chatId)<=1;}
function wordRegex(word){let r=regexCache.get(word);if(!r){r=new RegExp(`(?<![\\p{L}\\p{N}_])${word.replace(/[.*+?^${}()|[\]\\\\]/g,"\\\\$&")}(?![\\p{L}\\p{N}_])`,"iu");regexCache.set(word,r);}return r;}
async function listMarkup(chatId,listId){
 const s=await getBlockedSettings(chatId,listId);
 return new InlineKeyboard()
  .text("اضافة كلمات ➕",`bw:add:${listId}:${chatId}`).text("حذف كلمات 🗑️",`bw:delete:${listId}:${chatId}`).row()
  .text(s.enabled?"الحالة: مفعلة 🟢":"الحالة: معطلة 🔴",`bw:toggle:${listId}:${chatId}`);
}
async function listText(chatId,listId){
 const words=await getBlockedWords(chatId,listId);
 return words.length?`🚫 ${listTitle(listId)}:\n\n${words.map((w,i)=>`${i+1} - ${esc(w)}`).join("\n")}`:"لا توجد كلمات محظورة حاليًا .";
}
async function sendList(ctx,chatId,listId,edit=false){
 const text=await listText(chatId,listId),reply_markup=await listMarkup(chatId,listId);
 if(edit) await ctx.editMessageText(text,{parse_mode:"HTML",reply_markup});
 else await ctx.reply(text,{parse_mode:"HTML",reply_markup});
}
async function applyBlockedPunishment(ctx,chatId,user,action,duration){
 const until=duration?Math.floor(Date.now()/1000)+Number(duration):null;
 const untilDate=until?new Date(until*1000):undefined;
 const table={mute:"bot_mutes",restrict:"restrictions",ban:"moderation_bans"}[action];
 if(action==="restrict"){
  await ctx.api.restrictChatMember(chatId,user.id,{permissions:{can_send_messages:false},...(untilDate?{until_date:untilDate}:{})});
 } else if(action==="ban"){
  await ctx.api.banChatMember(chatId,user.id,{...(untilDate?{until_date:untilDate}:{})});
 }
 await saveSanction(table,chatId,user,untilDate,null,ctx.me.id);
 const labels={mute:"كتم",restrict:"تقييد",ban:"حظر"};
 const markup=new InlineKeyboard().text(`رفع ${labels[action]} ☑️`,`bw:lift:${action}:${chatId}:${user.id}`);
 await ctx.api.sendMessage(chatId,`🔐 تم ${labels[action]} ${mention(user)} [${user.id}].\n⏰ حتى: ${formatUntil(until)}`,{parse_mode:"HTML",reply_markup:markup});
}
async function handleWarning(ctx,chatId,listId,user,s){
 const count=await addBlockedWarning(chatId,listId,user.id,Number(s.warning_duration));
 if(count<3){
  await ctx.api.sendMessage(chatId,`• كتب كلمة محظورة وجاه إنذار.\n• المستخدم ↤︎ ${mention(user)}\n• عدد إنذاراته ↤︎ ${count}`,{parse_mode:"HTML"});
  return;
 }
 await clearBlockedWarnings(chatId,listId,user.id);
 await applyBlockedPunishment(ctx,chatId,user,s.warning_action,s.warning_punishment_duration);
}
export function hasBlockedWordSession(userId,chatId){return sessions.has(key(userId,chatId));}

export async function handleBlockedWords(ctx){
 const msg=ctx.message,user=ctx.from,chat=ctx.chat;
 if(!msg||!user||!chat)return false;
 const text=msg.text?.trim()??"";
 const session=sessions.get(key(user.id,chat.id));
 if(session){
  if(text.startsWith("/")||text.startsWith("الكلمات المحظورة")||text.startsWith("تفعيل ")||text.startsWith("تعطيل "))return false;
  if(session.type==="add"||session.type==="delete"){
   const words=splitWords(text);
   if(!words.length){await ctx.reply("• لم يتم العثور على كلمات.");return true;}
   await mutateBlockedWords(session.originChatId,session.listId,words,session.type==="add");
   sessions.delete(key(user.id,chat.id));
   try{await ctx.deleteMessage();}catch{}
   await ctx.reply(session.type==="add"?"تم حفظ الكلمات بنجاح ✅ .":"تم حذف الكلمات بنجاح ✅ .",{
    reply_markup:new InlineKeyboard().text("↩️ رجوع لقائمة الكلمات",`bw:back:${session.listId}:${session.originChatId}`).text("اغلاق القائمة",`bw:close:${session.originChatId}`)
   });
   return true;
  }
  if(session.type==="direct_duration"){
   const duration=parseDuration(text);if(!duration){await ctx.reply("• المدة غير صحيحة. مثال: 5ي أو 30ث أو 50د أو 1س");return true;}
   await updateBlockedSettings(session.originChatId,session.listId,{action:session.action,duration});
   sessions.delete(key(user.id,chat.id));await ctx.reply("• تم حفظ إعداد العقوبة بنجاح ✅ .");return true;
  }
  if(session.type==="warning_setup"){
   const p=text.split(/\s+/);if(p.length<2||p.length>3){await ctx.reply("• الصيغة غير صحيحة. مثال: 3د كتم 5ي");return true;}
   const warningDuration=parseDuration(p[0]),action={كتم:"mute",تقييد:"restrict",حظر:"ban"}[p[1]];
   if(!warningDuration||!action){await ctx.reply("• الصيغة غير صحيحة. مثال: 3د كتم 5ي");return true;}
   const punishmentDuration=action==="ban"?null:parseDuration(p[2]);
   if(action!=="ban"&&!punishmentDuration){await ctx.reply("• اكتب مدة العقوبة أيضًا. مثال: 3د كتم 5ي");return true;}
   await updateBlockedSettings(session.originChatId,session.listId,{action:"warning",warning_duration:warningDuration,warning_action:action,warning_punishment_duration:punishmentDuration});
   sessions.delete(key(user.id,chat.id));await ctx.reply("• تم حفظ إعدادات الانذار بنجاح ✅ .");return true;
  }
 }
 if(LISTS.has(text)){
  const listId=LISTS.get(text);
  if(group(ctx)){
   if(!await canManage(user.id,chat.id)){await ctx.reply("• هذا الأمر لـ نائب المالك وفوق فقط .");return true;}
   const kb=new InlineKeyboard().text("هنا 👆🏻",`bw:here:${listId}:${chat.id}`).text("فتح القائمة بالخاص❕",`bw:private:${listId}:${chat.id}`);
   await ctx.reply(`اهلًا يالمشرف ${mention(user)}\nاختر وين تبي تفك القائمة:`,{parse_mode:"HTML",reply_markup:kb});
  }else if(chat.type==="private"){await sendList(ctx,chat.id,listId);}
  return true;
 }
 const toggle=text.match(/^(تفعيل|تعطيل)\s+(الكلمات المحظورة(?:\/ه)?2?)$/);
 if(toggle){
  const id=LISTS.get(toggle[2]);if(!id)return false;
  if(!group(ctx)||!await canManage(user.id,chat.id)){await ctx.reply("• هذا الأمر لـ نائب المالك وفوق فقط .");return true;}
  await updateBlockedSettings(chat.id,id,{enabled:toggle[1]==="تفعيل"});await ctx.reply(toggle[1]==="تفعيل"?"• تم تفعيل الكلمات المحظورة ✅ .":"• تم تعطيل الكلمات المحظورة ✅ .");return true;
 }
 const punishment=text.match(/^ضع عقوبة\s+(الكلمات المحظورة(?:\/ه)?2?)\s+(كتم|تقييد|حظر|انذار)$/);
 if(punishment){
  const id=LISTS.get(punishment[1]);if(!group(ctx)||!await canManage(user.id,chat.id)){await ctx.reply("• هذا الأمر لـ نائب المالك وفوق فقط .");return true;}
  const action={كتم:"mute",تقييد:"restrict",حظر:"ban",انذار:"warning"}[punishment[2]];
  if(action==="ban"){await updateBlockedSettings(chat.id,id,{action,duration:null});await ctx.reply("• تم وضع عقوبة الحظر على الكلمات المحظورة بنجاح ✅ .");}
  else if(action==="warning"){sessions.set(key(user.id,chat.id),{type:"warning_setup",listId:id,originChatId:chat.id});await ctx.reply("تمام، أرسل مدة الانذار+ العقوبة الي بعد الانذارات مع المدة بهذي الطريقة:\n\n3د كتم 5ي");}
  else{sessions.set(key(user.id,chat.id),{type:"direct_duration",listId:id,originChatId:chat.id,action});await ctx.reply(action==="mute"?"• حسنًا اختر مدة الكتم .":"• حسنًا اختر مدة التقييد .");}
  return true;
 }
 if(group(ctx)&&user.id!==OWNER_ID&&msg.text){
  for(const listId of [1,2]){
   const words=await getBlockedWords(chat.id,listId);const settings=await getBlockedSettings(chat.id,listId);
   if(!settings.enabled)continue;
   const matched=words.find(w=>{try{return wordRegex(w).test(text);}catch{return text.toLowerCase().includes(w.toLowerCase());}});
   if(!matched)continue;
   const level=await getRankLevel(user.id,chat.id);
   try{await ctx.deleteMessage();}catch{}
   if(level>=2)return true;
   if(await canBeAffected(user.id,chat.id)){
    if(settings.action==="warning")await handleWarning(ctx,chat.id,listId,user,settings);
    else await applyBlockedPunishment(ctx,chat.id,user,settings.action,settings.duration);
   }
   return true;
  }
 }
 return false;
}

export async function handleBlockedWordCallback(ctx){
 const data=ctx.callbackQuery?.data;if(!data?.startsWith("bw:"))return;
 const p=data.split(":"),action=p[1],actor=ctx.from;
 let listId=null,originChatId=null,targetId=null,punish=null;
 if(["here","private","add","delete","toggle","back"].includes(action)){listId=Number(p[2]);originChatId=Number(p[3]);}
 else if(action==="close")originChatId=Number(p[2]);
 else if(action==="lift"){punish=p[2];originChatId=Number(p[3]);targetId=Number(p[4]);}
 else return;
 if(!Number.isFinite(originChatId)||!await canManage(actor.id,originChatId)){await ctx.answerCallbackQuery({text:"• هذا الأمر لـ نائب المالك وفوق فقط .",show_alert:true});return;}
 await ctx.answerCallbackQuery();
 if(action==="here"||action==="back"){await sendList(ctx,originChatId,listId,true);return;}
 if(action==="private"){
  try{
   const words=await listText(originChatId,listId),reply_markup=await listMarkup(originChatId,listId);
   await ctx.api.sendMessage(actor.id,words,{parse_mode:"HTML",reply_markup});
   await ctx.editMessageText("تم الإرسال بالخاص ✅ .");
  }catch{try{await ctx.editMessageText("تعذر إرسال القائمة بالخاص.");}catch{}}
  return;
 }
 if(action==="add"||action==="delete"){
  sessions.set(key(actor.id,ctx.chat.id),{type:action,listId,originChatId});
  await ctx.editMessageText(action==="add"?"• حسنًا ارسل الكلمات التي تريد إضافتها .\n\nمثال:\nكلمة1\nكلمة2":"• حسنًا ارسل الكلمات التي تريد حذفها .\n\nمثال:\nكلمة1\nكلمة2");return;
 }
 if(action==="toggle"){
  const s=await getBlockedSettings(originChatId,listId);await updateBlockedSettings(originChatId,listId,{enabled:!s.enabled});await sendList(ctx,originChatId,listId,true);return;
 }
 if(action==="close"){try{await ctx.deleteMessage();}catch{}return;}
 if(action==="lift"){
  if(punish==="restrict")await ctx.api.restrictChatMember(originChatId,targetId,{permissions:FULL_PERMISSIONS});
  if(punish==="ban")await ctx.api.unbanChatMember(originChatId,targetId,{only_if_banned:false});
  await deleteSanction({mute:"bot_mutes",restrict:"restrictions",ban:"moderation_bans"}[punish],originChatId,targetId);
  try{await ctx.editMessageReplyMarkup({reply_markup:undefined});}catch{}
 }
}

export async function cleanupBlockedWarningsLoop(){
 while(true){try{await cleanupExpiredBlockedWarnings();}catch(e){console.error("Blocked-word warning cleanup failed:",e);}await new Promise(r=>setTimeout(r,15000));}
}
