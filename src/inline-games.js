import crypto from "node:crypto";
import { pool } from "./db.js";

const GAME_INFO = {
  connect: ["Connect Four 🔴", "لعبة توصيل أربعة أقراص"],
  dots: ["Dots and Boxes 🟦", "ارسم الخطوط واجمع أكبر عدد من المربعات"],
  memory: ["Memory Match 🧠", "اختبر ذاكرتك وطابق الألوان والتسلسل"],
  word: ["خمن الكلمة 🔤", "تحدَّ حتى 10 لاعبين واكتشفوا الكلمة قبل انتهاء الوقت"],
  carrom: ["الكيرم 🎯", "صوّب الأقراص نحو الجيوب وتحدَّ لاعبًا آخر"],
  gravity: ["جري الجاذبية 🏃", "بدّل الجاذبية وتنافس مع لاعب آخر في سباق البقاء"],
};

const WORDS = ["سيارة", "مدرسة", "مكتبة", "طائرة", "حاسوب", "نافذة", "حديقة", "مفتاح", "مصباح", "وسادة", "حقيبة", "ثلاجة", "غسالة", "مروحة", "تلفاز", "سفينة", "دراجة", "طاولة", "ملعقة", "تفاحة"];

function selectGames(query = "") {
  const value = String(query).trim().toLowerCase();
  if (!value) return Object.keys(GAME_INFO);
  if (/(كونكت|connect|4)/i.test(value)) return ["connect"];
  if (/(مربع|المربعات|dots|dot)/i.test(value)) return ["dots"];
  if (/(ذاكرة|ذاكرت|memory)/i.test(value)) return ["memory"];
  if (/(خمن|كلمة|word)/i.test(value)) return ["word"];
  if (/(كيرم|carrom)/i.test(value)) return ["carrom"];
  if (/(جري الجاذبية|الجاذبية|gravity)/i.test(value)) return ["gravity"];
  return Object.keys(GAME_INFO);
}

function playerName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ")
    || user.username || "مستخدم";
}

async function createLobby(gameType, user) {
  const name = playerName(user);
  if (gameType === "word") {
    const id = crypto.randomUUID();
    const words = [...WORDS].sort(() => Math.random() - 0.5).slice(0, 5);
    const players = [{ id: Number(user.id), name, score: 0 }];
    await pool.query(
      `INSERT INTO word_games
        (id, owner_id, mode, status, max_players, word_limit, win_target,
         words, players, attempts_limit, word_length, round_seconds)
       VALUES ($1,$2,'online','waiting',10,5,5,$3::jsonb,$4::jsonb,6,5,180)`,
      [id, user.id, JSON.stringify(words), JSON.stringify(players)]
    );
    return { id: id.replace(/-/g, ""), startapp: `word_${id.replace(/-/g, "")}` };
  }

  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO online_game_lobbies (id, game_type, creator_id, creator_name)
     VALUES ($1,$2,$3,$4)`,
    [id, gameType, user.id, name]
  );
  return { id: id.replace(/-/g, ""), startapp: `online_lobby_${id.replace(/-/g, "")}` };
}

export async function handleInlineGamesQuery(ctx) {
  if (!pool || !ctx.inlineQuery) return;
  try {
    const botInfo = await ctx.api.getMe();
    const username = botInfo.username;
    if (!username) throw new Error("Bot username is unavailable");

    await pool.query(
      "DELETE FROM online_game_lobbies WHERE created_at < NOW() - INTERVAL '2 days' AND status <> 'playing'"
    ).catch(() => {});

    const results = [];
    for (const gameType of selectGames(ctx.inlineQuery.query)) {
      const [title, description] = GAME_INFO[gameType];
      const room = await createLobby(gameType, ctx.from);
      const roomUrl = `https://t.me/${username}?startapp=${room.startapp}`;
      const messageText = gameType === "word"
        ? `🔤 غرفة أونلاين — ${title}\n\nأنشأ ${playerName(ctx.from)} غرفة خمن الكلمة.\nانضموا من الزر بالأسفل، ويمكن لصاحب الغرفة بدء اللعبة بعد انضمام اللاعبين.`
        : `🎮 غرفة أونلاين — ${title}\n\nافتحوا الغرفة من الزر بالأسفل للانضمام وضبط الإعدادات وبدء اللعبة داخل الميني آب.`;

      const image = await pool.query(
        "SELECT photo_file_id FROM online_game_images WHERE game_type=$1",
        [gameType]
      ).catch(() => ({ rows: [] }));
      const fileId = image.rows[0]?.photo_file_id;
      const result = {
        type: "article",
        id: room.id,
        title,
        description,
        input_message_content: { message_text: messageText },
        reply_markup: {
          inline_keyboard: [[{ text: "دخول غرفة اللعبة", url: roomUrl }]]
        },
      };
      if (fileId) {
        result.thumbnail_url = `https://nawaf-bot-node-xsna.onrender.com/tg-file/${encodeURIComponent(fileId)}`;
        result.thumbnail_width = 80;
        result.thumbnail_height = 80;
      }
      results.push(result);
    }

    await ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
  } catch (error) {
    console.error("Inline games query failed:", error);
    try {
      await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
    } catch {}
  }
}
