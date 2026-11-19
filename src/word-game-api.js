import crypto from "node:crypto";

const four="نواف خالد أمين سارة ليان سامي رامي مازن زياد ياسر ناصر راشد صالح طارق عادل وليد حمزة حاتم باسل مالك تامر ماهر جابر حازم عمار رائد إياد جلال كنان فارس حارس لاعب فريق نحاس حديد زجاج قماش تراب هواء دخان رماد جدار دجاج حليب سكين كتاب دفتر ذراع مطار مسجد ملعب متحف فندق شاطئ غابة مضرب شبكة حروف نجوم ورود قلوب عيون أيام أسود أبيض أحمر أزرق أخضر كبير صغير جميل سريع هادئ سعيد حزين ضعيف طويل قصير جديد قديم ثقيل خفيف قريب بعيد نظيف واضح غامض صادق كاذب شجاع جبان كريم بخيل لطيف نشيط كسول مدرب كورة سحاب رياح شتاء ربيع خريف صباح مساء طريق شارع قرية دولة عالم وادي قارب مركب حذاء قميص قبعة ساعة خاتم سوار مكتب كرسي سرير مكيف هاتف شاشة لوحة فأرة جهاز موقع صفحة بريد حساب كلمة صورة لعبة فكرة سؤال جواب عربي مربع مثلث كوكب فضاء سماء ضباب شجرة زهرة وردة ثمرة ورقة جذور نبات طيور نملة نحلة عقرب أرنب حصان حمار بقرة ماعز بلبل بومة غراب ثعلب غزال سمكة".split(" ");
const five="سيارة مدرسة مكتبة طائرة حاسوب نافذة حديقة مفتاح مصباح وسادة حقيبة ثلاجة غسالة مروحة تلفاز سفينة دراجة طاولة ملعقة تفاحة ليمون دلفين حمامة مطرقة منشار كماشة مسمار نظارة جزيرة سحابة صحراء خريطة كلمات ألوان أصوات ألعاب أحلام أوقات أرقام أسماء مهاجم بطولة جائزة ظهيرة أسبوع مدينة ميناء حافلة سروال عباءة قلادة محفظة صندوق ستارة سجادة سماعة رسالة فيديو رواية قصيدة صحيفة حقيقة تجربة دراسة جامعة نتيجة شهادة مختبر أسنان رياضة سباحة كتابة قراءة تاريخ أحياء إيقاع دائرة حيوان أسماك حشرات فراشة ذبابة بعوضة ثعبان سحلية تمساح عصفور طاووس زرافة ميدان مهندس مزارع مخترع قانون عنوان مقالة سفارة وزارة مملكة منطقة دقيقة ثانية تذكرة بنطال جوارب مسلسل أغنية ترجمة ذاكرة جمهور خسارة شاحنة بنزين فرامل بوصلة بحيرة عاصفة إعصار حرارة برودة فاكهة مانجو كمثرى شوربة بيتزا مشروب فنجان مقلاة أرضية سبورة ممحاة مسطرة مقلمة تلميذ وظيفة رمادي مختلف مألوف ضروري مرتفع منخفض مفتوح ممتلئ مكسور مشهور مجهول معروف مطلوب ممنوع مسموح ممتاز صيدلي محامي".split(" ");
const fold=s=>String(s||"").normalize("NFKC").replace(/ـ/g,"").replace(/[\u064B-\u065F\u0670]/g,"").replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ؤ/g,"و").replace(/ئ/g,"ي").replace(/ة/g,"ه").trim();
const norm=s=>fold(s).replace(/\s/g,"");
const dec=v=>typeof v==="string"?JSON.parse(v):v||{};
const err=m=>Object.assign(new Error(m),{status:400});
const pick=(arr,n)=>{if(n>arr.length)throw err("لا توجد كلمات كافية لهذا الاختيار");const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a.slice(0,n);};
function makeWords(n,len){if(len===4)return pick(four,n);if(len===5)return pick(five,n);if(len!==0)throw err("اختر كلمات من 4 أو 5 أحرف أو كلهم");if(n===1)return pick(Math.random()<.5?four:five,1);const a=pick(four,Math.ceil(n/2)),b=pick(five,Math.floor(n/2));return Array.from({length:n},(_,i)=>i%2===0?a[Math.floor(i/2)] : b[Math.floor(i/2)]);}
function feedback(target,guess){const t=Array.from(norm(target)),g=Array.from(norm(guess)),out=Array(t.length).fill(null),left=t.slice();for(let i=0;i<t.length;i++)if(g[i]===t[i]){out[i]=guess[i]===target[i]?"green":"green_purple";left[i]=null;}for(let i=0;i<t.length;i++)if(!out[i]){const j=left.indexOf(g[i]);if(j<0)out[i]="white";else{out[i]=guess[i]===target[j]?"orange":"yellow_purple";left[j]=null;}}return out;}
function publicWord(row,uid){const players=dec(row.players),answers=dec(row.answers),by=answers.guesses||{},mine=by[String(uid)]||[],me=players.find(p=>Number(p.id)===Number(uid)),idx=Number(row.current_index),words=dec(row.words),target=row.status==="playing"?words[idx]:null,votes=answers.hint_votes||[],high=Math.max(0,...players.map(p=>Number(p.score||0))),leaders=players.filter(p=>Number(p.score||0)===high);
 return {id:String(row.id),mode:row.mode,status:row.status,word_limit:row.word_limit,win_target:row.win_target,attempts_limit:row.attempts_limit,attempts_left:Math.max(0,row.attempts_limit-mine.length),word_length:row.word_length,round_seconds:row.round_seconds,my_guesses:mine,current_index:idx,total:row.word_limit,
 players:players.map(p=>{const used=(by[String(p.id)]||[]).length;return {id:p.id,name:p.name,score:p.score||0,attempts_used:used,attempts_left:Math.max(0,row.attempts_limit-used)};}),
 my_score:me?.score||0,is_player:!!me,is_owner:Number(row.owner_id)===Number(uid),current_word_length:target?Array.from(norm(target)).length:null,
 hint:answers.hint||null,hint_id:answers.hint_id||null,hint_until:answers.hint_until||null,hint_votes_count:votes.length,hint_votes_needed:Math.max(1,Math.ceil(players.length*2/3)),my_hint_vote:votes.map(String).includes(String(uid)),
 round_deadline:row.round_deadline?new Date(row.round_deadline).getTime():null,round_until:row.round_until?new Date(row.round_until).getTime():null,
 round_winner:answers.round_winner||null,round_word:answers.last_word||null,round_end_reason:answers.round_end_reason||null,last_withdrawal:answers.last_withdrawal||null,last_guess:answers.last_guess||null,last_feedback:answers.last_feedback||null,
 words:row.status==="finished"?words:[],winner:row.status==="finished"?(leaders.length===1?leaders[0].name:"تعادل"):null,started_at:row.started_at?new Date(row.started_at).getTime():null};}
async function locked(pool,id,fn){const c=await pool.connect();try{await c.query("BEGIN");const q=await c.query("SELECT * FROM word_games WHERE id=$1 FOR UPDATE",[id]);if(!q.rows[0])throw err("الغرفة غير موجودة");const result=await fn(c,q.rows[0]);await c.query("COMMIT");return result;}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}}
export function registerWordGameRoutes(app,pool,token){
 app.post("/api/extra-games",async(req,res)=>{try{
  const u=verify(req.body?.initData,token),b=req.body||{},action=b.action||"",gid=String(b.game_id||"").replace(/-/g,""),type=b.game_type||"";
  if(type!=="word")throw err("نوع اللعبة غير معروف");
  let result;
  if(action==="create"){
   const mode=b.mode||"online",count=Number(b.word_count||5),len=Number(b.word_length??5),attempts=Number(b.attempts_limit||6),seconds=Number(b.round_seconds||180),target=Math.max(1,Math.min(count,Number(b.win_target||count)));
   if(!Number.isInteger(count)||count<1||count>15)throw err("اختر من 1 إلى 15 كلمة");if(!["online","training"].includes(mode))throw err("طور اللعبة غير صالح");
   if(![0,4,5].includes(len))throw err("اختر كلمات من 4 أو 5 أحرف أو كلهم");if(!Number.isInteger(attempts)||attempts<1||attempts>12)throw err("عدد المحاولات يجب أن يكون من 1 إلى 12");
   if(!Number.isInteger(seconds)||seconds<15||seconds>3600)throw err("مدة الجولة يجب أن تكون بين 15 و3600 ثانية");
   const words=makeWords(count,len),players=[{id:Number(u.id),name:[u.first_name,u.last_name].filter(Boolean).join(" ")||u.username||"لاعب",score:0}],id=crypto.randomUUID(),status=mode==="training"?"playing":"waiting";
   const q=await pool.query("INSERT INTO word_games(id,owner_id,mode,status,max_players,word_limit,win_target,words,players,attempts_limit,word_length,round_seconds,started_at,round_deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,CASE WHEN $4='playing' THEN NOW() ELSE NULL END,CASE WHEN $4='playing' THEN NOW()+($12::integer*INTERVAL '1 second') ELSE NULL END) RETURNING *",
    [id,u.id,mode,status,mode==="training"?1:10,count,target,JSON.stringify(words),JSON.stringify(players),attempts,len,seconds]);
   result=publicWord(q.rows[0],u.id);
  }else{
   if(!/^[0-9a-f]{32}$/i.test(gid))throw err("رابط اللعبة غير صالح");
   result=await locked(pool,gid,async(c,row)=>{
    const players=dec(row.players),answers=dec(row.answers),words=dec(row.words),idx=Number(row.current_index);
    if(action==="join"){
     if(row.status==="waiting"&&!players.some(p=>Number(p.id)===Number(u.id))){if(players.length>=10)throw err("اكتمل عدد اللاعبين");players.push({id:Number(u.id),name:[u.first_name,u.last_name].filter(Boolean).join(" ")||u.username||"لاعب",score:0});const q=await c.query("UPDATE word_games SET players=$2::jsonb,updated_at=NOW() WHERE id=$1 RETURNING *",[gid,JSON.stringify(players)]);row=q.rows[0];}
    }else if(action==="configure"){
     if(Number(row.owner_id)!==Number(u.id))throw err("تعديل الإعدادات لصاحب الغرفة فقط");if(row.status!=="waiting")throw err("لا يمكن تعديل الإعدادات بعد بدء اللعبة");
     const n=Number(b.word_count||5),l=Number(b.word_length??5),a=Number(b.attempts_limit||6),s=Number(b.round_seconds||180),w=Number(b.win_target||3);
     if(!Number.isInteger(n)||n<1||n>15||![0,4,5].includes(l)||!Number.isInteger(a)||a<1||a>12||!Number.isInteger(s)||s<15||s>3600||!Number.isInteger(w)||w<1||w>n)throw err("تحقق من إعدادات اللعبة");
     const q=await c.query("UPDATE word_games SET word_limit=$2,win_target=$3,words=$4::jsonb,attempts_limit=$5,word_length=$6,round_seconds=$7,updated_at=NOW() WHERE id=$1 RETURNING *",[gid,n,w,JSON.stringify(makeWords(n,l)),a,l,s]);row=q.rows[0];
    }else if(action==="start"){
     if(Number(row.owner_id)!==Number(u.id))throw err("بدء اللعبة لصاحب الغرفة فقط");if(row.status!=="waiting")throw err("اللعبة بدأت بالفعل");if(players.length<2)throw err("تحتاج لاعبين على الأقل");
     const q=await c.query("UPDATE word_games SET status='playing',started_at=NOW(),round_deadline=NOW()+(round_seconds*INTERVAL '1 second'),round_until=NULL,answers='{}'::jsonb,updated_at=NOW() WHERE id=$1 RETURNING *",[gid]);row=q.rows[0];
    }else if(action==="state"){
     if(row.status==="playing"&&row.round_deadline&&new Date(row.round_deadline)<=new Date()&&!row.round_until){answers.last_word=words[idx];answers.round_end_reason="timeout";const q=await c.query("UPDATE word_games SET answers=$2::jsonb,round_until=NOW()+INTERVAL '3 seconds',round_deadline=NULL,updated_at=NOW() WHERE id=$1 RETURNING *",[gid,JSON.stringify(answers)]);row=q.rows[0];}
    }else if(action==="hint"){
     if(row.status!=="playing"||!players.some(p=>Number(p.id)===Number(u.id)))throw err("التصويت متاح للاعبين فقط");if(row.round_until)throw err("انتهت الجولة");
     const votes=(answers.hint_votes||[]).map(String);if(!votes.includes(String(u.id)))votes.push(String(u.id));answers.hint_votes=votes;
     if(votes.length>=Math.max(1,Math.ceil(players.length*2/3))&&!answers.hint){answers.hint="فكّر في المكان أو الموقف اللي ممكن تشوفه فيه";answers.hint_id=crypto.randomUUID().replace(/-/g,"");answers.hint_until=Date.now()+5000;}
     const q=await c.query("UPDATE word_games SET answers=$2::jsonb,updated_at=NOW() WHERE id=$1 RETURNING *",[gid,JSON.stringify(answers)]);row=q.rows[0];
    }else if(action==="guess"){
     if(row.status!=="playing")throw err("اللعبة غير نشطة");const me=players.find(p=>Number(p.id)===Number(u.id));if(!me)throw err("أنت متفرج ولا يمكنك الإجابة");if(row.round_until)throw err("انتهت الجولة، انتظر الكلمة التالية");
     if(row.round_deadline&&new Date(row.round_deadline)<=new Date()){answers.last_word=words[idx];answers.round_end_reason="timeout";const q=await c.query("UPDATE word_games SET answers=$2::jsonb,round_until=NOW()+INTERVAL '3 seconds',round_deadline=NULL,updated_at=NOW() WHERE id=$1 RETURNING *",[gid,JSON.stringify(answers)]);row=q.rows[0];return {round_over:true,state:publicWord(row,u.id)};}
     const guess=String(b.guess||"").trim(),target=words[idx],glen=Array.from(norm(guess)).length;if(glen!==Array.from(norm(target)).length)throw err("اكتب كلمة من "+Array.from(norm(target)).length+" أحرف");if(/\s/.test(guess))throw err("اكتب الكلمة بدون مسافات");
     const by=answers.guesses||(answers.guesses={}),mine=by[String(u.id)]||(by[String(u.id)]=[]);if(mine.length>=Number(row.attempts_limit))throw err("خلصت محاولاتك في هذه الكلمة");
     const fb=feedback(target,guess);mine.push({guess,feedback:fb});
     if(norm(guess)===norm(target)){me.score=Number(me.score||0)+1;answers.round_winner=me.name;answers.last_word=target;answers.last_guess=guess;answers.last_feedback=fb;answers.round_end_reason="winner";const q=await c.query("UPDATE word_games SET players=$2::jsonb,answers=$3::jsonb,round_until=NOW()+INTERVAL '3 seconds',round_deadline=NULL,updated_at=NOW() WHERE id=$1 RETURNING *",[gid,JSON.stringify(players),JSON.stringify(answers)]);row=q.rows[0];return {correct:true,state:publicWord(row,u.id)};}
     const allOut=players.every(p=>(by[String(p.id)]||[]).length>=Number(row.attempts_limit));if(allOut){answers.last_word=target;answers.round_end_reason="attempts";}
     const q=await c.query("UPDATE word_games SET answers=$2::jsonb,round_until=CASE WHEN $3 THEN NOW()+INTERVAL '3 seconds' ELSE round_until END,round_deadline=CASE WHEN $3 THEN NULL ELSE round_deadline END,updated_at=NOW() WHERE id=$1 RETURNING *",[gid,JSON.stringify(answers),allOut]);row=q.rows[0];return {correct:false,feedback:fb,state:publicWord(row,u.id)};
    }else if(action==="leave"){
     const me=players.find(p=>Number(p.id)===Number(u.id));if(!me)throw err("أنت لست لاعبًا في هذه الغرفة");if(row.status!=="finished"){const remain=players.filter(p=>Number(p.id)!==Number(u.id));answers.last_withdrawal={id:Number(u.id),name:me.name,at:Date.now()};const status=remain.length<=1?"finished":row.status;const q=await c.query("UPDATE word_games SET players=$2::jsonb,answers=$3::jsonb,status=$4,round_deadline=CASE WHEN $4='finished' THEN NULL ELSE round_deadline END,round_until=CASE WHEN $4='finished' THEN NULL ELSE round_until END,finished_at=CASE WHEN $4='finished' THEN NOW() ELSE finished_at END,updated_at=NOW() WHERE id=$1 RETURNING *",[gid,JSON.stringify(remain),JSON.stringify(answers),status]);row=q.rows[0];}
    }else if(action==="next"){
     if(row.status!=="playing"||!players.some(p=>Number(p.id)===Number(u.id)))throw err("المتفرجون لا يمكنهم الانتقال بين الجولات");if(!row.round_until||new Date(row.round_until)>new Date())return publicWord(row,u.id);
     const next=idx+1,reached=players.some(p=>Number(p.score||0)>=Number(row.win_target)),status=next>=Number(row.word_limit)||(row.mode==="training"&&reached)?"finished":"playing";
     const q=await c.query("UPDATE word_games SET current_index=$2,status=$3,answers='{}'::jsonb,round_until=NULL,round_deadline=CASE WHEN $3='playing' THEN NOW()+(round_seconds*INTERVAL '1 second') ELSE NULL END,updated_at=NOW(),finished_at=CASE WHEN $3='finished' THEN NOW() ELSE finished_at END WHERE id=$1 RETURNING *",[gid,next,status]);row=q.rows[0];
    }else{throw err("إجراء اللعبة غير معروف");}
    return publicWord(row,u.id);
   });
  }
  res.json({ok:true,result});
 }catch(e){res.status(e.status||400).json({ok:false,error:e.message||"تعذر تنفيذ اللعبة"});}});
}
