import { pool } from "./db.js";

let ready;
export async function ensureGamesManagerSchema() {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  if (ready) return ready;
  ready = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        name TEXT PRIMARY KEY,
        image TEXT,
        status TEXT NOT NULL DEFAULT 'on'
      );
      ALTER TABLE games ADD COLUMN IF NOT EXISTS image TEXT;
      ALTER TABLE games ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'on';

      CREATE TABLE IF NOT EXISTS game_questions (
        id BIGSERIAL PRIMARY KEY,
        game_name TEXT NOT NULL,
        question TEXT,
        image TEXT,
        caption TEXT,
        answers JSONB NOT NULL DEFAULT '[]'::jsonb
      );
      ALTER TABLE game_questions ADD COLUMN IF NOT EXISTS question TEXT;
      ALTER TABLE game_questions ADD COLUMN IF NOT EXISTS image TEXT;
      ALTER TABLE game_questions ADD COLUMN IF NOT EXISTS caption TEXT;
      ALTER TABLE game_questions ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '[]'::jsonb;

      CREATE INDEX IF NOT EXISTS idx_game_questions_game_name ON game_questions(game_name);
      CREATE TABLE IF NOT EXISTS game_question_messages (
        chat_id BIGINT NOT NULL,
        message_id BIGINT NOT NULL,
        question_id BIGINT NOT NULL,
        PRIMARY KEY(chat_id,message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_game_question_messages_question ON game_question_messages(question_id);

      CREATE TABLE IF NOT EXISTS games_settings (
        id BIGINT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'on'
      );
      INSERT INTO games_settings(id,status) VALUES(1,'on')
      ON CONFLICT(id) DO NOTHING;
    `);

    const defaultGames = ["كلمات","تفكيك","انمي","شخصيات انمي","صور"];
    await pool.query(
      "INSERT INTO games(name,status) SELECT unnest($1::text[]),'on' ON CONFLICT(name) DO NOTHING",
      [defaultGames]
    );
    const words = [
      "ناروتو","ونبيس","تيليجرام","بوت","اميرة","نواف","برمجة","ذكاء","سرعة","انمي",
      "لوفي","زورو","سانجي","ايتاتشي","ساسكي","مادارا","غوجو","تانجيرو","كيلوا","كورابيكا",
      "ميكاسا","ليفاي","ايرين","لايت","شينرا","ادوارد","ديث نوت","بليتش","كود","بايثون",
      "جافا","كمبيوتر","لابتوب","جوال","انترنت","شبكة","موقع","تطبيق","لعبة","مغامرة",
      "تحدي","مسابقة","تفكير","تركيز","إجابة","سؤال","حروف","كلمة","لغة","كتاب",
      "قلم","مدرسة","جامعة","علم","شمس","قمر","نجمة","سماء","بحر","جبل","نهر",
      "صحراء","مدينة","قرية","سيارة","طائرة","سفينة","دراجة","طريق","بيت"
    ];
    const decomposition = [
      "مستشفى","مكتبة","حديقة","مطار","محطة","متحف","ملعب","مصباح","نافذة","مرآة",
      "طاولة","حقيبة","مفتاح","ساعة","حاسوب","تفاحة","برتقال","فراولة","موز","رمان",
      "زرافة","سلحفاة","دلفين","فيل","اسد","نمر","ذئب","حصان","ارنب","صقر",
      "طبيب","مهندس","معلم","طيار","شرطي","نجار","خباز","مزارع","رسام","طباخ",
      "مملكة","جزيرة","غابة","سحابة","مطر","ثلج","رياح","برق","رعد","محيط",
      "سعادة","شجاعة","صداقة","محبة","امانة","مغامرة","بطولة","قوة","نبات","حكمة",
      "موسيقى","كاميرا","صورة","فيديو","شاشة","روبوت","برنامج","ملف","مجلد","بيانات"
    ];
    const anime = [
      ["من هو بطل أنمي ناروتو؟",["ناروتو"]],
      ["ما اسم قرية ناروتو؟",["كونوها","قرية الورق"]],
      ["من هو والد ناروتو؟",["ميناتو","ميناتو ناميكازي"]],
      ["من هو معلم الفريق السابع؟",["كاكاشي","كاكاشي هاتاكي"]],
      ["من هو بطل ون بيس؟",["لوفي","مونكي دي لوفي"]],
      ["من هو سياف طاقم قبعة القش؟",["زورو","رورونوا زورو"]],
      ["من هو الطباخ في طاقم لوفي؟",["سانجي"]],
      ["من هو بطل ديمون سلاير؟",["تانجيرو","تانجيرو كامادو"]],
      ["ما اسم أخت تانجيرو؟",["نيزوكو"]],
      ["من هو ملك اللعنات في جوجوتسو كايسن؟",["سكونا","ريومن سكونا"]],
      ["من هو بطل هنتر × هنتر؟",["غون","غون فريكس"]],
      ["من هو أفضل صديق لغون؟",["كيلوا","كيلوا زولديك"]],
      ["من هو بطل ديث نوت؟",["لايت","لايت ياغامي"]],
      ["من هو المحقق الشهير في ديث نوت؟",["ال","L"]],
      ["من هو بطل هجوم العمالقة؟",["ايرين","ايرين ييغر"]],
      ["من هي أخت إيرين بالتبني؟",["ميكاسا"]],
      ["من هو بطل دراغون بول؟",["غوكو","سون غوكو"]],
      ["من هو أمير الساياجين؟",["فيجيتا"]],
      ["من هو صاحب تقنية اللانهائية؟",["غوجو","ساتورو غوجو"]],
      ["ما اسم أخ ساسكي؟",["ايتاتشي","إيتاتشي"]]
    ];
    const seedQuestions = async (gameName, rows) => {
      const count = await pool.query("SELECT COUNT(*)::int AS n FROM game_questions WHERE game_name=$1",[gameName]);
      if (Number(count.rows[0].n) > 0) return;
      for (const row of rows) {
        await pool.query(
          "INSERT INTO game_questions(game_name,question,image,caption,answers) VALUES($1,$2,NULL,NULL,$3::jsonb)",
          [gameName,row[0],JSON.stringify(row[1])]
        );
      }
    };
    await seedQuestions("كلمات",words.map(word=>[`• اكتب كلمة ~ ${word}`,[word]]));
    await seedQuestions("تفكيك",decomposition.map(word=>[`• فكك كلمة ~ ${word}`,[word.split("").join(" ")]]));
    await seedQuestions("انمي",anime);
\n    console.log("Games manager schema is ready.");
  })().catch(error => { ready = null; throw error; });
  return ready;
}
