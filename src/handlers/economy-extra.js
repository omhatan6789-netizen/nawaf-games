import { pool } from "../db.js";
import { randomInt } from "node:crypto";

const transfers = new Map();
const replySessions = new Map();
const OWNER_ID = 8453977662;
const enabledCache = { value: true, until: 0 };
async function enabled() {
  if (Date.now() < enabledCache.until) return enabledCache.value;
  const r = await db().query("SELECT status FROM games_settings WHERE id=1");
  enabledCache.value = !r.rows[0] || r.rows[0].status !== "off";
  enabledCache.until = Date.now() + 60000;
  return enabledCache.value;
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const mention = u => '<a href="tg://user?id='+u.id+'">'+esc(u.first_name || u.username || u.id)+'</a>';
const db = () => { if (!pool) throw new Error("Database is not configured"); return pool; };
const bank = async id => (await db().query("SELECT user_id,account_number,bank,card_type,robbery_balance FROM bank_accounts WHERE user_id=$1",[String(id)])).rows[0] || null;
const balance = async id => Number((await db().query("SELECT points FROM points WHERE user_id=$1",[String(id)])).rows[0]?.points || 0);
const ensureUser = async (c,id) => {
  await c.query("INSERT INTO users(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",[String(id)]);
  await c.query("INSERT INTO points(user_id,points) VALUES($1,0) ON CONFLICT(user_id) DO NOTHING",[String(id)]);
};
const lockIds = async (c,ids) => {
  for (const id of [...ids].map(String).sort((a,b)=>BigInt(a)<BigInt(b)?-1:1)) await c.query("SELECT pg_advisory_xact_lock($1::bigint)",[id]);
};
const fmtClock = n => [Math.floor(n/60),n%60].map(x=>String(x).padStart(2,"0")).join(":");
const fmtScratchRemaining = n => [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(x=>String(x).padStart(2,"0")).join(":");

async function rob(robberId,victimId,amount) {
  const c=await db().connect(), now=Math.floor(Date.now()/1000);
  try {
    await c.query("BEGIN"); await ensureUser(c,robberId); await ensureUser(c,victimId);
    await lockIds(c,[robberId,victimId]);
    const banks=await c.query("SELECT user_id FROM bank_accounts WHERE user_id=ANY($1::bigint[])",[[String(robberId),String(victimId)]]);
    if(banks.rowCount!==2){await c.query("ROLLBACK");return {status:"bank_missing"};}
    await c.query("INSERT INTO tasliyat_cooldowns(user_id) VALUES($1),($2) ON CONFLICT(user_id) DO NOTHING",[String(robberId),String(victimId)]);
    const rows=await c.query("SELECT user_id,robber_until,victim_rob_until FROM tasliyat_cooldowns WHERE user_id=ANY($1::bigint[]) FOR UPDATE",[[String(robberId),String(victimId)]]);
    const m=new Map(rows.rows.map(x=>[String(x.user_id),x]));
    const rleft=Math.max(0,Number(m.get(String(robberId))?.robber_until||0)-now);
    const vleft=Math.max(0,Number(m.get(String(victimId))?.victim_rob_until||0)-now);
    if(rleft){await c.query("COMMIT");return {status:"robber_cooldown",remaining:rleft};}
    if(vleft){await c.query("COMMIT");return {status:"victim_cooldown",remaining:vleft};}
    await c.query("SELECT user_id FROM points WHERE user_id=ANY($1::bigint[]) ORDER BY user_id FOR UPDATE",[[String(robberId),String(victimId)]]);
    const p=await c.query("SELECT points FROM points WHERE user_id=$1",[String(victimId)]);
    const available=Number(p.rows[0]?.points||0);
    if(available<=0){await c.query("COMMIT");return {status:"empty"};}
    const stolen=Math.min(Math.max(1,amount),available);
    await c.query("UPDATE tasliyat_cooldowns SET robber_until=$2 WHERE user_id=$1",[String(robberId),now+300]);
    await c.query("UPDATE tasliyat_cooldowns SET victim_rob_until=$2 WHERE user_id=$1",[String(victimId),now+600]);
    await c.query("UPDATE points SET points=points-$2 WHERE user_id=$1",[String(victimId),stolen]);
    await c.query("UPDATE points SET points=points+$2 WHERE user_id=$1",[String(robberId),stolen]);
    await c.query("UPDATE bank_accounts SET robbery_balance=robbery_balance+$2 WHERE user_id=$1",[String(robberId),stolen]);
    await c.query("COMMIT"); return {status:"ok",amount:stolen};
  } catch(e){await c.query("ROLLBACK");throw e;} finally{c.release();}
}
async function transfer(senderId,recipientId,amount) {
  const c=await db().connect();
  try {
    await c.query("BEGIN"); await ensureUser(c,senderId); await ensureUser(c,recipientId);
    const rows=await c.query("SELECT user_id,account_number,bank,card_type FROM bank_accounts WHERE user_id=ANY($1::bigint[])",[[String(senderId),String(recipientId)]]);
    const by=new Map(rows.rows.map(x=>[String(x.user_id),x]));
    const sb=by.get(String(senderId)), rb=by.get(String(recipientId));
    if(!sb||!rb){await c.query("ROLLBACK");return {status:"bank_missing"};}
    await lockIds(c,[senderId,recipientId]);
    await c.query("SELECT user_id FROM points WHERE user_id=ANY($1::bigint[]) ORDER BY user_id FOR UPDATE",[[String(senderId),String(recipientId)]]);
    const bal=Number((await c.query("SELECT points FROM points WHERE user_id=$1",[String(senderId)])).rows[0]?.points||0);
    if(bal<amount){await c.query("ROLLBACK");return {status:"insufficient"};}
    const received=Math.floor(amount*(sb.bank===rb.bank?95:90)/100);
    await c.query("UPDATE points SET points=points-$2 WHERE user_id=$1",[String(senderId),amount]);
    await c.query("UPDATE points SET points=points+$2 WHERE user_id=$1",[String(recipientId),received]);
    await c.query("COMMIT");return {status:"ok",senderBank:sb,recipientBank:rb,received};
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}

export async function handleEconomyExtraCallback(ctx) {
  const data=ctx.callbackQuery?.data||"";
  if(!data.startsWith("tasliyat:transfer_message:"))return false;
  const p=data.split(":"); const recipient=Number(p[2]), sender=Number(p[3]);
  if(ctx.from.id!==recipient){await ctx.answerCallbackQuery();return true;}
  replySessions.set(recipient,sender);
  await ctx.answerCallbackQuery();
  await ctx.reply("• تمام، ارسل الرسالة وبرسلها للمرسل فورًا .");
  return true;
}


async function ensureScratchCodes(){
  const c=await db().connect(), hour=Math.floor(Date.now()/3600000), chars="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  try{
    await c.query("BEGIN");await c.query("SELECT pg_advisory_xact_lock($1::bigint)",[918273645]);
    let count=Number((await c.query("SELECT COUNT(*) FROM scratch_codes WHERE hour_key=$1",[hour])).rows[0].count);
    while(count<10){
      const code=Array.from({length:12},()=>chars[randomInt(chars.length)]).join("");
      const r=await c.query("INSERT INTO scratch_codes(code,amount,hour_key,expires_at) VALUES($1,$2,$3,date_trunc('hour',NOW())+interval '1 hour') ON CONFLICT(code) DO NOTHING RETURNING id",[code,randomInt(70,10000001),hour]);
      if(r.rowCount)count++;
    }
    await c.query("COMMIT");
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
async function scratchCode(userId,code){
  const c=await db().connect();
  try{
    await c.query("BEGIN");await ensureUser(c,userId);
    await c.query("SELECT pg_advisory_xact_lock($1::bigint)",[String(userId)]);
    const last=await c.query("SELECT last_scratched_at FROM scratch_limits WHERE user_id=$1 FOR UPDATE",[String(userId)]);
    if(last.rows[0]){
      const remaining=Math.ceil((new Date(last.rows[0].last_scratched_at).getTime()+7200000-Date.now())/1000);
      if(remaining>0){await c.query("COMMIT");return {status:"cooldown",remaining};}
    }
    const r=await c.query("UPDATE scratch_codes SET used=TRUE,used_by=$1 WHERE code=$2 AND used=FALSE AND expires_at>NOW() RETURNING amount",[String(userId),code]);
    if(!r.rowCount){await c.query("COMMIT");return {status:"invalid"};}
    await c.query("INSERT INTO scratch_limits(user_id,last_scratched_at) VALUES($1,NOW()) ON CONFLICT(user_id) DO UPDATE SET last_scratched_at=EXCLUDED.last_scratched_at",[String(userId)]);
    await c.query("UPDATE points SET points=points+$2 WHERE user_id=$1",[String(userId),Number(r.rows[0].amount)]);
    await c.query("COMMIT");return {status:"success",amount:Number(r.rows[0].amount)};
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}

export async function handleEconomyExtraMessage(ctx) {
  const msg=ctx.message, text=msg?.text?.trim(), user=ctx.from;
  if(!msg||!user||!ctx.chat)return false;
  const id=user.id;
  if(!await enabled()) return false;
  if(ctx.chat.type==="private" && replySessions.has(id)){
    const sender=replySessions.get(id);replySessions.delete(id);
    try{
      if(text) await ctx.api.sendMessage(sender,"• جتك رسالة من الشخص الي حولت له🌹\n• اسمه: "+mention(user)+"\n• الرسالة: "+esc(text),{parse_mode:"HTML"});
      else{
        await ctx.api.sendMessage(sender,"• جتك رسالة من الشخص الي حولت له🌹\n• اسمه: "+mention(user)+"\n• الرسالة:"+(msg.caption?" "+esc(msg.caption):""),{parse_mode:"HTML"});
        await ctx.api.copyMessage(sender,ctx.chat.id,msg.message_id);
      }
      await ctx.reply("• تم ارسال الرسالة بنجاح ✅ .");
    }catch{await ctx.reply("تعذر إرسال الرسالة، تأكد أن المرسل يستطيع استقبال رسائل البوت.");}
    return true;
  }
  if(!text)return false;
  if (text === "عرض الاكواد") {
    await ensureScratchCodes();
    const rows = await db().query("SELECT code FROM scratch_codes WHERE used=FALSE AND expires_at>NOW() ORDER BY id");
    const body = rows.rows.map((x, i) => (i + 1) + "- <code>" + x.code + "</code>").join("\n\n");
    await ctx.reply("• اكواد الكشط الموجوده بالبوت :\n\n" + body, { parse_mode: "HTML" });
    return true;
  }
  if (/^كشط\s+[A-Za-z0-9]+$/i.test(text)) {
    await ensureScratchCodes();
    const result = await scratchCode(id, text.split(/\s+/)[1].toUpperCase());
    if (result.status === "cooldown") {
      const remaining = [Math.floor(result.remaining / 3600), Math.floor(result.remaining % 3600 / 60), result.remaining % 60].map(x => String(x).padStart(2, "0")).join(":");
      await ctx.reply("• مب حلى هو مايمديك تكشط اي كود الحين .\n• الوقت المتبقي: " + remaining + " ⏰");
    } else if (result.status === "invalid") {
      await ctx.reply("• للأسف الكود انتهى وقته او فيه شخص استعمله قبلك");
    } else {
      await ctx.reply("• تم كشط الكود بنجاح 🎉 .\n\n- الاسم ↤︎ " + mention(user) + "\n- المبلغ ↤︎ " + result.amount + " نقطة 💸 \n-", { parse_mode: "HTML" });
    }
    return true;
  }
  if (text === "رست الكشط" && id === OWNER_ID && msg.reply_to_message?.from) {
    await db().query("DELETE FROM scratch_limits WHERE user_id=$1", [String(msg.reply_to_message.from.id)]);
    await ctx.reply("• تم صفرت وقت الكشط لـ  " + mention(msg.reply_to_message.from) + " ✅", { parse_mode: "HTML" });
    return true;
  }
  if(/^تحويل\s+\d+$/.test(text)){
    if(!await bank(id)){await ctx.reply("• ماعندك حساب بنكي .");return true;}
    const amount=Number(text.split(/\s+/)[1]);
    if(amount<200)return true;
    if(await balance(id)<amount){await ctx.reply("• نقاطك ماتكفي يا مطفر\n–");return true;}
    transfers.set(id,{amount,createdAt:Date.now()});
    await ctx.reply("• الحين ارسل رقم الحساب البنكي الي تبي تحول له\n–");return true;
  }
  if(transfers.has(id)&&/^\d{17}$/.test(text)){
    const recipient=(await db().query("SELECT user_id,account_number FROM bank_accounts WHERE account_number=$1",[text])).rows[0];
    if(!recipient){transfers.delete(id);await ctx.reply("• مالقيت رقم الحساب البنكي\n–");return true;}
    if(String(recipient.user_id)===String(id)){transfers.delete(id);return true;}
    const amount=transfers.get(id).amount;transfers.delete(id);
    const result=await transfer(id,Number(recipient.user_id),amount);
    if(result.status==="insufficient"){await ctx.reply("• نقاطك ماتكفي يا مطفر\n–");return true;}
    if(result.status!=="ok")return true;
    const sb=result.senderBank,rb=result.recipientBank;
    const ur=(await db().query("SELECT first_name,username FROM users WHERE user_id=$1",[String(recipient.user_id)])).rows[0]||{};
    const to=mention({id:Number(recipient.user_id),first_name:ur.first_name||ur.username||recipient.user_id});
    const fee=sb.bank===rb.bank?"خصمت 5% لبنك "+esc(rb.bank):"خصمت 10% من بنك لبنك";
    await ctx.reply("حوالة صادرة من البنك ↢ ( "+esc(sb.bank)+" )\nالمرسل : "+mention(user)+"\nالحساب رقم : <code>"+sb.account_number+"</code>\nنوع البطاقة : "+esc(sb.card_type)+"\nالمستلم : "+to+"\nالحساب رقم : <code>"+rb.account_number+"</code>\nالبنك : "+esc(rb.bank)+"\nنوع البطاقة : "+esc(rb.card_type)+"\n"+fee+"\nالمبلغ : "+result.received+" نقطة 💵",{parse_mode:"HTML"});
    replySessions.delete(Number(recipient.user_id));
    try{await ctx.api.sendMessage(Number(recipient.user_id),"حوالة واردة من البنك ↢ ( "+esc(sb.bank)+" )\n\nالمرسل : "+mention(user)+"\nالحساب رقم : <code>"+sb.account_number+"</code>\nنوع البطاقة : "+esc(sb.card_type)+"\nالمبلغ : "+result.received+" نقطة 💸",{parse_mode:"HTML",reply_markup:{inline_keyboard:[[{text:"ارسل رسالة للمُرسل 🌹",callback_data:"tasliyat:transfer_message:"+recipient.user_id+":"+id}]]}});}catch{}
    return true;
  }
  if(text==="زرف"){
    const victim=msg.reply_to_message?.from;
    if(!victim)return true;
    if(victim.id===id){await ctx.reply("• شوفو الغبي يبي يزرف نفسه 😭😭 .");return true;}
    if(!await bank(id)){await ctx.reply("• ماعندك حساب بنكي:");return true;}
    if(!await bank(victim.id)){await ctx.reply("• ماعنده حساب بنكي");return true;}
    const r=await rob(id,victim.id,randomInt(20,1001));
    if(r.status==="robber_cooldown"){await ctx.reply("• انحش يارجال الشرطة تدور عليك 🚓\n• يمديك تزرف بعد "+fmtClock(r.remaining)+" دقيقة ⏰");return true;}
    if(r.status==="victim_cooldown"){await ctx.reply("• المسكين توه مزروف ارحمه شوي 😭 .\n• يمديك تزرفه بعد "+fmtClock(r.remaining)+" دقيقة");return true;}
    if(r.status==="empty")return true;
    if(r.status!=="ok"){await ctx.reply("• ماعنده حساب بنكي");return true;}
    const sent=await ctx.reply("• خذ يالحرامي زرفته "+r.amount+" نقطة 💵 .");
    const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Riyadh",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const time=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Riyadh",hour:"numeric",minute:"2-digit"}).format(new Date());
    const link=ctx.chat.username?"https://t.me/"+ctx.chat.username+"/"+sent.message_id:(String(ctx.chat.id).startsWith("-100")?"https://t.me/c/"+String(ctx.chat.id).slice(4)+"/"+sent.message_id:null);
    try{await ctx.api.sendMessage(victim.id,"• الحق على حلالك هههههه\n• الشخص ذا : "+mention(user)+"\n• زرفك "+r.amount+" نقطة 💸\n• التاريخ ↤︎ "+date+"\n• الساعة ↤︎ "+time+"\n-",{parse_mode:"HTML",...(link?{reply_markup:{inline_keyboard:[[{text:ctx.chat.title||"القروب",url:link}]]}}:{})});}catch{}
    return true;
  }
  return false;
}
