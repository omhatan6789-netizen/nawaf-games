import { pool } from "./db.js";
import { ensureModerationSchema } from "./moderation-schema.js";

const muteCache = new Map();
const blockedCache = new Map();
const settingsCache = new Map();
const now = () => Date.now();

async function db() {
  await ensureModerationSchema();
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool;
}
export async function saveSanction(table, chatId, user, untilTime, reason, byUser) {
  if (!["bot_mutes","restrictions","moderation_bans"].includes(table)) throw new Error("Invalid sanction table");
  const p=await db();
  await p.query(`INSERT INTO ${table}(chat_id,user_id,username,first_name,until_time,reason,by_user)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(chat_id,user_id) DO UPDATE SET username=EXCLUDED.username,
    first_name=EXCLUDED.first_name,until_time=EXCLUDED.until_time,reason=EXCLUDED.reason,by_user=EXCLUDED.by_user`,
    [String(chatId),String(user.id),user.username??null,user.first_name??null,untilTime,reason??null,String(byUser)]);
  if(table==="bot_mutes") muteCache.set(`${chatId}:${user.id}`,{until:untilTime?new Date(untilTime).getTime():null,at:now()});
}
export async function deleteSanction(table,chatId,userId) {
  if(!["bot_mutes","restrictions","moderation_bans"].includes(table)) throw new Error("Invalid sanction table");
  const p=await db(); await p.query(`DELETE FROM ${table} WHERE chat_id=$1 AND user_id=$2`,[String(chatId),String(userId)]);
  if(table==="bot_mutes") muteCache.set(`${chatId}:${userId}`,{until:0,at:now()});
}
export async function getActiveMute(chatId,userId) {
  const key=`${chatId}:${userId}`,cached=muteCache.get(key);
  if(cached&&now()-cached.at<10000) return cached.until===null||cached.until>now();
  const p=await db(); const r=await p.query("SELECT until_time FROM bot_mutes WHERE chat_id=$1 AND user_id=$2",[String(chatId),String(userId)]);
  const until=r.rows[0]?.until_time?new Date(r.rows[0].until_time).getTime():null;
  const active=Boolean(r.rowCount)&& (until===null||until>now());
  muteCache.set(key,{until:active?until:0,at:now()});
  if(r.rowCount&&!active) await p.query("DELETE FROM bot_mutes WHERE chat_id=$1 AND user_id=$2",[String(chatId),String(userId)]);
  return active;
}
export async function getModerationSettings(chatId) {
  const key=String(chatId),c=settingsCache.get(key);
  if(c&&now()-c.at<10000)return c.value;
  const p=await db(); await p.query("INSERT INTO moderation_settings(chat_id) VALUES($1) ON CONFLICT DO NOTHING",[key]);
  const r=await p.query("SELECT durations_enabled,reasons_enabled FROM moderation_settings WHERE chat_id=$1",[key]);
  const value={durations_enabled:Boolean(r.rows[0]?.durations_enabled),reasons_enabled:Boolean(r.rows[0]?.reasons_enabled)};
  settingsCache.set(key,{value,at:now()}); return value;
}
export async function setModerationSetting(chatId,column,enabled) {
  if(!["durations_enabled","reasons_enabled"].includes(column))throw new Error("Invalid setting");
  const p=await db(); await p.query(`INSERT INTO moderation_settings(chat_id,${column}) VALUES($1,$2)
    ON CONFLICT(chat_id) DO UPDATE SET ${column}=EXCLUDED.${column}`,[String(chatId),Boolean(enabled)]);
  settingsCache.delete(String(chatId));
}
export async function saveTargetUser(user) {
  if(!user)return;
  const p=await db();
  await p.query(`INSERT INTO users(user_id,username,first_name,last_name,is_bot)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET
    username=COALESCE(EXCLUDED.username,users.username),
    first_name=COALESCE(EXCLUDED.first_name,users.first_name),
    last_name=COALESCE(EXCLUDED.last_name,users.last_name),updated_at=NOW()`,
    [String(user.id),user.username??null,user.first_name??null,user.last_name??null,Boolean(user.is_bot)]);
}
export async function getUserByUsername(username) {
 const p=await db();const r=await p.query("SELECT user_id,username,first_name FROM users WHERE LOWER(username)=$1 LIMIT 1",[String(username).replace(/^@/,"").toLowerCase()]);
 return r.rows[0]??null;
}
export async function getSanctionRows(table,chatId) {
 if(!["bot_mutes","restrictions","moderation_bans"].includes(table))throw new Error("Invalid table");
 const p=await db();const r=await p.query(`SELECT user_id,username,first_name,until_time,reason,by_user FROM ${table} WHERE chat_id=$1 ORDER BY user_id`,[String(chatId)]);
 return r.rows;
}
export async function clearSanctionTable(table,chatId) {
 if(!["bot_mutes","restrictions","moderation_bans"].includes(table))throw new Error("Invalid table");
 const p=await db();const r=await p.query(`DELETE FROM ${table} WHERE chat_id=$1 RETURNING user_id`,[String(chatId)]);
 if(table==="bot_mutes")for(const row of r.rows)muteCache.set(`${chatId}:${row.user_id}`,{until:0,at:now()});
 return r.rows.map(x=>Number(x.user_id));
}
export async function getUserRestrictions(chatId,userId) {
 const p=await db();const r=await p.query(`SELECT 'كتم' kind FROM bot_mutes WHERE chat_id=$1 AND user_id=$2
 UNION ALL SELECT 'تقييد' FROM restrictions WHERE chat_id=$1 AND user_id=$2
 UNION ALL SELECT 'حظر' FROM moderation_bans WHERE chat_id=$1 AND user_id=$2`,[String(chatId),String(userId)]);
 return r.rows.map(x=>x.kind);
}
export async function addWarning(chatId,userId,source="manual") {
 const p=await db();await p.query("INSERT INTO warnings(chat_id,user_id,source) VALUES($1,$2,$3)",[String(chatId),String(userId),source]);
 return getWarningCount(chatId,userId);
}
export async function getWarningCount(chatId,userId) {
 const p=await db();const r=await p.query("SELECT COUNT(*)::int count FROM warnings WHERE chat_id=$1 AND user_id=$2",[String(chatId),String(userId)]);
 return Number(r.rows[0]?.count??0);
}
export async function clearWarnings(chatId,userId) {
 const p=await db();const r=await p.query("DELETE FROM warnings WHERE chat_id=$1 AND user_id=$2",[String(chatId),String(userId)]);
 return r.rowCount;
}
export async function getExpiredSanctions() {
 const p=await db(),out={mutes:[],restrictions:[],bans:[]};
 for(const [table,key] of [["bot_mutes","mutes"],["restrictions","restrictions"],["moderation_bans","bans"]]) {
  const r=await p.query(`SELECT chat_id,user_id FROM ${table} WHERE until_time IS NOT NULL AND until_time<=NOW()`);
  out[key]=r.rows.map(x=>[Number(x.chat_id),Number(x.user_id)]);
 }
 return out;
}
export async function getBlockedWords(chatId,listId) {
 const key=`${chatId}:${listId}`,c=blockedCache.get(key);
 if(c&&now()-c.at<30000)return c.words;
 const p=await db();const r=await p.query("SELECT word FROM blocked_words_v2 WHERE chat_id=$1 AND list_id=$2 ORDER BY word",[String(chatId),listId]);
 const words=r.rows.map(x=>x.word);blockedCache.set(key,{words,at:now()});return words;
}
export async function mutateBlockedWords(chatId,listId,words,add) {
 const p=await db();
 if(add) for(const word of words) await p.query("INSERT INTO blocked_words_v2(chat_id,list_id,word) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[String(chatId),listId,word]);
 else await p.query("DELETE FROM blocked_words_v2 WHERE chat_id=$1 AND list_id=$2 AND word=ANY($3::text[])",[String(chatId),listId,words]);
 blockedCache.delete(`${chatId}:${listId}`);
}
export async function getBlockedSettings(chatId,listId) {
 const p=await db();await p.query("INSERT INTO blocked_words_settings_v2(chat_id,list_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[String(chatId),listId]);
 const r=await p.query("SELECT * FROM blocked_words_settings_v2 WHERE chat_id=$1 AND list_id=$2",[String(chatId),listId]);
 const x=r.rows[0];return {enabled:Boolean(x.enabled),action:x.action||"mute",duration:x.duration,warning_duration:x.warning_duration,warning_action:x.warning_action,warning_punishment_duration:x.warning_punishment_duration};
}
export async function updateBlockedSettings(chatId,listId,values) {
 const allowed=["enabled","action","duration","warning_duration","warning_action","warning_punishment_duration"];
 const keys=Object.keys(values);if(!keys.length||keys.some(k=>!allowed.includes(k)))throw new Error("Invalid blocked settings");
 const p=await db();await p.query("INSERT INTO blocked_words_settings_v2(chat_id,list_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[String(chatId),listId]);
 const sets=keys.map((k,i)=>`${k}=$${i+3}`).join(",");
 await p.query(`UPDATE blocked_words_settings_v2 SET ${sets} WHERE chat_id=$1 AND list_id=$2`,[String(chatId),listId,...keys.map(k=>values[k])]);
}
export async function addBlockedWarning(chatId,listId,userId,duration) {
 const p=await db(),n=Math.floor(Date.now()/1000);
 await p.query("DELETE FROM blocked_words_warnings_v2 WHERE chat_id=$1 AND list_id=$2 AND user_id=$3 AND expires_at<=$4",[String(chatId),listId,String(userId),n]);
 await p.query("INSERT INTO blocked_words_warnings_v2(chat_id,list_id,user_id,expires_at,created_at) VALUES($1,$2,$3,$4,$5)",[String(chatId),listId,String(userId),n+duration,n]);
 const r=await p.query("SELECT COUNT(*)::int count FROM blocked_words_warnings_v2 WHERE chat_id=$1 AND list_id=$2 AND user_id=$3",[String(chatId),listId,String(userId)]);
 return Number(r.rows[0].count);
}
export async function clearBlockedWarnings(chatId,listId,userId) {
 const p=await db();await p.query("DELETE FROM blocked_words_warnings_v2 WHERE chat_id=$1 AND list_id=$2 AND user_id=$3",[String(chatId),listId,String(userId)]);
}
export async function cleanupExpiredBlockedWarnings() {
 const p=await db();await p.query("DELETE FROM blocked_words_warnings_v2 WHERE expires_at<=$1",[Math.floor(Date.now()/1000)]);
}
