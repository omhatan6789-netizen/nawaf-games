import { activeHideGames, joinHideGame, beginHideGame, endHideGame } from "./hide-and-seek.js";
import { getBigGame } from "./big-game-lock.js";

export function getActiveBigGame(chatId) {
  const active = getBigGame(chatId);
  if (!active) return null;
  if (active.key === "hide" && activeHideGames.has(Number(chatId))) return "hide";
  return active.key;
}

export async function handleBigGameRouterMessage(ctx) {
  const text = ctx.message?.text?.trim().replace(/\\s+/g, " ");
  if (!text || !ctx.chat || !ctx.from) return false;
  const game = getActiveBigGame(ctx.chat.id);
  if (!game) return false;

  if (text === "دخول") {
    if (game === "hide") return joinHideGame(ctx);
    return false;
  }
  if (text === ".ابدا") {
    if (game === "hide") return beginHideGame(ctx);
    return false;
  }
  if (text === ".انهاء") {
    if (game === "hide") return endHideGame(ctx);
    return false;
  }
  return false;
}
