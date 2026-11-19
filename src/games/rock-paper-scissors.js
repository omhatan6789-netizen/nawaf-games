import { randomUUID } from "node:crypto";
import { getPoints, transferPointsAtomic } from "../points.js";

const DEFAULT_POINTS = 30;
const CHALLENGE_TIMEOUT = 120;
const ROUND_TIMEOUT = 60;
const CONTINUE_TIMEOUT = 60;
const MOVES = { rock: "✊🏻", paper: "🖐🏻", scissors: "✌🏻" };
const MOVE_NAMES = { rock: "حجرة", paper: "ورقة", scissors: "مقص" };
const WINS_AGAINST = { rock: "scissors", paper: "rock", scissors: "paper" };
const activeGames = new Map();
const locks = new Map();

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);
const mention = user => `<a href="tg://user?id=${user.id}">${esc(user.first_name || user.username || "المستخدم")}</a>`;
const winsRequired = bestOf => Math.floor(bestOf / 2) + 1;
const gameLock = id => {
  if (!locks.has(id)) locks.set(id, Promise.resolve());
  return locks.get(id);
};
async function locked(id, fn) {
  const previous = gameLock(id);
  let release;
  const next = new Promise(resolve => { release = resolve; });
  locks.set(id, previous.then(() => next));
  await previous;
  try { return await fn(); } finally { release(); }
}
function keyboard(rows) { return { inline_keyboard: rows }; }
function roundsKeyboard(game) {
  return keyboard([
    [{ text: "BO1", callback_data: `rps:${game.id}:rounds:1` }, { text: "BO3", callback_data: `rps:${game.id}:rounds:3` }],
    [{ text: "BO5", callback_data: `rps:${game.id}:rounds:5` }, { text: "BO7", callback_data: `rps:${game.id}:rounds:7` }]
  ]);
}
const acceptKeyboard = game => keyboard([[{ text: "قبول التحدي 🔥", callback_data: `rps:${game.id}:accept` }]]);
const movesKeyboard = game => keyboard([[
  { text: "✊🏻", callback_data: `rps:${game.id}:move:rock` },
  { text: "🖐🏻", callback_data: `rps:${game.id}:move:paper` },
  { text: "✌🏻", callback_data: `rps:${game.id}:move:scissors` }
]]);
const continueKeyboard = game => keyboard([[{
  text: game.lastTie ? "إعادة الجولة 🔁" : "كمل الجولة 🔥",
  callback_data: `rps:${game.id}:next`
}]]);
function challengeText(g) {
  return `<b>• تم بدء لعبة حجرة ورقة مقص ✊🏻🖐🏻✌🏻</b>
<b>• عدد النقاط : ${g.points} 🎖️</b>
<b>• تم اختيار ↤ ${mention(g.target)}</b>
<b>• حدد الجولات الي تبيها بالزر الي تحت</b>`;
}
function acceptText(g) {
  return `<b>• تم بدء لعبة حجرة ورقة مقص ✊🏻🖐🏻✌🏻</b>
<b>• عدد النقاط : ${g.points} 🎖️</b>
<b>• عدد الجولات : BO${g.bestOf}</b>
<b>• تم اختيار ↤ ${mention(g.target)}</b>
<b>• عشان تلعب معه اضغط الزر</b>`;
}
function roundText(g) {
  return `<b>الجولة ${g.round} 🎮</b>

<b>• ركززز ورووووق واختر الي تبي تحطه.</b>

<b>• ${mention(g.challenger)} : ${g.wins[g.challenger.id]}</b>
<b>• ${mention(g.target)} : ${g.wins[g.target.id]}</b>`;
}
function resultText(g, winnerId) {
  const a = g.choices[g.challenger.id], b = g.choices[g.target.id];
  if (!winnerId) return `<b>تعادل!! 😂😂</b>

<b>${mention(g.challenger)} حط ${MOVES[a]}</b>
<b>${mention(g.target)} حط ${MOVES[b]}</b>

<b>• محد فاز بالجولة، بنعيدها.</b>`;
  const winner = winnerId === g.challenger.id ? g.challenger : g.target;
  const loserMove = winnerId === g.challenger.id ? b : a;
  const winnerMove = winnerId === g.challenger.id ? a : b;
  return `<b>انتهت الجولة 🎉</b>

<b>• الفائز بالجولة 🏆 : ${mention(winner)} ${MOVES[winnerMove]}</b>
<b>• اختياره : ${MOVE_NAMES[winnerMove]}</b>
<b>• اختيار الخصم : ${MOVES[loserMove]}</b>

<b>• النتيجة : ${g.wins[g.challenger.id]} - ${g.wins[g.target.id]}</b>`;
}
function finalText(g, winnerId) {
  const winner = winnerId === g.challenger.id ? g.challenger : g.target;
  const loser = winnerId === g.challenger.id ? g.target : g.challenger;
  return `<b>انتهت اللعبة 🎉🥳</b>

<b>• الفائز 🏆 : ${mention(winner)}</b>
<b>• النقاط الي كسبها : ${g.points} 🎖️🎉</b>

<b>• الخاسر 😂 : ${mention(loser)}</b>
<b>• النقاط الي خسرها : ${g.points} 😂</b>`;
}
function scheduleTimeout(bot, g, seconds, reason) {
  const token = ++g.timeoutToken;
  setTimeout(async () => {
    if (g.finished || g.timeoutToken !== token) return;
    g.finished = true;
    activeGames.delete(g.id);
    try {
      await bot.api.editMessageText(g.chatId, g.messageId,
        `<b>انتهت مهلة لعبة حجرة ورقة مقص ⏰</b>

<b>• ${esc(reason)}</b>`,
        { parse_mode: "HTML" });
    } catch (error) { console.warn("RPS timeout update failed:", error?.description || error?.message); }
  }, seconds * 1000).unref?.();
}
async function edit(ctx, text, replyMarkup) {
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: replyMarkup });
}
async function finish(ctx, g, winnerId) {
  const loser = winnerId === g.challenger.id ? g.target : g.challenger;
  const transferred = await transferPointsAtomic(loser.id, winnerId, g.points);
  g.finished = true;
  activeGames.delete(g.id);
  if (!transferred) {
    await ctx.answerCallbackQuery();
    await edit(ctx, "<b>انتهت اللعبة، لكن رصيد الخاسر لم يعد يكفي لتحويل المبلغ المحدد.</b>");
    return;
  }
  await ctx.answerCallbackQuery();
  await edit(ctx, finalText(g, winnerId));
}
export async function handleRpsMessage(ctx) {
  const text = ctx.message?.text?.trim();
  const match = text?.match(/^(?:حجرة(?: ورقة مقص)?|ورقة|مقص)(?:\s+(\d+))?$/);
  if (!match || !ctx.from || !ctx.chat) return false;
  const message = ctx.message;
  if (!message.reply_to_message?.from) {
    await ctx.reply("<b>• لازم تستخدم اللعبة بالرد على رسالة اللاعب.</b>", { parse_mode: "HTML" });
    return true;
  }
  const target = message.reply_to_message.from;
  if (target.id === ctx.from.id) { await ctx.reply("<b>• ما تقدر تتحدى نفسك 😂</b>", { parse_mode: "HTML" }); return true; }
  if (target.is_bot) { await ctx.reply("<b>• ما تقدر تتحدى البوت 😂</b>", { parse_mode: "HTML" }); return true; }
  const points = match[1] ? Number(match[1]) : DEFAULT_POINTS;
  if (!Number.isSafeInteger(points) || points <= 0) { await ctx.reply("<b>• عدد النقاط لازم يكون أكبر من صفر.</b>", { parse_mode: "HTML" }); return true; }
  if (await getPoints(ctx.from.id) < points) { await ctx.reply("<b>• نقاطك ما تكفي لبدء التحدي.</b>", { parse_mode: "HTML" }); return true; }
  const g = {
    id: randomUUID().slice(0, 10), chatId: ctx.chat.id, messageId: null,
    challenger: ctx.from, target, points, bestOf: null, status: "choosing_rounds",
    finished: false, round: 1, wins: { [ctx.from.id]: 0, [target.id]: 0 },
    choices: {}, lastTie: false, timeoutToken: 0
  };
  activeGames.set(g.id, g);
  const sent = await ctx.reply(challengeText(g), { parse_mode: "HTML", reply_markup: roundsKeyboard(g) });
  g.messageId = sent.message_id;
  scheduleTimeout(ctx.api, g, 120, "لم يتم تحديد الجولات أو قبول التحدي في الوقت المحدد.");
  return true;
}
export async function handleRpsCallback(ctx) {
  const data = ctx.callbackQuery?.data || "";
  if (!data.startsWith("rps:")) return false;
  const [, id, action, arg] = data.split(":");
  const g = activeGames.get(id);
  if (!g || g.finished) { await ctx.answerCallbackQuery({ text: "• انتهت اللعبة" }); return true; }
  await locked(id, async () => {
    const uid = ctx.from.id;
    if (action === "rounds") {
      if (uid !== g.challenger.id) { await ctx.answerCallbackQuery({ text: "• هذا الزر لا يخصك" }); return; }
      const bestOf = Number(arg);
      if (g.status !== "choosing_rounds" || ![1,3,5,7].includes(bestOf)) { await ctx.answerCallbackQuery({ text: "• انتهت مهلة الاختيار" }); return; }
      g.bestOf = bestOf; g.status = "waiting_accept";
      scheduleTimeout(ctx.api, g, 120, "لم يقبل اللاعب التحدي في الوقت المحدد.");
      await ctx.answerCallbackQuery();
      await edit(ctx, acceptText(g), acceptKeyboard(g));
      return;
    }
    if (action === "accept") {
      if (uid !== g.target.id || ctx.from.is_bot) { await ctx.answerCallbackQuery({ text: "• هذا الزر لا يخصك" }); return; }
      if (g.status !== "waiting_accept") { await ctx.answerCallbackQuery({ text: "• انتهى التحدي أو تم قبوله" }); return; }
      const [a,b] = await Promise.all([getPoints(g.challenger.id), getPoints(g.target.id)]);
      if (a < g.points) {
        g.finished = true; activeGames.delete(g.id);
        await ctx.answerCallbackQuery({ text: "• نقاط صاحب التحدي ما عادت تكفي", show_alert: true });
        await edit(ctx, "<b>• انتهى التحدي لأن نقاط صاحب التحدي ما عادت تكفي.</b>");
        return;
      }
      if (b < g.points) { await ctx.answerCallbackQuery({ text: "• نقاطك ما تكفي لهذا التحدي", show_alert: true }); return; }
      g.status = "playing"; g.round = 1; g.choices = {};
      scheduleTimeout(ctx.api, g, 60, "لم يختر اللاعبان حركتيهما في الوقت المحدد.");
      await ctx.answerCallbackQuery();
      await edit(ctx, roundText(g), movesKeyboard(g));
      return;
    }
    if (action === "move") {
      if (![g.challenger.id, g.target.id].includes(uid)) { await ctx.answerCallbackQuery({ text: "• هذا الزر لا يخصك" }); return; }
      if (!Object.hasOwn(MOVES, arg)) { await ctx.answerCallbackQuery(); return; }
      if (g.status !== "playing") { await ctx.answerCallbackQuery({ text: "• انتظر الجولة التالية" }); return; }
      if (Object.hasOwn(g.choices, uid)) { await ctx.answerCallbackQuery({ text: "• اخترت حركتك بالفعل، انتظر خصمك" }); return; }
      g.choices[uid] = arg;
      await ctx.answerCallbackQuery({ text: "• تم تسجيل اختيارك بنجاح" });
      if (Object.keys(g.choices).length < 2) {
        try { await edit(ctx, roundText(g) + "\n\n<b>• تم اختيار حركة من أحد اللاعبين، ننتظر الثاني...</b>", movesKeyboard(g)); } catch {}
        return;
      }
      const a = g.choices[g.challenger.id], b = g.choices[g.target.id];
      const winnerId = a === b ? null : (WINS_AGAINST[a] === b ? g.challenger.id : g.target.id);
      g.lastTie = winnerId === null;
      if (winnerId !== null) g.wins[winnerId]++;
      if (g.wins[g.challenger.id] >= winsRequired(g.bestOf)) return finish(ctx, g, g.challenger.id);
      if (g.wins[g.target.id] >= winsRequired(g.bestOf)) return finish(ctx, g, g.target.id);
      g.status = "round_result";
      scheduleTimeout(ctx.api, g, 60, "لم يتم الانتقال للجولة التالية في الوقت المحدد.");
      await edit(ctx, resultText(g, winnerId), continueKeyboard(g));
      return;
    }
    if (action === "next") {
      if (![g.challenger.id, g.target.id].includes(uid)) { await ctx.answerCallbackQuery({ text: "• هذا الزر لا يخصك" }); return; }
      if (g.status !== "round_result") { await ctx.answerCallbackQuery({ text: "• انتظر انتهاء الجولة" }); return; }
      g.round++; g.choices = {}; g.status = "playing"; g.lastTie = false;
      scheduleTimeout(ctx.api, g, 60, "لم يختر اللاعبان حركتيهما في الوقت المحدد.");
      await ctx.answerCallbackQuery();
      await edit(ctx, roundText(g), movesKeyboard(g));
      return;
    }
    await ctx.answerCallbackQuery();
  });
  return true;
}
