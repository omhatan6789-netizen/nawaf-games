import { pool } from "../db.js";
import { randomInt } from "node:crypto";

const OWNER_ID = 8453977662;
const BANKS = {
  ahli: { name: "الاهلي", card: "فيزا" },
  inma: { name: "الانماء", card: "مدى" },
  rajhi: { name: "الراجحي", card: "ماستر كارد" }
};
const ITEMS = {
  "برج": { emoji: "🏰", min: 2188, max: 4375 },
  "جزيرة": { emoji: "🏝", min: 2625, max: 5250 },
  "بيت": { emoji: "🏠", min: 1500, max: 3000 },
  "طيارة": { emoji: "🛩", min: 1125, max: 2250 },
  "سيارة": { emoji: "🏎", min: 750, max: 1500 },
  "سفينة": { emoji: "🛳", min: 1000, max: 2000 },
  "قطار": { emoji: "🚂", min: 1750, max: 3500 },
  "قصر": { emoji: "🏯", min: 2438, max: 4875 },
  "ماسة": { emoji: "💎", min: 625, max: 1250 },
  "طعمية": { emoji: "🧆", min: 13, max: 25 },
  "شاورما": { emoji: "🌯", min: 22, max: 44 },
  "مزرعة": { emoji: "🌾", min: 500, max: 1000 }
};
const JOBS = [
  ["دكتور","👨🏻‍⚕️",3900],["مهندس","👷🏻",3000],["معلّم","👨🏻‍🏫",2500],
  ["محامي","⚖️",3200],["مبرمج","👨🏻‍💻",1800],["طيار","👨🏻‍✈️",4000],
  ["شرطي","👮🏻",1700],["صيدلي","💊",1000],["مصمم","🎨",1400],
  ["طباخ","👨🏻‍🍳",1200],["ممرض","🧑🏻‍⚕️",1500],["سائق","🚗",900],
  ["رقاصة","💃🏻",600],["كاشير","🧑🏻‍💼",800],["كهربائي","⚡️",1400],
  ["محاسب","🧑🏻‍💼",2000],["قاضي","👨🏻‍⚖️",3800],["مزارع","👨🏻‍🌾",1100]
];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c]);
const mention = u => `<a href="tg://user?id=${u.id}">${esc(u.first_name || u.username || u.id)}</a>`;
const enabledCache = { value: true, until: 0 };

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}
async function enabled() {
  if (Date.now() < enabledCache.until) return enabledCache.value;
  const r = await db().query("SELECT status FROM games_settings WHERE id=1");
  enabledCache.value = !r.rows[0] || r.rows[0].status !== "off";
  enabledCache.until = Date.now() + 60000;
  return enabledCache.value;
}
async function ensureUser(client, id) {
  await client.query("INSERT INTO users(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING", [String(id)]);
  await client.query("INSERT INTO points(user_id,points) VALUES($1,0) ON CONFLICT(user_id) DO NOTHING", [String(id)]);
}
async function balance(id) {
  const r = await db().query("SELECT points FROM points WHERE user_id=$1", [String(id)]);
  return Number(r.rows[0]?.points || 0);
}
async function bank(id) {
  const r = await db().query("SELECT user_id,account_number,bank,card_type,robbery_balance FROM bank_accounts WHERE user_id=$1", [String(id)]);
  return r.rows[0] || null;
}
function duration(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const m = Math.floor(seconds / 60), s = seconds % 60;
  if (!m) return s === 1 ? "ثانية" : `${s} ثانية`;
  let mt = m === 1 ? "دقيقة" : m === 2 ? "دقيقتين" : m <= 10 ? ["","","","ثلاث","أربع","خمس","ست","سبع","ثمان","تسع","عشر"][m] + " دقائق" : `${m} دقيقة`;
  return s ? `${mt} و ${s} ثانية` : mt;
}
async function createBank(targetId, bankKey) {
  const info = BANKS[bankKey];
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await ensureUser(client, targetId);
    let existing = await client.query("SELECT user_id,account_number,bank,card_type,robbery_balance FROM bank_accounts WHERE user_id=$1", [String(targetId)]);
    if (existing.rowCount) { await client.query("COMMIT"); return existing.rows[0]; }
    let result;
    for (let i=0;i<8;i++) {
      const number = String(randomInt(10_000_000_000_000_000, 99_999_999_999_999_999));
      result = await client.query(
        "INSERT INTO bank_accounts(user_id,account_number,bank,card_type) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING user_id,account_number,bank,card_type,robbery_balance",
        [String(targetId),number,info.name,info.card]
      );
      if (result.rowCount) break;
    }
    await client.query("COMMIT");
    return result?.rows?.[0] || await bank(targetId);
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
async function claimReward(id, column, cooldown, amount) {
  const allowed = new Set(["salary_until","tip_until"]);
  if (!allowed.has(column)) throw new Error("invalid cooldown");
  const client = await db().connect(), now = Math.floor(Date.now()/1000);
  try {
    await client.query("BEGIN"); await ensureUser(client,id);
    await client.query("INSERT INTO tasliyat_cooldowns(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",[String(id)]);
    const c = await client.query(`SELECT ${column} AS until FROM tasliyat_cooldowns WHERE user_id=$1 FOR UPDATE`,[String(id)]);
    const remaining = Math.max(0,Number(c.rows[0].until || 0)-now);
    if (remaining) { await client.query("COMMIT"); return {ok:false,remaining}; }
    const p = await client.query("UPDATE points SET points=points+$2 WHERE user_id=$1 RETURNING points",[String(id),amount]);
    await client.query(`UPDATE tasliyat_cooldowns SET ${column}=$2 WHERE user_id=$1`,[String(id),now+cooldown]);
    await client.query("COMMIT"); return {ok:true,balance:Number(p.rows[0].points)};
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
async function gamble(id, kind, amount, outcome, percent=0) {
  const column = kind === "invest" ? "investment_until" : "luck_until";
  const client = await db().connect(), now = Math.floor(Date.now()/1000);
  try {
    await client.query("BEGIN"); await ensureUser(client,id);
    const p = await client.query("SELECT points FROM points WHERE user_id=$1 FOR UPDATE",[String(id)]);
    const before = Number(p.rows[0]?.points || 0);
    await client.query("INSERT INTO tasliyat_cooldowns(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",[String(id)]);
    const c = await client.query(`SELECT ${column} AS until FROM tasliyat_cooldowns WHERE user_id=$1 FOR UPDATE`,[String(id)]);
    const remaining = Math.max(0,Number(c.rows[0].until || 0)-now);
    if (remaining) { await client.query("COMMIT"); return {status:"cooldown",remaining,before,after:before}; }
    if (amount <= 0 || before < amount) { await client.query("COMMIT"); return {status:"insufficient",before,after:before}; }
    let delta;
    if (kind === "invest") delta = outcome ? Math.floor(amount*percent/100) : -amount;
    else delta = outcome ? amount : -amount;
    const upd = await client.query("UPDATE points SET points=points+$2 WHERE user_id=$1 RETURNING points",[String(id),delta]);
    await client.query(`UPDATE tasliyat_cooldowns SET ${column}=$2 WHERE user_id=$1`,[String(id),now+1200]);
    await client.query("COMMIT");
    return {status: kind === "invest" ? (outcome ? "success":"failed") : (outcome ? "won":"lost"),before,after:Number(upd.rows[0].points),profit:delta};
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
async function storePrices() {
  const hour = Math.floor(Date.now()/3600000);
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)",[918273646]);
    const prices = {};
    for (const [key,b] of Object.entries(ITEMS)) {
      const r = await client.query("SELECT price,hour_key FROM store_prices WHERE item_key=$1",[key]);
      let price = Number(r.rows[0]?.price);
      if (!r.rowCount || Number(r.rows[0].hour_key)!==hour) {
        price = randomInt(b.min,b.max+1);
        await client.query("INSERT INTO store_prices(item_key,price,hour_key) VALUES($1,$2,$3) ON CONFLICT(item_key) DO UPDATE SET price=EXCLUDED.price,hour_key=EXCLUDED.hour_key",[key,price,hour]);
      }
      prices[key]=price;
    }
    await client.query("COMMIT"); return prices;
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export async function handleEconomyCallback(ctx) {
  if (!ctx.callbackQuery?.data?.startsWith("tasliyat:bank:")) return false;
  await ctx.answerCallbackQuery();
  if (!await enabled()) return true;
  const [, , key, rawId] = ctx.callbackQuery.data.split(":");
  const targetId = Number(rawId), info = BANKS[key];
  if (!info || !Number.isSafeInteger(targetId) || (ctx.from.id !== targetId && ctx.from.id !== OWNER_ID)) return true;
  if (await bank(targetId)) {
    await ctx.editMessageText("• عنده حساب بنكي 😅\n\n• لعرض معلومات حسابه اكتب\n↤︎ حسابي"); return true;
  }
  const created = await createBank(targetId,key);
  if (!created) { await ctx.editMessageText("• تعذر إنشاء الحساب، حاول مرة ثانية."); return true; }
  await ctx.editMessageText(
    `• سويت لك حساب في البنك ( ${info.name} 💳 )\n• رقم حسابك ↢ ( <code>${created.account_number}</code> )\n• نوع البطاقة ↢ ( ${info.card} )\n• نقاطك ↢ ( ${await balance(targetId)} 💵 )`,
    {parse_mode:"HTML"}
  );
  return true;
}

export async function handleEconomyMessage(ctx) {
  const text = ctx.message?.text?.trim();
  if (!text || !ctx.from || !ctx.chat || !["group","supergroup","private"].includes(ctx.chat.type)) return false;
  const id = ctx.from.id, msg = ctx.message;
  if (!/^(انشاء حساب بنكي|حسابي|مسح حسابي|راتب|راتبي|بخشيش|استثمار(?: نقاطي|\s+\d+)?|حظ(?: نقاطي|\s+\d+)?|المتجر|ممتلكاتي|ممتلكاته|شراء \d+ .+|بيع \d+ .+|اهداء \d+ .+)$/.test(text)) return false;
  if (!await enabled()) return true;

  if (text === "انشاء حساب بنكي") {
    let target = ctx.from;
    if (msg.reply_to_message) {
      if (id !== OWNER_ID || !msg.reply_to_message.from) return true;
      target = msg.reply_to_message.from;
    }
    if (await bank(target.id)) { await ctx.reply("• عنده حساب بنكي 😅\n\n• لعرض معلومات حسابه اكتب\n↤︎ حسابي"); return true; }
    await ctx.reply("• عشان تسوي حساب لازم تختار نوع البطاقة\n↤︎ الاهلي\n↤︎ الانماء\n↤︎ الراجحي", {
      reply_markup:{inline_keyboard:[
        [{text:"الاهلي",callback_data:`tasliyat:bank:ahli:${target.id}`}],
        [{text:"الانماء",callback_data:`tasliyat:bank:inma:${target.id}`}],
        [{text:"الراجحي",callback_data:`tasliyat:bank:rajhi:${target.id}`}]
      ]}
    }); return true;
  }
  if (text === "حسابي") {
    const b = await bank(id);
    if (!b) await ctx.reply("• ماعندك حساب بنكي ارسل ↢ ( انشاء حساب بنكي )");
    else await ctx.reply(`• الاسم ↢ ${mention(ctx.from)}\n• الحساب ↢ <code>${b.account_number}</code>\n• بنك ↢ ( ${esc(b.bank)} )\n• نوع ↢ ( ${esc(b.card_type)} )\n• الرصيد ↢ ( ${await balance(id)} نقطة 💵 )\n• الزرف ↢ ( ${Number(b.robbery_balance)} نقطة 🥷🏻 )`,{parse_mode:"HTML"});
    return true;
  }
  if (text === "مسح حسابي") {
    const b=await bank(id);
    if (!b) await ctx.reply("• ماعندك حساب بنكي .");
    else { await db().query("DELETE FROM bank_accounts WHERE user_id=$1",[String(id)]); await ctx.reply("• تم مسح حسابك البنكي ."); }
    return true;
  }
  if (text === "راتب" || text === "راتبي") {
    if (!await bank(id)) { await ctx.reply("• ماعندك حساب بنكي ."); return true; }
    const [job,emoji,amount]=JOBS[randomInt(JOBS.length)];
    const result=await claimReward(id,"salary_until",600,amount);
    if (!result.ok) await ctx.reply(`• راتبك بينزل بعد ${duration(result.remaining)} .`);
    else await ctx.reply(`اشعار ايداع ${mention(ctx.from)}\nالمبلغ: ${amount} نقطة\nوظيفتك: ${job} ${emoji}\nنوع العملية: اضافة راتب\nرصيدك الحين: ${result.balance} نقطة 💸`,{parse_mode:"HTML"});
    return true;
  }
  if (text === "بخشيش") {
    if (!await bank(id)) { await ctx.reply("• ماعندك حساب بنكي ."); return true; }
    const amount=randomInt(100,2001), result=await claimReward(id,"tip_until",600,amount);
    if (!result.ok) await ctx.reply(`• بس بس مب حلاو هو !!\n↤︎ تعال بعد ${duration(result.remaining)}`);
    else await ctx.reply(`• شفقت عليك وعطيتك ${amount} نقطة 💵`);
    return true;
  }
  if (text.startsWith("استثمار") || text.startsWith("حظ")) {
    if (!await bank(id)) { await ctx.reply("• ماعندك حساب بنكي ."); return true; }
    const parts=text.split(/\s+/), amount=parts.length===1 || parts[1]==="نقاطي" ? await balance(id) : Number(parts[1]);
    if (!Number.isSafeInteger(amount) || amount<=0) return true;
    if (text.startsWith("استثمار")) {
      const success=randomInt(1,101)<=90;
      const roll=randomInt(1,101), percent=roll<=50?randomInt(1,21):roll<=90?randomInt(21,31):randomInt(31,41);
      const r=await gamble(id,"invest",amount,success,percent);
      if (r.status==="insufficient") await ctx.reply("• نقاطك ماتكفي يا مطفر\n–");
      else if (r.status==="cooldown") await ctx.reply(`• مايمديك تستثمر الحين\n• تعال بعد ${duration(r.remaining)}`);
      else if (r.status==="failed") await ctx.reply(`• استثمار فاشل\n• نسبة الربح ↢ 0%\n• مبلغ الربح ↢ ( 0 )\n• نقاطك صارت ↢ ( ${r.after} )`);
      else await ctx.reply(`• استثمار ناجح\n• نسبة الربح ↢ ${percent}%\n• مبلغ الربح ↢ ( ${r.profit} )\n• نقاطك صارت ↢ ( ${r.after} )`);
    } else {
      const r=await gamble(id,"luck",amount,randomInt(1,3)===1);
      if (r.status==="insufficient") await ctx.reply("• نقاطك ماتكفي يا مطفر\n–");
      else if (r.status==="cooldown") await ctx.reply(`• مايمديك تسوي حظ الحين\n• تعال بعد ${duration(r.remaining)}`);
      else if (r.status==="won") await ctx.reply(`• مبروك فزت بالحظ 🥳🎉\n• نقاطك قبل ↢ ( ${r.before} نقطة 💵 )\n• نقاطك الحين ↢ ( ${r.after} نقطة 💵 )`);
      else await ctx.reply(`• للاسف خسرت بالحظ 😂😂\n• نقاطك قبل ↢ ( ${r.before} نقطة 💵 )\n• نقاطك الحين ↢ ( ${r.after} نقطة 💵 )\n-`);
    }
    return true;
  }
  if (text === "المتجر") {
    const prices=await storePrices();
    const lines=["اهلًا يالتاجر هذا المتجر وأسعار المنتجات:"];
    Object.entries(ITEMS).forEach(([k,v],i)=>lines.push(`${i+1} - ${k} ${v.emoji} ↤︎ ${prices[k]} .`));
    lines.push("","• يمديك تشتري كذا، مثال : شراء 2 سيارة","• يمديك تبيع كذا، مثال : بيع 2 سيارة","• يمديك تهدي شخص كذا، مثال : اهداء 2 سيارة بالرد");
    await ctx.reply(lines.join("\n")); return true;
  }
  if (text === "ممتلكاتي" || text === "ممتلكاته") {
    const target = text === "ممتلكاته" ? msg.reply_to_message?.from : ctx.from;
    if (!target) return true;
    const r=await db().query("SELECT item_key,quantity FROM possessions WHERE user_id=$1 AND quantity>0 ORDER BY item_key",[String(target.id)]);
    if (!r.rowCount) await ctx.reply(text==="ممتلكاته"?"• الرجال ماعنده شي رح تبرع له .":"• مسكين ماعندك شي رح اشتغل على نفسك بعدين تعال 😂 .");
    else await ctx.reply((text==="ممتلكاته"?"• قائمة ممتلكاته .":"• أهلاً بك في قائمة ممتلكاتك .")+"\n"+r.rows.map(x=>`( ${x.item_key} ↤︎ ${x.quantity} )`).join("\n"));
    return true;
  }
  if (/^(شراء|بيع) /.test(text)) {
    const [,action,qtyRaw,item]=text.match(/^(شراء|بيع) (\d+) (.+)$/)||[];
    const qty=Number(qtyRaw);
    if (!ITEMS[item] || !Number.isSafeInteger(qty) || qty<=0 || qty>100000) return true;
    const prices=await storePrices(), total=prices[item]*qty;
    if (action==="شراء") {
      const client=await db().connect();
      try {
        await client.query("BEGIN"); await ensureUser(client,id);
        const r=await client.query("UPDATE points SET points=points-$2 WHERE user_id=$1 AND points >= $2 RETURNING points",[String(id),total]);
        if (!r.rowCount) { await client.query("ROLLBACK"); await ctx.reply("• نقاطك ماتكفي يا مطفر\n–"); return true; }
        await client.query("INSERT INTO possessions(user_id,item_key,quantity) VALUES($1,$2,$3) ON CONFLICT(user_id,item_key) DO UPDATE SET quantity=possessions.quantity+EXCLUDED.quantity",[String(id),item,qty]);
        await client.query("COMMIT");
        await ctx.reply(`• مبروك تم شراء : ${item}\n• العدد : ${qty}\n• بقيمة : ${total} نقطة 💸\n• أصبحت نقاطك : (${r.rows[0].points} 💸)\n• اكتب ( ممتلكاتي ) لمعرفة مملكاتك`);
      } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    } else {
      const client=await db().connect();
      try {
        await client.query("BEGIN"); await ensureUser(client,id);
        const r=await client.query("SELECT quantity FROM possessions WHERE user_id=$1 AND item_key=$2 FOR UPDATE",[String(id),item]);
        const owned=Number(r.rows[0]?.quantity||0);
        if (!owned) { await client.query("ROLLBACK"); await ctx.reply(`• انت اصلًا ماعندك ${item} تاكد من ممتلكاتك .`); return true; }
        if (owned<qty) { await client.query("ROLLBACK"); await ctx.reply(`• عندك ${owned} من (${item}) فقط .`); return true; }
        if (owned===qty) await client.query("DELETE FROM possessions WHERE user_id=$1 AND item_key=$2",[String(id),item]);
        else await client.query("UPDATE possessions SET quantity=quantity-$3 WHERE user_id=$1 AND item_key=$2",[String(id),item,qty]);
        const value=Math.floor(total*0.5);
        const p=await client.query("UPDATE points SET points=points+$2 WHERE user_id=$1 RETURNING points",[String(id),value]);
        await client.query("COMMIT");
        await ctx.reply(`• مبروك تم بيع : ${item}\n• العدد : ${qty}\n• بقيمة : ${value} نقطة بعد خصم 50% 💸\n• نقاطك صارت : (${p.rows[0].points} 💸)\n• اكتب ( ممتلكاتي ) لمعرفة مملكاتك`);
      } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    }
    return true;
  }
  if (text.startsWith("اهداء ")) {
    const [,qtyRaw,item]=text.match(/^اهداء (\d+) (.+)$/)||[];
    const qty=Number(qtyRaw), recipient=msg.reply_to_message?.from;
    if (!recipient || recipient.id===id || !ITEMS[item] || !Number.isSafeInteger(qty) || qty<=0) return true;
    const client=await db().connect();
    try {
      await client.query("BEGIN");
      const lockIds=[id,recipient.id].sort((a,b)=>a-b);
      for (const uid of lockIds) await client.query("SELECT pg_advisory_xact_lock($1)",[uid]);
      await ensureUser(client,id); await ensureUser(client,recipient.id);
      const r=await client.query("UPDATE possessions SET quantity=quantity-$3 WHERE user_id=$1 AND item_key=$2 AND quantity >= $3 RETURNING quantity",[String(id),item,qty]);
      if (!r.rowCount) {
        const owned=Number((await client.query("SELECT quantity FROM possessions WHERE user_id=$1 AND item_key=$2",[String(id),item])).rows[0]?.quantity||0);
        await client.query("ROLLBACK"); await ctx.reply(owned? `• عندك ${owned} من (${item}) فقط .` : `• انت اصلًا ماعندك ${item} تاكد من ممتلكاتك .`); return true;
      }
      if (Number(r.rows[0].quantity)===0) await client.query("DELETE FROM possessions WHERE user_id=$1 AND item_key=$2 AND quantity=0",[String(id),item]);
      await client.query("INSERT INTO possessions(user_id,item_key,quantity) VALUES($1,$2,$3) ON CONFLICT(user_id,item_key) DO UPDATE SET quantity=possessions.quantity+EXCLUDED.quantity",[String(recipient.id),item,qty]);
      await client.query("COMMIT");
      await ctx.reply(`• عملية اهداء :\n• الاهداء من : ${mention(ctx.from)}\n• نوع الهدية : (${item})\n• العدد : ${qty}\nالمستلم : ${mention(recipient)}`,{parse_mode:"HTML"});
      try { await ctx.api.sendMessage(recipient.id,`• وصلتك هدية :\n\n• الاهداء من : ${mention(ctx.from)}\n• نوع الهدية : (${item})\n• العدد : ${qty}\n-`,{parse_mode:"HTML"}); } catch {}
    } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    return true;
  }
  return false;
}
