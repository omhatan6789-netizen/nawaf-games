import { InlineKeyboard } from "grammy";
import { OWNER_ID, RANK_LEVELS, getRankLevel, getDeveloperType } from "../ranks.js";
import { pool } from "../db.js";
import { addWarning, saveSanction } from "../moderation-store.js";

const windows=new Map(),sessions=new Map();
const ranks={"عضو":0,"مميز":1,"ادمن":2,"ادمن اساسي":3,"نائب المالك":4,"المالك":5,"Dev":6};
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const mention=u=>'<a href="tg://user?id='+Number(u.id)+'">'+esc(u.first_name||u.username||u.id)+'</a>';
const group=ctx=>["group","supergroup"].includes(ctx.chat?.type);
function parseDuration(t){const m=String(t??"").trim().match(/^(\d+(?:\.\d+)?)\s*(ث|ثانية|ثواني|د|دقيقة|دقائق|س|ساعة|ساعات|ي|يوم|أيام)$/);if(!m)return null;const n=Number(m[1]);if(n<1)return null;return Math.floor(n*({"ث":1,"ثانية":1,"ثواني":1,"د":60,"دقيقة":60,"دقائق":60,"س":3600,"ساعة":3600,"ساعات":3600,"ي":86400,"يوم":86400,"أيام":86400}[m[2]]));}
function formatDuration(n){return n%86400===0?(n/86400)+" يوم":n%3600===0?(n/3600)+" ساعة":n%60===0?(n/60)+" دقيقة":n+" ثانية";}
async function canManage(id,chat){return Number(id)===OWNER_ID||Boolean(await getDeveloperType(id))||(await getRankLevel(id,chat))>=3;}
async function ensureChat(chat){await pool.query("INSERT INTO chats(chat_id,chat_type,title) VALUES($1,'supergroup','') ON CONFLICT(chat_id) DO NOTHING",[String(chat)]);}
async function settings(chat){
 await ensureChat(chat);
 await pool.query("INSERT INTO protection_settings(chat_id) VALUES($1) ON CONFLICT DO NOTHING",[String(chat)]);
 const q=await pool.query("SELECT repetition_enabled,repetition_limit,repetition_seconds,repetition_rank,repetition_punishment_duration FROM protection_settings WHERE chat_id=$1",[String(chat)]);
 const x=q.rows[0]||{};return {enabled:Boolean(x.repetition_enabled),limit:Math.max(1,Number(x.repetition_limit||3)),seconds:Math.max(1,Number(x.repetition_seconds||5)),rank:x.repetition_rank||"عضو",punishment:Math.max(1,Number(x.repetition_punishment_duration||300))};
}
async function update(chat,column,value){
 const allowed=["repetition_enabled","repetition_limit","repetition_seconds","repetition_rank","repetition_punishment_duration"];if(!allowed.includes(column))throw new Error("Invalid repetition setting");
 await ensureChat(chat);
 await pool.query("INSERT INTO protection_settings(chat_id) VALUES($1) ON CONFLICT DO NOTHING",[String(chat)]);
 await pool.query("UPDATE protection_settings SET "+column+"=$2 WHERE chat_id=$1",[String(chat),value]);
}
function key(c,u){return String(c)+":"+String(u);}
function addMessage(chat,user,msgId,seconds){
 const k=key(chat,user),now=Date.now(),arr=(windows.get(k)||[]).filter(x=>now-x.at<=seconds*1000);
 arr.push({id:msgId,at:now});if(arr.length>50)arr.splice(0,arr.length-50);windows.set(k,arr);return arr;
}
export async function handleRepetitionCommand(ctx){
 const text=ctx.message?.text?.trim();if(!text||!ctx.from||!group(ctx))return false;
 const chat=ctx.chat.id,user=ctx.from;
 if(text==="تفعيل التكرار"||text==="تعطيل التكرار"){
  if(!await canManage(user.id,chat)){await ctx.reply("❌ هذا الأمر للادمن الاساسي وفوق فقط.");return true;}
  await update(chat,"repetition_enabled",text==="تفعيل التكرار");await ctx.reply(text==="تفعيل التكرار"?"✅ تم تفعيل حماية التكرار.":"✅ تم تعطيل حماية التكرار.");return true;
 }
 const set=text.match(/^ضع تكرار\s+(\d+)$/);
 if(set){
  if(!await canManage(user.id,chat)){await ctx.reply("❌ هذا الأمر للادمن الاساسي وفوق فقط.");return true;}
  const limit=Number(set[1]);if(limit<1||limit>50){await ctx.reply("❌ عدد التكرار يجب أن يكون بين 1 و50.");return true;}
  sessions.set(key(chat,user.id),{limit,at:Date.now()});await ctx.reply("حسنًا، ارسل المدة التي تريدها .");return true;
 }
 const rank=text.match(/^(?:ضع|تغيير) رتبة التكرار\s+(.+)$/);
 if(rank){
  if(!await canManage(user.id,chat)){await ctx.reply("❌ هذا الأمر للادمن الاساسي وفوق فقط.");return true;}
  const aliases={"أدمن":"ادمن","أدمن أساسي":"ادمن اساسي","ادمن أساسي":"ادمن اساسي"};
  const selected=aliases[rank[1].trim()]||rank[1].trim();
  if(!Object.hasOwn(ranks,selected)){await ctx.reply("❌ الرتب المتاحة:\nعضو\nمميز\nادمن\nادمن اساسي\nنائب المالك\nالمالك\nDev");return true;}
  await update(chat,"repetition_rank",selected);await ctx.reply("☑️ تم تعيين رتبة التكرار إلى "+selected+".");return true;
 }
 const punish=text.match(/^ضع (?:كتم|تقييد) تكرار\s+(.+)$/);
 if(punish){
  if(!await canManage(user.id,chat)){await ctx.reply("❌ هذا الأمر للادمن الاساسي وفوق فقط.");return true;}
  const d=parseDuration(punish[1]);if(!d){await ctx.reply("❌ المدة غير صحيحة. مثال: ضع كتم تكرار 10د");return true;}
  await update(chat,"repetition_punishment_duration",d);await ctx.reply("✅ تم تعيين مدة العقوبة إلى "+formatDuration(d)+".");return true;
 }
 const pending=sessions.get(key(chat,user.id));
 if(pending&&Date.now()-pending.at<300000){
  if(/^(تفعيل التكرار|تعطيل التكرار|ضع تكرار|ضع رتبة التكرار|تغيير رتبة التكرار|مسح انذاراته)/.test(text))return false;
  const d=parseDuration(text);if(!d){await ctx.reply("❌ المدة غير صحيحة. أمثلة: 3ث - 5د - 1س - 2ي");return true;}
  await update(chat,"repetition_limit",pending.limit);await update(chat,"repetition_seconds",d);sessions.delete(key(chat,user.id));
  await ctx.reply("✅ تم حفظ إعداد التكرار.\n\nعدد الرسائل ↤︎ "+pending.limit+"\nالمدة ↤︎ "+formatDuration(d));return true;
 }
 return false;
}
export async function handleRepetitionMessage(ctx){
 const m=ctx.message,u=ctx.from;if(!m||!u||!group(ctx)||u.is_bot||m.text?.startsWith("/")||m.caption?.startsWith("/"))return;
 if(m.new_chat_members||m.left_chat_member||m.new_chat_title||m.new_chat_photo||m.delete_chat_photo)return;
 try{
  const s=await settings(ctx.chat.id);if(!s.enabled)return;
  if(Number(u.id)===OWNER_ID||await getDeveloperType(u.id)==="primary")return;
  const level=await getRankLevel(u.id,ctx.chat.id);if(level>(ranks[s.rank]??0))return;
  const arr=addMessage(ctx.chat.id,u.id,m.message_id,s.seconds);if(arr.length<s.limit)return;
  windows.delete(key(ctx.chat.id,u.id));
  await Promise.all(arr.slice(-s.limit).map(async x=>{try{await ctx.api.deleteMessage(ctx.chat.id,x.id);}catch{}}));
  const count=await addWarning(ctx.chat.id,u.id,"repetition");
  if(count>=3){
   const kb=new InlineKeyboard().text("تقييد","repetition_punish:restrict:"+u.id).text("كتم","repetition_punish:mute:"+u.id);
   await ctx.api.sendMessage(ctx.chat.id,"• المستخدم ↤︎ "+mention(u)+"\n• وصلت إنذاراته : "+count+"\nاختر العقوبة المناسبة له:",{parse_mode:"HTML",reply_markup:kb});
  }else await ctx.api.sendMessage(ctx.chat.id,"⚠️ تحذير التكرار "+count+"/3\n\nالمستخدم ↤︎ "+mention(u),{parse_mode:"HTML"});
 }catch(e){console.error("Repetition protection failed:",e);}
}
