import { getRankLevel } from "../ranks.js";
import { addPoints } from "../points.js";
import { getBigGame, lockBigGame, unlockBigGame } from "./big-game-lock.js";

export const activePenaltyGames = new Map();
const TURN_TIME=30000, WIN_POINTS=50;
const READY_IMAGES={"red":"AgACAgQAAxkBAAICQWrwgQ9V5SFgbCr0TH5yBUIvliGdAAIyD2sb8AyJU1PPTkWK9jLnAQADAgADeQADPQQ","blue":"AgACAgQAAxkBAAICRGrwggKPr3jUz2UoWcR4QZhWkDwpAAIzD2sb8AyJU_E_9KsKbdRWAQADAgADeQADPQQ"};
const RESULT_IMAGES={"red|يسار|يسار":"AgACAgQAAxkBAAICOWrwgJFDFWLLOHPGbGa6GgrOem7dAAIuD2sb8AyJU2xsgzSzxPWOAQADAgADeQADPQQ","red|يسار|وسط":"AgACAgQAAxkBAAICIGrwfdQVvp6bmLLOdwPD8v0m6QPNAAInD2sb8AyJU4KjQ3TdZr2yAQADAgADeQADPQQ","red|يسار|يمين":"AgACAgQAAxkBAAICO2rwgLJpryqOc3jv6QteQRD4hju7AAIvD2sb8AyJU9fLR0mO06krAQADAgADeQADPQQ","red|وسط|يسار":"AgACAgQAAxkBAAICM2rwf-9dlLzv7EAadoTGqDBdbb8CAAIrD2sb8AyJU4vgHB_slYWsAQADAgADeQADPQQ","red|وسط|وسط":"AgACAgQAAxkBAAICPWrwgM3V_GOgOeq-4J8ssvSunAxwAAIwD2sb8AyJU4mAY58Qkck0AQADAgADeQADPQQ","red|وسط|يمين":"AgACAgQAAxkBAAICN2rwgENwpN4v_xJKP9vE1kj3-tPaAAItD2sb8AyJU5MRbaFHUW4pAQADAgADeQADPQQ","red|يمين|يسار":"AgACAgQAAxkBAAICI2rwflgGWA7kAtS2GVfUPBqZ7uYfAAIoD2sb8AyJU37pfcFF22X8AQADAgADeQADPQQ","red|يمين|وسط":"AgACAgQAAxkBAAICNWrwgBXJ0U4PNc9C68jiaQkx6h-SAAIsD2sb8AyJU2m1tsd3W8o6AQADAgADeQADPQQ","red|يمين|يمين":"AgACAgQAAxkBAAICP2rwgO7OPDhsTWXjh0WDP0TvPSoEAAIxD2sb8AyJU7Q_0aiuTBIMAQADAgADeQADPQQ","blue|يسار|يسار":"AgACAgQAAxkBAAICVmrwg9BMZo_O0klQKpfYe4pgYbSsAAI-D2sb8AyJU-djiS1xQl0NAQADAgADeQADPQQ","blue|يسار|وسط":"AgACAgQAAxkBAAICRmrwgh4laErQZu_e5KmifBPqzMfnAAI0D2sb8AyJU4ttGXMOHnDMAQADAgADeQADPQQ","blue|يسار|يمين":"AgACAgQAAxkBAAICUmrwguS9B65vj44ETcKYdi6moApRAAI8D2sb8AyJUzwlwJDUwM2LAQADAgADeQADPQQ","blue|وسط|يسار":"AgACAgQAAxkBAAICSmrwgmfnxwHmi4rKsuvO_DDOQLDPAAI3D2sb8AyJU3XNYMaiGWcLAQADAgADeQADPQQ","blue|وسط|وسط":"AgACAgQAAxkBAAICTGrwgocMxm30RugYetJwrMszfRlHAAI4D2sb8AyJU72uLyf9KzHxAQADAgADeQADPQQ","blue|وسط|يمين":"AgACAgQAAxkBAAICSGrwgj1IpJWoTlKRdmqjLkqf7-SRAAI1D2sb8AyJU-AmXmZDBgF4AQADAgADeQADPQQ","blue|يمين|يسار":"AgACAgQAAxkBAAICVGrwgwnaKG8Ed9befVTpVzGdKOKGAAI9D2sb8AyJU-6mtQ86bc-JAQADAgADeQADPQQ","blue|يمين|وسط":"AgACAgQAAxkBAAICUGrwgsRQf-zMwtHFL8T6ZS0s3OXfAAI6D2sb8AyJUw-G9XNNIM9CAQADAgADeQADPQQ","blue|يمين|يمين":"AgACAgQAAxkBAAICTmrwgqb7CI5ZudMxHUTS4Na-aBn5AAI5D2sb8AyJUwqMG_1k73adAQADAgADeQADPQQ"};
const DIRECTIONS={"يسار":"👈🏻","وسط":"🎯","يمين":"👉🏻"};
const teamLabel=t=>t==="red"?"الأحمر 🔴":"الأزرق 🔵";
const playerName=u=>u?(u.last_name?u.first_name+" "+u.last_name:(u.first_name||"مستخدم")):"مستخدم";
const admin=async(id,chat)=>await getRankLevel(id,chat)>0;
function cancel(game,key){if(game[key])clearTimeout(game[key]);game[key]=null;}
function cancelKickTasks(g){cancel(g,"shooterTask");cancel(g,"goalieTask");}
function keyboard(chatId){return {inline_keyboard:[[{text:"يسار 👈🏻",callback_data:"penalty:direction:"+chatId+":يسار"},{text:"وسط 🎯",callback_data:"penalty:direction:"+chatId+":وسط"},{text:"يمين 👉🏻",callback_data:"penalty:direction:"+chatId+":يمين"}]]};}
async function startPenalty(ctx){
 if(ctx.chat?.type==="private"){await ctx.reply("❌ لعبة البلنتيات تبدأ من القروب.");return true;}
 if(!["group","supergroup"].includes(ctx.chat?.type))return false;
 if(!(await admin(ctx.from.id,ctx.chat.id))){await ctx.reply("❌ هذا الأمر للرتب فقط.");return true;}
 const active=getBigGame(ctx.chat.id);
 if(active){await ctx.reply("❌ فيه لعبة شغالة حاليًا!: "+active.name+"\n\n🛑 أنهِ اللعبة الحالية أولًا قبل بدء لعبة أخرى.");return true;}
 const g={statsGameKey:String(Date.now())+"-"+Math.random(),players:new Map(),order:[],phase:"registration",
 red:{shooters:[],goalies:[]},blue:{shooters:[],goalies:[]},shootIndex:{red:0,blue:0},goalieIndex:{red:0,blue:0},
 score:{red:0,blue:0},kickNumber:1,currentTeam:"red",currentShooter:null,currentGoalie:null,shooterChoice:null,goalieChoice:null,
 shooterReady:false,goalieReady:false,readyMessageId:null,shooterTask:null,goalieTask:null,resolving:false,manualMessageId:null,usedPlayers:new Set()};
 if(!lockBigGame(ctx.chat.id,"penalties","البلنتيات ⚽"))return true;
 activePenaltyGames.set(ctx.chat.id,g);
 await ctx.reply("⚽️ تم بدء لعبة البلنتيات 🥅\n\n• للانضمام اكتب: دخول\n• للبدء اكتب: ابدا");
 return true;
}
export async function joinPenaltyGame(ctx){
 const g=activePenaltyGames.get(ctx.chat?.id);if(!g||g.phase!=="registration")return false;
 const u=ctx.from;if(g.players.has(u.id)){await ctx.reply("❌ أنت داخل اللعبة بالفعل يا "+playerName(u)+".");return true;}
 g.players.set(u.id,u);g.order.push(u.id);
 await ctx.reply("انضم "+playerName(u)+" ⚽ (العدد: "+g.players.size+")");return true;
}
export async function distributePenalties(ctx){
 const chatId=ctx.chat?.id,g=activePenaltyGames.get(chatId);if(!g)return false;
 if(!(await admin(ctx.from.id,chatId)))return true;
 if(g.phase!=="registration")return true;
 if(g.players.size<2){await ctx.reply("❌ يجب أن يكون هناك لاعبان على الأقل.");return true;}
 await ctx.reply("🛡️ توزيع فرق مباراة البلنتيات (أحمر ضد أزرق)\nيا "+playerName(ctx.from)+"، كيف تبي نوزّع اللاعبين؟",{reply_markup:{inline_keyboard:[[{text:"🔘 يدوي",callback_data:"penalty:distribution:"+chatId+":manual"},{text:"🔘 عشوائي",callback_data:"penalty:distribution:"+chatId+":random"}]]}});
 return true;
}
function makeRandomTeams(g){
 const ids=[...g.players.keys()];
 for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}
 if(ids.length===2){g.red.shooters=[ids[0]];g.red.goalies=[ids[0]];g.blue.shooters=[ids[1]];g.blue.goalies=[ids[1]];return;}
 const redCount=Math.ceil(ids.length/2), teams={red:ids.slice(0,redCount),blue:ids.slice(redCount)};
 for(const team of ["red","blue"]){
  const shuffled=[...teams[team]];
  for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
  if(shuffled.length===1){g[team].shooters=[shuffled[0]];g[team].goalies=[shuffled[0]];continue;}
  let goalieCount=Math.max(1,Math.floor(shuffled.length/3));if(goalieCount>=shuffled.length)goalieCount=1;
  g[team].goalies=shuffled.slice(0,goalieCount);g[team].shooters=shuffled.slice(goalieCount);
 }
}
async function randomDistribution(api,chatId){const g=activePenaltyGames.get(chatId);if(!g)return;makeRandomTeams(g);g.phase="distributed";await sendDistributionResult(api,chatId);}
async function showManualDistribution(api,chatId){
 const g=activePenaltyGames.get(chatId);if(!g)return;g.phase="manual";
 const lines=g.order.map((id,i)=>(i+1)+". "+playerName(g.players.get(id)));
 const m=await api.sendMessage(chatId,"🎯 التوزيع اليدوي لمباراة البلنتيات\n\n"+lines.join("\n")+"\n\nاستخدم:\n.احمر رقم رقم*\n.ازرق رقم رقم*\n\nضع * بجانب الرقم لجعل اللاعب حارسًا.\nمثال:\n.احمر 1 2*\n\nيعني:\n1 = مسدد\n2 = حارس");
 g.manualMessageId=m.message_id;
}
async function showManualStatus(ctx,g){
 const names=(team,role)=>g[team][role].map(id=>playerName(g.players.get(id)));
 const remaining=g.order.map((id,i)=>g.usedPlayers.has(id)?null:i+1).filter(Boolean);
 let text="📋 حالة التوزيع:\n\n🔴 الفريق الأحمر:\n🎯 المسددين: "+(names("red","shooters").join(", ")||"—")+"\n🛡️ الحراس: "+(names("red","goalies").join(", ")||"—")+"\n\n🔵 الفريق الأزرق:\n🎯 المسددين: "+(names("blue","shooters").join(", ")||"—")+"\n🛡️ الحراس: "+(names("blue","goalies").join(", ")||"—");
 if(remaining.length)text+="\n\n👥 اللاعبون المتبقون:\n"+remaining.join("\n");
 await ctx.reply(text);
}
export async function manualTeamCommand(ctx){
 const chatId=ctx.chat?.id,g=activePenaltyGames.get(chatId),text=ctx.message?.text?.trim();if(!g||g.phase!=="manual"||!text)return false;
 if(!(await admin(ctx.from.id,chatId)))return true;
 const parts=text.split(/\s+/),cmd=parts[0];if(![".احمر",".ازرق"].includes(cmd)||parts.length<2)return false;
 const team=cmd===".احمر"?"red":"blue",selected=[];
 for(const raw of parts.slice(1)){
  const isGoalie=raw.endsWith("*"),clean=isGoalie?raw.slice(0,-1):raw,number=Number(clean);
  if(!Number.isInteger(number)){await ctx.reply("❌ الرقم "+clean+" غير صحيح.");return true;}
  if(number<1||number>g.order.length){await ctx.reply("❌ لا يوجد لاعب بالرقم "+number+".");return true;}
  selected.push([g.order[number-1],isGoalie]);
 }
 for(const [id] of selected)if(g.usedPlayers.has(id)){await ctx.reply("❌ اللاعب "+playerName(g.players.get(id))+" تم توزيعه بالفعل.");return true;}
 for(const [id,isGoalie] of selected){g[team][isGoalie?"goalies":"shooters"].push(id);g.usedPlayers.add(id);}
 await showManualStatus(ctx,g);await checkManualCompletion(ctx.api,chatId);return true;
}
async function checkManualCompletion(api,chatId){
 const g=activePenaltyGames.get(chatId);if(!g)return;
 const remaining=g.order.filter(id=>!g.usedPlayers.has(id));if(remaining.length)return;
 for(const team of ["red","blue"]){
  const members=[...new Set([...g[team].shooters,...g[team].goalies])];
  if(members.length===1){g[team].shooters=[members[0]];g[team].goalies=[members[0]];}
 }
 for(const team of ["red","blue"]){
  if(!g[team].shooters.length){await api.sendMessage(chatId,"❌ لا يمكن إكمال التوزيع.\nالفريق "+teamLabel(team)+" ليس لديه مسدد.");return;}
  if(!g[team].goalies.length){await api.sendMessage(chatId,"❌ لا يمكن إكمال التوزيع.\nالفريق "+teamLabel(team)+" ليس لديه حارس.");return;}
 }
 g.phase="distributed";await sendDistributionResult(api,chatId);
}
async function sendDistributionResult(api,chatId){
 const g=activePenaltyGames.get(chatId);if(!g)return;
 const names=(team,role)=>g[team][role].map(id=>playerName(g.players.get(id))).join(", ");
 await api.sendMessage(chatId,"🎯 اكتمل توزيع مباراة البلنتيات!\n\n🔴 الفريق الأحمر:\n🎯 المسددين: "+names("red","shooters")+"\n🛡️ الحراس: "+names("red","goalies")+"\n\n🔵 الفريق الأزرق:\n🎯 المسددين: "+names("blue","shooters")+"\n🛡️ الحراس: "+names("blue","goalies")+"\n\nالأدمن يكتب .ابدا لبدء ركلات الترجيح! 🚀");
}
export async function beginPenalties(ctx){
 const chatId=ctx.chat?.id,g=activePenaltyGames.get(chatId);if(!g)return false;
 if(!(await admin(ctx.from.id,chatId)))return true;
 if(g.phase!=="distributed"){await ctx.reply("❌ لم يكتمل توزيع اللاعبين بعد.");return true;}
 g.phase="shootout";g.kickNumber=1;g.currentTeam="red";await startKick(ctx.api,chatId);return true;
}
function nextPlayer(g,team,role){const list=g[team][role],key=role==="shooters"?"shootIndex":"goalieIndex",index=g[key][team]%list.length;g[key][team]++;return list[index];}
function kickWarning(g){
 const red=g.score.red,blue=g.score.blue,team=g.currentTeam,n=g.kickNumber,shooter=playerName(g.players.get(g.currentShooter)),goalie=playerName(g.players.get(g.currentGoalie));
 if(n<=10){
  let redTaken=Math.floor((n-1)/2),blueTaken=Math.floor((n-1)/2);if(team==="blue")redTaken++;
  if(team==="red"){
   const rr=5-redTaken-1,br=5-blueTaken;
   if(red+1>blue+br)return "⚠️ *ركلة حاسمة للبطولة!* إذا سجلها *"+shooter+"*، يفوز *🔴 الفريق الأحمر* باللقب! 🏆";
   if(red+rr<=blue)return "⚠️ *ضغوط هائلة!* يجب على *"+shooter+"* التسجيل للاستمرار، إذا ضاعت أو صدها الحارس *"+goalie+"* يفوز *🔵 الفريق الأزرق* باللقب! 🏆";
  }else{
   const rr=5-redTaken,br=5-blueTaken-1;
   if(blue+1>red+rr)return "⚠️ *ركلة حاسمة للبطولة!* إذا سجلها *"+shooter+"*، يفوز *🔵 الفريق الأزرق* باللقب! 🏆";
   if(blue+br<=red)return "⚠️ *ضغوط هائلة!* يجب على *"+shooter+"* التسجيل للاستمرار، إذا ضاعت أو صدها الحارس *"+goalie+"* يفوز *🔴 الفريق الأحمر* باللقب! 🏆";
  }
 }
 if(n>10){
  if(n%2===1)return null;
  if(team==="red"){
   if(red<blue)return "⚠️ *ضغوط هائلة!* يجب على *"+shooter+"* التسجيل للاستمرار، إذا ضاعت أو صدها الحارس *"+goalie+"* يفوز *🔵 الفريق الأزرق* باللقب! 🏆";
   if(red===blue)return "⚠️ *ركلة حاسمة للبطولة!* إذا سجلها *"+shooter+"*، يفوز *🔴 الفريق الأحمر* باللقب! 🏆";
  }else{
   if(blue<red)return "⚠️ *ضغوط هائلة!* يجب على *"+shooter+"* التسجيل للاستمرار، إذا ضاعت أو صدها الحارس *"+goalie+"* يفوز *🔴 الفريق الأحمر* باللقب! 🏆";
   if(blue===red)return "⚠️ *ركلة حاسمة للبطولة!* إذا سجلها *"+shooter+"*، يفوز *🔵 الفريق الأزرق* باللقب! 🏆";
  }
 }
 return null;
}
async function startKick(api,chatId){
 const g=activePenaltyGames.get(chatId);if(!g||g.phase!=="shootout")return;
 const team=g.currentTeam,goalieTeam=team==="red"?"blue":"red";
 g.currentShooter=nextPlayer(g,team,"shooters");g.currentGoalie=nextPlayer(g,goalieTeam,"goalies");
 g.shooterChoice=null;g.goalieChoice=null;g.shooterReady=false;g.goalieReady=false;g.resolving=false;g.readyMessageId=null;
 g.shooterTask=setTimeout(()=>choiceTimeout(api,chatId,"shooter"),TURN_TIME);
 g.goalieTask=setTimeout(()=>choiceTimeout(api,chatId,"goalie"),TURN_TIME);
 await sendReadyImage(api,chatId,goalieTeam);
}
function readyCaption(g,update=false){
 const team=g.currentTeam,shooter=g.players.get(g.currentShooter),goalie=g.players.get(g.currentGoalie);
 const shooterStatus=g.shooterReady?"✅ جاهز":"⏳ ينتظر الاختيار",goalieStatus=g.goalieReady?"✅ جاهز":"⏳ ينتظر الاختيار";
 let round;
 if(update)round=Math.floor((g.kickNumber+1)/2);
 else if(g.kickNumber<=2)round=1;else if(g.kickNumber<=4)round=2;else if(g.kickNumber<=6)round=3;else if(g.kickNumber<=8)round=4;else if(g.kickNumber<=10)round=5;else round=Math.floor((g.kickNumber-1)/2);
 const kickName=g.kickNumber%2===1?"الركلة الأولى":"الركلة الثانية",sc=team==="red"?"🔴":"🔵",gc=team==="red"?"🔵":"🔴";
 let text="🎮 *الجولة "+round+" — "+kickName+" "+sc+"*\n\n🎯 المسدد: *"+playerName(shooter)+"* "+sc+" ("+shooterStatus+")\n🛡️ الحارس: *"+playerName(goalie)+"* "+gc+" ("+goalieStatus+")\n\n";
 const warning=kickWarning(g);if(warning)text+=warning+"\n\n";
 return text+"اختر الزاوية من الأزرار بالأسفل:";
}
async function sendReadyImage(api,chatId,goalieTeam){
 const g=activePenaltyGames.get(chatId);if(!g)return;
 const file=READY_IMAGES[goalieTeam];if(!file)return;
 const sent=await api.sendPhoto(chatId,file,{caption:readyCaption(g),parse_mode:"Markdown",reply_markup:keyboard(chatId)});
 g.readyMessageId=sent.message_id;
}
async function updateReadyMessage(api,chatId){
 const g=activePenaltyGames.get(chatId);if(!g||!g.readyMessageId)return;
 try{await api.editMessageCaption(chatId,g.readyMessageId,readyCaption(g,true),{parse_mode:"Markdown",reply_markup:keyboard(chatId)});}catch{}
}
async function choiceTimeout(api,chatId,role){
 const g=activePenaltyGames.get(chatId);if(!g||g.phase!=="shootout")return;
 if(role==="shooter"&&g.shooterChoice===null){g.shooterChoice="وسط";g.shooterReady=true;}
 if(role==="goalie"&&g.goalieChoice===null){g.goalieChoice="وسط";g.goalieReady=true;}
 await updateReadyMessage(api,chatId);
 if(g.shooterChoice!==null&&g.goalieChoice!==null)await resolveKick(api,chatId);
}
async function resolveKick(api,chatId){
 const g=activePenaltyGames.get(chatId);if(!g||g.phase!=="shootout"||g.resolving)return;
 g.resolving=true;
 try{
  if(g.shooterChoice===null)g.shooterChoice="وسط";if(g.goalieChoice===null)g.goalieChoice="وسط";
  g.shooterReady=true;g.goalieReady=true;cancelKickTasks(g);
  const shooter=g.players.get(g.currentShooter),goalie=g.players.get(g.currentGoalie);if(!shooter||!goalie)return;
  const shootingTeam=g.currentTeam,goalieTeam=shootingTeam==="red"?"blue":"red";
  const warning=kickWarning(g),decisive=warning?.includes("ركلة حاسمة للبطولة"),survival=warning?.includes("ضغوط هائلة");
  const goal=g.shooterChoice!==g.goalieChoice;if(goal)g.score[shootingTeam]++;
  let teaser=null;try{teaser=await api.sendMessage(chatId,"هل يسجلها المسدد؟ ام يصدها الحارس…🧤🔥");}catch{}
  await new Promise(resolve=>setTimeout(resolve,5000));
  if(teaser){try{await api.deleteMessage(chatId,teaser.message_id);}catch{}}
  const image=RESULT_IMAGES[goalieTeam+"|"+g.goalieChoice+"|"+g.shooterChoice];
  let text;
  if(goal)text="⚽ قوووول!! هدف لصالح "+playerName(shooter)+" (فريق "+(shootingTeam==="red"?"الأحمر 🔴":"الأزرق 🔵")+") 🔥\n\n🎯 المسدد سدد في "+g.shooterChoice+" "+DIRECTIONS[g.shooterChoice]+" والحارس ارتمى إلى "+g.goalieChoice+" "+DIRECTIONS[g.goalieChoice]+"!\n\n📊 النتيجة: 🔴 الأحمر "+g.score.red+" - "+g.score.blue+" الأزرق 🔵";
  else text="🧤 ياساتر صدها الحارس! مستحييل! 💥\n\n🛡️ الحارس "+playerName(goalie)+" (فريق "+(goalieTeam==="red"?"الأحمر 🔴":"الأزرق 🔵")+") تصدى للكرة في "+g.goalieChoice+" "+DIRECTIONS[g.goalieChoice]+"!\n\n📊 النتيجة: 🔴 الأحمر "+g.score.red+" - "+g.score.blue+" الأزرق 🔵";
  try{if(image)await api.sendPhoto(chatId,image,{caption:text});else await api.sendMessage(chatId,text);}catch{try{await api.sendMessage(chatId,text);}catch{}}
  if(decisive){await finishPenaltyGame(api,chatId,goal?shootingTeam:goalieTeam);return;}
  if(survival&&!goal){await finishPenaltyGame(api,chatId,goalieTeam);return;}
  const winner=getWinnerIfFinished(g);if(winner){await finishPenaltyGame(api,chatId,winner);return;}
  await api.sendMessage(chatId,"⏸️ اكتب .كمل للركلة التالية.");
 }catch(e){console.error("Penalty kick resolution:",e?.message||e);}
 finally{const current=activePenaltyGames.get(chatId);if(current&&current.phase==="shootout")current.resolving=false;}
}
function getWinnerIfFinished(g){
 const red=g.score.red,blue=g.score.blue,n=g.kickNumber;
 if(n<=10){
  let rt,bt;if(n%2===1){rt=(n+1)/2;bt=(n-1)/2;}else{rt=n/2;bt=n/2;}
  if(rt<5||bt<5)return null;if(red>blue)return "red";if(blue>red)return "blue";return null;
 }
 if(n>10&&n%2===0){if(red>blue)return "red";if(blue>red)return "blue";}
 return null;
}
export async function continuePenalties(ctx){
 const chatId=ctx.chat?.id,g=activePenaltyGames.get(chatId);if(!g)return false;
 if(!(await admin(ctx.from.id,chatId)))return true;
 if(g.phase!=="shootout")return true;
 if(g.resolving){await ctx.reply("⏳ انتظر حتى تنتهي الركلة الحالية.");return true;}
 if(g.shooterChoice===null||g.goalieChoice===null){await ctx.reply("❌ الركلة الحالية لم تنتهِ بعد.");return true;}
 const winner=getWinnerIfFinished(g);if(winner){await finishPenaltyGame(ctx.api,chatId,winner);return true;}
 g.kickNumber++;g.currentTeam=g.currentTeam==="red"?"blue":"red";await startKick(ctx.api,chatId);return true;
}
async function finishPenaltyGame(api,chatId,winner){
 const g=activePenaltyGames.get(chatId);if(!g||g.phase==="finished")return;
 g.phase="finished";cancelKickTasks(g);const loser=winner==="red"?"blue":"red";
 await api.sendMessage(chatId,"🏆 انتهت مباراة البلنتيات! 🏆\n\n🎉 الفائز: "+(winner==="red"?"🔴 الفريق الأحمر":"🔵 الفريق الأزرق")+"!\n\nالنتيجة النهائية: 🔴 الأحمر "+g.score.red+" - "+g.score.blue+" الأزرق 🔵");
 const winners=[...new Set([...g[winner].shooters,...g[winner].goalies])];
 const reward=["✨ جوائز الفريق الفائز: ✨"];
 for(const id of winners){const player=g.players.get(id);if(!player)continue;try{await addPoints(player,WIN_POINTS);}catch(e){console.error("Penalty award:",e?.message||e);}reward.push("• "+playerName(player)+" — حصل على "+WIN_POINTS+" نقطة! 🎖️");}
 try{await api.sendMessage(chatId,reward.join("\n"));}catch{}
 activePenaltyGames.delete(chatId);unlockBigGame(chatId,"penalties");
}
export async function endPenaltyGame(ctx){
 const chatId=ctx.chat?.id,g=activePenaltyGames.get(chatId);if(!g)return false;
 if(!(await admin(ctx.from.id,chatId)))return true;
 cancelKickTasks(g);activePenaltyGames.delete(chatId);unlockBigGame(chatId,"penalties");
 await ctx.reply("🛑 تم إنهاء مباراة البلنتيات.");return true;
}
export async function handlePenaltyDistributionCallback(ctx){
 const parts=(ctx.callbackQuery?.data||"").split(":");if(parts.length!==4){await ctx.answerCallbackQuery();return;}
 const chatId=Number(parts[2]),mode=parts[3],g=activePenaltyGames.get(chatId);
 if(!g){await ctx.answerCallbackQuery({text:"❌ انتهت المباراة.",show_alert:true});return;}
 if(!(await admin(ctx.from.id,chatId))){await ctx.answerCallbackQuery({text:"❌ ما عندك صلاحية.",show_alert:true});return;}
 if(g.phase!=="registration"){await ctx.answerCallbackQuery({text:"❌ انتهى وقت التوزيع.",show_alert:true});return;}
 await ctx.answerCallbackQuery();try{await ctx.deleteMessage();}catch{}
 if(mode==="random")await randomDistribution(ctx.api,chatId);else if(mode==="manual")await showManualDistribution(ctx.api,chatId);
}
export async function handlePenaltyDirectionCallback(ctx){
 const parts=(ctx.callbackQuery?.data||"").split(":");if(parts.length!==4){await ctx.answerCallbackQuery();return;}
 const chatId=Number(parts[2]),direction=parts[3],g=activePenaltyGames.get(chatId);
 if(!g){await ctx.answerCallbackQuery({text:"❌ انتهت المباراة.",show_alert:true});return;}
 if(g.phase!=="shootout"){await ctx.answerCallbackQuery({text:"❌ لا توجد ركلة حالية.",show_alert:true});return;}
 const id=ctx.from.id,shooter=g.currentShooter,goalie=g.currentGoalie;
 if(!g.players.has(id)){await ctx.answerCallbackQuery({text:"❌ انت مو بالقيم اصلا!",show_alert:true});return;}
 if(id!==shooter&&id!==goalie){await ctx.answerCallbackQuery({text:"❌ انتظر، ليس دورك!",show_alert:true});return;}
 if(id===shooter){if(g.shooterChoice!==null){await ctx.answerCallbackQuery({text:"❌ اخترت اتجاهك بالفعل.",show_alert:true});return;}g.shooterChoice=direction;g.shooterReady=true;cancel(g,"shooterTask");await ctx.answerCallbackQuery({text:"✅ تم تسجيل اختيارك."});}
 else{if(g.goalieChoice!==null){await ctx.answerCallbackQuery({text:"❌ اخترت اتجاهك بالفعل.",show_alert:true});return;}g.goalieChoice=direction;g.goalieReady=true;cancel(g,"goalieTask");await ctx.answerCallbackQuery({text:"✅ تم تسجيل اختيارك."});}
 await updateReadyMessage(ctx.api,chatId);
 if(g.shooterChoice!==null&&g.goalieChoice!==null)await resolveKick(ctx.api,chatId);
}
export async function handlePenaltyDirectionMessage(ctx){
 const direction=ctx.message?.text?.trim();if(!DIRECTIONS[direction]||!ctx.chat||!ctx.from)return false;
 const g=activePenaltyGames.get(ctx.chat.id);if(!g||g.phase!=="shootout"||g.resolving)return false;
 const id=ctx.from.id;if(id!==g.currentShooter&&id!==g.currentGoalie)return false;
 let role;
 if(id===g.currentShooter){if(g.shooterChoice!==null)return true;role="shooter";g.shooterChoice=direction;g.shooterReady=true;}
 else{if(g.goalieChoice!==null)return true;role="goalie";g.goalieChoice=direction;g.goalieReady=true;}
 try{await ctx.deleteMessage();}catch{}
 cancel(g,role==="shooter"?"shooterTask":"goalieTask");await updateReadyMessage(ctx.api,ctx.chat.id);
 if(g.shooterChoice!==null&&g.goalieChoice!==null)await resolveKick(ctx.api,ctx.chat.id);
 return true;
}
export async function handlePenaltyMessage(ctx){
 const text=ctx.message?.text?.trim();if(!text||!ctx.chat||!ctx.from)return false;
 if(text==="بلنتيات")return startPenalty(ctx);
 return false;
}
