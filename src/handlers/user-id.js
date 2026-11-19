import { InlineKeyboard } from "grammy";
import { pool } from "../db.js";
import { OWNER_ID, getRank } from "../ranks.js";
import { saveTargetUser, getUserByUsername } from "../moderation-store.js";
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
async function resolve(ctx){
 const reply=ctx.message?.reply_to_message?.from;if(reply)return reply;
 const parts=(ctx.message?.text||"").trim().split(/\s+/);if(parts.length<2)return ctx.from;
 const token=parts.slice(1).find(x=>/^\d+$/.test(x)||x.startsWith("@"));if(!token)return null;
 try{return await ctx.api.getChat(token.startsWith("@")?token:Number(token));}catch{}
 if(token.startsWith("@")){const r=await getUserByUsername(token);if(r)return {id:Number(r.user_id),username:r.username,first_name:r.first_name};}
 return null;
}
export async function handleUserIdCommand(ctx){
 const text=ctx.message?.text?.trim();if(!text||!/^ايدي(?:\s+.+)?$/.test(text)||!ctx.from)return false;
 const target=await resolve(ctx);if(!target){await ctx.reply("❌ حدد الشخص بالرد أو اليوزر أو الآيدي.");return true;}
 try{await saveTargetUser(target);}catch{}
 const q=await pool.query("SELECT messages,joined_date FROM users WHERE user_id=$1",[String(target.id)]);
 if(!q.rows[0]){await ctx.reply("❌ تعذر جلب بيانات المستخدم حاليًا.");return true;}
 const row=q.rows[0],p=await pool.query("SELECT points FROM points WHERE user_id=$1",[String(target.id)]);
 let rank="عضو";try{rank=await getRank(target.id,ctx.chat?.id??null)||"عضو";}catch{}
 let bio="لا يوجد",name=target.first_name||target.title||"غير معروف",username=target.username??null;
 try{const full=await ctx.api.getChat(target.id);bio=full.bio||bio;name=full.first_name||full.title||name;username=full.username||username;}catch{}
 let joined=row.joined_date?new Date(row.joined_date).toLocaleDateString("en-GB",{timeZone:"Asia/Riyadh"}):"غير معروف";
 const rankText=target.id===OWNER_ID?"<tg-spoiler>"+esc(rank)+"</tg-spoiler>":esc(rank);
 const caption="\n🌷ᵂᴱᴸᶜᴼᴹᴱ ᵀᴼ ᴳᴿᴼᵁᴾ🌷\n- عـيـونـي تـنـظـفـت يـوم شـفـت افـتارك\n"+
 "🖱️ Name 𖦹 "+esc(name)+"\n"+
 "🖥️ USER 𖦹 "+esc(username?"@"+username:"لا يوجد")+"\n"+
 "💬 MSG 𖦹 "+Number(row.messages??0)+"\n"+
 "🛡 STA 𖦹 "+rankText+"\n"+
 "⭐ POINTS 𖦹 "+Number(p.rows[0]?.points??0)+"\n"+
 "ℹ️ ID 𖦹 <code>"+Number(target.id)+"</code>\n"+
 "🗒 BIO 𖦹 "+esc(bio)+"\n"+
 "📅 Joined Group 𖦹 "+esc(joined);
 try{
  const photos=await ctx.api.getUserProfilePhotos(target.id,{limit:1});
  if(photos.total_count){const photo=photos.photos[0][photos.photos[0].length-1].file_id;await ctx.replyWithPhoto(photo,{caption,parse_mode:"HTML",has_spoiler:true,reply_markup:new InlineKeyboard().url("🌷","https://t.me/Lewadbot")});return true;}
 }catch{}
 await ctx.reply(caption,{parse_mode:"HTML"});return true;
}
