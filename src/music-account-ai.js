import { getMusicAccountClient } from "./account-clock.js";
import { handleMusicAccountAiMessage } from "./ai-assistant.js";

let started=false;

async function handleMessage(message) {
  try {
    if (message.isOutgoing || message.isService || !message.text) return;
    const chatType=message.chat?.chatType||message.chat?.type;
    if (chatType!=="group" && chatType!=="supergroup") return;
    const text=String(message.text).trim();
    if (!["تفعيل الذكاء","تعطيل الذكاء","حالة الذكاء"].includes(text) &&
        !/^\s*نيوف(?:\s*[,،:!؟-]\s*|\s+|$)[\s\S]*$/i.test(text)) return;
    const client=await getMusicAccountClient();
    const handled=await handleMusicAccountAiMessage(message,client);
    if (handled) console.log(`[MUSIC ACCOUNT AI] Handled message in chat ${message.chat.id}.`);
  } catch (error) {
    console.error("[MUSIC ACCOUNT AI] Message handler failed:",error?.message||error);
  }
}

export async function startMusicAccountAi() {
  if (started) return;
  const client=await getMusicAccountClient();
  client.onNewMessage.add(handleMessage);
  started=true;
  console.log("[MUSIC ACCOUNT AI] Started on the assistant account (group trigger: نيوف).");
}
