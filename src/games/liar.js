import { getRankLevel } from "../ranks.js";
import { addPoints } from "../points.js";
import { getBigGame, lockBigGame, unlockBigGame } from "./big-game-lock.js";

export const activeLiarGames = new Map();
const DISCUSSION_MS=300000, VOTE_MS=60000, GUESS_MS=30000;
const MIN_PLAYERS=3, CORRECT_VOTE_POINTS=40, LIAR_CAUGHT_GUESS_POINTS=20, LIAR_FREE_GUESS_POINTS=40;
const WORD_  ["ذيب", "أسد"],
  ["خنزير", "بقرة"],
  ["حصان", "جمل"],
  ["فيل", "زرافة"],
  ["قرد", "غوريلا"],
  ["نمر", "فهد"],
  ["دب", "ثعلب"],
  ["أرنب", "سلحفاة"],
  ["تمساح", "قرش"],
  ["حوت", "دلفين"],
  ["غراب", "صقر"],
  ["بومة", "نسر"],
  ["نحلة", "فراشة"],
  ["نملة", "عنكبوت"],
  ["دجاجة", "بط"],
  ["ماعز", "خروف"],
  ["حمار", "حصان"],
  ["قطوة", "كلب"],
  ["تفاح", "موز"],
  ["برتقال", "تفاح"],
  ["بطيخ", "شمام"],
  ["عنب", "كرز"],
  ["فراولة", "توت"],
  ["مانجو", "أناناس"],
  ["ليمون", "برتقال"],
  ["خوخ", "شمام"],
  ["رمان", "تين"],
  ["كيوي", "جوافة"],
  ["بيتزا", "برجر"],
  ["كبسة", "برياني"],
  ["شاورما", "فلافل"],
  ["مكرونة", "أرز"],
  ["دجاج", "لحم"],
  ["بطاطس", "ذرة"],
  ["حلا اوريو", "دونات"],
  ["آيس كريم", "شوكولاتة"],
  ["شوربة", "سلطة"],
  ["بيض", "جبن"],
  ["قهوة", "عصير"],
  ["شاي", "قهوة"],
  ["حليب", "ماء"],
  ["ليمون", "برتقال"],
  ["مشروب غازي", "ماء"],
  ["لابتوب", "آيباد"],
  ["جوال", "تلفزيون"],
  ["آيفون", "سامسونج"],
  ["كمبيوتر", "بلايستيشن"],
  ["سماعة", "ميكروفون"],
  ["كيبورد", "ماوس"],
  ["كاميرا", "جوال"],
  ["سيارة", "طائرة"],
  ["قطار", "حافلة"],
  ["سفينة", "طائرة"],
  ["سيكل", "سيارة"],
  ["تاكسي", "حافلة"],
  ["دباب", "سيارة"],
  ["كرة قدم", "كرة سلة"],
  ["تنس", "بادل"],
  ["سباحة", "جري"],
  ["كرة طائرة", "كرة سلة"],
  ["قولف", "تنس"],
  ["بلايستيشن", "إكس بوكس"],
  ["روكيت ليق", "فيفا"],
  ["ماينكرافت", "روبلوكس"],
  ["فورتنايت", "ببجي"],
  ["جوال", "بلايستيشن"],
  ["لعبة", "فيلم"],
  ["بيت", "مدرسة"],
  ["غرفة", "مطبخ"],
  ["سرير", "كنبة"],
  ["طاولة", "كرسي"],
  ["ثلاجة", "فرن"],
  ["تلفزيون", "كمبيوتر"],
  ["باب", "نافذة"],
  ["مصباح", "مروحة"],
  ["حمام", "مطبخ"],
  ["حديقة", "سطح"],
  ["ثوب", "بدلة"],
  ["قبعة", "شماغ"],
  ["شرَّابات", "قفازات"],
  ["نظارة", "ساعة"],
  ["مدرسة", "جامعة"],
  ["مطعم", "مقهى"],
  ["شاطئ", "منتزه"],
  ["ملعب", "نادي"],
  ["سينما", "مسرح"],
  ["بحر", "نهر"],
  ["صحراء", "غابة"],
  ["شمس", "قمر"],
  ["مطر", "ثلج"],
  ["برق", "رعد"],
  ["شجرة", "زهرة"],
  ["نخلة", "شجرة"],
  ["نار", "ماء"],
  ["كتاب", "دفتر"],
  ["سبورة", "شاشة"],
  ["معلم", "طالب"],
  ["اختبار", "واجب"],
  ["رياضيات", "علوم"],
  ["جامعة", "مدرسة"],
  ["جواز سفر", "تذكرة"],
  ["مطار", "فندق"],
  ["سيارة", "طائرة"],
  ["معلم", "مهندس"],
  ["محامي", "قاضي"],
  ["طيار", "سائق"],
  ["مبرمج", "مصمم"],
  ["محفظة", "حقيبة"],
  ["ساعة", "جوال"],
  ["قلم", "فرشاة"],
  ["كرسي", "طاولة"],
  ["سرير", "وسادة"],
  ["فيلم", "مسلسل"],
  ["أغنية", "بودكاست"],
  ["مغني", "ممثل"],
  ["يوتيوب", "تيك توك"],
  ["كتاب", "فيلم"],
  ["رواية", "قصة"],
  ["الرياض", "جدة"],
  ["لندن", "باريس"],
  ["السعودية", "الإمارات"],
  ["تركيا", "اليونان"],
  ["ذهب", "فضة"],
  ["صيف", "شتاء"],
  ["بحر", "سماء"]=[
PAIRS
];
const norm=v=>String(v||"").trim().toLowerCase().replace(/[\u064B-\u065F\u0670]/g,"").replace(/[أإآ]/g,"ا").replace(/ة/g,"ه").replace(/ى/g,"ي").replace(/\s+/g," ");
const mention=u=>"["+(u?.first_name||"مستخدم")+"](tg://user?id="+u.id+")";
const stop=(g,k)=>{if(g[k])clearTimeout(g[k]);g[k]=null;};
const lobbyMarkup=()=>({inline_keyboard:[[{text:"🎮 دخول",callback_data:"liar:join"},{text:"🚪 خروج",callback_data:"liar:leave"}]]});
function lobbyText(g){const p=[...g.players.values()];let t="🕵️ **لعبة الكذاب**\n\n🎮 اكتب للانضمام إلى اللعبة.\n🚪 يمكنك الخروج قبل بدء اللعبة.\n\n👥 عدد اللاعبين: **"+p.length+"**\n";if(p.length<3)t+="\n⚠️ الحد الأدنى لبدء اللعبة: **3 لاعبين**";t+="\n\n";if(p.length)t+="👥 **اللاعبون:**\n"+p.map((u,i)=>(i+1)+". "+mention(u)+"\n").join("");return t;}
function optionsFor(correct){const n=norm(correct),c=[...new Set(WORD_PAIRS.flat().filter(w=>norm(w)!==n))];for(let i=c.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[c[i],c[j]]=[c[j],c[i]];}const a=[correct];for(const w of c){if(!a.includes(w))a.push(w);if(a.length===7)break;}for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function voteMarkup(g,id){const b=[...g.players.entries()].filter(([uid])=>uid!==id&&!g.eliminated.has(uid)).map(([uid,u])=>({text:u.first_name||"مستخدم",callback_data:"liar_vote:"+uid}));const rows=[];for(let i=0;i<b.length;i+=2)rows.push(b.slice(i,i+2));return {inline_keyboard:rows};}
async function award(id,n){try{await addPoints({id,is_bot:false},n);}catch(e){console.error("Liar points:",e?.message||e);}}
async function updateLobby(api,g){try{await api.editMessageText(g.chatId,g.lobbyMessageId,lobbyText(g),{parse_mode:"Markdown",reply_markup:lobbyMarkup()});}catch{}}
async function openLobby(ctx){
 if(!["group","supergroup"].includes(ctx.chat?.type)){await ctx.reply("❌ اللعبة تعمل داخل القروبات فقط.");return true;}
 const active=getBigGame(ctx.chat.id);if(active){await ctx.reply("❌ فيه لعبة شغالة حاليًا!: "+active.name+"\n\n🛑 أنهِ اللعبة الحالية أولًا قبل بدء لعبة أخرى.");return true;}
 const g={chatId:ctx.chat.id,players:new Map(),started:false,phase:"lobby",liarId:null,baseWord:null,liarWord:null,votes:new Map(),eliminated:new Set(),guessSelected:false,guessResult:null,liarCaught:false,lobbyMessageId:null,discussionTimer:null,voteTimer:null,guessTimer:null};
 if(!lockBigGame(g.chatId,"liar","الكذاب 🎭"))return true;
 activeLiarGames.set(g.chatId,g);
 try{const m=await ctx.reply(lobbyText(g),{parse_mode:"Markdown",reply_markup:lobbyMarkup()});g.lobbyMessageId=m.message_id;}catch(e){activeLiarGames.delete(g.chatId);unlockBigGame(g.chatId,"liar");throw e;}
 return true;
}
export async function joinLiarGame(ctx){const g=activeLiarGames.get(ctx.chat?.id);if(!g||g.started)return false;const u=ctx.from;if(g.players.has(u.id)){await ctx.reply("⚠️ أنت داخل اللعبة بالفعل.");return true;}g.players.set(u.id,u);await ctx.reply("✅ انضم "+mention(u)+" إلى لعبة الكذاب!\n👥 العدد: **"+g.players.size+"**",{parse_mode:"Markdown"});await updateLobby(ctx.api,g);return true;}
export async function leaveLiarGame(ctx){const g=activeLiarGames.get(ctx.chat?.id);if(!g||g.started)return false;const u=ctx.from;if(!g.players.has(u.id)){await ctx.reply("❌ أنت لست داخل اللعبة.");return true;}g.players.delete(u.id);await ctx.reply("🚪 خرج "+mention(u)+" من اللعبة.",{parse_mode:"Markdown"});await updateLobby(ctx.api,g);return true;}
async function startRound(ctx,g){
 const ids=[...g.players.keys()];g.started=true;g.phase="preparing";const unavailable=[];
 for(const id of ids){try{await ctx.api.sendChatAction(id,"typing");}catch{unavailable.push(id);}}
 if(unavailable.length){g.started=false;g.phase="lobby";await ctx.api.sendMessage(g.chatId,"⚠️ لا يمكن بدء لعبة الكذاب حاليًا.\n\nالأشخاص التاليون لم يبدأوا البوت في الخاص:\n\n"+unavailable.map(id=>mention(g.players.get(id))).join("\n")+"\n\n📩 كل لاعب منهم يرسل للبوت /start في الخاص، ثم يعيد الأدمن كتابة .ابدا.",{parse_mode:"Markdown"});return;}
 const pair=WORD_PAIRS[Math.floor(Math.random()*WORD_PAIRS.length)];g.baseWord=pair[0];g.liarWord=pair[1];g.liarId=ids[Math.floor(Math.random()*ids.length)];g.phase="discussion";
 for(const id of ids){const liar=id===g.liarId,w=liar?g.liarWord:g.baseWord;const msg=liar?"🕵️ **أنت الكذاب!**\n\n🔐 كلمتك السرية: **"+w+"**\n\n⚠️ حاول تندمج مع اللاعبين ولا تخليهم يعرفون أنك الكذاب.\n💬 جاوب على أسئلتهم بطريقة ذكية.\n\nوفي نهاية التصويت قد تحصل على فرصة لتخمين كلمة الأبرياء.":"🤫 **كلمتك السرية**\n\n🔐 كلمتك هي: **"+w+"**\n\n⚠️ لا ترسل الكلمة نفسها في القروب.\n💬 صف كلمتك وأجب على أسئلة اللاعبين بدون ذكرها مباشرة.\n\n🕵️ يوجد لاعب واحد حصل على كلمة مختلفة، وهو الكذاب.";try{await ctx.api.sendMessage(id,msg,{parse_mode:"Markdown"});}catch{}}
 const text="🕵️ **بدأت لعبة الكذاب!**\n\n👥 عدد اللاعبين: **"+ids.length+"**\n\n🔐 تم إرسال كلمة سرية لكل لاعب في الخاص.\n\n💬 **الآن تبدأ مرحلة النقاش!**\n\nيسأل اللاعبون بعضهم البعض عن كلماتهم، ويحاول كل لاعب معرفة من يملك الكلمة المختلفة.\n\n❓ مثال على الأسئلة:\n• هل الكلمة حقتك لها أكثر من لون؟\n• هل نستخدمها داخل البيت؟\n\n⚠️ **ممنوع ذكر الكلمة نفسها بشكل مباشر.**\nحاول توصفها بطريقة تساعد فريقك بدون ما تكشفها للكذاب.\n\n🚨 إذا أرسلت كلمتك السرية نفسها في القروب، سيتم استبعادك من الجولة وتحصل على **0 نقطة**.\n\n⏱️ وقت النقاش: **5 دقائق**\n\n🗳️ بعد انتهاء النقاش يبدأ التصويت تلقائيًا.\n👑 الأدمن يقدر ينهي النقاش ويبدأ التصويت مباشرة بـ .التصويت";
 await ctx.api.sendMessage(g.chatId,text,{parse_mode:"Markdown"});g.discussionTimer=setTimeout(()=>beginVoting(ctx.api,g).catch(console.error),DISCUSSION_MS);
}
export async function beginLiarGame(ctx){const g=activeLiarGames.get(ctx.chat?.id);if(!g)return false;if(g.started){await ctx.reply("❌ اللعبة بدأت بالفعل.");return true;}if(await getRankLevel(ctx.from.id,ctx.chat.id)<1)return true;if(g.players.size<3){await ctx.reply("❌ لا يمكن بدء اللعبة.\n\n👥 يجب أن يكون عدد اللاعبين **3 لاعبين على الأقل**.",{parse_mode:"Markdown"});return true;}await startRound(ctx,g);return true;}
async function beginVoting(api,g){if(g.phase!=="discussion")return;stop(g,"discussionTimer");g.phase="voting";g.votes=new Map();await api.sendMessage(g.chatId,"🗳️ **بدأ التصويت!**\n\nاختر الشخص الذي تعتقد أنه الكذاب.\n\n⚠️ لا يمكنك التصويت لنفسك.\n🎯 التصويت الصحيح على الكذاب = **+40 نقطة**.\n\n⏱️ أمامكم **60 ثانية**.",{parse_mode:"Markdown"});for(const [id] of g.players){if(g.eliminated.has(id))continue;try{const opts=optionsFor(g.baseWord);const buttons=[...g.players.entries()].filter(([uid])=>uid!==id&&!g.eliminated.has(uid)).map(([uid,u])=>({text:u.first_name||"مستخدم",callback_data:"liar_vote:"+uid}));const rows=[];for(let i=0;i<buttons.length;i+=2)rows.push(buttons.slice(i,i+2));await api.sendMessage(id,"🗳️ **التصويت**\n\nمن تعتقد أنه الكذاب؟\n\n⚠️ لديك تصويت واحد فقط.",{parse_mode:"Markdown",reply_markup:{inline_keyboard:rows}});}catch{}}
 g.voteTimer=setTimeout(()=>finishVoting(api,g).catch(console.error),VOTE_MS);}
export async function forceLiarVoting(ctx){const g=activeLiarGames.get(ctx.chat?.id);if(!g||g.phase!=="discussion")return false;if(await getRankLevel(ctx.from.id,ctx.chat.id)<1)return true;await beginVoting(ctx.api,g);return true;}
async function finishVoting(api,g){if(g.phase!=="voting")return;stop(g,"voteTimer");g.phase="guessing";g.liarCaught=[...g.votes.values()].includes(g.liarId);for(const [v,t] of g.votes)if(t===g.liarId)await award(v,40);
 const opts=optionsFor(g.baseWord),rows=[];for(let i=0;i<opts.length;i+=2)rows.push(opts.slice(i,i+2).map(w=>({text:w,callback_data:"liar_guess:"+norm(w)})));
 try{await api.sendMessage(g.liarId,"🕵️ **مرحلة تخمين كلمة الأبرياء**\n\nانتهى التصويت.\nالآن لديك فرصة واحدة فقط لتخمين كلمة الأبرياء.\n\n🎯 اختر كلمة واحدة من القائمة.\n⚠️ لا يمكنك تغيير اختيارك بعد الضغط.\n⏱️ أمامك **30 ثانية**.",{parse_mode:"Markdown",reply_markup:{inline_keyboard:rows}});}catch{g.guessResult=false;await finishGame(api,g);return;}
 g.guessSelected=false;g.guessTimer=setTimeout(async()=>{if(g.phase!=="guessing"||g.guessSelected)return;g.guessSelected=true;g.guessResult=false;try{await api.sendMessage(g.liarId,"⏰ **انتهى الوقت!**\n\nلم تختر أي كلمة.\n❌ تخمينك يعتبر خاطئًا.\n💰 النقاط: **0**",{parse_mode:"Markdown"});}catch{}await finishGame(api,g);},GUESS_MS);}
async function finishGame(api,g){if(!activeLiarGames.has(g.chatId)||g.phase==="finished")return;g.phase="finished";stop(g,"discussionTimer");stop(g,"voteTimer");stop(g,"guessTimer");const liar=g.players.get(g.liarId);let votes="";for(const [v,t] of g.votes){const vu=g.players.get(v),tu=g.players.get(t);if(vu&&tu)votes+="• "+mention(vu)+" ➡️ "+mention(tu)+" "+(t===g.liarId?"✅":"❌")+"\n";}if(!votes)votes="• لم يصوت أحد.\n";
 let scores="",winners=[];for(const [id,u] of g.players){let s=g.votes.get(id)===g.liarId?40:0;if(id===g.liarId&&g.guessResult)s+=g.liarCaught?20:40;if(g.eliminated.has(id))s=0;scores+="• "+mention(u)+" — **+"+s+"**\n";if(s>0)winners.push(mention(u));}
 let guess;if(g.guessResult===true)guess="🎯 **تخمين الكذاب:** صحيح ✅\n💰 حصل على **+"+(g.liarCaught?20:40)+" نقطة**.";else if(g.guessResult===false)guess="🎯 **تخمين الكذاب:** خاطئ ❌\n💰 حصل على **0 نقطة**.";else guess="🎯 **تخمين الكذاب:** لم يتم الاختيار ⏰\n💰 حصل على **0 نقطة**.";
 const result="🏆 **نتائج لعبة الكذاب**\n\n📝 **كلمة الأبرياء:** "+g.baseWord+"\n🕵️ **كلمة الكذاب:** "+g.liarWord+"\n👤 **الكذاب:** "+(liar?mention(liar):"غير معروف")+"\n\n"+(g.liarCaught?"🚨 **تم كشف الكذاب!**":"😈 **الكذاب لم يتم كشفه!**")+"\n\n🗳️ **نتائج التصويت:**\n"+votes+"\n🎯 **مرحلة تخمين الكذاب:**\n"+guess+"\n\n💰 **نقاط الجولة:**\n"+scores+"\n🏅 **الفائزون:**\n"+(winners.length?winners.map(w=>"🏆 "+w).join("\n"):"لا يوجد فائز بالنقاط في هذه الجولة.");
 try{await api.sendMessage(g.chatId,result,{parse_mode:"Markdown"});}catch(e){console.error("Liar final message:",e?.message||e);}activeLiarGames.delete(g.chatId);unlockBigGame(g.chatId,"liar");}
export async function endLiarGame(ctx){const g=activeLiarGames.get(ctx.chat?.id);if(!g){await ctx.reply("❌ لا توجد لعبة كذاب شغالة حاليًا.");return true;}if(await getRankLevel(ctx.from.id,ctx.chat.id)<1){await ctx.reply("❌ هذا الأمر للمشرفين فقط.");return true;}stop(g,"discussionTimer");stop(g,"voteTimer");stop(g,"guessTimer");activeLiarGames.delete(g.chatId);unlockBigGame(g.chatId,"liar");await ctx.reply("🛑 تم إنهاء لعبة الكذاب.\n\n");return true;}
export async function handleLiarCallback(ctx){const data=ctx.callbackQuery?.data||"",u=ctx.from;
 if(data==="liar:join"||data==="liar:leave"){const id=ctx.callbackQuery?.message?.message_id,g=[...activeLiarGames.values()].find(x=>x.lobbyMessageId===id);if(!g){await ctx.answerCallbackQuery({text:"❌ انتهت اللعبة.",show_alert:true});return;}if(g.started){await ctx.answerCallbackQuery({text:"⚠️ اللعبة بدأت بالفعل.",show_alert:true});return;}if(data==="liar:join"){if(g.players.has(u.id)){await ctx.answerCallbackQuery({text:"⚠️ أنت داخل اللعبة بالفعل.",show_alert:true});return;}g.players.set(u.id,u);await ctx.answerCallbackQuery({text:"✅ تم انضمامك!"});}else{if(!g.players.has(u.id)){await ctx.answerCallbackQuery({text:"❌ أنت لست داخل اللعبة.",show_alert:true});return;}g.players.delete(u.id);await ctx.answerCallbackQuery({text:"🚪 تم خروجك من اللعبة."});}await updateLobby(ctx.api,g);return;}
 if(data.startsWith("liar_vote:")){const target=Number(data.slice(10)),g=[...activeLiarGames.values()].find(x=>x.phase==="voting"&&x.players.has(u.id));if(!g){await ctx.answerCallbackQuery({text:"❌ انتهى التصويت.",show_alert:true});return;}if(g.votes.has(u.id)){await ctx.answerCallbackQuery({text:"⚠️ صوتك مسجل بالفعل.",show_alert:true});return;}if(target===u.id){await ctx.answerCallbackQuery({text:"❌ لا يمكنك التصويت لنفسك.",show_alert:true});return;}if(!g.players.has(target)||g.eliminated.has(target)){await ctx.answerCallbackQuery();return;}g.votes.set(u.id,target);await ctx.answerCallbackQuery();try{await ctx.editMessageText("✅ **تم تسجيل تصويتك.**\n\nلا يمكنك تغيير اختيارك.",{parse_mode:"Markdown"});}catch{}if(g.votes.size>=[...g.players.keys()].filter(id=>!g.eliminated.has(id)).length)await finishVoting(ctx.api,g);return;}
 if(data.startsWith("liar_guess:")){const g=[...activeLiarGames.values()].find(x=>x.phase==="guessing"&&x.liarId===u.id);if(!g){await ctx.answerCallbackQuery({text:"❌ لا يوجد تخمين متاح.",show_alert:true});return;}if(g.guessSelected){await ctx.answerCallbackQuery({text:"⚠️ تم تسجيل اختيارك بالفعل.",show_alert:true});return;}g.guessSelected=true;const correct=norm(data.slice(11))===norm(g.baseWord);g.guessResult=correct;stop(g,"guessTimer");const points=correct?(g.liarCaught?20:40):0;if(correct)await award(g.liarId,points);await ctx.answerCallbackQuery();const msg=correct?"🎯 **تخمين صحيح!**\n\n✅ الكلمة كانت: **"+g.baseWord+"**\n💰 حصلت على **+"+points+" نقطة**.":"❌ **تخمين خاطئ!**\n\n🔐 الكلمة الصحيحة كانت: **"+g.baseWord+"**\n💰 حصلت على **0 نقطة**.";try{await ctx.editMessageText(msg,{parse_mode:"Markdown"});}catch{}await finishGame(ctx.api,g);}
}
export async function handleLiarMessage(ctx){const text=ctx.message?.text;if(!text||!ctx.chat||!ctx.from)return false;if(text.trim()==="الكذاب"){await openLobby(ctx);return true;}if(!["group","supergroup"].includes(ctx.chat.type))return false;const g=activeLiarGames.get(ctx.chat.id);if(!g||g.phase!=="discussion"||!g.players.has(ctx.from.id)||g.eliminated.has(ctx.from.id))return false;const secret=ctx.from.id===g.liarId?g.liarWord:g.baseWord;if(norm(secret)!==norm(text))return false;g.eliminated.add(ctx.from.id);await ctx.reply("🚨 تم استبعاد "+mention(ctx.from)+" من الجولة!\n\n❌ لقد أرسلت كلمتك السرية في القروب.\n💰 نقاطك في هذه الجولة: **0**.",{parse_mode:"Markdown"});return false;}
