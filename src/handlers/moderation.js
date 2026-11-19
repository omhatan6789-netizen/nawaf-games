import { InlineKeyboard } from "grammy";
import { OWNER_ID, getRank, getRankLevel, getDeveloperType } from "../ranks.js";
import { getModerationSettings,setModerationSetting,saveTargetUser,saveSanction,deleteSanction,getActiveMute,getUserRestrictions,getSanctionRows,clearSanctionTable,addWarning,getWarningCount,clearWarnings,getExpiredSanctions } from "../moderation-store.js";

const TABLES={mute:["bot_mutes","قائمه المكتومين","مسح المكتومين"],restrict:["restrictions","قائمه المقيدين","مسح المقيدين"],ban:["moderation_bans","قائمه المحظورين","مسح المحظورين"]};
const FULL={can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true,can_invite_users:true,can_manage_topics:true};
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const mention=u=>'<a href="tg://user?id='+Number(u.id)+'">'+esc(u.first_name||u.username||u.id)+'</a>';
const isGroup=ctx=>["group","supergroup"].includes(ctx.chat?.type);
function duration(t){const m=String(t??"").match(/^(\d+(?:\.\d+)?)\s*(ث|ثانية|ثواني|د|دقيقة|دقائق|س|ساعة|ساعات|ي|يوم|أيام)$/);if(!m)return null;const n=Number(m[1]);if(n<=0)return null;return Math.floor(n*({"ث":1,"ثانية":1,"ثواني":1,"د":60,"دقيقة":60,"دقائق":60,"س":3600,"ساعة":3600,"ساعات":3600,"ي":86400,"يوم":86400,"أيام":86400}[m[2]]));}
function fmt(s){return s%86400===0?(s/86400)+" يوم":s%3600===0?(s/3600)+" ساعة":s%60===0?(s/60)+" دقيقة":s+" ثانية";}
async function permitted(id,chat,min){if(Number(id)===OWNER_ID)return true;if(await getDeveloperType(id))return true;return (await getRankLevel(id,chat))>=min;}
async function targetOf(ctx){
 const reply=ctx.message?.reply_to_message?.from;if(reply){await saveTargetUser(reply);return reply;}
 const words=(ctx.message?.text||"").trim().split(/\s+/),token=words.slice(1).find(x=>/^\d+$/.test(x)||x.startsWith("@"));if(!token)return null;
 try{const u=await ctx.api.getChat(token.startsWith("@")?token:Number(token));if(u?.id){await saveTargetUser(u);return u;}}catch{}
 if(token.startsWith("@")){const p=await import("../moderation-store.js");const row=await p.getUserByUsername(token);return row?{id:Number(row.user_id),username:row.username,first_name:row.first_name}:null;}
 return null;
}
async function act(ctx,action,target,seconds,reason){
 const until=seconds?new Date(Date.now()+seconds*1000):null,table={mute:"bot_mutes",restrict:"restrictions",ban:"moderation_bans"}[action];
 if(action==="restrict")await ctx.api.restrictChatMember(ctx.chat.id,target.id,{can_send_messages:false},until?{until_date:Math.floor(until.getTime()/1000)}:{});
 if(action==="ban")await ctx.api.banChatMember(ctx.chat.id,target.id,{...(until?{until_date:Math.floor(until.getTime()/1000)}:{})});
 await saveSanction(table,ctx.chat.id,target,until,reason,ctx.from.id);
 const label={mute:"كتم",restrict:"تقييد",ban:"حظر"}[action];
 const lead=action==="mute"?"تم كتمته لين يهجد بعدين فكوه":action==="restrict"?"تم قيَّدته لين يهجد بعدين فكوه":"تم حظرته لعيونك يـ "+esc(await getRank(ctx.from.id,ctx.chat.id));
 await ctx.reply(lead+"\nالمستخدم ↤︎ "+mention(target)+(seconds?"\nمدة "+label+" ↤︎ "+fmt(seconds):"")+(reason?"\nالسبب ↤︎ "+esc(reason):""),{parse_mode:"HTML"});
}
async function remove(ctx,action,target){
 const table={mute:"bot_mutes",restrict:"restrictions",ban:"moderation_bans"}[action];
 if(action==="restrict")await ctx.api.restrictChatMember(ctx.chat.id,target.id,FULL);
 if(action==="ban")await ctx.api.unbanChatMember(ctx.chat.id,target.id,{only_if_banned:false});
 await deleteSanction(table,ctx.chat.id,target.id);
 await ctx.reply("فكيت عنه "+({mute:"الكتم",restrict:"التقييد",ban:"الحظر"}[action])+" يارب يعقل 🙏🏻\n• المستخدم ↤︎ "+mention(target),{parse_mode:"HTML"});
}
export async function handleModerationCommand(ctx){
 const text=ctx.message?.text?.trim();if(!text||!ctx.from||!isGroup(ctx))return false;
 const chat=ctx.chat.id,actor=ctx.from;
 if(["تفعيل المدة للمشرفين","تعطيل المدة للمشرفين","تفعيل الاسباب","تعطيل الاسباب"].includes(text)){
  if(!await permitted(actor.id,chat,2))return true;
  const col=text.includes("المدة")?"durations_enabled":"reasons_enabled",on=text.startsWith("تفعيل");await setModerationSetting(chat,col,on);
  await ctx.reply(text.includes("المدة")?(on?"• تم تفعيل المدة للمشرفين .":"• تم تعطيل المدة للمشرفين ."):(on?"• تم تفعيل الاسباب .":"• تم تعطيل الاسباب ."));return true;
 }
 if(["المكتومين","المقيدين","المحظورين"].includes(text)){
  if(!await permitted(actor.id,chat,3))return true;
  const kind={المكتومين:"mute",المقيدين:"restrict",المحظورين:"ban"}[text],rows=await getSanctionRows(TABLES[kind][0],chat);
  let out="• "+TABLES[kind][1]+"\n━━━━━━━━━━━━\n";
  if(!rows.length)out+="لا يوجد\n";else rows.forEach((r,i)=>{out+=(i+1)+" - "+(r.username?"@"+r.username:'<a href="tg://user?id='+r.user_id+'">'+esc(r.first_name||r.user_id)+'</a>')+"\n";});
  await ctx.reply(out,{parse_mode:"HTML",reply_markup:new InlineKeyboard().text(TABLES[kind][2],"moderation:clear:"+kind)});return true;
 }
 if(/^كشف القيود(?:\s+.+)?$/.test(text)){
  const t=await targetOf(ctx);if(!t)return true;const rs=await getUserRestrictions(chat,t.id),w=await getWarningCount(chat,t.id);
  await ctx.reply("• معلومات الكشف\n━━━━━━━━━━━━\n• الحظر : "+(rs.includes("حظر")?"محظور":"غير محظور")+"\n• الكتم : "+(rs.includes("كتم")?"مكتوم":"غير مكتوم")+"\n• التقييد : "+(rs.includes("تقييد")?"مقيد":"غير مقيد")+"\n• الانذارات : "+w);return true;
 }
 if(text==="انذار"||text.startsWith("انذار ")){
  if(!await permitted(actor.id,chat,2))return true;const t=await targetOf(ctx);if(!t)return true;
  if(t.id===actor.id||t.id===ctx.me.id||(await getRankLevel(t.id,chat))>=(await getRankLevel(actor.id,chat))){await ctx.reply("• اعذرني بس هذا الأمر لـ ↤︎〖 الادمن 〗وفوق فقط .");return true;}
  const n=await addWarning(chat,t.id,"manual");
  if(n>=3)await ctx.reply("• المستخدم ↤︎ "+mention(t)+"\n• وصلت إنذاراته : "+n+"\nاختر العقوبة المناسبة له:",{parse_mode:"HTML",reply_markup:new InlineKeyboard().text("تقييد","repetition_punish:restrict:"+t.id).text("كتم","repetition_punish:mute:"+t.id)});
  else await ctx.reply("• تمام عطيته انذار .\n• المستخدم ↤︎ "+mention(t)+"\n• عدد إنذاراته : "+n,{parse_mode:"HTML"});return true;
 }
 if(text==="مسح انذاراته"||text.startsWith("مسح انذاراته ")){
  if(!await permitted(actor.id,chat,2))return true;const t=await targetOf(ctx);if(!t)return true;
  if((await getRankLevel(t.id,chat))>=(await getRankLevel(actor.id,chat)))return true;
  const n=await clearWarnings(chat,t.id);await ctx.reply(n?"☑️ تم مسح جميع انذاراته.":"• الشخص هذا ماعنده انذارات من قبل.");return true;
 }
 const removePrefix=["الغاء الكتم","الغاء التقييد","الغاء الحظر"].find(x=>text===x||text.startsWith(x+" "));
 if(removePrefix){
  const action={"الغاء الكتم":"mute","الغاء التقييد":"restrict","الغاء الحظر":"ban"}[removePrefix];if(!await permitted(actor.id,chat,action==="ban"?3:2))return true;
  const t=await targetOf(ctx);if(!t)return true;if(t.id===actor.id||t.id===ctx.me.id)return true;await remove(ctx,action,t);return true;
 }
 if(text==="رفع القيود"||text.startsWith("رفع القيود ")){
  if(!await permitted(actor.id,chat,2))return true;const t=await targetOf(ctx);if(!t)return true;const rs=await getUserRestrictions(chat,t.id);
  if(rs.includes("كتم"))await deleteSanction("bot_mutes",chat,t.id);
  if(rs.includes("تقييد"))await remove(ctx,"restrict",t);
  if(rs.includes("حظر")&&await permitted(actor.id,chat,3))await remove(ctx,"ban",t);
  await ctx.reply("• تم رفع القيود عنه، قيوده كانت ( "+rs.join("، ")+" )\nالمستخدم ↤︎ "+mention(t),{parse_mode:"HTML"});return true;
 }
 const action=text.split(/\s+/)[0],actionMap={كتم:"mute",تقييد:"restrict",حظر:"ban"};
 if(actionMap[action]){
  if(!await permitted(actor.id,chat,2))return true;
  const settings=await getModerationSettings(chat),parts=text.split(/\s+/),rest=parts.slice(1);
  const di=rest.findIndex(x=>duration(x)!==null),dur=di>=0&&settings.durations_enabled?duration(rest[di]):null;
  const targetToken=rest.find((x,i)=>i!==di&&(/^\d+$/.test(x)||x.startsWith("@")));
  const t=await targetOf(ctx);if(!t)return true;
  if(t.id===actor.id||t.id===ctx.me.id){await ctx.reply("صحصح شف من الي تبي تعاقبه ياورع!");return true;}
  if((await getRankLevel(t.id,chat))>=(await getRankLevel(actor.id,chat))){await ctx.reply("صحصح، لا يمكنك معاقبة شخص رتبته مساوية أو أعلى منك.");return true;}
  const reason=settings.reasons_enabled?rest.filter((x,i)=>i!==di&&x!==targetToken).join(" "):"";
  await act(ctx,actionMap[action],t,dur??(action==="كتم"&&settings.durations_enabled?3600:null),reason);return true;
 }
 return false;
}
export async function handleModerationCallback(ctx){
 const data=ctx.callbackQuery?.data;if(!data?.startsWith("moderation:clear:")||!ctx.callbackQuery.message)return;
 const kind=data.split(":")[2];if(!TABLES[kind])return;
 const chat=ctx.callbackQuery.message.chat.id;if(!await permitted(ctx.from.id,chat,3)){await ctx.answerCallbackQuery({text:"هذا الأمر للأدمن الأساسي وفوق فقط!",show_alert:true});return;}
 const rows=await getSanctionRows(TABLES[kind][0],chat);await ctx.answerCallbackQuery();
 if(kind==="restrict")for(const r of rows){try{await ctx.api.restrictChatMember(chat,Number(r.user_id),FULL);}catch{}}
 if(kind==="ban")for(const r of rows){try{await ctx.api.unbanChatMember(chat,Number(r.user_id),{only_if_banned:false});}catch{}}
 const ids=await clearSanctionTable(TABLES[kind][0],chat);await ctx.editMessageText("• تم "+TABLES[kind][2]+" . ("+ids.length+")");
}
export async function handleRepetitionPunishmentCallback(ctx){
 const d=ctx.callbackQuery?.data;if(!d?.startsWith("repetition_punish:")||!ctx.callbackQuery.message)return;
 const [,action,id]=d.split(":");if(!["mute","restrict"].includes(action))return;const chat=ctx.callbackQuery.message.chat.id,userId=Number(id);
 if(!await permitted(ctx.from.id,chat,3)){await ctx.answerCallbackQuery({text:"❌ ليس لديك الصلاحية.",show_alert:true});return;}
 if(await getWarningCount(chat,userId)<3||userId===OWNER_ID||(await getRankLevel(userId,chat))>=(await getRankLevel(ctx.from.id,chat))){await ctx.answerCallbackQuery({text:"❌ لا يمكنك تطبيق العقوبة عليه.",show_alert:true});return;}
 let target;try{const u=await ctx.api.getChat(userId);target={id:u.id,username:u.username,first_name:u.first_name||u.title};}catch{await ctx.answerCallbackQuery({text:"تعذر العثور على المستخدم.",show_alert:true});return;}
 const p=await import("../db.js"),r=await p.pool.query("SELECT repetition_punishment_duration FROM protection_settings WHERE chat_id=$1",[String(chat)]),until=new Date(Date.now()+Number(r.rows[0]?.repetition_punishment_duration??300)*1000);
 if(action==="restrict")await ctx.api.restrictChatMember(chat,userId,{can_send_messages:false},{until_date:Math.floor(until.getTime()/1000)});
 await saveSanction(action==="mute"?"bot_mutes":"restrictions",chat,target,until,"التكرار",ctx.me.id);await clearWarnings(chat,userId);
 await ctx.answerCallbackQuery({text:"تم اختيار العقوبة وتصفير إنذاراته."});try{await ctx.editMessageText("• ✅ تم اختيار العقوبة المناسبة بنجاح .");}catch{}
}
export async function handleMutedMessage(ctx){if(ctx.message&&ctx.from&&isGroup(ctx)&&await getActiveMute(ctx.chat.id,ctx.from.id)){try{await ctx.deleteMessage();}catch{}return true;}return false;}
export async function moderationExpiryLoop(bot){
 while(true){try{const expired=await getExpiredSanctions();for(const [c,u] of expired.mutes)await deleteSanction("bot_mutes",c,u);for(const [c,u] of expired.restrictions){try{await bot.api.restrictChatMember(c,u,FULL);await deleteSanction("restrictions",c,u);}catch(e){console.error("Auto-unrestrict failed",e);}}for(const [c,u] of expired.bans){try{await bot.api.unbanChatMember(c,u,{only_if_banned:false});await deleteSanction("moderation_bans",c,u);}catch(e){console.error("Auto-unban failed",e);}}}catch(e){console.error("Moderation expiry loop failed",e);}await new Promise(r=>setTimeout(r,5000));}
}
