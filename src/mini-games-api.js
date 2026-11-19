import crypto from "node:crypto";

const R=6,C=7,ORDER=[3,2,4,1,5,0,6],LEVELS=["سهل","متوسط","صعب","مستحيل"];
const TURN={dots:30,memory:90};
const err=m=>Object.assign(new Error(m),{status:400});
const dec=v=>typeof v==="string"?JSON.parse(v):v;
const ms=v=>v?new Date(v).getTime():null;

function verify(initData,token){
 if(!initData||!token)throw err("افتح اللعبة من داخل تيليجرام أولاً");
 const p=new URLSearchParams(initData),hash=p.get("hash");if(!hash)throw err("تعذر التحقق من حساب تيليجرام");
 p.delete("hash");const check=[...p.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(x=>x[0]+"="+x[1]).join("\n");
 const secret=crypto.createHmac("sha256","WebAppData").update(token).digest();
 const got=crypto.createHmac("sha256",secret).update(check).digest("hex");
 const a=Buffer.from(got,"hex"),b=Buffer.from(hash,"hex");
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw err("بيانات تيليجرام غير صالحة");
 const date=Number(p.get("auth_date")||0),now=Date.now()/1000;
 if(!date||date>now+30||now-date>3600)throw err("انتهت صلاحية الجلسة، أغلق اللعبة وافتحها مجددًا");
 let user;try{user=JSON.parse(p.get("user")||"{}");}catch{throw err("بيانات جلسة تيليجرام غير صالحة");}
 if(!user.id)throw err("لم أستطع تحديد حسابك");return user;
}
function legal(b){return ORDER.filter(c=>b[0][c]===0);}
function drop(b,c,p){for(let r=R-1;r>=0;r--)if(b[r][c]===0){b[r][c]=p;return r;}return null;}
function win(b,p){
 for(let r=0;r<R;r++)for(let c=0;c<C;c++)if(b[r][c]===p)for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){
  const cells=Array.from({length:4},(_,i)=>[r+i*dr,c+i*dc]);
  if(cells.every(([y,x])=>y>=0&&y<R&&x>=0&&x<C&&b[y][x]===p))return cells;
 }return null;
}
function windowScore(w,p){const n=w.filter(x=>x===p).length,o=w.filter(x=>x===(p===2?1:2)).length,e=w.filter(x=>x===0).length;
 if(n===4)return 100000;if(n===3&&e===1)return 120;if(n===2&&e===2)return 12;if(o===3&&e===1)return -150;if(o===2&&e===2)return -10;return 0;}
function evaluate(b){let s=b.reduce((a,row)=>a+(row[3]===2?7:0),0);
 for(let r=0;r<R;r++)for(let c=0;c<C-3;c++)s+=windowScore(b[r].slice(c,c+4),2);
 for(let c=0;c<C;c++)for(let r=0;r<R-3;r++)s+=windowScore(Array.from({length:4},(_,i)=>b[r+i][c]),2);
 for(let r=0;r<R-3;r++)for(let c=0;c<C-3;c++)s+=windowScore(Array.from({length:4},(_,i)=>b[r+i][c+i]),2);
 for(let r=3;r<R;r++)for(let c=0;c<C-3;c++)s+=windowScore(Array.from({length:4},(_,i)=>b[r-i][c+i]),2);return s;}
function minimax(b,d,a,z,max){
 const v=legal(b);if(win(b,2))return [null,1e7+d];if(win(b,1))return [null,-1e7-d];if(!v.length||!d)return [null,evaluate(b)];
 let best=max?-Infinity:Infinity,choice=v[0];
 for(const c of v){const cp=b.map(x=>x.slice());drop(cp,c,max?2:1);const score=minimax(cp,d-1,a,z,!max)[1];
  if((max&&score>best)||(!max&&score<best)){best=score;choice=c;}if(max)a=Math.max(a,best);else z=Math.min(z,best);if(a>=z)break;
 }return [choice,best];
}
function botMove(b,diff){const v=legal(b);if(!v.length)return null;
 for(const p of [2,1])for(const c of v){const cp=b.map(x=>x.slice());drop(cp,c,p);if(win(cp,p))return c;}
 if(diff==="سهل")return v[Math.floor(Math.random()*v.length)];
 if(diff==="متوسط"){const x=v.slice(0,Math.min(3,v.length));return x[Math.floor(Math.random()*x.length)];}
 return minimax(b,diff==="صعب"?4:5,-Infinity,Infinity,true)[0];
}
function connectState(row,uid){
 const b=dec(row.board),cells=dec(row.winning_cells)||[],mode=row.game_mode||"bot",first=uid==null||Number(uid)===Number(row.user_id);
 const p1=row.player1_name||"أنت",p2=row.player2_name||row.bot_name||"بوت نواف";
 return {id:String(row.id),board:b,status:mode==="human"&&row.status==="won"&&uid!=null?(Number(row.winner_id)===Number(uid)?"won":"lost"):row.status,
 difficulty:row.difficulty,last_move:row.last_move,winning_cells:cells,turn_seconds:15,turn_started_at:ms(row.turn_started_at),
 game_mode:mode,player1_name:p1,player2_name:p2,bot_name:row.bot_name||"بوت نواف",your_turn:mode==="human"&&uid!=null?Number(row.turn_player_id)===Number(uid):!row.bot_move_pending,
 bot_move_pending:!!row.bot_move_pending,my_piece:first?1:2,turn_player_id:row.turn_player_id,winner_id:row.winner_id,wager:Number(row.wager||0),
 winner_name:row.winner_id?(Number(row.winner_id)===Number(row.user_id)?p1:p2):(mode==="bot"&&row.status==="won"?"أنت":p2)};
}
function dotsStart(){return {h:Array.from({length:5},()=>Array(4).fill(0)),v:Array.from({length:4},()=>Array(5).fill(0)),boxes:Array.from({length:4},()=>Array(4).fill(0)),scores:[0,0]};}
function edges(s){const out=[],r=s.boxes.length,c=s.boxes[0].length;
 for(let y=0;y<=r;y++)for(let x=0;x<c;x++)if(!s.h[y][x])out.push({kind:"h",r:y,c:x});
 for(let y=0;y<r;y++)for(let x=0;x<=c;x++)if(!s.v[y][x])out.push({kind:"v",r:y,c:x});return out;}
function draw(s,e,p){const r=s.boxes.length,c=s.boxes[0].length,y=Number(e?.r),x=Number(e?.c),k=e?.kind;
 if(!["h","v"].includes(k)||!Number.isInteger(y)||!Number.isInteger(x)||y<0||x<0||y>=(k==="h"?r+1:r)||x>=(k==="h"?c:c+1))throw err("الحركة غير صالحة");
 if(s[k][y][x])throw err("هذا الخط مرسوم بالفعل");s[k][y][x]=p;let done=[];
 for(let a=0;a<r;a++)for(let b=0;b<c;b++)if(!s.boxes[a][b]&&s.h[a][b]&&s.h[a+1][b]&&s.v[a][b]&&s.v[a][b+1]){s.boxes[a][b]=p;s.scores[p-1]++;done.push([a,b]);}return done;}
function soloState(row){const s=dec(row.game_state)||{};return {id:String(row.id),game_type:row.game_type,difficulty:row.difficulty,status:row.status,
 your_turn:Number(row.turn_player_id)===Number(row.user_id),turn_player_id:Number(row.turn_player_id),turn_started_at:ms(row.turn_started_at),
 turn_seconds:TURN[row.game_type],player_name:"أنت",bot_name:"بوت نواف",state:s};}
async function locked(pool,sql,args,fn){const c=await pool.connect();try{await c.query("BEGIN");const q=await c.query(sql,args);if(!q.rows[0])throw err("اللعبة غير موجودة");const v=await fn(c,q.rows[0]);await c.query("COMMIT");return v;}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}}
function route(app,path,pool,token,fn){app.post(path,async(req,res)=>{try{const user=verify(req.body?.initData,token);const result=await fn(req.body||{},user);res.json({ok:true,...result});}catch(e){res.status(e.status||400).json({ok:false,error:e.message||"تعذر تنفيذ الحركة"});}});}

export function registerMiniGameRoutes(app,pool,token){
 route(app,"/api/connect4/new",pool,token,async(body,u)=>{
  const d=body.difficulty||"متوسط",r=body.rps_choice||"r";if(!LEVELS.includes(d))throw err("اختر مستوى صحيحًا");
  const choices={r:["p","s"],p:["s","r"],s:["r","p"]};if(!choices[r])throw err("اختر حجر أو ورقة أو مقص");
  const starts=Math.random()<.4,id=crypto.randomUUID(),board=Array.from({length:R},()=>Array(C).fill(0));
  const q=await pool.query("INSERT INTO connect4_games(id,user_id,difficulty,board,game_mode,bot_name,bot_move_pending) VALUES($1,$2,$3,$4::jsonb,'bot','بوت نواف',$5) RETURNING *",
   [id,u.id,d,JSON.stringify(board),starts]);
  return {game:{...connectState(q.rows[0],u.id),rps_result:starts?"bot_starts":"player_starts",rps_player_choice:r,rps_bot_choice:choices[r][starts?0:1]}};
 });
 route(app,"/api/connect4/state",pool,token,async(body,u)=>({game:await locked(pool,"SELECT * FROM connect4_games WHERE id=$1 AND (user_id=$2 OR player2_id=$2) FOR UPDATE",[body.game_id,u.id],async(c,row)=>connectState(row,u.id))}));
 route(app,"/api/connect4/move",pool,token,async(body,u)=>({game:await locked(pool,"SELECT * FROM connect4_games WHERE id=$1 AND user_id=$2 FOR UPDATE",[body.game_id,u.id],async(c,row)=>{
  if(row.game_mode!=="bot")throw err("هذه المباراة ليست ضد البوت");if(row.status!=="playing")return connectState(row,u.id);if(row.bot_move_pending)throw err("انتظر حركة البوت");
  const col=Number(body.column),b=dec(row.board);if(!Number.isInteger(col)||!legal(b).includes(col))throw err("هذا العمود غير صالح أو ممتلئ");
  drop(b,col,1);const cells=win(b,1)||[],status=cells.length?"won":legal(b).length?"playing":"draw";
  const q=await c.query("UPDATE connect4_games SET board=$2::jsonb,status=$3,last_move=$4,winning_cells=$5::jsonb,bot_move_pending=$6,turn_started_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",
   [row.id,JSON.stringify(b),status,col,JSON.stringify(cells),status==="playing"]);return connectState(q.rows[0],u.id);
 })}));
 route(app,"/api/connect4/bot-move",pool,token,async(body,u)=>({game:await locked(pool,"SELECT * FROM connect4_games WHERE id=$1 AND user_id=$2 FOR UPDATE",[body.game_id,u.id],async(c,row)=>{
  if(row.game_mode!=="bot")throw err("المباراة غير موجودة");if(row.status!=="playing"||!row.bot_move_pending)return connectState(row,u.id);
  const b=dec(row.board),col=botMove(b,row.difficulty);if(col!==null)drop(b,col,2);const cells=col===null?[]:(win(b,2)||[]),status=cells.length?"lost":legal(b).length?"playing":"draw";
  const q=await c.query("UPDATE connect4_games SET board=$2::jsonb,status=$3,last_move=$4,winning_cells=$5::jsonb,bot_move_pending=FALSE,turn_started_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",
   [row.id,JSON.stringify(b),status,col,JSON.stringify(cells)]);return connectState(q.rows[0],u.id);
 })}));
 route(app,"/api/minigames/solo/new",pool,token,async(body,u)=>{
  const type=body.game_type,d=body.difficulty||"متوسط";if(!["dots","memory"].includes(type))throw err("اللعبة غير معروفة");if(!LEVELS.includes(d))throw err("اختر مستوى صعوبة صحيحًا");
  const state=type==="dots"?dotsStart():{sequence:Array.from({length:3},()=>Math.floor(Math.random()*4)),level:3,progress:0,rounds_won:0},id=crypto.randomUUID();
  const q=await pool.query("INSERT INTO mini_game_solo(id,user_id,game_type,difficulty,turn_player_id,game_state) VALUES($1,$2,$3,$4,$2,$5::jsonb) RETURNING *",
   [id,u.id,type,d,JSON.stringify(state)]);return {result:soloState(q.rows[0])};
 });
 route(app,"/api/minigames/solo/state",pool,token,async(body,u)=>{const q=await pool.query("SELECT * FROM mini_game_solo WHERE id=$1 AND user_id=$2",[body.game_id,u.id]);if(!q.rows[0])throw err("اللعبة غير موجودة");return {result:soloState(q.rows[0])};});
 route(app,"/api/minigames/solo/action",pool,token,async(body,u)=>({result:await locked(pool,"SELECT * FROM mini_game_solo WHERE id=$1 AND user_id=$2 FOR UPDATE",[body.game_id,u.id],async(c,row)=>{
  if(row.status!=="playing")throw err("اللعبة انتهت أو غير موجودة");if(Number(row.turn_player_id)!==Number(u.id))throw err("انتظر دورك");
  const s=dec(row.game_state),a=body.action||{},expired=(Date.now()-new Date(row.turn_started_at).getTime())/1000>TURN[row.game_type];let turn=Number(u.id),status=row.status;
  if(row.game_type==="dots"){const list=edges(s);if(!list.length)return soloState(row);const edge=expired||a.automatic?list[Math.floor(Math.random()*list.length)]:a,done=draw(s,edge,1);
   if(s.scores[0]+s.scores[1]>=16)status=s.scores[0]>s.scores[1]?"won":s.scores[0]<s.scores[1]?"lost":"draw";else if(!done.length)turn=-1;
  }else if(expired)status="lost";else{const color=a.color;if(!Number.isInteger(color)||color<0||color>3)throw err("اختيار اللون غير صالح");if(color!==s.sequence[s.progress])status="lost";else{s.progress++;if(s.progress>=s.level){s.progress=0;s.rounds_won++;const chance={"سهل":.38,"متوسط":.62,"صعب":.82,"مستحيل":.96}[row.difficulty];if(Math.random()>=chance||s.level>=12)status="won";else{s.level++;s.sequence.push(Math.floor(Math.random()*4));}}}}
  const q=await c.query("UPDATE mini_game_solo SET game_state=$2::jsonb,turn_player_id=$3,status=$4,turn_started_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[row.id,JSON.stringify(s),turn,status]);return soloState(q.rows[0]);
 })}));
 route(app,"/api/minigames/solo/bot-move",pool,token,async(body,u)=>({result:await locked(pool,"SELECT * FROM mini_game_solo WHERE id=$1 AND user_id=$2 FOR UPDATE",[body.game_id,u.id],async(c,row)=>{
  if(row.status!=="playing")throw err("اللعبة انتهت");if(Number(row.turn_player_id)!==-1)return soloState(row);
  const s=dec(row.game_state);let turn=Number(u.id),status=row.status;
  if(row.game_type==="dots"){const list=edges(s);if(list.length){const e=list[Math.floor(Math.random()*list.length)];const done=draw(s,e,2);if(s.scores[0]+s.scores[1]>=16)status=s.scores[1]>s.scores[0]?"lost":s.scores[1]<s.scores[0]?"won":"draw";else if(done.length)turn=-1;}}
  const q=await c.query("UPDATE mini_game_solo SET game_state=$2::jsonb,turn_player_id=$3,status=$4,turn_started_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[row.id,JSON.stringify(s),turn,status]);return soloState(q.rows[0]);
 })}));
}
