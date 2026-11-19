import { pool } from "./db.js";
import { getRankLevel } from "./ranks.js";

const sessions = new Map();
const OWNER_ID = 8453977662;

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}
function inGroup(ctx) {
  return ["group","supergroup"].includes(ctx.chat?.type);
}
function normalize(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g,"")
    .replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/\s+/g," ");
}
async function canManage(ctx) {
  if (Number(ctx.from?.id) === OWNER_ID) return true;
  return inGroup(ctx) && await getRankLevel(ctx.from.id,ctx.chat.id) >= 2;
}
async function findGame(name) {
  const result=await db().query("SELECT name,status FROM games ORDER BY name");
  const key=normalize(name);
  return result.rows.find(row=>normalize(row.name)===key)||null;
}
async function addGame(ctx,name) {
  const clean=String(name||"").trim();
  if(!clean||clean.length>40) { await ctx.reply("اسم اللعبة غير صحيح. الحد الأقصى 40 حرفًا."); return; }
  const result=await db().query(
    "INSERT INTO games(name,status) VALUES($1,'on') ON CONFLICT(name) DO NOTHING RETURNING name",
    [clean]
  );
  if(!result.rowCount) { await ctx.reply("هذه اللعبة موجودة بالفعل."); return; }
  await ctx.reply(`تمت إضافة لعبة ${clean} بنجاح.\nاللعبة أُنشئت فارغة، ويمكنك إضافة الأسئلة لها باستخدام: اضف ${clean}`);
}
async function beginQuestion(ctx,game) {
  sessions.set(ctx.from.id,{chatId:ctx.chat.id,action:"add_question",game:game.name,stage:"question",question:"",image:null,caption:"",answers:[]});
  await ctx.reply(game.name==="صور"||game.name==="شخصيات انمي"?"أرسل صورة السؤال الآن.\nاكتب الغاء للإلغاء.":"أرسل السؤال كنص أو صورة مع كابشن.\nاكتب الغاء للإلغاء.");
}
async function saveQuestion(ctx,session) {
  const answers=[...new Set(session.answers.map(x=>String(x).trim()).filter(Boolean))];
  if(!answers.length) { await ctx.reply("لم تضف أي إجابة. أرسل الإجابات أولًا."); return; }
  await db().query(
    "INSERT INTO game_questions(game_name,question,image,caption,answers) VALUES($1,$2,$3,$4,$5::jsonb)",
    [session.game,session.question,session.image,session.caption,JSON.stringify(answers)]
  );
  sessions.delete(ctx.from.id);
  await ctx.reply(`تمت إضافة السؤال إلى لعبة ${session.game} بنجاح.\nعدد الإجابات: ${answers.length}`);
}
async function receiveSession(ctx,session) {
  if(ctx.chat.id!==session.chatId) return false;
  const text=ctx.message.text?.trim()||"";
  if(normalize(text)==="الغاء") {
    sessions.delete(ctx.from.id);
    await ctx.reply("تم إلغاء العملية.");
    return true;
  }
  if(session.action==="add_game") {
    if(!text) { await ctx.reply("أرسل اسم اللعبة كنص."); return true; }
    sessions.delete(ctx.from.id);
    await addGame(ctx,text);
    return true;
  }
  if(session.action!=="add_question") return false;
  if(session.stage==="question") {
    const photo=ctx.message.photo?.at(-1);
    if(session.game==="صور"||session.game==="شخصيات انمي") {
      if(!photo) { await ctx.reply("هذه اللعبة مخصصة للصور فقط. أرسل صورة."); return true; }
      session.image=photo.file_id;
      session.question="";
      session.caption="";
    } else if(photo) {
      session.image=photo.file_id;
      session.question=ctx.message.caption||"";
      session.caption=ctx.message.caption||"";
    } else if(text) {
      session.question=text;
      session.caption=text;
    } else {
      await ctx.reply("أرسل نصًا أو صورة.");
      return true;
    }
    session.stage="answers";
    await ctx.reply("ممتاز! أرسل الإجابات الآن، كل إجابة في سطر مستقل. وبعد الانتهاء أرسل: تم");
    return true;
  }
  if(session.stage==="answers") {
    if(!text) { await ctx.reply("أرسل الإجابات كنص، كل إجابة في سطر."); return true; }
    if(normalize(text)==="تم") {
      await saveQuestion(ctx,session);
      return true;
    }
    const added=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    session.answers.push(...added);
    await ctx.reply(`تم استلام ${added.length} إجابة. أرسل إجابات إضافية أو اكتب تم للحفظ.`);
    return true;
  }
  return false;
}
async function setGlobalGames(ctx,status) {
  await db().query(
    "INSERT INTO games_settings(id,status) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status",
    [status]
  );
  await ctx.reply(status==="on"?"تم تفعيل الألعاب العامة ✅":"تم تعطيل الألعاب العامة ⛔");
}
async function setOneGame(ctx,name,status) {
  const game=await findGame(name);
  if(!game) { await ctx.reply("اللعبة غير موجودة. أرسل الالعاب لمعرفة الألعاب."); return; }
  await db().query("UPDATE games SET status=$2 WHERE name=$1",[game.name,status]);
  await ctx.reply(status==="on"?`تم تفعيل لعبة ${game.name} ✅`:`تم تعطيل لعبة ${game.name} ⛔`);
}
async function deleteGame(ctx,name) {
  const game=await findGame(name);
  if(!game) { await ctx.reply("اللعبة غير موجودة."); return; }
  const client=await db().connect();
  let removed=0;
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM game_question_messages WHERE question_id IN (SELECT id FROM game_questions WHERE game_name=$1)",[game.name]);
    const questions=await client.query("DELETE FROM game_questions WHERE game_name=$1",[game.name]);
    removed=questions.rowCount;
    await client.query("DELETE FROM games WHERE name=$1",[game.name]);
    await client.query("COMMIT");
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally { client.release(); }
  await ctx.reply(`تم حذف لعبة ${game.name} وجميع أسئلتها.\nعدد الأسئلة المحذوفة: ${removed}`);
}
async function listGames(ctx) {
  const [games,global]=await Promise.all([
    db().query(`SELECT g.name,g.status,COUNT(q.id)::int AS questions
      FROM games g LEFT JOIN game_questions q ON q.game_name=g.name
      GROUP BY g.name,g.status ORDER BY g.name`),
    db().query("SELECT status FROM games_settings WHERE id=1")
  ]);
  if(!games.rowCount) { await ctx.reply("ما فيه ألعاب حاليًا."); return; }
  const globalOn=global.rows[0]?.status!=="off";
  const lines=[`الألعاب المتوفرة (الحالة العامة: ${globalOn?"مفعّلة":"معطّلة"}):`,""];
  for(const row of games.rows) lines.push(`• ${row.name} — ${row.questions} سؤال — ${row.status==="on"?"مفعّلة":"معطّلة"}`);
  await ctx.reply(lines.join("\n"));
}

export async function handleGamesManagerMessage(ctx) {
  if(!ctx.message||!ctx.from||!inGroup(ctx)) return false;
  const text=ctx.message.text?.trim()||"";
  const normalized=normalize(text);
  const active=sessions.get(ctx.from.id);
  if(active && active.chatId===ctx.chat.id) {
    if(!await canManage(ctx)) { sessions.delete(ctx.from.id); await ctx.reply("هذا الأمر للمشرفين فقط."); return true; }
    return receiveSession(ctx,active);
  }
  if(!text) return false;

  if(normalized==="الالعاب"||normalized==="العاب") { await listGames(ctx); return true; }

  const globalToggle=normalized==="تفعيل الالعاب"?"on":normalized==="تعطيل الالعاب"?"off":null;
  if(globalToggle) {
    if(!await canManage(ctx)) { await ctx.reply("هذا الأمر للمشرفين فقط."); return true; }
    await setGlobalGames(ctx,globalToggle); return true;
  }
  const addDirect=text.match(/^اضف لعبة\s+(.+)$/i);
  if(addDirect) {
    if(!await canManage(ctx)) { await ctx.reply("هذا الأمر للمشرفين فقط."); return true; }
    await addGame(ctx,addDirect[1]); return true;
  }
  if(normalized==="اضف لعبة") {
    if(!await canManage(ctx)) { await ctx.reply("هذا الأمر للمشرفين فقط."); return true; }
    sessions.set(ctx.from.id,{chatId:ctx.chat.id,action:"add_game"});
    await ctx.reply("أرسل اسم اللعبة الجديدة.\nاكتب الغاء لإيقاف العملية."); return true;
  }
  const deleteMatch=text.match(/^حذف لعبة\s+(.+)$/i);
  if(deleteMatch) {
    if(!await canManage(ctx)) { await ctx.reply("هذا الأمر للمشرفين فقط."); return true; }
    await deleteGame(ctx,deleteMatch[1]); return true;
  }
  const enable=text.match(/^(تفعيل|تعطيل) لعبة\s+(.+)$/);
  if(enable) {
    if(!await canManage(ctx)) { await ctx.reply("هذا الأمر للمشرفين فقط."); return true; }
    await setOneGame(ctx,enable[2],enable[1]==="تفعيل"?"on":"off"); return true;
  }
  if(normalized.startsWith("اضف ")) {
    const name=text.slice(4).trim();
    if(normalize(name)==="لعبة"||!name) return false;
    const game=await findGame(name);
    if(!game) return false;
    if(!await canManage(ctx)) { await ctx.reply("هذا الأمر للمشرفين فقط."); return true; }
    await beginQuestion(ctx,game); return true;
  }
  return false;
}
