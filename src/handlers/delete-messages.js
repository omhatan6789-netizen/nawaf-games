import { getRankLevel } from "../ranks.js";
const group=ctx=>["group","supergroup"].includes(ctx.chat?.type);
async function deleteOne(ctx,id){try{await ctx.api.deleteMessage(ctx.chat.id,id);return true;}catch{return false;}}
export async function handleDeleteMessages(ctx){
 const text=ctx.message?.text?.trim();if(!text||!group(ctx)||!ctx.from)return false;
 const rank=await getRankLevel(ctx.from.id,ctx.chat.id);
 if(text==="مسح"){
  const target=ctx.message.reply_to_message;
  if(!target)return true;
  if(rank<2&&target.from?.id!==ctx.from.id)return true;
  await deleteOne(ctx,ctx.message.message_id);
  await deleteOne(ctx,target.message_id);
  return true;
 }
 if(!text.startsWith("مسح "))return false;
 const raw=text.slice(3).trim();if(!/^\d+$/.test(raw))return false;
 const amount=Number(raw);
 if(amount<3){if(rank>=2)await ctx.reply("الحد الادنى 3 رسائل .");return true;}
 if(amount>800){if(rank>=2)await ctx.reply("الحد الأقصى 800 رسالة .");return true;}
 if(rank<2)return true;
 await deleteOne(ctx,ctx.message.message_id);
 const ids=Array.from({length:amount},(_,i)=>ctx.message.message_id-i-1);
 for(let i=0;i<ids.length;i+=100){
  const batch=ids.slice(i,i+100);
  try{await ctx.api.deleteMessages(ctx.chat.id,batch);}
  catch{for(const id of batch)await deleteOne(ctx,id);}
 }
 return true;
}
