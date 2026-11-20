import express from 'express';
import fs from 'fs';
import http from 'http';
import JSZip from 'jszip';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  CarromDisc,
  CarromPlayerState,
  FourPlayerMode,
  MAX_SHOT_SPEED,
  PieceKind,
  PlayerCount,
  QueenStatus,
  createInitialCoins,
  createStriker,
  findNearestClearSlider,
  isStrikerSpotClear,
  resolveCarromTurn,
  sliderToStrikerPos,
  stepCarromPhysics,
} from './src/game/carromPhysics.ts';
import {
  MINI_APP_INDEX_PATCH,
  MINI_APP_SERVER_PATCH,
  ONLINE_MODE_PY_PATCH,
  buildStandaloneCarromReadme,
} from './src/game/exportCarromMiniApp.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RoomPlayer {
  id: string;
  name: string;
  connected: boolean;
  withdrawn: boolean;
  ws: WebSocket | null;
}

interface RoomSpectator {
  id: string;
  name: string;
  ws: WebSocket;
}

interface ActiveCarromGame {
  coins: CarromDisc[];
  striker: CarromDisc | null;
  players: CarromPlayerState[];
  turn: number;
  sliderNorm: number;
  queenStatus: QueenStatus;
  queenHolderSlot: number | null;
  shotMoving: boolean;
  turnsPlayed: number;
  pocketedThisTurn: PieceKind[];
  strikerPocketedThisTurn: boolean;
  remoteAim: {
    active: boolean;
    pullX: number;
    pullY: number;
    powerNorm: number;
    dirX: number;
    dirY: number;
    validPull: boolean;
  } | null;
  tickCounter: number;
}

interface CarromRoom {
  id: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  playerCount: PlayerCount;
  fourMode: FourPlayerMode;
  createdAt: number;
  players: RoomPlayer[];
  spectators: Map<string, RoomSpectator>;
  game: ActiveCarromGame | null;
  interval: ReturnType<typeof setInterval> | null;
}

interface SocketSession {
  roomId: string | null;
  playerId: string | null;
  isSpectator: boolean;
}

const rooms = new Map<string, CarromRoom>();
const sessions = new WeakMap<WebSocket, SocketSession>();

function makeRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(out) ? makeRoomId() : out;
}

function makeClientId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
  return cleaned || fallback;
}

function sendJson(ws: WebSocket | null, payload: unknown) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function broadcastRoom(room: CarromRoom, payload: unknown) {
  const encoded = JSON.stringify(payload);
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(encoded);
    }
  }
  for (const s of room.spectators.values()) {
    if (s.ws.readyState === WebSocket.OPEN) {
      s.ws.send(encoded);
    }
  }
}

function serializeRoomLobby(room: CarromRoom) {
  return {
    type: 'room_state',
    room: {
      id: room.id,
      hostId: room.hostId,
      status: room.status,
      playerCount: room.playerCount,
      fourMode: room.fourMode,
      players: room.players.map((p, idx) => ({
        id: p.id,
        name: p.name,
        slotIndex: idx,
        side:
          room.playerCount === 4 && room.fourMode === 'solo'
            ? 'solo'
            : idx % 2 === 0
              ? 'white'
              : 'black',
        connected: p.connected,
        withdrawn: p.withdrawn,
      })),
      spectatorsCount: room.spectators.size,
    },
  };
}

function initCarromGame(room: CarromRoom) {
  const count = room.playerCount;
  const isTeams = count === 4 && room.fourMode === 'teams';
  const isSolo = count === 4 && room.fourMode === 'solo';

  const players: CarromPlayerState[] = room.players.map((rp, idx) => ({
    id: rp.id,
    name: rp.name,
    slotIndex: idx,
    side: isSolo ? 'solo' : idx % 2 === 0 ? 'white' : 'black',
    teamIndex: isTeams ? idx % 2 : idx,
    score: 0,
    pocketedCount: 0,
    hasQueen: false,
  }));

  const coins = createInitialCoins();
  const clearNorm = findNearestClearSlider(0, 0, count, coins);
  const striker = createStriker(0, count, clearNorm);

  room.game = {
    coins,
    striker,
    players,
    turn: 0,
    sliderNorm: clearNorm,
    queenStatus: 'on_board',
    queenHolderSlot: null,
    shotMoving: false,
    turnsPlayed: 0,
    pocketedThisTurn: [],
    strikerPocketedThisTurn: false,
    remoteAim: null,
    tickCounter: 0,
  };

  broadcastSnapshot(room);
}

function buildSnapshotPayload(room: CarromRoom) {
  const g = room.game;
  if (!g) return null;
  return {
    type: 'carrom_snapshot',
    roomId: room.id,
    playerCount: room.playerCount,
    fourMode: room.fourMode,
    players: g.players,
    coins: g.coins.map((c) => ({
      ...c,
      x: Number(c.x.toFixed(2)),
      y: Number(c.y.toFixed(2)),
      vx: Number(c.vx.toFixed(1)),
      vy: Number(c.vy.toFixed(1)),
    })),
    striker: g.striker
      ? {
          ...g.striker,
          x: Number(g.striker.x.toFixed(2)),
          y: Number(g.striker.y.toFixed(2)),
          vx: Number(g.striker.vx.toFixed(1)),
          vy: Number(g.striker.vy.toFixed(1)),
        }
      : null,
    turn: g.turn,
    shotMoving: g.shotMoving,
    sliderNorm: Number(g.sliderNorm.toFixed(3)),
    queenStatus: g.queenStatus,
    queenHolderSlot: g.queenHolderSlot,
    remoteAim: g.remoteAim,
  };
}

function broadcastSnapshot(room: CarromRoom) {
  const snap = buildSnapshotPayload(room);
  if (snap) {
    broadcastRoom(room, snap);
  }
}

function stopRoomLoop(room: CarromRoom) {
  if (room.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }
}

function finishOnlineMatch(
  room: CarromRoom,
  winnerName: string,
  winnerIsDraw: boolean,
  winnerSide: 'white' | 'black' | 'draw' | null
) {
  const g = room.game;
  room.status = 'finished';
  stopRoomLoop(room);
  if (g) {
    g.shotMoving = false;
    g.remoteAim = null;
  }
  broadcastSnapshot(room);
  broadcastRoom(room, {
    type: 'match_end',
    winnerName,
    winnerIsDraw,
    winnerSide,
    standings: (g?.players ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      side: p.side,
      score: p.score,
      pocketedCount: p.pocketedCount,
      hasQueen: p.hasQueen,
    })),
    turnsPlayed: g?.turnsPlayed ?? 0,
  });
  broadcastRoom(room, serializeRoomLobby(room));
}

function startShotSimulation(room: CarromRoom) {
  stopRoomLoop(room);
  const dt = 1 / 60;

  room.interval = setInterval(() => {
    const g = room.game;
    if (!g || room.status !== 'playing' || !g.shotMoving) {
      stopRoomLoop(room);
      return;
    }

    const { events, anyMoving } = stepCarromPhysics(g.coins, g.striker, dt);
    for (const ev of events) {
      if (ev.type === 'clack' && ev.intensity > 0.14) {
        broadcastRoom(room, {
          type: 'sfx',
          kind: 'clack',
          intensity: Number(ev.intensity.toFixed(2)),
          x: Math.round(ev.x),
          y: Math.round(ev.y),
        });
      } else if (ev.type === 'wall' && ev.intensity > 0.18) {
        broadcastRoom(room, {
          type: 'sfx',
          kind: 'wall',
          intensity: Number(ev.intensity.toFixed(2)),
          x: Math.round(ev.x),
          y: Math.round(ev.y),
        });
      } else if (ev.type === 'pocket') {
        const isQ = ev.kind === 'queen';
        const isS = ev.kind === 'striker';
        broadcastRoom(room, {
          type: 'sfx',
          kind: 'pocket',
          isQueen: isQ,
          isStriker: isS,
          x: Math.round(ev.x),
          y: Math.round(ev.y),
        });
        if (isS) {
          g.strikerPocketedThisTurn = true;
        } else if (ev.kind === 'white' || ev.kind === 'black' || ev.kind === 'queen') {
          g.pocketedThisTurn.push(ev.kind);
        }
      }
    }

    g.tickCounter++;
    if (!anyMoving) {
      g.shotMoving = false;
      stopRoomLoop(room);

      const { resolution, nextQueenStatus, nextQueenHolderSlot } = resolveCarromTurn({
        turn: g.turn,
        players: g.players,
        playerCount: room.playerCount,
        fourMode: room.fourMode,
        coins: g.coins,
        pocketedThisTurn: g.pocketedThisTurn,
        strikerPocketed: g.strikerPocketedThisTurn,
        queenStatus: g.queenStatus,
        queenHolderSlot: g.queenHolderSlot,
      });

      g.queenStatus = nextQueenStatus;
      g.queenHolderSlot = nextQueenHolderSlot;

      if (resolution.toastText) {
        broadcastRoom(room, { type: 'toast', text: resolution.toastText });
      }

      if (resolution.matchFinished) {
        g.turn = resolution.nextTurn;
        const isDraw = resolution.winnerSide === 'draw';
        let winnerName = 'الفائز';
        if (isDraw) {
          winnerName = 'تعادل';
        } else if (room.playerCount === 4 && room.fourMode === 'teams') {
          winnerName = resolution.winnerTeam === 0 ? 'الفريق الأبيض' : 'الفريق الأسود';
        } else if (resolution.winnerSlot !== null && g.players[resolution.winnerSlot]) {
          winnerName = g.players[resolution.winnerSlot].name;
        }
        finishOnlineMatch(room, winnerName, isDraw, resolution.winnerSide);
        return;
      }

      g.turn = resolution.nextTurn;
      const clearNorm = findNearestClearSlider(0, g.turn, room.playerCount, g.coins);
      g.sliderNorm = clearNorm;
      g.striker = createStriker(g.turn, room.playerCount, clearNorm);
      broadcastSnapshot(room);
      return;
    }

    if (g.tickCounter % 2 === 0) {
      broadcastSnapshot(room);
    }
  }, 1000 / 60);
}

function handleSocketLeave(ws: WebSocket, permanent: boolean) {
  const sess = sessions.get(ws);
  if (!sess || !sess.roomId) return;
  const room = rooms.get(sess.roomId);
  if (!room) {
    sess.roomId = null;
    sess.playerId = null;
    return;
  }

  if (sess.isSpectator && sess.playerId) {
    room.spectators.delete(sess.playerId);
    sess.roomId = null;
    sess.playerId = null;
    broadcastRoom(room, serializeRoomLobby(room));
    return;
  }

  const pIdx = room.players.findIndex((p) => p.id === sess.playerId);
  if (pIdx >= 0) {
    const player = room.players[pIdx];
    player.ws = null;
    player.connected = false;

    if (room.status === 'lobby') {
      room.players.splice(pIdx, 1);
      if (room.players.length === 0) {
        stopRoomLoop(room);
        rooms.delete(room.id);
      } else {
        if (room.hostId === player.id) {
          room.hostId = room.players[0].id;
        }
        broadcastRoom(room, serializeRoomLobby(room));
      }
    } else if (room.status === 'playing' && permanent) {
      player.withdrawn = true;
      broadcastRoom(room, { type: 'toast', text: `👋 انسحب ${player.name}` });
      const activeRemaining = room.players.filter((p) => !p.withdrawn);
      if (activeRemaining.length === 1) {
        finishOnlineMatch(
          room,
          activeRemaining[0].name,
          false,
          room.players.indexOf(activeRemaining[0]) % 2 === 0 ? 'white' : 'black'
        );
      } else if (activeRemaining.length === 0) {
        stopRoomLoop(room);
        room.status = 'finished';
      } else {
        broadcastRoom(room, serializeRoomLobby(room));
      }
    } else {
      broadcastRoom(room, serializeRoomLobby(room));
    }
  }

  if (permanent) {
    sess.roomId = null;
    sess.playerId = null;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  app.get('/api/carrom/room/:id', (req, res) => {
    const code = String(req.params.id || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      res.status(404).json({ ok: false, error: 'الغرفة غير موجودة أو انتهت' });
      return;
    }
    res.json({ ok: true, ...serializeRoomLobby(room) });
  });

  app.get('/api/export/project.zip', async (_req, res) => {
    try {
      const zip = new JSZip();
      const skipDirs = new Set(['node_modules', 'dist', '.git', '.aistudio']);
      const walk = (dir: string, relBase: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (skipDirs.has(entry.name)) continue;
          const full = path.join(dir, entry.name);
          const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
          if (rel.startsWith('public/assets/aistudio')) continue;
          if (entry.isDirectory()) {
            walk(full, rel);
          } else if (entry.isFile()) {
            zip.file(rel, fs.readFileSync(full));
          }
        }
      };
      walk(__dirname, '');
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="carrom-game-project.zip"');
      res.send(buf);
    } catch (err) {
      console.error('Failed to build project zip:', err);
      res.status(500).json({ ok: false, error: 'تعذر ضغط ملفات المشروع' });
    }
  });

  app.get('/api/export/nawaf-addon.zip', async (_req, res) => {
    try {
      const zip = new JSZip();
      zip.file('patches/mini_app_index_patch.js', MINI_APP_INDEX_PATCH);
      zip.file('patches/mini_app_server_patch.py', MINI_APP_SERVER_PATCH);
      zip.file('patches/games_online_mode_patch.py', ONLINE_MODE_PY_PATCH);
      zip.file('README_AR.txt', buildStandaloneCarromReadme());
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="nawaf-bot-v2-carrom-addon.zip"');
      res.send(buf);
    } catch (err) {
      console.error('Failed to build addon zip:', err);
      res.status(500).json({ ok: false, error: 'تعذر تجهيز ملف الإضافة المضغوط' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/carrom' });

  wss.on('connection', (ws) => {
    sessions.set(ws, { roomId: null, playerId: null, isSpectator: false });

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      const type = String(msg.type || '');
      const sess = sessions.get(ws);
      if (!sess) return;

      if (type === 'create_room') {
        handleSocketLeave(ws, true);
        const roomId = makeRoomId();
        const playerId = sanitizeName(msg.clientId, '') || makeClientId();
        const name = sanitizeName(msg.name, 'اللاعب الأول');
        const playerCount: PlayerCount = Number(msg.playerCount) === 4 ? 4 : 2;
        const fourMode: FourPlayerMode = msg.fourMode === 'solo' ? 'solo' : 'teams';

        const room: CarromRoom = {
          id: roomId,
          hostId: playerId,
          status: 'lobby',
          playerCount,
          fourMode,
          createdAt: Date.now(),
          players: [
            {
              id: playerId,
              name,
              connected: true,
              withdrawn: false,
              ws,
            },
          ],
          spectators: new Map(),
          game: null,
          interval: null,
        };
        rooms.set(roomId, room);
        sess.roomId = roomId;
        sess.playerId = playerId;
        sess.isSpectator = false;

        sendJson(ws, { type: 'joined', playerId, isSpectator: false });
        sendJson(ws, serializeRoomLobby(room));
        return;
      }

      if (type === 'join_room') {
        const roomId = String(msg.roomId || '').trim().toUpperCase();
        const room = rooms.get(roomId);
        if (!room) {
          sendJson(ws, { type: 'error', message: 'الغرفة غير موجودة أو انتهت' });
          return;
        }

        const requestedId = sanitizeName(msg.clientId, '');
        const existingIdx = requestedId
          ? room.players.findIndex((p) => p.id === requestedId)
          : -1;

        if (existingIdx >= 0) {
          const existing = room.players[existingIdx];
          existing.ws = ws;
          existing.connected = true;
          sess.roomId = roomId;
          sess.playerId = existing.id;
          sess.isSpectator = false;
          sendJson(ws, { type: 'joined', playerId: existing.id, isSpectator: false });
          sendJson(ws, serializeRoomLobby(room));
          const snap = buildSnapshotPayload(room);
          if (snap) sendJson(ws, snap);
          return;
        }

        handleSocketLeave(ws, true);
        const playerId = requestedId || makeClientId();
        const name = sanitizeName(msg.name, `لاعب ${room.players.length + 1}`);

        if (room.status === 'playing') {
          room.spectators.set(playerId, { id: playerId, name, ws });
          sess.roomId = roomId;
          sess.playerId = playerId;
          sess.isSpectator = true;
          sendJson(ws, { type: 'joined', playerId, isSpectator: true });
          sendJson(ws, serializeRoomLobby(room));
          const snap = buildSnapshotPayload(room);
          if (snap) sendJson(ws, snap);
          return;
        }

        if (room.status !== 'lobby') {
          sendJson(ws, { type: 'error', message: 'المباراة انتهت، أنشئ غرفة جديدة' });
          return;
        }

        if (room.players.length >= room.playerCount) {
          sendJson(ws, {
            type: 'error',
            message: `الغرفة مكتملة (${room.playerCount}/${room.playerCount} لاعبين)`,
          });
          return;
        }

        room.players.push({
          id: playerId,
          name,
          connected: true,
          withdrawn: false,
          ws,
        });
        sess.roomId = roomId;
        sess.playerId = playerId;
        sess.isSpectator = false;

        sendJson(ws, { type: 'joined', playerId, isSpectator: false });
        broadcastRoom(room, serializeRoomLobby(room));
        return;
      }

      if (type === 'leave_room') {
        handleSocketLeave(ws, true);
        sendJson(ws, { type: 'left_room' });
        return;
      }

      if (!sess.roomId || !sess.playerId) return;
      const room = rooms.get(sess.roomId);
      if (!room) return;

      if (type === 'update_settings') {
        if (room.hostId !== sess.playerId || room.status !== 'lobby') return;
        const nextCount: PlayerCount = Number(msg.playerCount) === 4 ? 4 : 2;
        if (room.players.length <= nextCount) {
          room.playerCount = nextCount;
        }
        room.fourMode = msg.fourMode === 'solo' ? 'solo' : 'teams';
        broadcastRoom(room, serializeRoomLobby(room));
        return;
      }

      if (type === 'start_match' || type === 'rematch') {
        if (room.hostId !== sess.playerId) {
          sendJson(ws, { type: 'error', message: 'بدء المباراة لصاحب الغرفة فقط' });
          return;
        }
        if (room.players.length < room.playerCount) {
          sendJson(ws, {
            type: 'error',
            message: `بانتظار اكتمال اللاعبين (${room.players.length}/${room.playerCount})`,
          });
          return;
        }
        room.status = 'playing';
        for (const p of room.players) {
          p.withdrawn = false;
        }
        initCarromGame(room);
        broadcastRoom(room, serializeRoomLobby(room));
        return;
      }

      if (sess.isSpectator || room.status !== 'playing' || !room.game) return;
      const g = room.game;
      const pIdx = room.players.findIndex((p) => p.id === sess.playerId);
      if (pIdx < 0 || pIdx !== g.turn || g.shotMoving) return;

      if (type === 'slider_move') {
        const norm = Math.max(-1, Math.min(1, Number(msg.sliderNorm) || 0));
        g.sliderNorm = norm;
        if (g.striker) {
          const pos = sliderToStrikerPos(norm, g.turn, room.playerCount);
          g.striker.x = pos.x;
          g.striker.y = pos.y;
        }
        broadcastSnapshot(room);
        return;
      }

      if (type === 'aim_update') {
        g.remoteAim = msg.aim
          ? (msg.aim as ActiveCarromGame['remoteAim'])
          : null;
        broadcastSnapshot(room);
        return;
      }

      if (type === 'shoot') {
        const norm = Math.max(-1, Math.min(1, Number(msg.sliderNorm) ?? g.sliderNorm));
        g.sliderNorm = norm;
        const pos = sliderToStrikerPos(norm, g.turn, room.playerCount);
        if (!isStrikerSpotClear(pos.x, pos.y, g.coins)) {
          sendJson(ws, { type: 'toast', text: '⚠️ حرّك السحّاب لمكان فارغ على الخط أولًا!' });
          return;
        }

        let vx = Number(msg.vx) || 0;
        let vy = Number(msg.vy) || 0;
        const spd = Math.hypot(vx, vy);
        if (spd < 40) return;
        if (spd > MAX_SHOT_SPEED) {
          vx = (vx / spd) * MAX_SHOT_SPEED;
          vy = (vy / spd) * MAX_SHOT_SPEED;
        }

        if (!g.striker) {
          g.striker = createStriker(g.turn, room.playerCount, norm);
        }
        g.striker.x = pos.x;
        g.striker.y = pos.y;
        g.striker.vx = vx;
        g.striker.vy = vy;
        g.striker.pocketed = false;
        g.remoteAim = null;
        g.shotMoving = true;
        g.pocketedThisTurn = [];
        g.strikerPocketedThisTurn = false;
        g.turnsPlayed += 1;

        broadcastRoom(room, {
          type: 'sfx',
          kind: 'shoot',
          intensity: Math.min(1, spd / MAX_SHOT_SPEED),
        });
        startShotSimulation(room);
      }
    });

    ws.on('close', () => {
      handleSocketLeave(ws, false);
    });
  });

  // Periodic cleanup for stale rooms older than 2 hours
  setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, room] of rooms.entries()) {
      const anyConnected =
        room.players.some((p) => p.connected) || room.spectators.size > 0;
      if (!anyConnected && room.createdAt < cutoff) {
        stopRoomLoop(room);
        rooms.delete(id);
      }
    }
  }, 5 * 60 * 1000);

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Carrom server running at http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
