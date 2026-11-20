import { activeHideGames, joinHideGame, beginHideGame, endHideGame } from "./hide-and-seek.js";
import { getBigGame } from "./big-game-lock.js";
import { activeLiarGames, joinLiarGame, leaveLiarGame, beginLiarGame, endLiarGame, forceLiarVoting } from "./liar.js";
import { activePenaltyGames, joinPenaltyGame, distributePenalties, manualTeamCommand, beginPenalties, continuePenalties, endPenaltyGame } from "./penalties.js";

export function getActiveBigGame(chatId) {
  const active = getBigGame(chatId);
  if (!active) return null;
  if (active.key === "hide" && activeHideGames.has(Number(chatId))) return "hide";
  if (active.key === "liar" && activeLiarGames.has(Number(chatId))) return "liar";
  if (active.key === "penalties" && activePenaltyGames.has(Number(chatId))) return "penalties";
  return active.key;
}

export async function handleBigGameRouterMessage(ctx) {
  const text = ctx.message?.text?.trim().replace(/\\s+/g, " ");
  if (!text || !ctx.chat || !ctx.from) return false;
  const game = getActiveBigGame(ctx.chat.id);
  if (!game) return false;

  if (text === "دخول") {
    if (game === "hide") return joinHideGame(ctx);
    if (game === "liar") return joinLiarGame(ctx);
    if (game === "penalties") return joinPenaltyGame(ctx);
    return false;
  }
  if (text === ".خروج") {
    if (game === "liar") return leaveLiarGame(ctx);
    return false;
  }
  if (text === ".ابدا") {
    if (game === "hide") return beginHideGame(ctx);
    if (game === "liar") return beginLiarGame(ctx);
    if (game === "penalties") return beginPenalties(ctx);
    return false;
  }
  if (text === ".وزع") {
    if (game === "penalties") return distributePenalties(ctx);
    return false;
  }
  if (text === ".كمل") {
    if (game === "penalties") return continuePenalties(ctx);
    return false;
  }
  if (/^\.(?:احمر|ازرق)(?:\s+\d+\*?)+$/.test(text)) {
    if (game === "penalties") return manualTeamCommand(ctx);
    return false;
  }
  if (text === ".التصويت") {
    if (game === "liar") return forceLiarVoting(ctx);
    return false;
  }
  if (text === ".انهاء") {
    if (game === "hide") return endHideGame(ctx);
    if (game === "liar") return endLiarGame(ctx);
    if (game === "penalties") return endPenaltyGame(ctx);
    return false;
  }
  return false;
}
