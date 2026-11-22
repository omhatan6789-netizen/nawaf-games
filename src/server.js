import "dotenv/config";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { spawn } from "node:child_process";
import httpProxy from "http-proxy";
import { createBot } from "./bot.js";
import { startAccountClock } from "./account-clock.js";
import { startAutoPrivateReply } from "./auto-private-reply.js";
import { startMusicAccountReplies } from "./music-account-replies.js";
import { startMusicAccountAi } from "./music-account-ai.js";
import { ensureButtonColorsSchema } from "./button-colors.js";
import { checkDatabase } from "./db.js";
import { flushPendingActivity } from "./activity.js";
import { ensureModerationSchema } from "./moderation-schema.js";
import { ensureProfileRepliesSchema } from "./profile-replies-schema.js";
import { ensureEconomySchema } from "./economy-schema.js";
import { ensureMandatorySubscriptionSchema } from "./mandatory-subscription-schema.js";
import { ensureEmojiReactionSchema } from "./emoji-reactions-schema.js";
import { ensureStartEditorSchema } from "./start-editor-schema.js";
import { ensureDeveloperPanelSchema } from "./developer-panel-schema.js";
import { ensureGamesManagerSchema } from "./games-manager-schema.js";
import { ensureMiniAppPanelSchema } from "./mini-app-panel.js";
import { ensureAiAssistantSchema } from "./ai-assistant-schema.js";
import { ensureImageQuizSchema } from "./image-quiz-schema.js";
import { ensureDemonNawafSchema } from "./games/demon-nawaf.js";
import { ensureConnect4Schema } from "./connect4-schema.js";
import { pool } from "./db.js";
import { registerMiniGameRoutes } from "./mini-games-api.js";
import { registerWordGameRoutes } from "./word-game-api.js";
import { registerOnlineLobbyRoutes } from "./online-lobbies-api.js";
import { ensureCasualGamesSchema, registerCasualGameRoutes } from "./casual-games-api.js";
import { ensureNumberSortSchema, registerNumberSortRoutes } from "./number-sort-api.js";
import { ensureDartsSchema } from "./darts-schema.js";
import { registerDartsRoutes } from "./darts-api.js";

ensureButtonColorsSchema().catch(error => console.error("Button colors schema initialization failed:", error));
ensureModerationSchema().catch(error => console.error("Moderation schema initialization failed:", error));
ensureProfileRepliesSchema().catch(error => console.error("Profile replies schema initialization failed:", error));
ensureEconomySchema().catch(error => console.error("Economy schema initialization failed:", error));
ensureMandatorySubscriptionSchema().catch(error => console.error("Mandatory subscription schema initialization failed:", error));
ensureEmojiReactionSchema().catch(error => console.error("Emoji reaction schema initialization failed:", error));
ensureStartEditorSchema().catch(error => console.error("Start editor schema initialization failed:", error));
ensureDeveloperPanelSchema().catch(error => console.error("Developer panel schema initialization failed:", error));
ensureGamesManagerSchema().catch(error => console.error("Games manager schema initialization failed:", error));
ensureMiniAppPanelSchema().catch(error => console.error("Mini App panel schema initialization failed:", error));
ensureAiAssistantSchema().catch(error => console.error("AI assistant schema initialization failed:", error));
ensureImageQuizSchema().catch(error => console.error("Image quiz schema initialization failed:", error));
ensureDemonNawafSchema().catch(error => console.error("Demon Nawaf schema initialization failed:", error));
ensureConnect4Schema().catch(error => console.error("Connect Four schema initialization failed:", error));
if (pool) {
  await Promise.all([ensureCasualGamesSchema(pool), ensureNumberSortSchema(pool), ensureDartsSchema(pool)]).catch(error => console.error("Mini-game schema initialization failed:", error));
}

const app = express();
const port = Number(process.env.PORT || 10000);
const gameDefinitions = [
  { name: "carrom", port: 10001 },
  { name: "gravity", port: 10002 },
  { name: "snowball", port: 10003 },
];
const gameProcesses = new Map();
const gameProxies = new Map();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
if (pool) {
  registerMiniGameRoutes(app, pool, process.env.BOT_TOKEN);
  registerWordGameRoutes(app, pool, process.env.BOT_TOKEN);
  registerOnlineLobbyRoutes(app, pool, process.env.BOT_TOKEN);
  registerCasualGameRoutes(app, pool, process.env.BOT_TOKEN);
  registerNumberSortRoutes(app, pool, process.env.BOT_TOKEN);
  registerDartsRoutes(app, pool, process.env.BOT_TOKEN);
}
app.use("/miniapp", express.static("public"));
app.use("/darts", express.static(path.resolve("games-src/darts/dist")));
app.use("/mini_app", express.static("public/mini_app"));

for (const game of gameDefinitions) {
  const proxy = httpProxy.createProxyServer({
    target: `http://127.0.0.1:${game.port}`,
    ws: true,
    xfwd: true,
  });

  proxy.on("error", (error, _req, res) => {
    console.error(`[${game.name}] proxy error:`, error.message);
    if (res && typeof res.writeHead === "function" && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Game server is starting. Please retry in a moment.");
    } else if (res && typeof res.destroy === "function") {
      res.destroy();
    }
  });

  gameProxies.set(game.name, proxy);
  app.use(`/${game.name}`, (req, res) => proxy.web(req, res));
}


async function telegramFile(fileId) {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("Telegram token is not configured");
  const metaResponse = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const meta = await metaResponse.json();
  if (!meta.ok || !meta.result?.file_path) throw new Error("Telegram file not found");
  const fileResponse = await fetch(`https://api.telegram.org/file/bot${token}/${meta.result.file_path}`);
  if (!fileResponse.ok) throw new Error("Telegram file download failed");
  return { buffer: Buffer.from(await fileResponse.arrayBuffer()), contentType: fileResponse.headers.get("content-type") || "application/octet-stream" };
}

app.get("/api/mini-app", async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const [settingsResult, buttonsResult, soundsResult, onlineImagesResult, colorsResult] = await Promise.all([
      pool.query("SELECT * FROM mini_app_settings WHERE id=1"),
      pool.query("SELECT * FROM mini_app_buttons ORDER BY button_type DESC, button_order, id"),
      pool.query("SELECT * FROM mini_app_sounds ORDER BY id").catch(() => ({ rows: [] })),
      pool.query("SELECT * FROM online_game_images").catch(() => ({ rows: [] })),
      pool.query("SELECT * FROM mini_app_button_colors").catch(() => ({ rows: [] })),
    ]);
    const settings = settingsResult.rows[0] || {};
    const sounds = soundsResult.rows;
    const onlineImages = onlineImagesResult.rows;
    const buttonColors = Object.fromEntries(colorsResult.rows.map(row => [row.button_text, row.color_hex]));
    let me = null;
    if (process.env.BOT_TOKEN) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getMe`);
        const data = await response.json();
        if (data.ok) me = data.result;
      } catch {}
    }
    res.set("Cache-Control", "no-store").json({
      leaderboard: null,
      bot_username: me?.username || null,
      bot_name: me?.first_name || "البوت",
      banner: settings.banner_file_id ? "/tg-file/" + encodeURIComponent(settings.banner_file_id) : null,
      banner_type: settings.banner_media_kind || "image",
      banner_mime_type: settings.banner_mime_type || null,
      buttons: buttonsResult.rows.map(row => ({
        id: row.id, title: row.title, target: row.target, type: row.button_type,
        color: row.color, image: row.image_file_id ? "/tg-file/" + encodeURIComponent(row.image_file_id) : null,
        media_kind: row.media_kind || "image", mime_type: row.mime_type || null
      })),
      button_colors: buttonColors,
      sounds: sounds.map(row => ({
        id: row.id, title: row.title, type: row.media_kind || "audio",
        mime_type: row.mime_type || null, url: `/mini-app/sound/${row.id}`
      })),
      online_game_images: Object.fromEntries(onlineImages.map(row => [
        row.game_type, "/tg-file/" + encodeURIComponent(row.photo_file_id)
      ]))
    });
  } catch (error) {
    console.error("Mini App payload failed:", error);
    res.status(503).json({ ok: false, error: "تعذر تحميل بيانات الميني آب" });
  }
});

app.get("/tg-file/:fileId", async (req, res) => {
  try {
    const { buffer, contentType } = await telegramFile(req.params.fileId);
    res.set("Cache-Control", "public, max-age=3600").type(contentType).send(buffer);
  } catch (error) {
    console.error("Mini App Telegram media failed:", error.message);
    res.sendStatus(404);
  }
});

app.get("/number-sort/background", async (_req, res) => {
  try {
    const result = await pool.query("SELECT background_file_id FROM number_sort_settings WHERE id=1");
    const fileId = result.rows[0]?.background_file_id;
    if (!fileId) return res.sendStatus(404);
    const { buffer, contentType } = await telegramFile(fileId);
    res.set("Cache-Control", "public, max-age=3600").type(contentType).send(buffer);
  } catch (error) {
    console.error("Number Sort background failed:", error.message);
    res.sendStatus(404);
  }
});

app.get("/mini-app/sound/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT file_id,mime_type,media_kind FROM mini_app_sounds WHERE id=$1", [Number(req.params.id)]);
    const sound = result.rows[0];
    if (!sound) return res.sendStatus(404);
    const { buffer, contentType } = await telegramFile(sound.file_id);
    res.set("Cache-Control", "public, max-age=3600").type(sound.mime_type || contentType).send(buffer);
  } catch (error) {
    console.error("Mini App sound failed:", error.message);
    res.sendStatus(404);
  }
});

app.get("/", (_req, res) => res.redirect("/miniapp/"));
app.get("/health", (_req, res) => res.status(200).send("Bot is running"));

app.get("/api/health/db", async (_req, res) => {
  try {
    const result = await checkDatabase();
    res.json({ ok: true, database: result });
  } catch (error) {
    console.error("Database health check failed:", error);
    res.status(503).json({ ok: false, error: "Database unavailable" });
  }
});

app.get("/api/health/games", async (_req, res) => {
  const results = await Promise.all(gameDefinitions.map(async (game) => {
    try {
      const response = await fetch(`http://127.0.0.1:${game.port}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      const body = await response.json();
      return { name: game.name, ok: response.ok, ...body };
    } catch {
      return { name: game.name, ok: false };
    }
  }));
  const ok = results.every((game) => game.ok);
  res.status(ok ? 200 : 503).json({ ok, games: results });
});

startAccountClock().catch(() => console.error("[ACCOUNT CLOCK] Startup failed."));
startAutoPrivateReply().catch(() => console.error("[AUTO REPLY] Startup failed."));
startMusicAccountReplies().catch(() => console.error("[MUSIC ACCOUNT REPLIES] Startup failed."));
startMusicAccountAi().catch(() => console.error("[MUSIC ACCOUNT AI] Startup failed."));

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`HTTP server listening on port ${port}`);
});

if (process.env.ENABLE_GAME_SERVERS !== "false") {
  for (const game of gameDefinitions) {
    const cwd = path.resolve(process.cwd(), "games-src", game.name);
    const child = spawn(process.execPath, ["server.ts"], {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(game.port),
      },
      stdio: "inherit",
    });
    child.on("error", (error) => {
      console.error(`[${game.name}] failed to start:`, error);
    });
    child.on("exit", (code, signal) => {
      console.error(`[${game.name}] exited (code=${code}, signal=${signal})`);
    });
    gameProcesses.set(game.name, child);
    console.log(`[${game.name}] starting on internal port ${game.port}`);
  }
} else {
  console.log("Game servers are disabled by ENABLE_GAME_SERVERS.");
}

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (pathname === "/ws/carrom") {
    gameProxies.get("carrom")?.ws(req, socket, head);
    return;
  }
  if (pathname === "/ws/gravity") {
    gameProxies.get("gravity")?.ws(req, socket, head);
    return;
  }
  if (pathname === "/ws/snowball") {
    gameProxies.get("snowball")?.ws(req, socket, head);
    return;
  }
  socket.destroy();
});

const bot = process.env.ENABLE_TELEGRAM_BOT === "true" ? createBot() : null;
if (!bot) console.log("Telegram polling is disabled until cutover.");
if (bot) {
  const configureMiniAppMenu = async () => {
    try {
      await bot.api.setChatMenuButton({
        menu_button: {
          type: "web_app",
          text: "الألعاب",
          web_app: { url: "https://nawaf-bot-node-xsna.onrender.com/miniapp/" },
        },
      });
      console.log("Telegram Mini App menu button points to the current Node Mini App.");
    } catch (error) {
      console.error("Could not update Telegram Mini App menu button:", error?.description || error?.message || error);
    }
  };
  configureMiniAppMenu();
  const startPolling = async () => {
    while (true) {
      try {
        await bot.start({ onStart: () => console.log("Telegram polling started.") });
        return;
      } catch (error) {
        const description = error?.description || error?.message || String(error);
        const conflict = error?.error_code === 409 || /409|terminated by other getUpdates request/i.test(description);
        console.error("Telegram polling failed:", description);
        if (!conflict) return;
        // Render can briefly overlap old and new instances during a rolling deploy.
        try { await bot.stop(); } catch {}
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  };
  startPolling().catch(error => console.error("Telegram polling restart failed:", error));
}

async function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  if (bot) await bot.stop();
  try { await flushPendingActivity(); } catch (error) { console.error("Final activity flush failed:", error); }
  for (const child of gameProcesses.values()) child.kill("SIGTERM");
  for (const proxy of gameProxies.values()) proxy.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
