import { getRankLevel } from "../ranks.js";
import { pool } from "../db.js";
import { getBigGame, lockBigGame, unlockBigGame } from "./big-game-lock.js";

export const activeHideGames = new Map();
const HIDE_TIME = 60_000;
const SEARCH_TIME = 30_000;
const MIN_PLAYERS = 2;
const WIN_POINTS = 30;

function playerName(user) {
  if (!user) return "مستخدم";
  return user.username ? `@${user.username}` : (user.first_name || "مستخدم");
}
function boardSize(count) {
  if (count <= 2) return 16;
  if (count <= 5) return 20;
  return 24;
}
function createContents(size) {
  let items;
  if (size <= 16) items = ["bomb","bomb","bomb","extra","extra","plus5","plus5","plus10","minus3","minus3","minus5","minus5"];
  else if (size <= 20) items = ["bomb","bomb","bomb","bomb","extra","extra","extra","plus5","plus5","plus5","plus10","plus10","minus3","minus3","minus3","minus5","minus5","minus5"];
  else items = ["bomb","bomb","bomb","bomb","bomb","extra","extra","extra","plus5","plus5","plus5","plus10","plus10","minus3","minus3","minus3","minus5","minus5","minus5"];
  while (items.length < size) items.push("empty");
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return Object.fromEntries(items.map((item, i) => [i + 1, item]));
}
function keyboard(numbers, prefix) {
  const rows = [];
  for (let i = 0; i < numbers.length; i += 4) {
    rows.push(numbers.slice(i, i + 4).map(n => ({ text: String(n), callback_data: `${prefix}:${n}` })));
  }
  return { inline_keyboard: rows };
}
function cancelTask(game, key) {
  const task = game?.[key];
  if (task) clearTimeout(task);
  if (game) game[key] = null;
}
async function adjustPoints(userId, amount) {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  await pool.query(
    `INSERT INTO points(user_id, points) VALUES($1, GREATEST(0,$2))
     ON CONFLICT(user_id) DO UPDATE SET points=GREATEST(0,points.points+$2)`,
    [String(userId), amount]
  );
}
async function canManage(userId, chatId) {
  return (await getRankLevel(userId, chatId)) > 0;
}
function alivePlayers(game) {
  return game.order.filter(id => game.players.has(id));
}
function playersInBox(game, number) {
  return [...game.hidden.entries()].filter(([id, n]) => n === number && game.players.has(id)).map(([id]) => id);
}
function isFinished(game) {
  const alive = alivePlayers(game);
  if (alive.length <= 1) return true;
  return new Set(alive.map(id => game.hidden.get(id))).size === 1;
}
async function sendHideChoice(ctx, chatId, playerId) {
  const game = activeHideGames.get(chatId);
  const player = game?.players.get(playerId);
  if (!game || !player) return;
  try {
    const sent = await ctx.api.sendMessage(playerId,
      "😶‍🌫️ اختر الرقم الذي تريد الاختباء فيه.\n\n⏱ لديك 60 ثانية.\nيمكن لأكثر من لاعب الاختباء في نفس الرقم.",
      { reply_markup: keyboard(Array.from({length: game.boardSize}, (_, i) => i + 1), `hide:${chatId}:${playerId}`) });
    game.hideMessages.set(playerId, sent.message_id);
  } catch {
    try {
      await ctx.api.sendMessage(chatId,
        `⚠️ لم أستطع إرسال رسالة خاصة إلى ${playerName(player)}.\nيجب عليه فتح محادثة البوت والضغط على Start.`);
    } catch {}
  }
}
async function startSearchTurn(ctx, chatId) {
  const game = activeHideGames.get(chatId);
  if (!game || game.phase !== "searching" || game.resolving) return;
  if (isFinished(game) || !game.available.length) return finishHideGame(ctx, chatId);
  const order = game.order;
  for (let checked = 0; checked < order.length; checked++) {
    const index = game.currentIndex % order.length;
    const playerId = order[index];
    game.currentIndex++;
    if (!game.players.has(playerId)) continue;
    const player = game.players.get(playerId);
    game.searching = true;
    game.searchPlayer = playerId;
    game.resolving = false;
    const sent = await ctx.api.sendMessage(chatId,
      `🫣 تفضل يا ${playerName(player)} اختر مربع لكشف ما بداخله.\n\n⏱ أمامك 30 ثانية.`,
      { reply_markup: keyboard(game.available, `search:${chatId}:${playerId}`) });
    game.searchMessageId = sent.message_id;
    game.searchTask = setTimeout(() => searchTimeout(ctx, chatId, playerId), SEARCH_TIME);
    return;
  }
  await finishHideGame(ctx, chatId);
}
async function finishHiding(ctx, chatId) {
  const game = activeHideGames.get(chatId);
  if (!game || game.phase !== "hiding") return;
  game.phase = "searching";
  cancelTask(game, "hideTask");
  await ctx.api.sendMessage(chatId,
    "😶‍🌫️ لقد اختبأ جميع اللاعبين بنجاح.\n\nتبدأ الآن أدوار البحث!\n\nفي كل دور يختار اللاعب مربعًا واحدًا للبحث فيه.\n\n💥 إذا وجد لاعبًا مختبئًا يتم استبعاده.\n🎁 بعض المربعات تحتوي على هدايا.");
  await startSearchTurn(ctx, chatId);
}
async function finishHideGame(ctx, chatId) {
  const game = activeHideGames.get(chatId);
  if (!game || game.phase === "finished") return;
  game.phase = "finished";
  cancelTask(game, "hideTask");
  cancelTask(game, "searchTask");
  const winners = alivePlayers(game);
  if (winners.length) {
    for (const id of winners) {
      await adjustPoints(id, WIN_POINTS);
      game.scores.set(id, (game.scores.get(id) || 0) + WIN_POINTS);
    }
  }
  let mostDiscoveries = null;
  for (const [id, count] of game.discoveries) {
    if (count > 0 && (mostDiscoveries === null || count > game.discoveries.get(mostDiscoveries))) mostDiscoveries = id;
  }
  if (mostDiscoveries !== null) await adjustPoints(mostDiscoveries, 5);
  let mostBombs = null;
  for (const [id, count] of game.bombHits) {
    if (count > 0 && (mostBombs === null || count > game.bombHits.get(mostBombs))) mostBombs = id;
  }
  if (mostBombs !== null) await adjustPoints(mostBombs, -5);
  let message = "🏆 انتهت لعبة الغميضة!\n\n";
  if (winners.length === 1) {
    const winner = game.players.get(winners[0]);
    if (winner) message += `🥇 ${playerName(winner)} — الفائز\n🎁 حصل على +30 نقطة.\n`;
  } else if (winners.length > 1) {
    message += "🥇 الفائزون:\n" + winners.map(id => `• ${playerName(game.players.get(id))} 🎁 +30`).join("\n") + "\n";
  }
  if (mostDiscoveries !== null) {
    const user = game.players.get(mostDiscoveries);
    if (user) message += `\n🔎 أكثر لاعب اكتشف مخابئ: ${playerName(user)} (${game.discoveries.get(mostDiscoveries)} اكتشاف)\n🎁 حصل على +5 نقاط.`;
  }
  if (mostBombs !== null) {
    const user = game.players.get(mostBombs);
    if (user) message += `\n\n💣 أكثر لاعب أصابته القنابل: ${playerName(user)} (${game.bombHits.get(mostBombs)} قنابل)\n💥 تم خصم 5 نقاط منه.`;
  }
  const scored = [...game.scores.entries()].filter(([, points]) => points !== 0).sort((a,b) => b[1]-a[1]);
  if (scored.length) {
    message += "\n\n📊 نقاط الجولة:\n";
    for (const [id, points] of scored) {
      const player = game.players.get(id);
      if (player) message += `• ${playerName(player)}: ${points > 0 ? "+" : ""}${points}\n`;
    }
  }
  await ctx.api.sendMessage(chatId, message);
  activeHideGames.delete(chatId);
  unlockBigGame(chatId, "hide");
}
async function resolveSearch(ctx, chatId, playerId, number, messageId) {
  const game = activeHideGames.get(chatId);
  if (!game || !game.available.includes(number)) { if (game) game.resolving = false; return; }
  const player = game.players.get(playerId);
  if (!player) { game.resolving = false; return; }
  game.available = game.available.filter(n => n !== number);
  const foundPlayers = playersInBox(game, number);
  const content = game.contents[number] || "empty";
  let resultText = `🎯 قام اللاعب ${playerName(player)} باختيار المربع (${number}).\n\n`;
  if (foundPlayers.length) {
    resultText += "💥 تم كشف المخبأ!\nتم العثور على اللاعبين:\n" +
      foundPlayers.map(id => `• ${playerName(game.players.get(id))} ❌`).join("\n") +
      "\n\nتم استبعادهم من اللعبة.";
    for (const id of foundPlayers) game.players.delete(id);
    game.discoveries.set(playerId, (game.discoveries.get(playerId) || 0) + foundPlayers.length);
  } else {
    resultText += "💨 المربع فارغ!\nلم يتم العثور على أحد.";
    if (content === "bomb") {
      game.bombHits.set(playerId, (game.bombHits.get(playerId) || 0) + 1);
      const alive = alivePlayers(game);
      if (alive.length) {
        const targetId = alive[Math.floor(Math.random() * alive.length)];
        const target = game.players.get(targetId);
        const secret = game.hidden.get(targetId);
        if (target && secret !== undefined) resultText += `\n\n💣 انفجرت قنبلة!\nتم كشف تلميح عن ${playerName(target)}:\n🔎 رقمه السري ${secret % 2 === 0 ? "زوجي" : "فردي"}.`;
      }
    } else if (content === "extra") {
      resultText += `\n\n🔄 حصل اللاعب ${playerName(player)} على فرصة إضافية!`;
    } else if (content === "plus5") {
      game.scores.set(playerId, (game.scores.get(playerId) || 0) + 5);
      await adjustPoints(playerId, 5);
      resultText += `\n\n🎁 حصل اللاعب ${playerName(player)} على +5 نقاط!`;
    } else if (content === "plus10") {
      game.scores.set(playerId, (game.scores.get(playerId) || 0) + 10);
      await adjustPoints(playerId, 10);
      resultText += `\n\n🎁 حصل اللاعب ${playerName(player)} على +10 نقاط!`;
    } else if (content === "minus3") {
      game.scores.set(playerId, (game.scores.get(playerId) || 0) - 3);
      await adjustPoints(playerId, -3);
      resultText += `\n\n💥 أوبس!\nتم خصم 3 نقاط من اللاعب ${playerName(player)}.`;
    } else if (content === "minus5") {
      game.scores.set(playerId, (game.scores.get(playerId) || 0) - 5);
      await adjustPoints(playerId, -5);
      resultText += `\n\n💥 أوبس!\nتم خصم 5 نقاط من اللاعب ${playerName(player)}.`;
    }
  }
  try { await ctx.api.editMessageText(chatId, messageId, resultText); } catch {}
  if (isFinished(game)) { game.resolving = false; return finishHideGame(ctx, chatId); }
  if (!foundPlayers.length && content === "extra" && game.players.has(playerId)) {
    game.resolving = false;
    return startSpecificSearch(ctx, chatId, playerId);
  }
  game.searching = false;
  game.resolving = false;
  await startSearchTurn(ctx, chatId);
}
async function startSpecificSearch(ctx, chatId, playerId) {
  const game = activeHideGames.get(chatId);
  if (!game || game.phase !== "searching" || !game.players.has(playerId)) return;
  if (!game.available.length) return finishHideGame(ctx, chatId);
  const player = game.players.get(playerId);
  game.searchPlayer = playerId;
  game.searching = true;
  game.resolving = false;
  const sent = await ctx.api.sendMessage(chatId,
    `🔄 فرصة إضافية!\n\nتفضل يا ${playerName(player)} اختر مربعًا آخر.\n\n⏱ أمامك 30 ثانية.`,
    { reply_markup: keyboard(game.available, `search:${chatId}:${playerId}`) });
  game.searchMessageId = sent.message_id;
  game.searchTask = setTimeout(() => searchTimeout(ctx, chatId, playerId), SEARCH_TIME);
}
async function searchTimeout(ctx, chatId, playerId) {
  const game = activeHideGames.get(chatId);
  if (!game || game.phase !== "searching" || game.searchPlayer !== playerId || game.resolving) return;
  const player = game.players.get(playerId);
  if (!player) return;
  game.resolving = true;
  try {
    if (game.searchMessageId) {
      try { await ctx.api.editMessageText(chatId, game.searchMessageId,
        `⏰ انتهى وقت ${playerName(player)}!\n\n❌ تم استبعادك من اللعبة لأنك لم تختر رقمًا.`); } catch {}
    }
    game.players.delete(playerId);
    game.searchTask = null;
    game.searching = false;
    game.searchPlayer = null;
    game.resolving = false;
    if (isFinished(game)) return finishHideGame(ctx, chatId);
    await startSearchTurn(ctx, chatId);
  } catch { game.resolving = false; }
}
export async function handleHideAndSeekCallback(ctx) {
  const data = ctx.callbackQuery?.data || "";
  const parts = data.split(":");
  if (data.startsWith("hide:")) {
    if (parts.length !== 4) return ctx.answerCallbackQuery();
    const chatId = Number(parts[1]), playerId = Number(parts[2]), number = Number(parts[3]);
    const game = activeHideGames.get(chatId);
    if (!game) return ctx.answerCallbackQuery({ text: "❌ انتهت اللعبة.", show_alert: true });
    if (game.phase !== "hiding") return ctx.answerCallbackQuery({ text: "❌ انتهى وقت الاختباء.", show_alert: true });
    if (ctx.from.id !== playerId) return ctx.answerCallbackQuery({ text: "❌ هذه اللوحة ليست لك.", show_alert: true });
    if (game.hidden.has(playerId)) return ctx.answerCallbackQuery({ text: "❌ لقد اخترت رقمًا بالفعل.", show_alert: true });
    if (!Number.isInteger(number) || number < 1 || number > game.boardSize) return ctx.answerCallbackQuery({ text: "❌ رقم غير صحيح.", show_alert: true });
    game.hidden.set(playerId, number);
    await ctx.answerCallbackQuery({ text: "✅ تم اختيار الرقم." });
    try { await ctx.editMessageText(`😶‍🌫️ تم اختيار مكان اختبائك!\n\n🔢 الرقم: ${number}\n\n✅ تم تسجيل اختيارك بنجاح.`); } catch {}
    if (game.hidden.size === game.players.size) await finishHiding(ctx, chatId);
    return;
  }
  if (data.startsWith("search:")) {
    if (parts.length !== 4) return ctx.answerCallbackQuery();
    const chatId = Number(parts[1]), playerId = Number(parts[2]), number = Number(parts[3]);
    const game = activeHideGames.get(chatId);
    if (!game) return ctx.answerCallbackQuery({ text: "❌ انتهت اللعبة.", show_alert: true });
    if (game.phase !== "searching") return ctx.answerCallbackQuery({ text: "❌ انتهى الدور.", show_alert: true });
    if (ctx.from.id !== playerId || game.searchPlayer !== playerId) return ctx.answerCallbackQuery({ text: "❌ انتظر، ليس دورك!", show_alert: true });
    if (game.resolving) return ctx.answerCallbackQuery({ text: "⏳ انتظر...", show_alert: true });
    if (!game.available.includes(number)) return ctx.answerCallbackQuery({ text: "❌ هذا الرقم تم اختياره بالفعل.", show_alert: true });
    game.resolving = true;
    await ctx.answerCallbackQuery({ text: `تم اختيار ${number}.` });
    cancelTask(game, "searchTask");
    await resolveSearch(ctx, chatId, playerId, number, ctx.callbackQuery.message.message_id);
  }
}
async function startHideGame(ctx) {
  if (ctx.chat.type === "private") return ctx.reply("❌ لعبة الغميضة تبدأ من القروب.");
  if (!(await canManage(ctx.from.id, ctx.chat.id))) return ctx.reply("❌ هذا الأمر للرتب فقط.");
  const active = getBigGame(ctx.chat.id);
  if (active) return ctx.reply(`❌ فيه لعبة شغالة حاليًا!: ${active.name}\n\n🛑 أنهِ اللعبة الحالية أولًا قبل بدء لعبة أخرى.`);
  if (activeHideGames.has(ctx.chat.id)) return ctx.reply("❌ توجد لعبة غميضة شغالة بالفعل.");
  activeHideGames.set(ctx.chat.id, {
    statsGameKey: `${Date.now()}-${Math.random()}`, players: new Map(), order: [], boardSize: 16,
    available: [], contents: {}, phase: "registration", currentIndex: 0, searchMessageId: null,
    searchPlayer: null, searchTask: null, hideTask: null, hideMessages: new Map(),
    discoveries: new Map(), bombHits: new Map(), scores: new Map(), hidden: new Map(),
    searching: false, resolving: false,
  });
  lockBigGame(ctx.chat.id, "hide", "غميضة 🕵️");
  await ctx.reply("🚪 تم فتح التسجيل في لعبة الغميضة!\n\n• نوع اللوحة المختار: الأرقام 🔢\n• اكتب دخول للانضمام إلى اللعبة.\n• عندما يكتمل اللاعبون، يكتب الأدمن ابدا لبدء اللعبة.\n• الحد الأدنى لبدء اللعبة: 2 لاعبين.");
}
export async function joinHideGame(ctx) {
  const game = activeHideGames.get(ctx.chat.id);
  if (!game || game.phase !== "registration") return false;
  const user = ctx.from;
  if (game.players.has(user.id)) {
    await ctx.reply(`❌ أنت داخل اللعبة بالفعل يا ${playerName(user)}.`);
    return true;
  }
  game.players.set(user.id, user);
  game.order.push(user.id);
  game.scores.set(user.id, 0);
  game.boardSize = boardSize(game.players.size);
  const names = game.order.map((id, i) => `${i + 1}. ${playerName(game.players.get(id))}`);
  await ctx.reply(`✅ تم تسجيل ${playerName(user)} في لعبة الغميضة!\n\n👥 عدد اللاعبين: ${game.players.size}\n🔢 عدد المربعات: ${game.boardSize}\n\n${names.join("\n")}`);
  return true;
}
export async function beginHideGame(ctx) {
  const game = activeHideGames.get(ctx.chat.id);
  if (!game) return false;
  if (!(await canManage(ctx.from.id, ctx.chat.id))) return true;
  if (game.phase !== "registration") { await ctx.reply("❌ اللعبة بدأت بالفعل."); return true; }
  if (game.players.size < MIN_PLAYERS) { await ctx.reply("❌ لا يمكن بدء اللعبة.\nالحد الأدنى: 2 لاعبين."); return true; }
  game.boardSize = boardSize(game.players.size);
  game.available = Array.from({length: game.boardSize}, (_, i) => i + 1);
  game.contents = createContents(game.boardSize);
  game.phase = "hiding";
  await ctx.reply("😶‍🌫️ بدأت لعبة الغميضة!\n\n📩 أرسلت لكل لاعب رسالة خاصة لاختيار مكان اختبائه.\n⏱ أمام كل لاعب 60 ثانية.\n\nإذا لم يختر اللاعب خلال الوقت، سأختار له رقمًا عشوائيًا.");
  for (const playerId of game.order) await sendHideChoice(ctx, ctx.chat.id, playerId);
  game.hideTask = setTimeout(async () => {
    const current = activeHideGames.get(ctx.chat.id);
    if (!current || current.phase !== "hiding") return;
    for (const playerId of current.order) {
      if (current.hidden.has(playerId)) continue;
      const number = Math.floor(Math.random() * current.boardSize) + 1;
      current.hidden.set(playerId, number);
      const messageId = current.hideMessages.get(playerId);
      if (messageId) {
        try { await ctx.api.editMessageText(playerId, messageId, `⏰ انتهى وقت الاختباء!\n\n🎲 تم اختيار المربع (${number}) لك عشوائيًا.\n\n✅ تم تسجيل اختيارك.`); } catch {}
      }
    }
    await finishHiding(ctx, ctx.chat.id);
  }, HIDE_TIME);
  return true;
}
export async function endHideGame(ctx) {
  const game = activeHideGames.get(ctx.chat.id);
  if (!game) return false;
  if (!(await canManage(ctx.from.id, ctx.chat.id))) return true;
  await ctx.reply("🛑 تم إنهاء لعبة الغميضة.");
  activeHideGames.delete(ctx.chat.id);
  unlockBigGame(ctx.chat.id, "hide");
  cancelTask(game, "hideTask");
  cancelTask(game, "searchTask");
  return true;
}
export async function handleHideAndSeekMessage(ctx) {
  const text = ctx.message?.text?.trim().replace(/\s+/g, " ");
  if (!text || !ctx.chat || !ctx.from) return false;
  if (text === "غميضة") { await startHideGame(ctx); return true; }
  return false;
}
