export const activeBigGames = new Map();

export function getBigGame(chatId) {
  return activeBigGames.get(Number(chatId)) || null;
}

export function lockBigGame(chatId, key, name) {
  const id = Number(chatId);
  const current = activeBigGames.get(id);
  if (current) return false;
  activeBigGames.set(id, { key, name });
  return true;
}

export function unlockBigGame(chatId, key) {
  const id = Number(chatId);
  const current = activeBigGames.get(id);
  if (!current || (key && current.key !== key)) return false;
  activeBigGames.delete(id);
  return true;
}
