import { ensureDartsSchema } from "./darts-schema.js";
import crypto from "node:crypto";

const fail = (message) => Object.assign(new Error(message), { status: 400 });
const safeName = (value, fallback = "مستخدم") => String(value || fallback).trim().replace(/\\s+/g, " ").slice(0, 80) || fallback;
const json = (value) => typeof value === "string" ? JSON.parse(value) : value || {};

function verify(initData, token) {
  if (!initData || !token) throw fail("افتح اللعبة من داخل تيليجرام أولاً");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw fail("تعذر التحقق من حساب تيليجرام");
  params.delete("hash");
  const check = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join("\\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const expected = crypto.createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(hash, "hex"), b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw fail("بيانات تيليجرام غير صالحة");
  const authDate = Number(params.get("auth_date") || 0), now = Date.now() / 1000;
  if (!authDate || authDate > now + 30 || now - authDate > 3600) throw fail("انتهت صلاحية الجلسة، افتح اللعبة مجددًا");
  let user;
  try { user = JSON.parse(params.get("user") || "{}"); } catch { throw fail("بيانات جلسة تيليجرام غير صالحة"); }
  if (!user.id) throw fail("لم أستطع تحديد حسابك");
  return user;
}

function publicLobby(row, uid, imageUrl) {
  const count = Number(row.player_count);
  const players = [{ id: Number(row.creator_id), name: safeName(row.creator_name) }];
  for (let i = 2; i <= count; i++) {
    if (row[`player${i}_id`] != null) players.push({ id: Number(row[`player${i}_id`]), name: safeName(row[`player${i}_name`]) });
  }
  return {
    id: String(row.id).replace(/-/g, ""), game_type: row.game_type, status: row.status,
    creator_id: Number(row.creator_id), player_count: count, team_mode: row.team_mode,
    players, is_creator: Number(uid) === Number(row.creator_id),
    is_joined: players.some(p => p.id === Number(uid)),
    game_id: row.game_id ? String(row.game_id).replace(/-/g, "") : null,
    image_url: imageUrl || null,
  };
}

export function registerOnlineLobbyRoutes(app, pool, token) {
  app.post("/api/online/lobby", async (req, res) => {
    const client = await pool.connect();
    try {
      const user = verify(req.body?.initData, token);
      const uid = Number(user.id), action = String(req.body?.action || "state"), settings = req.body?.settings || {};
      const rawId = String(req.body?.lobby_id || req.body?.game_id || "").replace(/-/g, "");
      if (!/^[0-9a-f]{32}$/i.test(rawId)) throw fail("رابط الغرفة غير صالح");
      await client.query("BEGIN");
      let q = await client.query("SELECT * FROM online_game_lobbies WHERE id=$1 FOR UPDATE", [rawId]);
      let lobby = q.rows[0];
      if (!lobby) throw fail("الغرفة غير موجودة");

      if (action === "join") {
        if (lobby.status !== "pending") throw fail("الغرفة لم تعد تستقبل لاعبين");
        const ids = [lobby.creator_id, lobby.player2_id, lobby.player3_id, lobby.player4_id];
        if (!ids.some(id => id != null && Number(id) === uid)) {
          const slot = ids.findIndex((id, index) => index > 0 && id == null);
          if (slot < 0 || slot >= Number(lobby.player_count)) throw fail("اكتمل عدد اللاعبين");
          await client.query(`UPDATE online_game_lobbies SET player${slot + 1}_id=$2,player${slot + 1}_name=$3,updated_at=NOW() WHERE id=$1`, [rawId, uid, safeName(settings.name || [user.first_name,user.last_name].filter(Boolean).join(" ") || user.username)]);
        }
      } else if (action === "configure") {
        if (uid !== Number(lobby.creator_id)) throw fail("الإعدادات لصاحب الغرفة فقط");
        if (lobby.status !== "pending") throw fail("لا يمكن تغيير الإعدادات بعد بدء اللعبة");
        const count = Number(settings.player_count || 2), mode = String(settings.team_mode || "individual");
        if (lobby.game_type === "dots") {
          if (![2,3,4].includes(count)) throw fail("اختر لاعبين أو ثلاثة أو أربعة");
          if (!["individual","teams"].includes(mode) || (count !== 4 && mode !== "individual")) throw fail("نظام الفرق متاح لأربعة لاعبين فقط");
        } else if (count !== 2 || mode !== "individual") throw fail("هذه اللعبة تدعم لاعبين فقط");
        await client.query(`UPDATE online_game_lobbies SET player_count=$2,team_mode=$3,player2_id=NULL,player2_name=NULL,player3_id=NULL,player3_name=NULL,player4_id=NULL,player4_name=NULL,creator_joined=FALSE,updated_at=NOW() WHERE id=$1`, [rawId,count,mode]);
      } else if (action === "leave") {
        if (lobby.status !== "pending") throw fail("لا يمكن مغادرة الغرفة بعد بدء اللعبة");
        if (uid === Number(lobby.creator_id)) await client.query("UPDATE online_game_lobbies SET status='cancelled',updated_at=NOW() WHERE id=$1",[rawId]);
        else for (let i=2;i<=4;i++) if (lobby[`player${i}_id`] != null && Number(lobby[`player${i}_id`])===uid) {
          await client.query(`UPDATE online_game_lobbies SET player${i}_id=NULL,player${i}_name=NULL,updated_at=NOW() WHERE id=$1`,[rawId]); break;
        }
      } else if (action === "start") {
        if (uid !== Number(lobby.creator_id)) throw fail("بدء اللعبة لصاحب الغرفة فقط");
        if (lobby.status !== "pending") throw fail("الغرفة بدأت أو انتهت");
        const count=Number(lobby.player_count), ids=[lobby.creator_id,lobby.player2_id,lobby.player3_id,lobby.player4_id].slice(0,count);
        if (ids.some(id=>id==null)) throw fail("لا يمكن البدء قبل اكتمال عدد اللاعبين");
        const names=[safeName(lobby.creator_name),...ids.slice(1).map((_,i)=>safeName(lobby[`player${i+2}_name`]))];
        const gameId=crypto.randomUUID();
        if (lobby.game_type === "darts") await ensureDartsSchema(pool);
        if (lobby.game_type === "connect") {
          const board=Array.from({length:6},()=>Array(7).fill(0));
          await client.query(`INSERT INTO connect4_games(id,user_id,player2_id,difficulty,board,game_mode,chat_id,player1_name,player2_name,turn_player_id,wager,wager_settled)
            VALUES($1,$2,$3,'متوسط',$4::jsonb,'human',$5,$6,$7,$2,0,TRUE)`,
            [gameId,Number(ids[0]),Number(ids[1]),JSON.stringify(board),Number(lobby.chat_id||0),names[0],names[1]]);
        } else if (lobby.game_type === "dots" || lobby.game_type === "memory") {
          let state;
          if (lobby.game_type === "dots") {
            const size=count===2?4:count===3?5:6;
            state={h:Array.from({length:size+1},()=>Array(size).fill(0)),v:Array.from({length:size},()=>Array(size+1).fill(0)),boxes:Array.from({length:size},()=>Array(size).fill(0)),scores:Array(count).fill(0),multi_player_ids:ids.map(Number),multi_player_names:names,player_count:count,team_mode:count===4?lobby.team_mode:"individual",board_size:size,turn_index:0,online_free:true};
          } else {
            state={sequence:Array.from({length:3},()=>Math.floor(Math.random()*4)),level:3,progress:0,round_successes:[],starter_id:Number(ids[0]),online_free:true};
          }
          await client.query(`INSERT INTO mini_game_challenges(id,game_type,chat_id,player1_id,player1_name,player2_id,player2_name,player3_id,player3_name,player4_id,player4_name,wager,status,turn_player_id,game_state,wager_settled)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,'playing',$4,$12::jsonb,TRUE)`,
            [gameId,lobby.game_type,Number(lobby.chat_id||0),Number(ids[0]),names[0],Number(ids[1]),names[1],count>=3?Number(ids[2]):null,count>=3?names[2]:null,count>=4?Number(ids[3]):null,count>=4?names[3]:null,JSON.stringify(state)]);
        } else if (lobby.game_type === "darts") {
          const startingScore = 300;
          await client.query(
            `INSERT INTO darts_games
              (id,lobby_id,red_player_id,red_player_name,blue_player_id,blue_player_name,
               starting_score,red_score,blue_score,phase,active_side,round,status)
             VALUES($1,$2,$3,$4,$5,$6,$7,$7,$7,'turn_intro','red',1,'playing')`,
            [gameId, rawId, Number(ids[0]), names[0], Number(ids[1]), names[1], startingScore]
          );
          await client.query(
            "INSERT INTO darts_game_events(game_id,payload) VALUES($1,$2::jsonb)",
            [gameId, JSON.stringify({
              type: "state_sync", phase: "turn_intro", activeSide: "red",
              redScore: startingScore, blueScore: startingScore,
              redName: names[0], blueName: names[1], round: 1, lockedX: 0
            })]
          );
        } else throw fail("نوع اللعبة غير معروف");
        await client.query("UPDATE online_game_lobbies SET status='playing',game_id=$2,updated_at=NOW() WHERE id=$1",[rawId,gameId]);
      } else if (action !== "state") throw fail("طلب غير معروف");

      q=await client.query("SELECT * FROM online_game_lobbies WHERE id=$1",[rawId]);
      lobby=q.rows[0];
      await client.query("COMMIT");
      const image=await pool.query("SELECT photo_file_id FROM online_game_images WHERE game_type=$1",[lobby.game_type]).catch(()=>({rows:[]}));
      const photo=image.rows[0]?.photo_file_id;
      res.json({ok:true,result:publicLobby(lobby,uid,photo?"/tg-file/"+encodeURIComponent(photo):null)});
    } catch(error) {
      try { await client.query("ROLLBACK"); } catch {}
      res.status(error.status||500).json({ok:false,error:error.message||"تعذر تنفيذ طلب الغرفة"});
    } finally { client.release(); }
  });
}
