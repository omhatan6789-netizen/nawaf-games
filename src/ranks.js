import { pool } from "./db.js";

export const OWNER_ID = 8453977662;
export const RANK_LEVELS = {
  "عضو": 0, "مميز": 1, "ادمن": 2, "ادمن اساسي": 3,
  "نائب المالك": 4, "المالك": 5, "Dev": 6,
};
export const NORMAL_RANKS = ["مميز", "ادمن", "ادمن اساسي", "نائب المالك", "المالك"];

let commandLocksCache = null;
let commandLocksCacheAt = 0;

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}

export async function getDeveloperType(userId) {
  if (Number(userId) === OWNER_ID) return "primary";
  const result = await db().query("SELECT developer_type FROM developers WHERE user_id = $1", [String(userId)]);
  return result.rows[0]?.developer_type ?? null;
}

export async function getRank(userId, chatId = null) {
  if (Number(userId) === OWNER_ID || await getDeveloperType(userId)) return "Dev";
  if (chatId !== null) {
    const result = await db().query(
      `SELECT rank FROM group_user_ranks WHERE chat_id = $1 AND user_id = $2
       AND rank = ANY($3::text[])
       ORDER BY CASE rank
         WHEN 'المالك' THEN 5 WHEN 'نائب المالك' THEN 4
         WHEN 'ادمن اساسي' THEN 3 WHEN 'ادمن' THEN 2 WHEN 'مميز' THEN 1 ELSE 0 END DESC
       LIMIT 1`,
      [String(chatId), String(userId), NORMAL_RANKS]
    );
    return result.rows[0]?.rank ?? "عضو";
  }
  const result = await db().query("SELECT rank FROM ranks WHERE user_id = $1", [String(userId)]);
  const rank = result.rows[0]?.rank;
  return Object.hasOwn(RANK_LEVELS, rank) ? rank : "عضو";
}

export async function getRankLevel(userId, chatId = null) {
  if (Number(userId) === OWNER_ID) return 7;
  if (await getDeveloperType(userId) === "secondary") return 6;
  return RANK_LEVELS[await getRank(userId, chatId)] ?? 0;
}

export async function hasGroupRank(chatId, userId, rank) {
  if (rank === "عضو") return true;
  const result = await db().query(
    "SELECT 1 FROM group_user_ranks WHERE chat_id = $1 AND user_id = $2 AND rank = $3",
    [String(chatId), String(userId), rank]
  );
  return result.rowCount > 0;
}

export async function changeRank({ actorId, targetId, chatId, rank, promote }) {
  const actorDev = await getDeveloperType(actorId);
  const targetDev = await getDeveloperType(targetId);

  if (rank === "Dev") {
    if (actorDev !== "primary") return { ok: false, message: "هذا الأمر للمطور الأساسي فقط." };
    if (Number(targetId) === OWNER_ID) return { ok: false, message: "لا يمكن تعديل المطور الأساسي." };
    if (Number(targetId) === Number(actorId)) return { ok: false, message: "لا يمكنك تعديل رتبتك بنفسك." };
    if (promote) {
      if (targetDev) return { ok: false, message: "المستخدم Dev مسبقًا." };
      await db().query(
        `INSERT INTO developers(user_id, developer_type, added_by, added_date)
         VALUES($1, 'secondary', $2, NOW())
         ON CONFLICT(user_id) DO UPDATE SET developer_type='secondary', added_by=EXCLUDED.added_by, added_date=NOW()`,
        [String(targetId), String(actorId)]
      );
      return { ok: true, message: "تم رفعه Dev بنجاح." };
    }
    if (targetDev !== "secondary") return { ok: false, message: "هذا الشخص ليس Dev مساعدًا." };
    await db().query("DELETE FROM developers WHERE user_id = $1 AND developer_type = 'secondary'", [String(targetId)]);
    return { ok: true, message: "تم تنزيله من Dev بنجاح." };
  }

  if (chatId === null) return { ok: false, message: "أوامر الرتب العادية تستخدم داخل القروب." };
  if (Number(targetId) === OWNER_ID) return { ok: false, message: "لا يمكن تعديل رتبة المطور الأساسي." };
  if (actorDev === "secondary" && targetDev === "secondary") return { ok: false, message: "لا يمكنك تعديل مطور من نفس رتبتك." };
  if (targetDev) return { ok: false, message: "لا يمكنك تعديل رتبة مطور Dev." };

  const actorLevel = await getRankLevel(actorId, chatId);
  if (actorDev !== "primary" && RANK_LEVELS[rank] >= actorLevel) {
    const nextRank = Object.entries(RANK_LEVELS).find(([, level]) => level === RANK_LEVELS[rank] + 1)?.[0];
    return { ok: false, message: nextRank ? `هذا الأمر لرتبة ${nextRank} وفوق.` : "ما عندك الصلاحية لهذا الأمر." };
  }

  const already = await hasGroupRank(chatId, targetId, rank);
  if (promote && already) return { ok: false, message: `تم رفعه ${rank} مسبقًا.` };
  if (!promote && !already) return { ok: false, message: `تم تنزيله من ${rank} مسبقًا.` };

  if (promote) {
    await db().query(
      "INSERT INTO group_user_ranks(chat_id, user_id, rank) VALUES($1, $2, $3) ON CONFLICT DO NOTHING",
      [String(chatId), String(targetId), rank]
    );
  } else {
    await db().query(
      "DELETE FROM group_user_ranks WHERE chat_id = $1 AND user_id = $2 AND rank = $3",
      [String(chatId), String(targetId), rank]
    );
  }
  return { ok: true, message: promote ? `تم رفعه ${rank} بنجاح.` : `تم تنزيله من ${rank} بنجاح.` };
}


export async function getGroupRankUsers(chatId) {
  const result = await db().query(
    `SELECT user_id, rank FROM group_user_ranks
     WHERE chat_id=$1 AND rank=ANY($2::text[])
     ORDER BY CASE rank WHEN 'المالك' THEN 5 WHEN 'نائب المالك' THEN 4
       WHEN 'ادمن اساسي' THEN 3 WHEN 'ادمن' THEN 2 WHEN 'مميز' THEN 1 ELSE 0 END DESC, user_id`,
    [String(chatId), NORMAL_RANKS]
  );
  return result.rows.map(row => ({ userId: Number(row.user_id), rank: row.rank }));
}

export async function getUsersByGroupRank(chatId, rank) {
  const result = await db().query(
    "SELECT user_id FROM group_user_ranks WHERE chat_id=$1 AND rank=$2 ORDER BY user_id",
    [String(chatId), rank]
  );
  return result.rows.map(row => Number(row.user_id));
}

export async function getSecondaryDevelopers() {
  const result = await db().query(
    "SELECT user_id FROM developers WHERE developer_type='secondary' ORDER BY user_id"
  );
  return result.rows.map(row => Number(row.user_id));
}

export async function clearSecondaryDevelopers() {
  const result = await db().query("DELETE FROM developers WHERE developer_type='secondary'");
  return result.rowCount;
}

export async function clearRankList(chatId, rank) {
  const result = await db().query(
    "DELETE FROM group_user_ranks WHERE chat_id=$1 AND rank=$2",
    [String(chatId), rank]
  );
  return result.rowCount;
}

export async function clearGroupRanks(chatId) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query(
      "SELECT rank, COUNT(*)::int AS count FROM group_user_ranks WHERE chat_id=$1 GROUP BY rank",
      [String(chatId)]
    );
    const counts = Object.fromEntries(NORMAL_RANKS.map(rank => [rank, 0]));
    for (const row of rows.rows) if (Object.hasOwn(counts, row.rank)) counts[row.rank] = Number(row.count);
    await client.query("DELETE FROM group_user_ranks WHERE chat_id=$1", [String(chatId)]);
    await client.query("COMMIT");
    return counts;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function clearLowerGroupRanks(chatId, userId, actorLevel) {
  const result = await db().query(
    `DELETE FROM group_user_ranks WHERE chat_id=$1 AND user_id=$2
     AND CASE rank WHEN 'مميز' THEN 1 WHEN 'ادمن' THEN 2
       WHEN 'ادمن اساسي' THEN 3 WHEN 'نائب المالك' THEN 4
       WHEN 'المالك' THEN 5 ELSE 0 END < $3`,
    [String(chatId), String(userId), actorLevel]
  );
  return result.rowCount;
}

export async function checkCommandPermission(userId, command, chatId) {
  const result = await db().query(
    "SELECT rank FROM command_locks WHERE command=$1",
    [command]
  );
  const required = result.rows[0]?.rank;
  if (!required) return { allowed: true, required: null };
  if (await getDeveloperType(userId)) return { allowed: true, required };
  const level = await getRankLevel(userId, chatId);
  return { allowed: level >= (RANK_LEVELS[required] ?? 0), required };
}


export async function getCommandLocks() {
  if (commandLocksCache && Date.now() - commandLocksCacheAt < 30000) return { ...commandLocksCache };
  const result = await db().query("SELECT command, rank FROM command_locks");
  commandLocksCache = Object.fromEntries(result.rows.map(row => [row.command, row.rank]));
  commandLocksCacheAt = Date.now();
  return { ...commandLocksCache };
}

export async function setCommandLock(command, rank) {
  const cleanCommand = String(command || "").trim().replace(/\\s+/g, " ");
  if (!cleanCommand || !Object.hasOwn(RANK_LEVELS, rank) || rank === "عضو") throw new Error("Invalid command lock");
  await db().query(
    `INSERT INTO command_locks(command, rank) VALUES($1,$2)
     ON CONFLICT(command) DO UPDATE SET rank=EXCLUDED.rank`,
    [cleanCommand, rank]
  );
  commandLocksCache = null;
}

export async function removeCommandLock(command) {
  const cleanCommand = String(command || "").trim().replace(/\\s+/g, " ");
  await db().query("DELETE FROM command_locks WHERE command=$1", [cleanCommand]);
  commandLocksCache = null;
}

export async function setUserPermission(chatId, userId, command, allowed) {
  const cleanCommand = String(command || "").trim().replace(/\\s+/g, " ");
  if (!cleanCommand) throw new Error("Permission command cannot be empty");
  await db().query(
    `INSERT INTO group_user_permissions(chat_id,user_id,permission,allowed)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(chat_id,user_id,permission) DO UPDATE SET allowed=EXCLUDED.allowed`,
    [String(chatId), String(userId), cleanCommand, Boolean(allowed)]
  );
}

export async function getUserPermission(chatId, userId, command) {
  const result = await db().query(
    "SELECT allowed FROM group_user_permissions WHERE chat_id=$1 AND user_id=$2 AND permission=$3",
    [String(chatId), String(userId), String(command)]
  );
  return result.rows[0] ? Boolean(result.rows[0].allowed) : null;
}
