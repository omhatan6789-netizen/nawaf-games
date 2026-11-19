import "dotenv/config";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { spawn } from "node:child_process";
import httpProxy from "http-proxy";
import { createBot } from "./bot.js";
import { checkDatabase } from "./db.js";
import { flushPendingActivity } from "./activity.js";
import { ensureModerationSchema } from "./moderation-schema.js";
import { ensureProfileRepliesSchema } from "./profile-replies-schema.js";
import { ensureEconomySchema } from "./economy-schema.js";
import { ensureMandatorySubscriptionSchema } from "./mandatory-subscription-schema.js";
import { ensureEmojiReactionSchema } from "./emoji-reactions-schema.js";

ensureModerationSchema().catch(error => console.error("Moderation schema initialization failed:", error));
ensureProfileRepliesSchema().catch(error => console.error("Profile replies schema initialization failed:", error));
ensureEconomySchema().catch(error => console.error("Economy schema initialization failed:", error));
ensureMandatorySubscriptionSchema().catch(error => console.error("Mandatory subscription schema initialization failed:", error));
ensureEmojiReactionSchema().catch(error => console.error("Emoji reaction schema initialization failed:", error));

const app = express();
const port = Number(process.env.PORT || 10000);
const gameDefinitions = [
  { name: "carrom", port: 10001 },
  { name: "gravity", port: 10002 },
];
const gameProcesses = new Map();
const gameProxies = new Map();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use("/miniapp", express.static("public"));

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
  socket.destroy();
});

const bot = process.env.ENABLE_TELEGRAM_BOT === "true" ? createBot() : null;
if (!bot) console.log("Telegram polling is disabled until cutover.");
if (bot) {
  bot.start().then(() => console.log("Telegram polling started."))
    .catch((error) => console.error("Telegram polling failed:", error));
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
