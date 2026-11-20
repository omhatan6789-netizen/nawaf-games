import crypto from "node:crypto";
import { pool } from "./db.js";

let inlineLobbySchemaReady = null;
async function ensureInlineLobbyGameTypes() {
  if (!inlineLobbySchemaReady) {
    inlineLobbySchemaReady = pool.query(`
      ALTER TABLE online_game_lobbies
      DROP CONSTRAINT IF EXISTS online_game_lobbies_game_type_check;
      ALTER TABLE online_game_lobbies
      ADD CONSTRAINT online_game_lobbies_game_type_check
      CHECK (game_type IN ('connect','dots','memory','match','find','number','sort'));
    `).catch(error => {
      inlineLobbySchemaReady = null;
      throw error;
    });
  }
  return inlineLobbySchemaReady;
}

const GAME_INFO = {
  connect: ["كونكت 4 🔴", "لعبة توصيل أربعة أقراص"],
  dots: ["المربعات 🟦", "ارسم الخطوط واجمع أكبر عدد من المربعات"],
  memory: ["اختبر ذاكرتك 🧠", "احفظ التسلسل وكرر الألوان"],
  word: ["خمن الكلمة 🔤", "تحدَّ حتى 10 لاعبين واكتشفوا الكلمة"],
  match: ["تطابق البطاقات 🃏", "طابق البطاقات واجمع أكبر عدد"],
  find: ["Find Match 🔎", "اعثر على الغرض المشترك قبل خصمك"],
  number: ["خمن الرقم 🎯", "اكتشف الرقم مع تلميحات أعلى أو أقل"],
  sort: ["ترتيب الأرقام 🔢", "رتّب اللوحة قبل انتهاء الوقت"],
  carrom: ["الكيرم 🎯", "صوّب الأقراص نحو الجيوب وتحدَّ لاعبًا آخر"],
  gravity: ["جري الجاذبية 🏃", "بدّل الجاذبية وتجاوز العقبات مع لاعب آخر"],
  snowball: ["كرة الثلج ❄️", "صوّب كرات الثلج وتحدَّ لاعبًا آخر"],
};

const WORDS = ["سيارة", "مدرسة", "مكتبة", "طائرة", "حاسوب", "نافذة", "حديقة", "مفتاح", "مصباح", "وسادة", "حقيبة", "ثلاجة", "غسالة", "مروحة", "تلفاز", "سفينة", "دراجة", "طاولة", "ملعقة", "تفاحة"];

function selectGames(query = "") {
  const value = String(query).trim().toLowerCase();
  if (!value) return Object.keys(GAME_INFO);
  if (/(كونكت|connect|4)/i.test(value)) return ["connect"];
  if (/(مربع|المربعات|dots|dot)/i.test(value)) return ["dots"];
  if (/(ذاكرة|ذاكرت|memory)/i.test(value)) return ["memory"];
  if (/(خمن الرقم|رقم|number)/i.test(value)) return ["number"];
  if (/(ترتيب الأرقام|ترتيب|sort)/i.test(value)) return ["sort"];
  if (/(find match|فايند ماتش|اعثر|العثور)/i.test(value)) return ["find"];
  if (/(تطابق البطاقات|مطابقة|match)/i.test(value)) return ["match"];
  if (/(خمن|كلمة|word)/i.test(value)) return ["word"];
  if (/(كيرم|carrom)/i.test(value)) return ["carrom"];
  if (/(كرة الثلج|ثلج|snowball)/i.test(value)) return ["snowball"];
  if (/(جري الجاذبية|الجاذبية|gravity)/i.test(value)) return ["gravity"];
  return Object.keys(GAME_INFO);
}

function playerName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ")
    || user.username || "مستخدم";
}

async function createLobby(gameType, user) {
  const name = playerName(user);
  if (gameType === "carrom" || gameType === "gravity" || gameType === "snowball") {
    const port = gameType === "carrom" ? 10001 : gameType === "gravity" ? 10002 : 10003;
    const response = await fetch(`http://127.0.0.1:${port}/api/internal/inline-room`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-token": process.env.BOT_TOKEN },
      body: JSON.stringify({ userId: user.id, name }),
      signal: AbortSignal.timeout(4000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.roomId) throw new Error(data.error || "تعذر إنشاء غرفة اللعبة");
    const prefix = gameType === "carrom" ? "carrom_" : gameType === "gravity" ? "gravity_" : "snowball_";
    return { id: data.roomId, startapp: `${prefix}${data.roomId}` };
  }
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

    await ensureInlineLobbyGameTypes();
    const results = [];
    for (const gameType of selectGames(ctx.inlineQuery.query)) {
      try {
      const [title, description] = GAME_INFO[gameType];
      const room = await createLobby(gameType, ctx.from);
      const roomUrl = `https://t.me/${username}?startapp=${room.startapp}`;
      const messageText = gameType === "word"
        ? `🔤 تحدي جماعي — ${title}\n\nبدأ ${playerName(ctx.from)} تحديًا في خمن الكلمة. افتحوا اللعبة من الزر بالأسفل وابدؤوا التحدي!`
        : `🎮 @${username} — ${title}\n\nاضغطوا الزر بالأسفل لفتح اللعبة والانضمام إلى التحدي داخل الميني آب.`;

      const image = await pool.query(
        "SELECT photo_file_id FROM online_game_images WHERE game_type=$1",
        [gameType]
      ).catch(() => ({ rows: [] }));
      const fileId = image.rows[0]?.photo_file_id;
      const imageUrl = fileId
        ? `https://nawaf-bot-node-xsna.onrender.com/tg-file/${encodeURIComponent(fileId)}`
        : null;
      const replyMarkup = {
        inline_keyboard: [[{ text: "ابدأ اللعب", url: roomUrl }]]
      };
      const result = imageUrl
        ? {
            type: "photo",
            id: room.id,
            photo_url: imageUrl,
            thumbnail_url: imageUrl,
            caption: messageText,
            reply_markup: replyMarkup,
          }
        : {
            type: "article",
            id: room.id,
            title,
            description,
            input_message_content: { message_text: messageText },
            reply_markup: replyMarkup,
          };
      results.push(result);
      } catch (gameError) {
        console.error(`Inline game result failed for ${gameType}:`, gameError?.message || gameError);
      }
    }

    await ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
  } catch (error) {
    console.error("Inline games query failed:", error);
    try {
      await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
    } catch {}
  }
}
