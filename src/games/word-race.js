import sharp from "sharp";
import { InputFile } from "grammy";
import { getRankLevel } from "../ranks.js";
import { addPoints } from "../points.js";
import { lockBigGame, unlockBigGame } from "./big-game-lock.js";

export const activeWordRaces = new Map();
const privateHosts = new Map();
const teams = ["احمر", "ازرق", "اخضر", "اصفر"];
const info = { احمر: ["🔴", "الأحمر", "#ff415a"], ازرق: ["🔵", "الأزرق", "#00cdff"], اخضر: ["🟢", "الأخضر", "#37eb7d"], اصفر: ["🟡", "الأصفر", "#ffcd23"] };
const colors = ["#ff4173", "#00dcff", "#b155ff", "#ff9619", "#50ffaa", "#ffe13c", "#5091ff", "#ff5adc"];
const nameOf = u => (String([u?.first_name, u?.last_name].filter(Boolean).join(" ") || "لاعب").trim()).slice(0, 32);
const teamName = t => info[t][0] + " " + info[t][1];
const group = c => ["group", "supergroup"].includes(c?.type);
const isController = async (s, userId, chatId) => Number(userId) === s.hostId || await getRankLevel(userId, chatId) >= 6;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

async function sendBoard(ctx, s) {
  const x = n => Math.round(880 - (n - 1) * (700 / Math.max(1, s.stages - 1)));
  const at = Array.from({ length: s.stages }, () => []);
  if (s.mode === "teams") {
    const seen = new Map();
    for (const p of s.players.values()) if (p.team) seen.set(p.team, p.stage);
    for (const [t, n] of seen) at[Math.max(0, Math.min(s.stages - 1, n - 1))].push({ name: teamName(t), color: info[t][2] });
  } else for (const p of s.players.values()) at[Math.max(0, Math.min(s.stages - 1, p.stage - 1))].push({ name: p.name, color: p.color });
  const svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="560"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#081326"/><stop offset="1" stop-color="#172b4d"/></linearGradient><filter id="f"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="1000" height="560" rx="28" fill="url(#g)"/><text x="500" y="72" text-anchor="middle" fill="white" font-size="42" font-weight="bold">سباق الكلمات 🐎</text><path d="M90 390 H910" stroke="#3a638f" stroke-width="12" stroke-linecap="round"/>'];
  for (let n = 1; n <= s.stages; n++) {
    const px = x(n);
    svg.push('<rect x="' + (px - 62) + '" y="350" width="124" height="80" rx="16" fill="#101e36" stroke="#28beff" stroke-width="4"/><text x="' + px + '" y="401" text-anchor="middle" fill="white" font-size="34" font-weight="bold">' + n + '</text>');
    const rows = at[n - 1], total = rows.length * 34 + Math.max(0, rows.length - 1) * 6;
    rows.forEach((v, i) => { const py = 315 - total / 2 + i * 40; svg.push('<g filter="url(#f)"><rect x="' + (px - 75) + '" y="' + py + '" width="150" height="34" rx="9" fill="#0c1428" stroke="' + v.color + '" stroke-width="3"/></g><text x="' + px + '" y="' + (py + 23) + '" text-anchor="middle" fill="white" font-size="16" font-weight="bold">' + esc(v.name) + '</text>'); });
  }
  svg.push('<text x="500" y="505" text-anchor="middle" fill="#a9c9e8" font-size="22">خط النهاية 🏁</text></svg>');
  const image = await sharp(Buffer.from(svg.join(""))).jpeg({ quality: 88 }).toBuffer();
  await ctx.api.sendPhoto(s.chatId, new InputFile(image, "word_race.jpg"));
}
async function distribution(ctx, s) {
  const lines = ["📋 قائمة الفرق — سباق الكلمات", ""];
  for (const t of teams.slice(0, s.teamCount)) {
    const players = [...s.players.values()].filter(p => p.team === t);
    lines.push(teamName(t) + ":");
    if (players.length) players.forEach((p, i) => lines.push("  " + (i + 1) + ". " + p.name)); else lines.push("  لا يوجد");
    lines.push("");
  }
  const text = lines.join("\n").trim();
  if (s.distributionId) try { await ctx.api.editMessageText(s.chatId, s.distributionId, text); return; } catch { s.distributionId = null; }
  const m = await ctx.api.sendMessage(s.chatId, text); s.distributionId = m.message_id;
  try { await ctx.api.pinChatMessage(s.chatId, m.message_id, { disable_notification: true }); } catch {}
}
function stopTimer(s) { if (s.timer) clearTimeout(s.timer); s.timer = null; }
async function finishAction(ctx, s) {
  stopTimer(s); s.actionPending = false; s.answerLocked = true; s.waitingContinue = true; s.actionMessageId = null;
  await ctx.api.sendMessage(s.chatId, "الادمن يكتب .كمل للجولة التالية.");
}
async function winner(ctx, s, id = null, team = null) {
  if (s.finished) return;
  stopTimer(s);
  if (s.distributionId) try { await ctx.api.unpinChatMessage(s.chatId, s.distributionId); } catch {}
  s.finished = true; s.started = false; s.waitingContinue = false; s.privateWordWaiting = false;
  const winners = team ? [...s.players.values()].filter(p => p.team === team) : [s.players.get(id)].filter(Boolean);
  if (!winners.length) return;
  await ctx.api.sendMessage(s.chatId, "<b>🏆🎉 الفائز بالسباق! 🎉🏆\n\nألف مبروك لـ " + (team ? teamName(team) : winners[0].name) + " الفوز بسباق الكلمات! 🥇</b>", { parse_mode: "HTML" });
  await sendBoard(ctx, s);
  const rewards = [], paid = new Set();
  for (const p of winners) if (!paid.has(p.userId)) { await addPoints({ id: p.userId, first_name: p.name, is_bot: false }, 70); rewards.push("• " + p.name + " — حصل على +70 نقطة 🏅"); paid.add(p.userId); }
  if (!paid.has(s.hostId)) { await addPoints({ id: s.hostId, first_name: s.hostName, is_bot: false }, 70); rewards.push("• " + s.hostName + " — حصل على +70 نقطة 🏅"); }
  await ctx.api.sendMessage(s.chatId, "<b>" + ["✨ جوائز النقاط للفائزين ✨", ...rewards].join("\n") + "</b>", { parse_mode: "HTML" });
  privateHosts.delete(s.hostId); activeWordRaces.delete(s.chatId); unlockBigGame(s.chatId, "word_race");
}
async function advance(ctx, s, id, query = null) {
  if (s.finished || !s.actionPending || s.pendingAnswererId !== id) return;
  stopTimer(s);
  const body = "<b>🎉 إجابة صحيحة! من " + s.pendingAnswererName + "\n\nالكلمة الصحيحة هي: " + s.displayWord + "\n\n✅ تم اختيار: تقديم</b>";
  if (s.mode === "teams") {
    const t = s.players.get(id)?.team; if (!t) return;
    const old = [...s.players.values()].find(p => p.team === t)?.stage ?? 1;
    if (old >= s.stages) { if (query) await query.editMessageText(body, { parse_mode: "HTML" }).catch(() => {}); await winner(ctx, s, null, t); return; }
    for (const p of s.players.values()) if (p.team === t) p.stage = old + 1;
    if (query) await query.editMessageText(body, { parse_mode: "HTML" }).catch(() => {});
    await ctx.api.sendMessage(s.chatId, "<b>🚀 يتقدم " + teamName(t) + " إلى المرحلة " + (old + 1) + "!</b>", { parse_mode: "HTML" });
    await sendBoard(ctx, s);
    if (old + 1 === s.stages) await ctx.api.sendMessage(s.chatId, "<b>🚨 انتبه! " + teamName(t) + " وصل إلى المرحلة " + s.stages + " والأخيرة! الإجابة الصحيحة القادمة له تعني الفوز بالسباق! 🏁</b>", { parse_mode: "HTML" });
    await finishAction(ctx, s); return;
  }
  const p = s.players.get(id); if (!p) return;
  if (p.stage >= s.stages) { if (query) await query.editMessageText(body, { parse_mode: "HTML" }).catch(() => {}); await winner(ctx, s, id); return; }
  p.stage++;
  if (query) await query.editMessageText(body, { parse_mode: "HTML" }).catch(() => {});
  await ctx.api.sendMessage(s.chatId, "<b>🚀 يتقدم " + p.name + " إلى المرحلة " + p.stage + "!</b>", { parse_mode: "HTML" });
  await sendBoard(ctx, s);
  if (p.stage === s.stages) await ctx.api.sendMessage(s.chatId, "<b>🚨 انتبه! " + p.name + " وصل إلى المرحلة " + p.stage + " والأخيرة! الإجابة الصحيحة القادمة له تعني الفوز بالسباق! 🏁</b>", { parse_mode: "HTML" });
  await finishAction(ctx, s);
}
function timer(ctx, s, id) {
  stopTimer(s); s.timer = setTimeout(() => { if (!s.finished && s.actionPending && s.pendingAnswererId === id) advance(ctx, s, id).catch(e => console.error("Word race timeout:", e)); }, 30000);
}
async function requestWord(ctx, s) {
  s.privateWordWaiting = true; s.acceptedWords.clear(); s.displayWord = ""; s.answerLocked = false; s.actionPending = false; s.pendingAnswererId = null; s.pendingAnswererName = "";
  privateHosts.set(s.hostId, s.chatId);
  try { await ctx.api.sendMessage(s.hostId, "✏️ سباق الكلمات - الجولة " + s.round + "\n\nأرسل الكلمة أو الكلمات المطلوبة بهذه الصيغة:\nالكلمة\nأو للكلمات البديلة المقبولة:\nكلمة1 - كلمة2 - كلمة3"); }
  catch { await ctx.api.sendMessage(s.chatId, "⚠️ لم أستطع إرسال الكلمة للأدمن في الخاص. يجب أن يفتح الادمن محادثة البوت أولًا."); }
}
async function handlePrivate(ctx) {
  const id = privateHosts.get(ctx.from.id), s = activeWordRaces.get(id);
  if (!s || !s.started || !s.privateWordWaiting || s.hostId !== ctx.from.id) return false;
  const words = ctx.message.text.trim().split("-").map(v => v.trim()).filter(Boolean); if (!words.length) return false;
  s.acceptedWords = new Set(words); s.displayWord = words[0]; s.privateWordWaiting = false;
  await ctx.reply("✅ تم حفظ الكلمة: " + words[0] + (words.length > 1 ? "\nالكلمات المقبولة: " + words.slice(1).join(" + ") : ""));
  await ctx.api.sendMessage(s.chatId, '📢 يا حكم <a href="tg://user?id=' + s.hostId + '">' + esc(s.hostName) + "</a>، لمح للكلمة المطلوبة في الجولة (" + s.round + ")!", { parse_mode: "HTML" });
  return true;
}
async function handleAnswer(ctx, s) {
  if (!s.started || s.finished || s.privateWordWaiting || s.waitingContinue || s.answerLocked || s.actionPending || !s.acceptedWords.size) return false;
  if (!s.players.has(ctx.from.id) || ctx.from.id === s.hostId || !s.acceptedWords.has(ctx.message.text.trim())) return false;
  s.answerLocked = true; s.actionPending = true; s.pendingAnswererId = ctx.from.id; s.pendingAnswererName = nameOf(ctx.from);
  const buttons = [{ text: "تقديم", callback_data: "wr:advance:" + ctx.from.id }];
  if (s.mode === "solo") buttons.push({ text: "ترجيع", callback_data: "wr:backmenu:" + ctx.from.id });
  else for (const t of teams) if (t !== s.players.get(ctx.from.id).team && [...s.players.values()].some(p => p.team === t)) buttons.push({ text: "ترجيع " + teamName(t), callback_data: "wr:backteam:" + ctx.from.id + ":" + t });
  const m = await ctx.reply("<b>🎉 إجابة صحيحة! من " + s.pendingAnswererName + "\nالكلمة الصحيحة هي: " + s.displayWord + "\n\nاختر تقديم فريقك! او ترجيع فريق الخصم.</b>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [buttons] } });
  s.actionMessageId = m.message_id; timer(ctx, s, ctx.from.id); return true;
}
export async function handleWordRaceMessage(ctx) {
  if (!ctx.message?.text || !ctx.from || !ctx.chat) return false;
  if (ctx.chat.type === "private") return handlePrivate(ctx);
  if (!group(ctx.chat)) return false;
  const text = ctx.message.text.trim().replace(/\s+/g, " ");
  let s = activeWordRaces.get(ctx.chat.id);
  if (text === "سباق الكلمات") {
    if (await getRankLevel(ctx.from.id, ctx.chat.id) < 2) return true;
    if (s) { await ctx.reply("⚠️ يوجد سباق كلمات قائم بالفعل في هذه المجموعة."); return true; }
    if (!lockBigGame(ctx.chat.id, "word_race", "سباق الكلمات")) { await ctx.reply("⚠️ توجد لعبة أخرى قائمة بالفعل في هذه المجموعة."); return true; }
    s = { chatId: ctx.chat.id, hostId: ctx.from.id, hostName: nameOf(ctx.from), players: new Map(), mode: null, teamCount: 0, stages: 5, started: false, finished: false, round: 0, acceptedWords: new Set(), displayWord: "", answerLocked: false, actionPending: false, pendingAnswererId: null, pendingAnswererName: "", privateWordWaiting: false, waitingContinue: false, timer: null, actionMessageId: null, distributionId: null };
    activeWordRaces.set(ctx.chat.id, s);
    await ctx.reply("<b>تم بدأ لعبة (سباق الكلمات 🐎)</b>\n\nاكتب دخول", { parse_mode: "HTML" }); return true;
  }
  if (!s) return false;
  if (text === ".الطور" && !s.started) {
    if (!await isController(s, ctx.from.id, ctx.chat.id)) { await ctx.reply("❌ هذا الأمر خاص بأدمن اللعبة."); return true; }
    if (s.players.size < 2) { await ctx.reply("❌ لازم يكون فيه لاعبين اثنين على الأقل."); return true; }
    await ctx.reply("اختر الطور الذي تريده", { reply_markup: { inline_keyboard: [[{ text: "فردي", callback_data: "wr:mode:solo" }, { text: "فرق", callback_data: "wr:mode:teams" }]] } }); return true;
  }
  if (text === "دخول" && !s.started) {
    if (s.players.has(ctx.from.id)) return true;
    s.players.set(ctx.from.id, { userId: ctx.from.id, name: nameOf(ctx.from), stage: 1, team: null, color: colors[Math.floor(Math.random() * colors.length)] });
    await ctx.reply("✅ انضم " + nameOf(ctx.from) + " إلى لعبة سباق الكلمات🐎!\n👥 العدد: " + s.players.size); return true;
  }
  if (text === ".خروج" && !s.started) {
    const p = s.players.get(ctx.from.id); if (p) { s.players.delete(ctx.from.id); await ctx.reply("🚪 خرج " + p.name + " من لعبة سباق الكلمات🐎!\n👥 العدد: " + s.players.size); } return true;
  }
  if ([".الطور", ".ابدا", ".كمل", ".توزيع", ".انهاء", ".اضافة"].includes(text) || /^\.اضافة\s+(احمر|ازرق|اخضر|اصفر)$/.test(text)) return false;
  return handleAnswer(ctx, s);
}
async function stageButtons(ctx, s) {
  const labels = ["أربع مراحل 4", "خمس مراحل 5", "ست مراحل 6", "سبع مراحل 7", "ثمان مراحل 8", "تسع مراحل 9"];
  const buttons = labels.map((text, i) => ({ text, callback_data: "wr:stages:" + (i + 4) }));
  await ctx.api.sendMessage(s.chatId, "اختر عدد المراحل التي تريدها.", { reply_markup: { inline_keyboard: [buttons.slice(0, 3), buttons.slice(3)] } });
}
async function backMenu(ctx, s, id) {
  const buttons = [...s.players.values()].filter(p => p.userId !== id).map(p => ({ text: p.name, callback_data: "wr:backplayer:" + id + ":" + p.userId }));
  if (!buttons.length) { await ctx.answerCallbackQuery({ text: "لا يوجد خصم.", show_alert: true }); return; }
  const rows = []; for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: rows } });
}
export async function handleWordRaceCallback(ctx) {
  const data = ctx.callbackQuery?.data || ""; if (!data.startsWith("wr:")) return false;
  await ctx.answerCallbackQuery();
  const s = ctx.callbackQuery.message ? activeWordRaces.get(ctx.callbackQuery.message.chat.id) : null; if (!s || s.finished) return true;
  const uid = ctx.from.id;
  if (data.startsWith("wr:mode:")) {
    if (!await isController(s, uid, s.chatId) || s.started) return true;
    s.mode = data.split(":")[2]; await ctx.deleteMessage().catch(() => {});
    if (s.mode === "teams") await ctx.api.sendMessage(s.chatId, "اختر عدد الأفرقة!", { reply_markup: { inline_keyboard: [[{ text: "فريقين 2", callback_data: "wr:teams:2" }, { text: "ثلاث أفرقة 3", callback_data: "wr:teams:3" }, { text: "أربع أفرقة 4", callback_data: "wr:teams:4" }]] } });
    else await stageButtons(ctx, s); return true;
  }
  if (data.startsWith("wr:teams:")) {
    if (s.hostId !== uid || s.started) return true;
    const count = Number(data.split(":")[2]); if (count < 2 || count > 4) return true;
    s.teamCount = count; const chosen = teams.slice(0, count), players = [...s.players.values()].sort(() => Math.random() - .5);
    players.forEach((p, i) => { p.team = chosen[i % chosen.length]; });
    await ctx.deleteMessage().catch(() => {}); await distribution(ctx, s); await stageButtons(ctx, s); return true;
  }
  if (data.startsWith("wr:stages:")) {
    if (!await isController(s, uid, s.chatId)) return true;
    const n = Number(data.split(":")[2]); if (n < 4 || n > 9) return true;
    s.stages = n; await ctx.deleteMessage().catch(() => {});
    const body = s.mode === "teams" ? "تم اعتماد التعديلات! 👍🏻\n\nطور اللعبة: فِرَق\nعدد الفرق: " + s.teamCount + "\nعدد المراحل: " + n + "\nالادمن يكتب .ابدا  لبدا اللعبة!" : "تم اعتماد التعديلات! 👍🏻\n\nطور اللعبة: فردي\nعدد المراحل: " + n + "\nالادمن يكتب .ابدا  لبدا اللعبة!";
    await ctx.api.sendMessage(s.chatId, "<b>" + body + "</b>", { parse_mode: "HTML" }); return true;
  }
  const parts = data.split(":"), action = parts[1], answerer = Number(parts[2]);
  if (s.pendingAnswererId !== answerer) { await ctx.answerCallbackQuery({ text: "انتظر ليس دورك!", show_alert: true }); return true; }
  if (action === "backmenu" && s.mode === "solo") { await backMenu(ctx, s, answerer); return true; }
  if (action === "advance" && uid === answerer) { await advance(ctx, s, answerer, ctx); return true; }
  if (action === "backplayer" && uid === answerer) {
    const p = s.players.get(Number(parts[3])); if (!p || p.userId === answerer) return true;
    stopTimer(s); const changed = p.stage > 1; p.stage = Math.max(1, p.stage - 1);
    await ctx.editMessageText("<b>🎉 إجابة صحيحة! من " + s.pendingAnswererName + "\n\nالكلمة الصحيحة هي: " + s.displayWord + "\n\n✅ تم اختيار: ترجيع</b>", { parse_mode: "HTML" });
    await ctx.api.sendMessage(s.chatId, changed ? "<b>🔙 تم ترجيع " + p.name + " خطوة للخلف!</b>" : "<b>🔙 " + p.name + " بالفعل في المرحلة الأولى.</b>", { parse_mode: "HTML" });
    await sendBoard(ctx, s); await finishAction(ctx, s); return true;
  }
  if (action === "backteam" && uid === answerer) {
    const t = parts[3]; if (s.mode !== "teams" || !teams.slice(0, s.teamCount).includes(t) || s.players.get(answerer)?.team === t) return true;
    stopTimer(s); const members = [...s.players.values()].filter(p => p.team === t), old = members[0]?.stage ?? 1;
    for (const p of members) p.stage = Math.max(1, old - 1);
    await ctx.editMessageText("<b>🎉 إجابة صحيحة! من " + s.pendingAnswererName + "\n\nالكلمة الصحيحة هي: " + s.displayWord + "\n\n✅ تم اختيار: ترجيع " + teamName(t) + "</b>", { parse_mode: "HTML" });
    await ctx.api.sendMessage(s.chatId, old > 1 ? "<b>🔙 تم ترجيع " + teamName(t) + " خطوة للخلف!</b>" : "<b>🔙 " + teamName(t) + " بالفعل في المرحلة الأولى.</b>", { parse_mode: "HTML" });
    await sendBoard(ctx, s); await finishAction(ctx, s); return true;
  }
  return true;
}
export async function handleWordRaceRouter(ctx, text) {
  const s = activeWordRaces.get(ctx.chat.id); if (!s) return false;
  if (text === "دخول") {
    if (s.started || s.players.has(ctx.from.id)) return true;
    const name = nameOf(ctx.from); s.players.set(ctx.from.id, { userId: ctx.from.id, name, stage: 1, team: null, color: colors[Math.floor(Math.random() * colors.length)] });
    await ctx.reply("✅ انضم " + name + " إلى لعبة سباق الكلمات🐎!\n👥 العدد: " + s.players.size); return true;
  }
  if (text === ".خروج") {
    if (s.started) return true; const p = s.players.get(ctx.from.id);
    if (p) { s.players.delete(ctx.from.id); await ctx.reply("🚪 خرج " + p.name + " من لعبة سباق الكلمات🐎!\n👥 العدد: " + s.players.size); } return true;
  }
  if (text === ".ابدا") {
    if (!await isController(s, ctx.from.id, ctx.chat.id)) { await ctx.reply("❌ هذا الأمر خاص بأدمن اللعبة."); return true; }
    if (s.players.size < 2) { await ctx.reply("❌ لازم يكون فيه لاعبين اثنين على الأقل."); return true; }
    if (!s.mode) { await ctx.reply("❌ اختر الطور أولًا باستخدام .الطور."); return true; }
    if (s.mode === "teams") {
      const chosen = teams.slice(0, s.teamCount);
      if (!chosen.length || ![...s.players.values()].some(p => chosen.includes(p.team))) { await ctx.reply("❌ وزّع اللاعبين أولًا باستخدام .توزيع أو .اضافة."); return true; }
      const counts = Object.fromEntries(chosen.map(t => [t, 0]));
      for (const p of s.players.values()) if (chosen.includes(p.team)) counts[p.team]++;
      for (const p of s.players.values()) if (!chosen.includes(p.team)) { const t = [...chosen].sort((a, b) => counts[a] - counts[b])[0]; p.team = t; counts[t]++; }
    }
    for (const p of s.players.values()) p.stage = 1;
    s.started = true; s.round = 1;
    await ctx.api.sendMessage(s.chatId, "<b>🏁 استعدوا للسباق! 🏁</b>", { parse_mode: "HTML" });
    for (const n of [3, 2, 1]) { await new Promise(r => setTimeout(r, 1000)); await ctx.api.sendMessage(s.chatId, "<b>" + n + " 🔢….</b>", { parse_mode: "HTML" }); }
    await new Promise(r => setTimeout(r, 500)); await ctx.api.sendMessage(s.chatId, "<b>🚀 انطلقنا!</b>", { parse_mode: "HTML" });
    await sendBoard(ctx, s); await requestWord(ctx, s); return true;
  }
  if (text === ".كمل") {
    if (ctx.from.id !== s.hostId) { await ctx.reply("❌ هذا الأمر خاص بأدمن اللعبة."); return true; }
    if (!s.waitingContinue) return true; s.waitingContinue = false; s.round++; await requestWord(ctx, s); return true;
  }
  if (text === ".توزيع") {
    if (!await isController(s, ctx.from.id, ctx.chat.id)) { await ctx.reply("❌ هذا الأمر خاص بأدمن اللعبة."); return true; }
    if (s.started) return true;
    if (s.mode !== "teams") { await ctx.reply("❌ التوزيع متاح في طور الفرق فقط."); return true; }
    const chosen = teams.slice(0, s.teamCount), players = [...s.players.values()].sort(() => Math.random() - .5);
    players.forEach((p, i) => { p.team = chosen[i % chosen.length]; }); await distribution(ctx, s); return true;
  }
  if (text === ".اضافة" || /^\.اضافة\s+(احمر|ازرق|اخضر|اصفر)$/.test(text)) {
    if (!await isController(s, ctx.from.id, ctx.chat.id)) { await ctx.reply("❌ هذا الأمر خاص بأدمن اللعبة."); return true; }
    const target = ctx.message.reply_to_message?.from; if (!target) { await ctx.reply("❌ لازم ترد على رسالة اللاعب."); return true; }
    const team = text.match(/^\.اضافة\s+(احمر|ازرق|اخضر|اصفر)$/)?.[1], old = s.players.get(target.id), name = nameOf(target);
    if (team) {
      if (s.mode !== "teams" || !teams.slice(0, s.teamCount).includes(team)) return true;
      s.players.set(target.id, { userId: target.id, name, stage: old?.stage ?? 1, team, color: old?.color ?? colors[0] });
      await ctx.reply(old ? (old.team === team ? "✅ " + name + " موجود أصلًا في " + teamName(team) : "✅ تم نقل " + name + " إلى الفريق " + teamName(team)) : "✅ تمت إضافة " + name + " إلى الفريق " + teamName(team));
      await distribution(ctx, s); if (s.started) await sendBoard(ctx, s); return true;
    }
    if (s.mode !== "solo" || old) return true;
    s.players.set(target.id, { userId: target.id, name, stage: 1, team: null, color: colors[Math.floor(Math.random() * colors.length)] });
    await ctx.reply("✅ تمت إضافة " + name + " إلى سباق الكلمات!"); if (s.started) await sendBoard(ctx, s); return true;
  }
  if (text === ".انهاء") {
    if (await getRankLevel(ctx.from.id, ctx.chat.id) < 2) return true;
    stopTimer(s); if (s.distributionId) try { await ctx.api.unpinChatMessage(s.chatId, s.distributionId); } catch {}
    activeWordRaces.delete(s.chatId); privateHosts.delete(s.hostId); unlockBigGame(s.chatId, "word_race");
    await ctx.reply("🛑 تم إنهاء لعبة سباق الكلمات."); return true;
  }
  return false;
}
