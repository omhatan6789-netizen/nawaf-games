import { getMusicAccountClient } from "./account-clock.js";
import { handleMusicAccountAiMessage } from "./ai-assistant.js";

let started=false;

async function handleMessage(message) {
  try {
    const handled=await handleMusicAccountAiMessage(message,await getMusicAccountClient());
    if (handled) console.log("[MUSIC ACCOUNT AI] Handled outgoing command in chat " + message.chat.id + ".");
  } catch (error) {
    console.error("[MUSIC ACCOUNT AI] Message handler failed:",error?.message||error);
  }
}

export async function startMusicAccountAi() {
  if (started) return;
  const client=await getMusicAccountClient();
  client.onNewMessage.add(handleMessage);
  started=true;
  console.log("[MUSIC ACCOUNT AI] Started on assistant account (outgoing نيوف trigger, groups and private).");
}
