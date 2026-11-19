import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { createBot } from "./bot.js";
import { checkDatabase } from "./db.js";

const app = express();
const port = Number(process.env.PORT || 10000);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use("/miniapp", express.static("public"));

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

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`HTTP server listening on port ${port}`);
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
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
