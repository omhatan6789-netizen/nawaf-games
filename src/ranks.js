import { pool } from "./db.js";

export const OWNER_ID = 8453977662;
export const RANK_LEVELS = {
  "عضو": 0, "مميز": 1, "ادمن": 2, "ادمن اساسي": 3,
  "نائب المالك": 4, "المالك": 5, "Dev": 6,
};
export const NORMAL_RANKS = ["مميز", "ادمن", "ادمن اساسي", "نائب المالك", "المالك"];

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
