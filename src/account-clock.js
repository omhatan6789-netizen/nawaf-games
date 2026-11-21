import { TelegramClient } from "@mtcute/node";
import { convertFromPyrogramSession } from "@mtcute/convert";

const ACCOUNT_ID = 6496915877;
const TIME_ZONE = "Asia/Riyadh";
// Remove every consecutive clock suffix, not just the last one.
const CLOCK_PATTERN = /(?:\\s+⌁\\s+\\d{1,2}:\\d{2}\\s+(?:AM|PM))+$/i;
let clientPromise;

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
  const match = String(error?.message || "").match(/FLOOD_WAIT[_ ](\\d+)/i);
  return match ? Number(match[1]) : 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getMusicAccountClient() {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const apiId = Number(process.env.API_ID);
    const apiHash = process.env.API_HASH;
    const sessionString = process.env.SESSION_STRING;
    if (!apiId || !apiHash || !sessionString) {
      throw new Error("API_ID, API_HASH or SESSION_STRING is missing");
    }

    const client = new TelegramClient({ apiId, apiHash });
    try {
      await client.importSession(convertFromPyrogramSession(sessionString));
      await client.connect();
      const account = await client.getMe();
      if (Number(account.id) !== ACCOUNT_ID) {
        throw new Error("Connected account ID does not match the configured music account");
      }

      // connect() establishes the MTProto connection but does not start
      // receiving updates. Start the updates loop once for all account features.
      await client.startUpdatesLoop();
      console.log("[MUSIC ACCOUNT] Updates loop started.");
      console.log("[MUSIC ACCOUNT] Account verified and connected.");
      return client;
    } catch (error) {
      try { await client.destroy(); } catch {}
      throw error;
    }
  })();

  try {
    return await clientPromise;
  } catch (error) {
    clientPromise = null;
    throw error;
  }
}

export async function startAccountClock() {
  let client;
  try {
    client = await getMusicAccountClient();
  } catch {
    console.error("[ACCOUNT CLOCK] Could not connect or verify the music account. Check the account credentials and session.");
    return;
  }

  console.log("[ACCOUNT CLOCK] Riyadh clock started.");
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
}
