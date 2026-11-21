import { TelegramClient } from "@mtcute/node";
import { convertFromPyrogramSession } from "@mtcute/convert";

const ACCOUNT_ID = 6496915877;
const TIME_ZONE = "Asia/Riyadh";
const CLOCK_PATTERN = /\s+⌁\s+\d{1,2}:\d{2}\s+(?:AM|PM)$/;

function getRiyadhClock() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}

function millisecondsUntilNextMinute() {
  const now = new Date();
  return Math.max(1000, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}

function floodWaitSeconds(error) {
  const direct = Number(error?.seconds ?? error?.value);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const match = String(error?.message || "").match(/FLOOD_WAIT[_ ](\d+)/i);
  return match ? Number(match[1]) : 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startAccountClock() {
  const apiId = Number(process.env.API_ID);
  const apiHash = process.env.API_HASH;
  const sessionString = process.env.SESSION_STRING;

  if (!apiId || !apiHash || !sessionString) {
    console.log("[ACCOUNT CLOCK] Disabled: API_ID, API_HASH or SESSION_STRING is missing.");
    return;
  }

  const client = new TelegramClient({ apiId, apiHash });

  try {
    await client.importSession(convertFromPyrogramSession(sessionString));
    await client.connect();

    const account = await client.getMe();
    if (Number(account.id) !== ACCOUNT_ID) {
      console.error("[ACCOUNT CLOCK] Disabled: connected account ID does not match the configured account.");
      await client.destroy();
      return;
    }

    console.log("[ACCOUNT CLOCK] Music account verified. Riyadh clock started.");

    while (true) {
      try {
        const me = await client.getMe();
        const baseName = String(me.firstName || "").replace(CLOCK_PATTERN, "").trim();
        const newName = `${baseName} ⌁ ${getRiyadhClock()}`;

        if (me.firstName !== newName) {
          await client.updateProfile({ firstName: newName });
        }

        await sleep(millisecondsUntilNextMinute());
      } catch (error) {
        const waitSeconds = floodWaitSeconds(error);
        if (waitSeconds) {
          console.warn(`[ACCOUNT CLOCK] Telegram rate limit; waiting ${waitSeconds} seconds.`);
          await sleep(waitSeconds * 1000);
        } else {
          console.error("[ACCOUNT CLOCK] Update failed; retrying in 60 seconds.");
          await sleep(60_000);
        }
      }
    }
  } catch {
    console.error("[ACCOUNT CLOCK] Could not connect or verify the music account. Check the account credentials and session.");
    try { await client.destroy(); } catch {}
  }
}
