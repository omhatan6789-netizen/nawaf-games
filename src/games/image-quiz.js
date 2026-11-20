import sharp from "sharp";
import { InputFile } from "grammy";
import { getRankLevel } from "../ranks.js";
import { addPoints } from "../points.js";
import { pool } from "../db.js";
import { lockBigGame, unlockBigGame } from "./big-game-lock.js";

export const activeImageQuizzes = new Map();
const addingImageUsers = new Map();
const deletingImageUsers = new Map();
const MIN_PLAYERS = 2;
const MIN_TARGET_POINTS = 5;
const MAX_TARGET_POINTS = 15;
const rewards = [60, 45, 30, 15];
const revealTimes = [20000, 20000, 20000, 5000];
const stageRatios = [0.30, 0.52, 0.72, 1];

const normalize = value => String(value || "").trim().toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و")
  .replace(/ئ/g, "ي").replace(/ة/g, "ه").replace(/ـ/g, "")
  .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const playerName = user => user?.first_name || (user?.username ? "@" + user.username : String(user?.id || "لاعب"));
const isGroup = chat => ["group", "supergroup"].includes(chat?.type);
const isAdmin = async (userId, chatId) => Number(await getRankLevel(userId, chatId)) >= 2;
const mention = user => "[" + (user?.first_name || "مستخدم") + "](tg://user?id=" + user.id + ")";
const active = chatId => activeImageQuizzes.get(Number(chatId)) || null;

async function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}
async function loadManualImages() {
  const p = await db();
  const r = await p.query("SELECT id,file_id,answer,alternative_answers FROM image_quiz_images ORDER BY id");
  return r.rows.map(row => ({
    id: "manual_" + row.id, file_id: row.file_id, answer: row.answer,
    alternative_answers: Array.isArray(row.alternative_answers) ? row.alternative_answers : []
  })).filter(x => x.file_id && x.answer);
}
async function addManualImage(fileId, answer) {
  const p = await db();
  const r = await p.query(
    "INSERT INTO image_quiz_images(file_id,answer,alternative_answers) VALUES($1,$2,'[]'::jsonb) ON CONFLICT(file_id) DO NOTHING RETURNING id",
    [String(fileId), String(answer).trim()]
  );
  return r.rowCount > 0;
}
async function deleteManualImage(fileId) {
  const p = await db();
  const r = await p.query("DELETE FROM image_quiz_images WHERE file_id=$1 RETURNING id", [String(fileId)]);
  return r.rowCount > 0;
}
async function imageCount() {
  const p = await db();
  const r = await p.query("SELECT COUNT(*)::int AS count FROM image_quiz_images");
  return Number(r.rows[0]?.count || 0);
}
async function chooseQuestion(state) {
  const all = await loadManualImages();
  if (!all.length) return null;
  let available = all.filter(q => !state.usedQuestionIds.has(q.id));
  if (!available.length) { state.usedQuestionIds.clear(); available = all; }
  const q = available[Math.floor(Math.random() * available.length)];
  state.usedQuestionIds.add(q.id);
  return q;
}
async function croppedPhoto(ctx, question, stage) {
  try {
    const file = await ctx.api.getFile(question.file_id);
    const response = await fetch("https://api.telegram.org/file/bot" + process.env.BOT_TOKEN + "/" + file.file_path);
    if (!response.ok) throw new Error("Telegram photo download failed");
    const buffer = Buffer.from(await response.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    const ratio = stageRatios[stage] || 1;
    const width = Math.max(1, Math.floor(meta.width * ratio));
    const height = Math.max(1, Math.floor(meta.height * ratio));
    const left = Math.max(0, Math.floor((meta.width - width) / 2));
    const top = Math.max(0, Math.floor((meta.height - height) / 2));
    return await sharp(buffer).extract({ left, top, width, height })
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 92 }).toBuffer();
  } catch (error) {
    console.error("[IMAGE QUIZ] Photo processing failed:", error?.message || error);
    return null;
  }
}
function stageText(stage) {
  return ["🔎 الصورة مخفية بشكل كبير", "👀 بدأت الصورة تتضح", "👁️ الصورة أصبحت أوضح", "🖼️ الصورة كاملة"][stage] || "🖼️ الصورة كاملة";
}
function caption(state) {
  const timing = ["⏱️ الوقت: 0 - 20 ثانية", "⏱️ الوقت: 20 - 40 ثانية", "⏱️ الوقت: 40 - 60 ثانية", "⏱️ آخر 5 ثواني"][state.revealStage];
  return "🖼️ *الجولة " + state.currentRound + "*\n\n" + stageText(state.revealStage) + "\n" + timing + "\n\n🎯 كل إجابة صحيحة = +1 نقطة";
}
async function updateBoard(ctx, state) {
  const players = [...state.players.values()].sort((a,b) => b.gamePoints - a.gamePoints || b.originalPoints - a.originalPoints);
  const lines = ["🖼️ *توقع الصورة*", ""];
  if (state.targetPoints) lines.push("🎯 الهدف: *" + state.targetPoints + " نقاط*", "");
  if (!players.length) lines.push("👥 لا يوجد لاعبين.");
  else players.forEach((p,i) => lines.push((i+1) + ". " + p.name + " — *" + p.gamePoints + "* نقطة"));
  lines.push("");
  if (!state.started) lines.push("⏳ بانتظار بدء القيم…");
  else if (state.waitingContinue) lines.push("⏸️ الجولة انتهت.\nالأدمن يكتب .كمل للجولة التالية.");
  else if (state.finalGuessPhase) lines.push("⏰ الصورة كاملة!\nلديكم 5 ثوانٍ للإجابة.");
  else lines.push("🎮 الجولة جارية…");
  if (state.boardMessageId) try { await ctx.api.editMessageText(state.chatId, state.boardMessageId, lines.join("\n"), { parse_mode: "Markdown" }); } catch {}
}
async function sendOrEditImage(ctx, state) {
  if (!state.currentQuestion) return;
  const data = await croppedPhoto(ctx, state.currentQuestion, state.revealStage);
  if (!data) { await ctx.api.sendMessage(state.chatId, "❌ تعذر تحميل صورة الجولة."); return; }
  const photo = new InputFile(data, "image-quiz.jpg");
  if (state.imageMessageId) {
    try {
      await ctx.api.editMessageMedia(state.chatId, state.imageMessageId, {
        type: "photo", media: photo, caption: caption(state), parse_mode: "Markdown"
      });
      return;
    } catch {}
  }
  const msg = await ctx.api.sendPhoto(state.chatId, photo, { caption: caption(state), parse_mode: "Markdown" });
  state.imageMessageId = msg.message_id;
}
function stopTimer(state) { if (state.timer) clearTimeout(state.timer); state.timer = null; }
async function finishRoundWithoutAnswer(ctx, state) {
  state.answerLocked = true; state.finalGuessPhase = false; state.waitingContinue = true;
  const answer = state.currentQuestion?.answer || "غير معروف";
  await ctx.api.sendMessage(state.chatId,
    "⏱️ *انتهت الجولة " + state.currentRound + "!*\n\n❌ لم يجب أحد بشكل صحيح.\n\n✅ الإجابة: *" + answer + "*\n\n⏸️ الأدمن يكتب .كمل للجولة التالية.",
    { parse_mode: "Markdown" });
  await updateBoard(ctx, state);
}
function scheduleStage(ctx, state, stage) {
  stopTimer(state);
  state.timer = setTimeout(async () => {
    if (state.finished || state.answerLocked) return;
    if (stage < 3) {
      state.revealStage = stage + 1;
      state.finalGuessPhase = stage + 1 === 3;
      await sendOrEditImage(ctx, state);
      await updateBoard(ctx, state);
      if (state.finalGuessPhase) {
        await ctx.api.sendMessage(state.chatId,
          "⏰ *انتهت الـ60 ثانية!*\n\n🖼️ الصورة كاملة الآن.\n⚡ أمامكم *5 ثوانٍ* للإجابة.\n🎯 الإجابة الصحيحة الآن = +1 نقطة\n💰 وتحصل على +15 نقطة أصلية.",
          { parse_mode: "Markdown" });
      }
      scheduleStage(ctx, state, stage + 1);
    } else await finishRoundWithoutAnswer(ctx, state);
  }, revealTimes[stage]);
}
async function startRound(ctx, state) {
  if (state.finished) return;
  if (state.players.size < MIN_PLAYERS) {
    state.waitingContinue = true;
    await ctx.api.sendMessage(state.chatId, "❌ لا يمكن بدء الجولة.\nيجب أن يكون عدد اللاعبين 2 على الأقل.");
    return;
  }
  const question = await chooseQuestion(state);
  if (!question) {
    state.waitingContinue = true;
    await ctx.api.sendMessage(state.chatId, "❌ ما فيه صور مضافة للعبة توقع الصورة.\n\nأضف صورك يدويًا باستخدام الأمر اضف صور توقع.", { parse_mode: "Markdown" });
    return;
  }
  state.currentQuestion = question; state.currentRound++;
  state.answerLocked = false; state.waitingContinue = false; state.revealStage = 0; state.finalGuessPhase = false;
  state.roundStartedAt = Date.now();
  await updateBoard(ctx, state);
  await sendOrEditImage(ctx, state);
  await ctx.api.sendMessage(state.chatId,
    "🎮 *الجولة " + state.currentRound + " بدأت!*\n\n🖼️ حاول معرفة الصورة.\n⚡ كل إجابة صحيحة = +1 نقطة في القيم.\n\n💰 نقاط البوت الأصلية:\n• 0 - 20 ثانية: +60\n• 20 - 40 ثانية: +45\n• 40 - 60 ثانية: +30\n• آخر 5 ثواني: +15",
    { parse_mode: "Markdown" });
  scheduleStage(ctx, state, 0);
}
function questionAnswers(q) {
  return [...new Set([q.answer, ...(Array.isArray(q.alternative_answers) ? q.alternative_answers : [])]
    .flatMap(v => typeof v === "string" ? v.split(/\r?\n/) : [])
    .map(normalize).filter(Boolean))];
}
async function givePoints(userId, points) {
  if (points <= 0) return;
  try { await addPoints({ id: userId, is_bot: false }, points); }
  catch (error) { console.error("[IMAGE QUIZ] Point award failed:", error?.message || error); }
}
async function finishQuiz(ctx, state, winnerId = null, manual = false) {
  if (state.finished) return;
  state.finished = true; state.answerLocked = true; state.finalGuessPhase = false; state.waitingContinue = false;
  stopTimer(state);
  const players = [...state.players.values()].sort((a,b) => b.gamePoints - a.gamePoints || b.originalPoints - a.originalPoints);
  for (const player of players) if (player.originalPoints > 0) await givePoints(player.userId, player.originalPoints);
  const lines = ["🏁 *انتهت لعبة توقع الصورة!*", ""];
  if (manual) lines.push("🛑 تم إنهاء القيم بواسطة الأدمن.", "");
  if (winnerId) {
    const winner = state.players.get(winnerId);
    if (winner) lines.push("🏆 *الفائز*", "👑 " + winner.name, "🎯 نقاط القيم: *" + winner.gamePoints + "*", "");
  }
  if (players.length) {
    lines.push("📊 *النتائج النهائية:*", "");
    players.forEach((p,i) => lines.push((i+1) + ". " + p.name + "\n   🎯 نقاط القيم: " + p.gamePoints + "\n   💰 النقاط الأصلية: " + p.originalPoints, ""));
  }
  await ctx.api.sendMessage(state.chatId, lines.join("\n"), { parse_mode: "Markdown" });
  activeImageQuizzes.delete(state.chatId);
  unlockBigGame(state.chatId, "image_quiz");
}
async function openQuiz(ctx) {
  if (!isGroup(ctx.chat)) { await ctx.reply("❌ هذا الأمر يعمل داخل القروبات فقط."); return true; }
  if (!await isAdmin(ctx.from.id, ctx.chat.id)) { await ctx.reply("❌ لازم تكون أدمن لإنشاء لعبة توقع الصورة."); return true; }
  if (activeImageQuizzes.has(ctx.chat.id) || !lockBigGame(ctx.chat.id, "image_quiz", "توقع الصورة")) {
    await ctx.reply("⚠️ توجد لعبة أخرى قائمة بالفعل في هذا القروب."); return true;
  }
  const state = { chatId: ctx.chat.id, hostId: ctx.from.id, hostName: playerName(ctx.from), players: new Map(),
    eliminatedPlayers: new Set(), targetPoints: null, started: false, finished: false, currentRound: 0,
    currentQuestion: null, boardMessageId: null, imageMessageId: null, waitingContinue: false, answerLocked: false,
    roundStartedAt: null, revealStage: 0, finalGuessPhase: false, timer: null, usedQuestionIds: new Set() };
  activeImageQuizzes.set(ctx.chat.id, state);
  try {
    const m = await ctx.reply("🖼️ *توقع الصورة*\n\n👑 المنظم: *" + state.hostName + "*\n\n👥 يجب دخول لاعبين على الأقل.\n🎯 حددوا نقاط الفوز من زر الإعدادات.\n\nاكتب دخول للانضمام.", {
      parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🎯 اختيار النقاط", callback_data: "iq:settings" }]] }
    });
    state.boardMessageId = m.message_id;
  } catch (error) { activeImageQuizzes.delete(ctx.chat.id); unlockBigGame(ctx.chat.id, "image_quiz"); throw error; }
  return true;
}
async function joinQuiz(ctx) {
  const state = active(ctx.chat?.id);
  if (!state) return false;
  if (state.started) { await ctx.reply("❌ القيم بدأ بالفعل.\nإذا تبي تضيف شخص استخدم .اضافة."); return true; }
  if (state.players.has(ctx.from.id)) { await ctx.reply("⚠️ أنت داخل القيم بالفعل."); return true; }
  state.players.set(ctx.from.id, { userId: ctx.from.id, name: playerName(ctx.from), gamePoints: 0, originalPoints: 0 });
  await ctx.reply("✅ تم دخول *" + playerName(ctx.from) + "* للقيم.", { parse_mode: "Markdown" });
  await updateBoard(ctx, state); return true;
}
async function leaveQuiz(ctx) {
  const state = active(ctx.chat?.id);
  if (!state) return false;
  const player = state.players.get(ctx.from.id);
  if (!player) { await ctx.reply("❌ أنت لست داخل القيم."); return true; }
  state.players.delete(ctx.from.id); state.eliminatedPlayers.add(ctx.from.id);
  await ctx.reply("🚪 خرج *" + player.name + "* من القيم.", { parse_mode: "Markdown" });
  await updateBoard(ctx, state);
  if (state.started && !state.waitingContinue && state.players.size < MIN_PLAYERS)
    await ctx.api.sendMessage(state.chatId, "⚠️ عدد اللاعبين أصبح أقل من 2.\nيمكن للقيم الاستمرار، لكن يجب إضافة لاعب بـ.اضافة قبل بدء الجولة التالية.");
  return true;
}
async function addPlayer(ctx) {
  const state = active(ctx.chat?.id);
  if (!state) return false;
  if (!await isAdmin(ctx.from.id, ctx.chat.id)) { await ctx.reply("❌ هذا الأمر للأدمن فقط."); return true; }
  const target = ctx.message.reply_to_message?.from;
  if (!target) { await ctx.reply("❌ رد على رسالة الشخص الذي تريد إضافته واكتب .اضافة"); return true; }
  if (target.is_bot) { await ctx.reply("❌ لا يمكنك إضافة بوت."); return true; }
  if (state.players.has(target.id)) { await ctx.reply("⚠️ الشخص داخل القيم بالفعل."); return true; }
  state.eliminatedPlayers.delete(target.id);
  state.players.set(target.id, { userId: target.id, name: playerName(target), gamePoints: 0, originalPoints: 0 });
  await ctx.reply("✅ تمت إضافة *" + playerName(target) + "* إلى القيم.", { parse_mode: "Markdown" });
  await updateBoard(ctx, state); return true;
}
async function setSettings(ctx) {
  const state = active(ctx.chat?.id);
  if (!state) return false;
  if (!await isAdmin(ctx.from.id, ctx.chat.id)) { await ctx.reply("❌ هذا الأمر للأدمن فقط."); return true; }
  if (state.started) { await ctx.reply("❌ لا يمكن تغيير الإعدادات بعد بدء القيم."); return true; }
  const rows = [[5,6,7,8],[9,10,11,12],[13,14,15]].map(row => row.map(n => ({ text: n + " 🎯", callback_data: "iq:points:" + n })));
  await ctx.reply("⚙️ *إعدادات توقع الصورة*\n\n🎯 اختر عدد النقاط المطلوبة للفوز:", { parse_mode: "Markdown", reply_markup: { inline_keyboard: rows } });
  return true;
}
async function beginQuiz(ctx) {
  const state = active(ctx.chat?.id);
  if (!state) return false;
  if (!await isAdmin(ctx.from.id, ctx.chat.id)) { await ctx.reply("❌ هذا الأمر للأدمن فقط."); return true; }
  if (state.started) { await ctx.reply("⚠️ القيم بدأ بالفعل."); return true; }
  if (state.targetPoints === null) { await ctx.reply("❌ حدد نقاط الفوز أولًا باستخدام .اعدادات."); return true; }
  if (state.players.size < MIN_PLAYERS) { await ctx.reply("❌ يجب دخول لاعبين على الأقل."); return true; }
  state.started = true; state.finished = false;
  await ctx.reply("🚀 *تم بدء القيم!*\n\n🎯 الهدف: *" + state.targetPoints + " نقاط*\n👥 اللاعبين: *" + state.players.size + "*", { parse_mode: "Markdown" });
  await startRound(ctx, state); return true;
}
async function continueQuiz(ctx) {
  const state = active(ctx.chat?.id);
  if (!state) return false;
  if (!await isAdmin(ctx.from.id, ctx.chat.id)) { await ctx.reply("❌ هذا الأمر للأدمن فقط."); return true; }
  if (!state.started) { await ctx.reply("❌ القيم لم يبدأ بعد."); return true; }
  if (state.finished) return true;
  if (!state.waitingContinue) { await ctx.reply("⚠️ الجولة الحالية لم تنتهِ بعد."); return true; }
  if (state.players.size < MIN_PLAYERS) { await ctx.reply("❌ لا يمكن بدء الجولة التالية.\nيجب أن يكون هناك لاعبين على الأقل.\n\nيمكن للأدمن إضافة لاعب باستخدام .اضافة."); return true; }
  await startRound(ctx, state); return true;
}
async function endQuiz(ctx) {
  const state = active(ctx.chat?.id);
  if (!state) { await ctx.reply("❌ لا توجد لعبة توقع الصورة شغالة حاليًا."); return true; }
  if (!await isAdmin(ctx.from.id, ctx.chat.id)) { await ctx.reply("❌ هذا الأمر للأدمن فقط."); return true; }
  await finishQuiz(ctx, state, null, true); return true;
}
async function addImageCommand(ctx) {
  if (!isGroup(ctx.chat)) return false;
  if (!await isAdmin(ctx.from.id, ctx.chat.id)) { await ctx.reply("❌ هذا الأمر للأدمن فقط."); return true; }
  addingImageUsers.set(ctx.chat.id, ctx.from.id); deletingImageUsers.delete(ctx.chat.id);
  const count = await imageCount();
  await ctx.reply("🖼️ *إضافة صورة لتوقع الصورة*\n\nأرسل الآن الصورة التي تريد إضافتها.\n✏️ واكتب *إجابة الصورة في الكابشن*.\n\nمثال:\nترسل صورة أسد وتكتب في الكابشن:\nأسد\n\nالاسد\n📸 الصور المضافة حاليًا: *" + count + "*\n\nيمكنك إلغاء العملية بكتابة:\nالغاء اضافة صورة", { parse_mode: "Markdown" });
  return true;
}
async function deleteImageCommand(ctx) {
  if (!isGroup(ctx.chat)) return false;
  if (!await isAdmin(ctx.from.id, ctx.chat.id)) { await ctx.reply("❌ هذا الأمر للأدمن فقط."); return true; }
  const count = await imageCount();
  if (count <= 0) { await ctx.reply("❌ لا توجد صور مضافة يدويًا."); return true; }
  deletingImageUsers.set(ctx.chat.id, ctx.from.id); addingImageUsers.delete(ctx.chat.id);
  await ctx.reply("🗑️ *حذف صورة من توقع الصورة*\n\nأرسل الآن الصورة التي تريد حذفها.\n\n⚠️ يجب إرسال نفس الصورة التي سبق إضافتها.\n\nلإلغاء العملية اكتب:\nالغاء حذف صورة", { parse_mode: "Markdown" });
  return true;
}
async function handlePhoto(ctx) {
  if (!isGroup(ctx.chat) || !ctx.message?.photo?.length) return false;
  const userId = ctx.from.id, chatId = ctx.chat.id;
  if (addingImageUsers.get(chatId) === userId) {
    if (!await isAdmin(userId, chatId)) { addingImageUsers.delete(chatId); return true; }
    const answer = String(ctx.message.caption || "").trim();
    if (!answer) { await ctx.reply("❌ لازم تكتب إجابة الصورة في الكابشن.\n\nأرسل الصورة مرة ثانية، واكتب الإجابة في الكابشن."); return true; }
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const ok = await addManualImage(fileId, answer);
    addingImageUsers.delete(chatId);
    if (!ok) { await ctx.reply("⚠️ هذه الصورة موجودة مسبقًا أو تعذر حفظها."); return true; }
    await ctx.reply("✅ *تمت إضافة الصورة بنجاح!*\n\n📝 الإجابة: *" + answer + "*\n📸 إجمالي الصور المضافة يدويًا: *" + await imageCount() + "*\n\n🎲 ستدخل الصورة الآن مع باقي صور توقع الصورة بشكل عشوائي.", { parse_mode: "Markdown" });
    return true;
  }
  if (deletingImageUsers.get(chatId) === userId) {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const ok = await deleteManualImage(fileId);
    deletingImageUsers.delete(chatId);
    if (!ok) { await ctx.reply("❌ لم أجد هذه الصورة ضمن الصور المضافة يدويًا."); return true; }
    await ctx.reply("✅ *تم حذف الصورة بنجاح!*\n\n📸 الصور المضافة يدويًا المتبقية: *" + await imageCount() + "*", { parse_mode: "Markdown" });
    return true;
  }
  return false;
}
async function checkAnswer(ctx, state) {
  const text = String(ctx.message.text || "").trim();
  const ignored = new Set(["دخول","خروج",".خروج",".اضافة",".اعدادات",".ابدا",".كمل",".انهاء","توقع الصورة","اضف صور توقع","حذف صور توقع"]);
  if (!state.started || state.finished || state.answerLocked || !state.currentQuestion || ignored.has(text)) return false;
  const player = state.players.get(ctx.from.id);
  if (!player || !questionAnswers(state.currentQuestion).includes(normalize(text))) return false;
  state.answerLocked = true; state.finalGuessPhase = false; stopTimer(state);
  const elapsed = Math.max(0, (Date.now() - state.roundStartedAt) / 1000);
  const reward = elapsed < 20 ? 60 : elapsed < 40 ? 45 : elapsed < 60 ? 30 : 15;
  player.gamePoints++; player.originalPoints += reward;
  const answer = state.currentQuestion.answer || text;
  if (player.gamePoints >= state.targetPoints) {
    await ctx.api.sendMessage(state.chatId,
      "🎉 *إجابة صحيحة!*\n\n👤 اللاعب: *" + player.name + "*\n✅ الإجابة: *" + answer + "*\n\n🎯 +1 نقطة في القيم\n💰 +" + reward + " نقطة أصلية\n\n🏆 وصل إلى الهدف *" + state.targetPoints + " نقاط*!",
      { parse_mode: "Markdown" });
    await finishQuiz(ctx, state, ctx.from.id); return true;
  }
  await ctx.api.sendMessage(state.chatId,
    "🎯 *إجابة صحيحة!*\n\n👤 " + player.name + "\n✅ " + answer + "\n\n🏅 +1 نقطة في القيم\n💰 +" + reward + " نقطة أصلية\n\n📊 نقاطه الآن: *" + player.gamePoints + "*",
    { parse_mode: "Markdown" });
  state.waitingContinue = true;
  await updateBoard(ctx, state);
  await ctx.api.sendMessage(state.chatId, "⏸️ انتهت الجولة.\nالأدمن يكتب .كمل للجولة التالية.");
  return true;
}
export async function handleImageQuizMessage(ctx) {
  if (!ctx.message?.text || !ctx.chat || !ctx.from) return false;
  const text = ctx.message.text.trim().replace(/\s+/g, " ");
  if (text === "توقع الصورة") return openQuiz(ctx);
  if (text === "اضف صور توقع" || text === "اضف صورة") return addImageCommand(ctx);
  if (text === "حذف صور توقع" || text === "حذف صورة") return deleteImageCommand(ctx);
  if (text === "الغاء اضافة صورة") {
    if (addingImageUsers.get(ctx.chat.id) === ctx.from.id) { addingImageUsers.delete(ctx.chat.id); await ctx.reply("✅ تم إلغاء إضافة الصورة."); return true; }
    return false;
  }
  if (text === "الغاء حذف صورة") {
    if (deletingImageUsers.get(ctx.chat.id) === ctx.from.id) { deletingImageUsers.delete(ctx.chat.id); await ctx.reply("✅ تم إلغاء حذف الصورة."); return true; }
    return false;
  }
  if (text === ".اعدادات") return setSettings(ctx);
  const state = active(ctx.chat.id);
  if (state && isGroup(ctx.chat)) return checkAnswer(ctx, state);
  return false;
}
export async function handleImageQuizPhoto(ctx) { return handlePhoto(ctx); }
export async function handleImageQuizRouter(ctx, text) {
  if (text === "دخول") return joinQuiz(ctx);
  if (text === ".خروج") return leaveQuiz(ctx);
  if (text === ".ابدا") return beginQuiz(ctx);
  if (text === ".كمل") return continueQuiz(ctx);
  if (text === ".انهاء") return endQuiz(ctx);
  if (text === ".اضافة") return addPlayer(ctx);
  return false;
}
export async function handleImageQuizCallback(ctx) {
  const data = ctx.callbackQuery?.data || "";
  if (!data.startsWith("iq:")) return false;
  const chatId = ctx.callbackQuery.message?.chat?.id;
  const state = chatId ? active(chatId) : null;
  if (!state) { await ctx.answerCallbackQuery({ text: "❌ لا توجد لعبة نشطة.", show_alert: true }); return true; }
  if (!await isAdmin(ctx.from.id, chatId)) { await ctx.answerCallbackQuery({ text: "❌ هذا الزر للأدمن فقط.", show_alert: true }); return true; }
  if (data === "iq:settings") {
    if (state.started) { await ctx.answerCallbackQuery({ text: "❌ لا يمكن تغيير الإعدادات بعد بدء القيم.", show_alert: true }); return true; }
    await ctx.answerCallbackQuery();
    const rows = [[5,6,7,8],[9,10,11,12],[13,14,15]].map(row => row.map(n => ({ text: n + " 🎯", callback_data: "iq:points:" + n })));
    await ctx.editMessageText("⚙️ *إعدادات توقع الصورة*\n\n🎯 اختر عدد النقاط المطلوبة للفوز:", { parse_mode: "Markdown", reply_markup: { inline_keyboard: rows } }).catch(() => {});
    return true;
  }
  if (data.startsWith("iq:points:")) {
    if (state.started) { await ctx.answerCallbackQuery({ text: "❌ القيم بدأ بالفعل.", show_alert: true }); return true; }
    const points = Number(data.split(":").pop());
    if (!Number.isInteger(points) || points < MIN_TARGET_POINTS || points > MAX_TARGET_POINTS) { await ctx.answerCallbackQuery({ text: "❌ عدد النقاط غير مسموح.", show_alert: true }); return true; }
    state.targetPoints = points;
    await ctx.answerCallbackQuery({ text: "تم تحديد الهدف: " + points + " نقاط." });
    await ctx.editMessageText("🖼️ *توقع الصورة*\n\n🎯 هدف الفوز: *" + points + " نقاط*\n\n👥 اللاعبين الحاليين: *" + state.players.size + "*\n\nاكتب دخول للانضمام.\nوبعد اكتمال اللاعبين يكتب الأدمن .ابدا.", {
      parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "⚙️ تعديل النقاط", callback_data: "iq:settings" }]] }
    }).catch(() => {});
    await updateBoard(ctx, state); return true;
  }
  await ctx.answerCallbackQuery(); return true;
}
