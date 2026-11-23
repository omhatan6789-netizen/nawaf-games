import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const PORT =
  process.env.NODE_ENV === 'production'
    ? Number(process.env.PORT) || 3000
    : Number(process.env.DEFAULT_APP_PORT) || 3000;

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', '.aistudio']);
const IGNORED_FILES = new Set(['bun.lock', '.DS_Store']);

const GRID_SIZE = 9;
const BOMB_COUNT = 3;
const MAX_HEARTS = 3;
const PREP_DURATION_SEC = 25;
const TURN_DURATION_SEC = 15;
const REVEAL_DURATION_SEC = 3;

type CellStatus =
  | 'CHIP'
  | 'SAFE_EATEN'
  | 'EXPLODING_BOMB'
  | 'EXPLODING_SMOKE'
  | 'BOMB_CHARRED'
  | 'BOMB_REVEALED';

type RoomPhase =
  | 'LOBBY'
  | 'PREP'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'REVEALING_BOMBS'
  | 'GAME_OVER';

interface PlayerState {
  slot: 0 | 1;
  clientId: string;
  name: string;
  ws: WebSocket | null;
  bombs: number[];
  ready: boolean;
  hearts: number;
  board: CellStatus[];
  rematchRequested: boolean;
}

interface RoomState {
  id: string;
  phase: RoomPhase;
  players: PlayerState[];
  turnSlot: 0 | 1;
  prepTimer: number;
  countdownValue: number;
  turnTimer: number;
  revealTimer: number;
  isResolvingPick: boolean;
  winnerSlot: 0 | 1 | null;
  withdrawnSlot: 0 | 1 | null;
  intervalId: ReturnType<typeof setInterval> | null;
  timeouts: ReturnType<typeof setTimeout>[];
}

const rooms = new Map<string, RoomState>();

function createEmptyBoard(): CellStatus[] {
  return Array.from({ length: GRID_SIZE }, () => 'CHIP');
}


function completeBombs(existing: number[]): number[] {
  const valid = new Set<number>();
  for (const idx of existing) {
    if (
      Number.isInteger(idx) &&
      idx >= 0 &&
      idx < GRID_SIZE &&
      valid.size < BOMB_COUNT
    ) {
      valid.add(idx);
    }
  }
  const available = Array.from({ length: GRID_SIZE }, (_, i) => i).filter(
    (i) => !valid.has(i)
  );
  while (valid.size < BOMB_COUNT && available.length > 0) {
    const r = Math.floor(Math.random() * available.length);
    valid.add(available[r]);
    available.splice(r, 1);
  }
  return Array.from(valid);
}

function clearRoomTimers(room: RoomState) {
  if (room.intervalId) {
    clearInterval(room.intervalId);
    room.intervalId = null;
  }
  for (const t of room.timeouts) {
    clearTimeout(t);
  }
  room.timeouts = [];
}

function safeSend(ws: WebSocket | null, payload: unknown) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function broadcastRoomState(room: RoomState) {
  const showAllBombs =
    room.phase === 'REVEALING_BOMBS' || room.phase === 'GAME_OVER';

  for (const recipient of room.players) {
    if (!recipient.ws) continue;
    const opponent =
      room.players.find((p) => p.slot !== recipient.slot) ?? null;

    const myCells = recipient.board.map((status, index) => ({
      index,
      hasBomb: recipient.bombs.includes(index),
      status,
    }));

    const oppCells = (opponent?.board ?? createEmptyBoard()).map(
      (status, index) => ({
        index,
        hasBomb:
          showAllBombs && opponent ? opponent.bombs.includes(index) : false,
        status,
      })
    );

    safeSend(recipient.ws, {
      type: 'room_state',
      roomId: room.id,
      phase: room.phase,
      mySlot: recipient.slot,
      myName: recipient.name,
      myReady: recipient.ready,
      myHearts: recipient.hearts,
      myCells,
      opponentName: opponent?.name ?? '',
      opponentConnected: Boolean(opponent?.ws),
      opponentReady: opponent?.ready ?? false,
      opponentHearts: opponent?.hearts ?? MAX_HEARTS,
      opponentCells: oppCells,
      players: room.players.map((p) => ({
        slot: p.slot,
        name: p.name,
        connected: Boolean(p.ws),
      })),
      turnSlot: room.turnSlot,
      prepTimer: room.prepTimer,
      countdownValue: room.countdownValue,
      turnTimer: room.turnTimer,
      revealTimer: room.revealTimer,
      isResolvingPick: room.isResolvingPick,
      winnerSlot: room.winnerSlot,
      withdrawnSlot: room.withdrawnSlot,
      rematchPending: recipient.rematchRequested,
    });
  }
}

function startPrepPhase(room: RoomState) {
  clearRoomTimers(room);
  room.phase = 'PREP';
  room.prepTimer = PREP_DURATION_SEC;
  room.countdownValue = 3;
  room.turnTimer = TURN_DURATION_SEC;
  room.revealTimer = REVEAL_DURATION_SEC;
  room.turnSlot = 0;
  room.isResolvingPick = false;
  room.winnerSlot = null;
  room.withdrawnSlot = null;

  for (const p of room.players) {
    p.bombs = [];
    p.ready = false;
    p.hearts = MAX_HEARTS;
    p.board = createEmptyBoard();
    p.rematchRequested = false;
  }

  broadcastRoomState(room);

  room.intervalId = setInterval(() => {
    if (room.phase !== 'PREP') return;
    room.prepTimer = Math.max(0, room.prepTimer - 1);
    broadcastRoomState(room);
    if (room.prepTimer <= 0) {
      startCountdownPhase(room);
    }
  }, 1000);
}

function startCountdownPhase(room: RoomState) {
  clearRoomTimers(room);

  for (const p of room.players) {
    p.bombs = completeBombs(p.bombs);
    p.ready = true;
  }

  room.phase = 'COUNTDOWN';
  room.countdownValue = 3;
  broadcastRoomState(room);

  room.timeouts.push(
    setTimeout(() => {
      if (room.phase !== 'COUNTDOWN') return;
      room.countdownValue = 2;
      broadcastRoomState(room);
    }, 850)
  );

  room.timeouts.push(
    setTimeout(() => {
      if (room.phase !== 'COUNTDOWN') return;
      room.countdownValue = 1;
      broadcastRoomState(room);
    }, 1700)
  );

  room.timeouts.push(
    setTimeout(() => {
      if (room.phase !== 'COUNTDOWN') return;
      startPlayingPhase(room);
    }, 2550)
  );
}

function startPlayingPhase(room: RoomState) {
  clearRoomTimers(room);
  room.phase = 'PLAYING';
  room.turnSlot = 0;
  room.turnTimer = TURN_DURATION_SEC;
  room.isResolvingPick = false;
  broadcastRoomState(room);

  room.intervalId = setInterval(() => {
    if (room.phase !== 'PLAYING' || room.isResolvingPick) return;
    room.turnTimer = Math.max(0, room.turnTimer - 1);
    if (room.turnTimer <= 0) {
      const targetPlayer = room.players.find((p) => p.slot !== room.turnSlot);
      if (targetPlayer) {
        const available = targetPlayer.board
          .map((st, idx) => ({ st, idx }))
          .filter((item) => item.st === 'CHIP');
        if (available.length > 0) {
          const rand = available[Math.floor(Math.random() * available.length)];
          resolvePick(room, room.turnSlot, rand.idx);
          return;
        }
      }
    }
    broadcastRoomState(room);
  }, 1000);
}

function triggerRevealAndEnd(room: RoomState, winnerSlot: 0 | 1) {
  clearRoomTimers(room);
  room.phase = 'REVEALING_BOMBS';
  room.revealTimer = REVEAL_DURATION_SEC;
  room.winnerSlot = winnerSlot;

  for (const p of room.players) {
    p.board = p.board.map((st, idx) =>
      st === 'CHIP' && p.bombs.includes(idx) ? 'BOMB_REVEALED' : st
    );
  }
  broadcastRoomState(room);

  room.timeouts.push(
    setTimeout(() => {
      if (room.phase !== 'REVEALING_BOMBS') return;
      room.revealTimer = 2;
      broadcastRoomState(room);
    }, 1000)
  );

  room.timeouts.push(
    setTimeout(() => {
      if (room.phase !== 'REVEALING_BOMBS') return;
      room.revealTimer = 1;
      broadcastRoomState(room);
    }, 2000)
  );

  room.timeouts.push(
    setTimeout(() => {
      if (room.phase !== 'REVEALING_BOMBS') return;
      room.phase = 'GAME_OVER';
      broadcastRoomState(room);
    }, REVEAL_DURATION_SEC * 1000)
  );
}

function resolvePick(room: RoomState, actorSlot: 0 | 1, cellIndex: number) {
  if (room.phase !== 'PLAYING' || room.isResolvingPick) return;
  if (room.turnSlot !== actorSlot) return;

  const actor = room.players.find((p) => p.slot === actorSlot);
  const target = room.players.find((p) => p.slot !== actorSlot);
  if (!actor || !target) return;
  if (cellIndex < 0 || cellIndex >= GRID_SIZE) return;
  if (target.board[cellIndex] !== 'CHIP') return;

  room.isResolvingPick = true;
  const isBomb = target.bombs.includes(cellIndex);

  if (!isBomb) {
    target.board[cellIndex] = 'SAFE_EATEN';
    for (const p of room.players) {
      safeSend(p.ws, {
        type: 'pick_fx',
        fx: 'crunch',
        targetSlot: target.slot,
      });
    }
    broadcastRoomState(room);

    room.timeouts.push(
      setTimeout(() => {
        if (room.phase !== 'PLAYING') return;
        room.turnSlot = actorSlot === 0 ? 1 : 0;
        room.turnTimer = TURN_DURATION_SEC;
        room.isResolvingPick = false;
        broadcastRoomState(room);
      }, 580)
    );
  } else {
    target.board[cellIndex] = 'EXPLODING_BOMB';
    for (const p of room.players) {
      safeSend(p.ws, {
        type: 'pick_fx',
        fx: 'bomb_reveal',
        targetSlot: target.slot,
      });
    }
    broadcastRoomState(room);

    room.timeouts.push(
      setTimeout(() => {
        if (room.phase !== 'PLAYING') return;
        target.board[cellIndex] = 'EXPLODING_SMOKE';
        actor.hearts = Math.max(0, actor.hearts - 1);
        for (const p of room.players) {
          safeSend(p.ws, {
            type: 'pick_fx',
            fx: 'explosion',
            targetSlot: target.slot,
          });
        }
        broadcastRoomState(room);
      }, 440)
    );

    room.timeouts.push(
      setTimeout(() => {
        if (room.phase !== 'PLAYING') return;
        target.board[cellIndex] = 'BOMB_CHARRED';
        broadcastRoomState(room);

        if (actor.hearts <= 0) {
          room.timeouts.push(
            setTimeout(() => {
              if (room.phase !== 'PLAYING') return;
              triggerRevealAndEnd(room, target.slot);
            }, 320)
          );
        } else {
          room.turnSlot = actorSlot === 0 ? 1 : 0;
          room.turnTimer = TURN_DURATION_SEC;
          room.isResolvingPick = false;
          broadcastRoomState(room);
        }
      }, 1060)
    );
  }
}

function collectProjectFiles(dirPath: string, relativeBase = ''): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const collected: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const nextRel = relativeBase
        ? `${relativeBase}/${entry.name}`
        : entry.name;
      collected.push(
        ...collectProjectFiles(path.join(dirPath, entry.name), nextRel)
      );
    } else if (entry.isFile()) {
      if (IGNORED_FILES.has(entry.name)) continue;
      const fileRel = relativeBase
        ? `${relativeBase}/${entry.name}`
        : entry.name;
      collected.push(fileRel);
    }
  }

  return collected;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.post('/api/internal/inline-room', (req, res) => {
    const expectedToken = process.env.BOT_TOKEN;
    if (!expectedToken || req.get('x-bot-token') !== expectedToken) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const userId = String(req.body?.userId || '').trim();
    if (!/^\\d+$/.test(userId)) {
      return res.status(400).json({ ok: false, error: 'Invalid Telegram user' });
    }
    const roomId = randomUUID().replace(/-/g, '').toUpperCase();
    const name = String(req.body?.name || '').trim().slice(0, 22) || 'لاعب ١';
    const room: RoomState = {
      id: roomId,
      phase: 'LOBBY',
      players: [{
        slot: 0,
        clientId: 'tg_' + userId,
        name,
        ws: null,
        bombs: [],
        ready: false,
        hearts: MAX_HEARTS,
        board: createEmptyBoard(),
        rematchRequested: false,
      }],
      turnSlot: 0,
      prepTimer: PREP_DURATION_SEC,
      countdownValue: 3,
      turnTimer: TURN_DURATION_SEC,
      revealTimer: REVEAL_DURATION_SEC,
      isResolvingPick: false,
      winnerSlot: null,
      withdrawnSlot: null,
      intervalId: null,
      timeouts: [],
    };
    rooms.set(roomId, room);
    res.json({ ok: true, roomId });
  });
  const server = http.createServer(app);

  app.get('/api/download-zip', async (_req, res) => {
    try {
      const zip = new JSZip();
      const files = collectProjectFiles(ROOT_DIR);

      for (const relPath of files) {
        const absPath = path.join(ROOT_DIR, relPath);
        const content = fs.readFileSync(absPath);
        zip.file(`al-batates-game/${relPath}`, content);
      }

      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="al-batates-game.zip"'
      );
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (error) {
      console.error('Failed to generate ZIP archive:', error);
      res.status(500).json({ error: 'Failed to create ZIP archive' });
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws/potato' });

  wss.on('connection', (ws) => {
    let attachedRoomId: string | null = null;
    let attachedClientId: string | null = null;

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'join_room') {
        const roomId = String(msg.roomId || '').trim().toUpperCase();
        const name = String(msg.name || '').trim().slice(0, 22) || 'لاعب ٢';
        const clientId =
          String(msg.clientId || '').trim() || `c_${Date.now()}`;
        const room = rooms.get(roomId);

        if (!room) {
          safeSend(ws, { type: 'error', message: 'الغرفة غير موجودة أو انتهت' });
          return;
        }

        const existing = room.players.find((p) => p.clientId === clientId);
        if (existing) {
          existing.ws = ws;
          existing.name = name || existing.name;
          attachedRoomId = roomId;
          attachedClientId = clientId;
          broadcastRoomState(room);
          return;
        }

        if (room.players.length >= 2) {
          safeSend(ws, { type: 'error', message: 'الغرفة ممتلئة بالفعل' });
          return;
        }

        if (room.phase !== 'LOBBY') {
          safeSend(ws, { type: 'error', message: 'المباراة بدأت بالفعل' });
          return;
        }

        room.players.push({
          slot: 1,
          clientId,
          name,
          ws,
          bombs: [],
          ready: false,
          hearts: MAX_HEARTS,
          board: createEmptyBoard(),
          rematchRequested: false,
        });
        attachedRoomId = roomId;
        attachedClientId = clientId;
        broadcastRoomState(room);
        return;
      }

      if (!attachedRoomId || !attachedClientId) return;
      const room = rooms.get(attachedRoomId);
      if (!room) return;
      const player = room.players.find((p) => p.clientId === attachedClientId);
      if (!player) return;

      if (type === 'start_match') {
        if (player.slot !== 0 || room.players.length < 2) return;
        if (room.phase !== 'LOBBY') return;
        startPrepPhase(room);
        return;
      }

      if (type === 'update_bombs') {
        if (room.phase !== 'PREP' || player.ready) return;
        const incoming = Array.isArray(msg.bombs) ? msg.bombs : [];
        const clean: number[] = [];
        for (const item of incoming) {
          const num = Number(item);
          if (
            Number.isInteger(num) &&
            num >= 0 &&
            num < GRID_SIZE &&
            !clean.includes(num) &&
            clean.length < BOMB_COUNT
          ) {
            clean.push(num);
          }
        }
        player.bombs = clean;
        broadcastRoomState(room);
        return;
      }

      if (type === 'submit_bombs') {
        if (room.phase !== 'PREP') return;
        const incoming = Array.isArray(msg.bombs) ? msg.bombs : player.bombs;
        const clean = incoming
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 0 && n < GRID_SIZE);
        const unique = Array.from(new Set(clean)).slice(0, BOMB_COUNT);
        if (unique.length < BOMB_COUNT) return;
        player.bombs = unique;
        player.ready = true;
        broadcastRoomState(room);

        if (room.players.length === 2 && room.players.every((p) => p.ready)) {
          startCountdownPhase(room);
        }
        return;
      }

      if (type === 'pick_cell') {
        const index = Number(msg.index);
        resolvePick(room, player.slot, index);
        return;
      }

      if (type === 'withdraw') {
        if (room.phase === 'LOBBY') {
          if (player.slot === 0) {
            clearRoomTimers(room);
            for (const other of room.players) {
              if (other.slot !== 0) {
                safeSend(other.ws, {
                  type: 'error',
                  message: 'قام صاحب الغرفة بإغلاق الغرفة',
                });
              }
            }
            rooms.delete(room.id);
          } else {
            room.players = room.players.filter((p) => p.slot !== player.slot);
            broadcastRoomState(room);
          }
          attachedRoomId = null;
          return;
        }

        if (room.phase === 'GAME_OVER' || room.phase === 'REVEALING_BOMBS')
          return;
        clearRoomTimers(room);
        const opp = room.players.find((p) => p.slot !== player.slot);
        room.withdrawnSlot = player.slot;
        room.winnerSlot = opp ? opp.slot : null;
        room.phase = 'GAME_OVER';
        broadcastRoomState(room);
        return;
      }

      if (type === 'rematch') {
        if (room.phase !== 'GAME_OVER' || room.players.length < 2) return;
        player.rematchRequested = true;
        broadcastRoomState(room);

        if (room.players.every((p) => p.rematchRequested)) {
          startPrepPhase(room);
        }
      }
    });

    ws.on('close', () => {
      if (!attachedRoomId || !attachedClientId) return;
      const room = rooms.get(attachedRoomId);
      if (!room) return;
      const player = room.players.find((p) => p.clientId === attachedClientId);
      if (!player) return;
      player.ws = null;
      if (room.phase === 'LOBBY') {
        // Keep the invited player's slot reserved while they temporarily close
        // the Mini App; reopening the Telegram invitation reconnects them.
        broadcastRoomState(room);
        return;
      }
      if (room.phase === 'PREP' || room.phase === 'COUNTDOWN' || room.phase === 'PLAYING') {
        const opp = room.players.find((p) => p.slot !== player.slot);
        if (opp && opp.ws) {
          clearRoomTimers(room);
          room.withdrawnSlot = player.slot;
          room.winnerSlot = opp.slot;
          room.phase = 'GAME_OVER';
          broadcastRoomState(room);
        } else {
          clearRoomTimers(room);
          rooms.delete(room.id);
        }
      } else {
        const anyConnected = room.players.some((p) => Boolean(p.ws));
        if (!anyConnected) {
          clearRoomTimers(room);
          rooms.delete(room.id);
        } else {
          broadcastRoomState(room);
        }
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
