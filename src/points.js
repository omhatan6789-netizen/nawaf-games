import { pool } from "./db.js";

function db() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}

export async function ensureUser(user) {
  await db().query(
    `INSERT INTO users (user_id, username, first_name, last_name, is_bot)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       username = COALESCE(EXCLUDED.username, users.username),
       first_name = COALESCE(EXCLUDED.first_name, users.first_name),
       last_name = COALESCE(EXCLUDED.last_name, users.last_name),
       is_bot = EXCLUDED.is_bot,
       updated_at = NOW()`,
    [user.id, user.username ?? null, user.first_name ?? null, user.last_name ?? null, Boolean(user.is_bot)]
  );
}

export async function getPoints(userId) {
  const result = await db().query("SELECT points FROM points WHERE user_id = $1", [userId]);
  return Number(result.rows[0]?.points ?? 0);
}

export async function transferPointsAtomic(senderId, recipientId, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || senderId === recipientId) return false;
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    for (const id of [senderId, recipientId]) {
      await client.query(
        "INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
        [id]
      );
      await client.query(
        "INSERT INTO points (user_id, points) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING",
        [id]
      );
    }
    const ids = [senderId, recipientId].sort((a, b) => a - b);
    await client.query(
      "SELECT user_id FROM points WHERE user_id = ANY($1::bigint[]) ORDER BY user_id FOR UPDATE",
      [ids]
    );
    const debit = await client.query(
      "UPDATE points SET points = points - $2 WHERE user_id = $1 AND points >= $2 RETURNING user_id",
      [senderId, amount]
    );
    if (!debit.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      "UPDATE points SET points = points + $2 WHERE user_id = $1",
      [recipientId, amount]
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function addPoints(user, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid points amount");
  await ensureUser(user);
  const result = await db().query(
    `INSERT INTO points (user_id, points) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET points = points.points + EXCLUDED.points
     RETURNING points`,
    [user.id, amount]
  );
  return Number(result.rows[0].points);
}

export async function deductPoints(user, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid points amount");
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (user_id, username, first_name, last_name, is_bot)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id) DO NOTHING`,
      [user.id, user.username ?? null, user.first_name ?? null, user.last_name ?? null, Boolean(user.is_bot)]
    );
    await client.query(
      "INSERT INTO points (user_id, points) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING",
      [user.id]
    );
    const result = await client.query(
      "UPDATE points SET points = points - $2 WHERE user_id = $1 AND points >= $2 RETURNING points",
      [user.id, amount]
    );
    await client.query("COMMIT");
    return result.rows.length ? Number(result.rows[0].points) : null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function sellPointsForMessages(user, amount, pointsPerMessage = 10) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid points amount");
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (user_id, username, first_name, last_name, is_bot)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         username = COALESCE(EXCLUDED.username, users.username),
         first_name = COALESCE(EXCLUDED.first_name, users.first_name),
         updated_at = NOW()`,
      [user.id, user.username ?? null, user.first_name ?? null, user.last_name ?? null, Boolean(user.is_bot)]
    );
    await client.query(
      "INSERT INTO points (user_id, points) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING",
      [user.id]
    );
    const debit = await client.query(
      "UPDATE points SET points = points - $2 WHERE user_id = $1 AND points >= $2 RETURNING points",
      [user.id, amount]
    );
    if (!debit.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }
    const messages = amount * pointsPerMessage;
    await client.query(
      "UPDATE users SET messages = COALESCE(messages, 0) + $2, updated_at = NOW() WHERE user_id = $1",
      [user.id, messages]
    );
    await client.query("COMMIT");
    return { remainingPoints: Number(debit.rows[0].points), messages };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getPointsLeaderboard(limit = 10) {
  const result = await db().query(
    `SELECT p.user_id, p.points, u.first_name
     FROM points p LEFT JOIN users u ON u.user_id = p.user_id
     WHERE p.points > 0 ORDER BY p.points DESC, p.user_id ASC LIMIT $1`,
    [limit]
  );
  return result.rows;
}


export async function chargeTwoPlayersAtomic(firstId, secondId, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || firstId === secondId) return "first_insufficient";
  const ids = [firstId, secondId].sort((a, b) => a - b);
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    for (const id of ids) {
      await client.query("INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [id]);
      await client.query("INSERT INTO points (user_id, points) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING", [id]);
    }
    const locked = await client.query(
      "SELECT user_id, points FROM points WHERE user_id = ANY($1::bigint[]) ORDER BY user_id FOR UPDATE",
      [ids]
    );
    const balances = new Map(locked.rows.map(row => [Number(row.user_id), Number(row.points)]));
    if ((balances.get(firstId) ?? 0) < amount) {
      await client.query("ROLLBACK");
      return "first_insufficient";
    }
    if ((balances.get(secondId) ?? 0) < amount) {
      await client.query("ROLLBACK");
      return "second_insufficient";
    }
    await client.query("UPDATE points SET points = points - $2 WHERE user_id = ANY($1::bigint[])", [ids, amount]);
    await client.query("COMMIT");
    return "ok";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function settleTwoPlayerWagerAtomic(firstId, secondId, amount, winnerId = null) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || firstId === secondId ||
      (winnerId !== null && winnerId !== firstId && winnerId !== secondId)) {
    throw new Error("Invalid two-player wager settlement");
  }
  const ids = [firstId, secondId].sort((a, b) => a - b);
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    for (const id of ids) {
      await client.query("INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [id]);
      await client.query("INSERT INTO points (user_id, points) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING", [id]);
    }
    await client.query(
      "SELECT user_id FROM points WHERE user_id = ANY($1::bigint[]) ORDER BY user_id FOR UPDATE",
      [ids]
    );
    if (winnerId === null) {
      await client.query("UPDATE points SET points = points + $2 WHERE user_id = ANY($1::bigint[])", [ids, amount]);
    } else {
      await client.query("UPDATE points SET points = points + $2 WHERE user_id = $1", [winnerId, amount * 2]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
