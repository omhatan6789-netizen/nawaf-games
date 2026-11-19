import { InputFile } from "grammy";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { createWriteStream } from "node:fs";

const BOT_USERNAME = "lnll0bot";
const RESULT_COUNT = 4;
const MAX_AUDIO_BYTES = 49 * 1024 * 1024;
const searches = new Map();

function youtubeKeys() {
  const keys = [];
  if (process.env.YOUTUBE_API_KEY) keys.push(process.env.YOUTUBE_API_KEY);
  for (let i = 2; process.env[`YOUTUBE_API_KEY_${i}`]; i++) {
    keys.push(process.env[`YOUTUBE_API_KEY_${i}`]);
  }
  return keys;
}

function durationSeconds(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value || "");
  return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : null;
}

function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "";
  const n = Math.max(0, Math.floor(Number(seconds)));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return h ? [h, m, s].map(x => String(x).padStart(2, "0")).join(":") : [m, s].map(x => String(x).padStart(2, "0")).join(":");
}

async function searchYouTube(query) {
  const keys = youtubeKeys();
  if (!keys.length) throw new Error("YOUTUBE_API_KEY غير مضبوط في Render");
  let lastError;
  for (const key of keys) {
    const params = new URLSearchParams({
      part: "snippet", q: query, type: "video", maxResults: String(RESULT_COUNT),
      regionCode: "SA", relevanceLanguage: "ar", key,
    });
    try {
      const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok) {
        const reasons = (data.error?.errors || []).map(x => x.reason);
        lastError = new Error(data.error?.message || `YouTube API HTTP ${response.status}`);
        if (reasons.includes("quotaExceeded") || reasons.includes("dailyLimitExceeded")) continue;
        throw lastError;
      }
      const videos = (data.items || []).flatMap(item => {
        const id = item.id?.videoId;
        return id ? [{ id, title: item.snippet?.title || "مقطع بدون عنوان", url: `https://www.youtube.com/watch?v=${id}`, duration: null }] : [];
      });
      if (videos.length) {
        try {
          const detailsParams = new URLSearchParams({ part: "contentDetails", id: videos.map(v => v.id).join(","), key });
          const detailsResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailsParams}`, { signal: AbortSignal.timeout(12000) });
          if (detailsResponse.ok) {
            const details = await detailsResponse.json();
            const durations = new Map((details.items || []).map(v => [v.id, durationSeconds(v.contentDetails?.duration)]));
            for (const video of videos) video.duration = durations.get(video.id) ?? null;
          }
        } catch (error) { console.warn("YouTube duration lookup failed:", error.message); }
      }
      return videos;
    } catch (error) {
      lastError = error;
      if (/quotaExceeded|dailyLimitExceeded/.test(error.message)) continue;
      throw error;
    }
  }
  throw lastError || new Error("تعذّر البحث في يوتيوب");
}

async function downloadSamplecut(videoUrl, folder) {
  const response = await fetch("https://api.samplecut.app/v1/downloads", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Client-Name": "NawafTelegramBot",
      Accept: "audio/mpeg, application/json",
    },
    body: JSON.stringify({ url: videoUrl, format: "mp3", response: "file" }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Samplecut HTTP ${response.status}: ${detail}`);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("audio/")) {
    throw new Error("Samplecut لم يُرجع ملفًا صوتيًا صالحًا");
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_AUDIO_BYTES) throw new Error("حجم الصوت أكبر من الحد المسموح");
  const filePath = join(folder, "audio.mp3");
  let total = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      total += chunk.length;
      if (total > MAX_AUDIO_BYTES) callback(new Error("حجم الصوت أكبر من الحد المسموح"));
      else callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(filePath));
  const info = await stat(filePath);
  if (!info.size) throw new Error("ملف الصوت فارغ");
  const encodedTitle = response.headers.get("X-Samplecut-Title");
  return { filePath, title: encodedTitle ? decodeURIComponent(encodedTitle) : "صوت من يوتيوب" };
}

export async function handleYouTubeAudioMessage(ctx) {
  const text = ctx.message?.text?.trim();
  if (!text) return false;
  const match = /^(?:بحث|يوت)\s+(.+?)\s*$/i.exec(text);
  if (!match) return false;
  const query = match[1].trim();
  if (!query) {
    await ctx.reply("❌ اكتب اسم المقطع بعد كلمة بحث.");
    return true;
  }
  const status = await ctx.reply("🔎 ثواني قاعد ابحث...");
  try {
    const results = await searchYouTube(query);
    if (!results.length) {
      await ctx.api.editMessageText(status.chat.id, status.message_id, "❌ لم يتم العثور على نتائج.");
      return true;
    }
    const id = Math.random().toString(16).slice(2, 12);
    searches.set(id, { results, chatId: status.chat.id, createdAt: Date.now() });
    for (const [key, value] of searches) if (Date.now() - value.createdAt > 15 * 60 * 1000) searches.delete(key);
    const keyboard = results.map((video, index) => {
      const title = video.title.length > 55 ? video.title.slice(0, 52) + "..." : video.title;
      const duration = formatDuration(video.duration);
      return [{ text: `${index + 1}. ${title}${duration ? ` [${duration}]` : ""}`, callback_data: `ytpick:${id}:${index}` }];
    });
    await ctx.api.editMessageText(status.chat.id, status.message_id, `🎵 نتائج البحث عن: ${query}\n\nاختر المقطع:`, {
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (error) {
    console.error("YouTube search failed:", error);
    await ctx.api.editMessageText(status.chat.id, status.message_id, "❌ تعذّر البحث في يوتيوب. تأكد من إعداد YOUTUBE_API_KEY وراجع سجلات Render.");
  }
  return true;
}

export async function handleYouTubeAudioCallback(ctx) {
  const data = ctx.callbackQuery?.data || "";
  const match = /^ytpick:([a-f0-9]+):(\d+)$/.exec(data);
  if (!match) return false;
  const [, id, rawIndex] = match;
  const saved = searches.get(id);
  const index = Number(rawIndex);
  if (!saved || saved.chatId !== ctx.callbackQuery.message?.chat?.id || !saved.results[index]) {
    await ctx.answerCallbackQuery({ text: "انتهت صلاحية النتائج، ابحث مرة ثانية.", show_alert: true });
    return true;
  }
  await ctx.answerCallbackQuery();
  const video = saved.results[index];
  searches.delete(id);
  const chatId = saved.chatId;
  const message = ctx.callbackQuery.message;
  try { await ctx.api.deleteMessage(chatId, message.message_id); } catch {}
  const status = await ctx.api.sendMessage(chatId, "⏳ قاعد أجهز المقطع، انتظر...");
  let folder;
  try {
    folder = await mkdtemp(join(tmpdir(), "nawaf-yt-"));
    const { filePath, title: downloadedTitle } = await downloadSamplecut(video.url, folder);
    const title = (downloadedTitle && downloadedTitle !== "صوت من يوتيوب" ? downloadedTitle : video.title).slice(0, 64);
    const duration = Number(video.duration || 0);
    const caption = `• Nawaf${duration ? ` . ↠ ${formatDuration(duration)}` : ""}`;
    await ctx.api.sendAudio(chatId, new InputFile(filePath), {
      title,
      performer: "Nawaf",
      ...(duration ? { duration } : {}),
      caption,
      reply_markup: { inline_keyboard: [[{ text: "🌷", url: `https://t.me/${BOT_USERNAME}` }]] },
    });
    await ctx.api.deleteMessage(chatId, status.message_id);
  } catch (error) {
    console.error("YouTube audio delivery failed:", error);
    try { await ctx.api.editMessageText(chatId, status.message_id, "❌ تعذّر تحميل هذا المقطع أو إرساله. جرّب نتيجة ثانية أو راجع سجلات Render."); } catch {}
  } finally {
    if (folder) await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
  return true;
}
