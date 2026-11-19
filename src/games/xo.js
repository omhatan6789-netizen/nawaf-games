import { randomUUID } from "node:crypto";
import { getPoints, chargeTwoPlayersAtomic, settleTwoPlayerWagerAtomic } from "../points.js";

const DEFAULT_POINTS = 30;
const X = "X";
const O = "O";
const X_MARK = "❌";
const O_MARK = "⭕️";
const EMPTY_MARK = "⬜️";
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const activeGames = new Map();
const locks = new Map();

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);
const userName = user =>
  `<a href="tg://user?id=${user.id}">${escapeHtml(user.first_name || user.username || "المستخدم")}</a>`;
const getMark = symbol => symbol === X ? X_MARK : O_MARK;
const getSymbolUser = (game, symbol) => symbol === X ? game.xPlayer : game.oPlayer;
const getCurrentPlayer = game => game.turn === X ? game.xPlayer : game.oPlayer;
const getPlayerSymbol = (game, userId) =>
  game.xPlayerId === userId ? X : game.oPlayerId === userId ? O : null;
const checkWinner = board => {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
};
const boardFull = board => board.every(Boolean);
const keyboard = inline_keyboard => ({ inline_keyboard });

function buildBoardKeyboard(game) {
  return keyboard(Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, col) => {
      const index = row * 3 + col;
      const value = game.board[index];
      return {
        text: value === X ? X_MARK : value === O ? O_MARK : EMPTY_MARK,
        callback_data: `xo:${game.id}:cell:${index}`,
      };
    })
  ));
}
function buildAcceptKeyboard(game) {
  return keyboard([[{ text: "قبول التحدي 🔥", callback_data: `xo:${game.id}:accept` }]]);
}
function buildChallengeCaption(game) {
  const target = game.targetUser;
  if (target) {
    return `<b>• تم بدء لعبة XO</b>
<b>• عدد النقاط : ${game.points} 🎖️</b>
<b>• تم اختيار ↤ ${userName(target)}</b>
<b>• عشان تلعب معه اضغط الزر</b>`;
  }
  return `<b>• تم بدء لعبة XO</b>
<b>• عدد النقاط : ${game.points} 🎖️</b>
<b>• اللي يبي يلعب ضده يضغط الزر</b>`;
}
function buildGameCaption(game) {
  const currentPlayer = getCurrentPlayer(game);
  return `<b>• اللاعب الاول : ${userName(game.xPlayer)} ${X_MARK}</b>
<b>• اللاعب الثاني : ${userName(game.oPlayer)} ${O_MARK}</b>

<b>• دور اللاعب : ${userName(currentPlayer)} ${getMark(game.turn)}</b>`;
}
function buildWinCaption(game, winnerSymbol) {
  const winner = getSymbolUser(game, winnerSymbol);
  const loser = getSymbolUser(game, winnerSymbol === X ? O : X);
  return `<b>انتهت اللعبة 🎉🥳</b>

<b>• الفائز 🏆 : ${userName(winner)} ${getMark(winnerSymbol)}</b>
<b>• النقاط الي كسبها : ${game.points} 🎖️🎉</b>

<b>• الخاسر 😂 : ${userName(loser)} ${getMark(winnerSymbol === X ? O : X)}</b>
<b>• النقاط الي كسبها : 0 😂😂</b>`;
}
function buildDrawCaption() {
  return `<b>محد فاز يالسبايك 😂😂</b>

<b>• نقاطكم رجعت لكم نفس ماهي 👍🏻</b>
<b>————————————————</b>`;
}
async function withGameLock(id, callback) {
  const previous = locks.get(id) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  locks.set(id, previous.then(() => current));
  await previous;
  try { return await callback(); }
  finally {
    release();
    if (locks.get(id) === current) locks.delete(id);
  }
}

export async function handleXoMessage(ctx) {
  const text = ctx.message?.text?.trim();
  const match = text?.match(/^اكس او(?:\s+(\d+))?$/);
  if (!match || !ctx.from || !ctx.chat) return false;

  const message = ctx.message;
  const targetUser = message.reply_to_message?.from ?? null;
  if (message.reply_to_message && !targetUser) return true;
  if (targetUser && targetUser.id === ctx.from.id) {
    await ctx.reply("<b>• ما تقدر تتحدى نفسك 😂</b>", { parse_mode: "HTML" });
    return true;
  }
  if (targetUser?.is_bot) {
    await ctx.reply("<b>• ما تقدر تتحدى البوت 😂</b>", { parse_mode: "HTML" });
    return true;
  }

  const points = match[1] ? Number(match[1]) : DEFAULT_POINTS;
  if (!Number.isSafeInteger(points) || points <= 0) {
    await ctx.reply("<b>• عدد النقاط لازم يكون أكبر من صفر.</b>", { parse_mode: "HTML" });
    return true;
  }
  if (await getPoints(ctx.from.id) < points) {
    await ctx.reply("<b>• نقاطك ماتكفي يامطفر</b>", { parse_mode: "HTML" });
    return true;
  }

  const game = {
    id: randomUUID().replace(/-/g, "").slice(0, 10),
    chatId: ctx.chat.id,
    messageId: null,
    challenger: ctx.from,
    challengerId: ctx.from.id,
    targetUser,
    targetId: targetUser?.id ?? null,
    points,
    status: "waiting",
    xPlayer: null,
    xPlayerId: null,
    oPlayer: null,
    oPlayerId: null,
    board: Array(9).fill(""),
    turn: X,
    finished: false,
  };
  activeGames.set(game.id, game);
  const sent = await ctx.reply(buildChallengeCaption(game), {
    parse_mode: "HTML",
    reply_markup: buildAcceptKeyboard(game),
  });
  game.messageId = sent.message_id;
  return true;
}

export async function handleXoCallback(ctx) {
  const data = ctx.callbackQuery?.data || "";
  if (!data.startsWith("xo:")) return false;
  const parts = data.split(":");
  if (parts.length < 3) {
    await ctx.answerCallbackQuery();
    return true;
  }
  const [, id, action] = parts;
  const game = activeGames.get(id);
  if (!game || game.finished) {
    await ctx.answerCallbackQuery({ text: "• انتهت اللعبه" });
    return true;
  }

  await withGameLock(id, async () => {
    const user = ctx.from;
    if (action === "accept") {
      if (game.targetId !== null && user.id !== game.targetId) {
        await ctx.answerCallbackQuery({ text: "• هذا الزر لا يخصك" });
        return;
      }
      if (user.id === game.challengerId || user.is_bot) {
        await ctx.answerCallbackQuery({ text: "• هذا الزر لا يخصك" });
        return;
      }
      if (game.status !== "waiting") {
        await ctx.answerCallbackQuery({ text: "• انتهت اللعبه" });
        return;
      }

      const charge = await chargeTwoPlayersAtomic(game.challengerId, user.id, game.points);
      if (charge === "first_insufficient") {
        game.finished = true;
        game.status = "cancelled";
        activeGames.delete(game.id);
        await ctx.answerCallbackQuery({ text: "• الي ضدك مطفر اختر خصم غني 😂😂" });
        try {
          await ctx.editMessageText("<b>• انتهى التحدي لأن صاحب التحدي ما عاد معه النقاط المطلوبة.</b>", { parse_mode: "HTML" });
        } catch {}
        return;
      }
      if (charge === "second_insufficient") {
        await ctx.answerCallbackQuery({ text: "• نقاطك ما تكفي يامطفر" });
        return;
      }

      game.status = "playing";
      if (Math.random() < 0.5) {
        game.xPlayer = game.challenger;
        game.oPlayer = user;
      } else {
        game.xPlayer = user;
        game.oPlayer = game.challenger;
      }
      game.xPlayerId = game.xPlayer.id;
      game.oPlayerId = game.oPlayer.id;
      game.turn = X;
      game.board = Array(9).fill("");
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(buildGameCaption(game), {
        parse_mode: "HTML",
        reply_markup: buildBoardKeyboard(game),
      });
      return;
    }

    if (action !== "cell" || parts.length !== 4) {
      await ctx.answerCallbackQuery();
      return;
    }
    const cellIndex = Number(parts[3]);
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 8) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (game.status !== "playing") {
      await ctx.answerCallbackQuery({ text: "• انتظر قبول التحدي" });
      return;
    }
    const symbol = getPlayerSymbol(game, user.id);
    if (!symbol) {
      await ctx.answerCallbackQuery({ text: "• هذا الزر لا يخصك" });
      return;
    }
    if (game.turn !== symbol) {
      await ctx.answerCallbackQuery({ text: "• انتظر ليس دورك" });
      return;
    }
    if (game.board[cellIndex] !== "") {
      await ctx.answerCallbackQuery({ text: "• هذه الخانة مستخدمة" });
      return;
    }

    game.board[cellIndex] = symbol;
    const winner = checkWinner(game.board);
    if (winner) {
      game.finished = true;
      game.status = "finished";
      const winnerId = getSymbolUser(game, winner).id;
      await settleTwoPlayerWagerAtomic(game.xPlayerId, game.oPlayerId, game.points, winnerId);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(buildWinCaption(game, winner), {
        parse_mode: "HTML",
        reply_markup: buildBoardKeyboard(game),
      });
      activeGames.delete(game.id);
      return;
    }
    if (boardFull(game.board)) {
      game.finished = true;
      game.status = "draw";
      await settleTwoPlayerWagerAtomic(game.xPlayerId, game.oPlayerId, game.points, null);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(buildDrawCaption(), {
        parse_mode: "HTML",
        reply_markup: buildBoardKeyboard(game),
      });
      activeGames.delete(game.id);
      return;
    }

    game.turn = symbol === X ? O : X;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(buildGameCaption(game), {
      parse_mode: "HTML",
      reply_markup: buildBoardKeyboard(game),
    });
  });
  return true;
}
