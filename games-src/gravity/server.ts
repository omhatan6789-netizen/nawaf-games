import express from 'express';
import fs from 'fs';
import http from 'http';
import JSZip from 'jszip';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  buildStandaloneGravityHtml,
  MINI_APP_INDEX_PATCH,
  MINI_APP_SERVER_PATCH,
  ONLINE_MODE_PY_PATCH,
} from './src/game/exportMiniApp.ts';
import {
  BIOMES,
  computeScrollSpeed,
  generateVerticalChunks,
  LOGICAL_H,
  PLAYER_PALETTE,
} from './src/game/gravityBiomes.ts';
import type { PlayerColorId, SolidRect } from './src/game/gravityBiomes.ts';
import {
  createPlayersForMatch,
  stepGravityPlayer,
} from './src/game/gravityPhysics.ts';
import type { PlayerRuntime } from './src/game/gravityPhysics.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RoomPlayer {
  id: string;
  name: string;
  score: number;
  withdrawn: boolean;
  connected: boolean;
  ws: WebSocket | null;
}

interface RoomSpectator {
  id: string;
  name: string;
  ws: WebSocket;
}

interface ActiveGame {
  roundNumber: number;
  roundSeed: number;
  roundElapsed: number;
  roundState: 'intro' | 'playing' | 'round-over' | 'match-over';
  stateTimer: number;
  cameraY: number;
  nextTopY: number;
  chunkIndex: number;
  rects: SolidRect[];
  runtimes: PlayerRuntime[];
  tickCounter: number;
}

interface GravityRoom {
  id: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  targetScore: number;
  createdAt: number;
  players: RoomPlayer[];
  spectators: Map<string, RoomSpectator>;
  game: ActiveGame | null;
  interval: ReturnType<typeof setInterval> | null;
}

interface SocketSession {
  roomId: string | null;
  playerId: string | null;
  isSpectator: boolean;
}

const rooms = new Map<string, GravityRoom>();
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

function broadcastRoom(room: GravityRoom, payload: unknown) {
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

function serializeRoomLobby(room: GravityRoom) {
  return {
    type: 'room_state',
    room: {
      id: room.id,
      hostId: room.hostId,
      status: room.status,
      targetScore: room.targetScore,
      minPlayers: 2,
      maxPlayers: 5,
      players: room.players.map((p, idx) => {
        const color = PLAYER_PALETTE[idx] ?? PLAYER_PALETTE[0];
        return {
          id: p.id,
          name: p.name,
          slotIndex: idx,
          colorId: color.id,
          colorLabel: color.label,
          mainColor: color.main,
          emoji: color.emoji,
          score: p.score,
          connected: p.connected,
          withdrawn: p.withdrawn,
        };
      }),
      spectatorsCount: room.spectators.size,
    },
  };
}

function initGameRound(room: GravityRoom, roundNumber: number) {
  const seed = Math.floor(Math.random() * 1000) + roundNumber - 1;
  const rects: SolidRect[] = [];
  let nextTopY = LOGICAL_H;
  let chunkIndex = 0;

  while (nextTopY > -LOGICAL_H * 1.8) {
    const gen = generateVerticalChunks(nextTopY, chunkIndex, seed, true);
    rects.push(...gen.rects);
    nextTopY = gen.nextTopY;
    chunkIndex++;
  }

  const activePlayers = room.players.filter((p) => !p.withdrawn);
  const runtimes = createPlayersForMatch(
    room.players.map((p) => ({ id: p.id, name: p.name }))
  );
  // Keep withdrawn players marked dead immediately so they don't appear in round
  for (let i = 0; i < room.players.length; i++) {
    if (room.players[i].withdrawn && runtimes[i]) {
      runtimes[i].dead = true;
    }
  }

  room.game = {
    roundNumber,
    roundSeed: seed,
    roundElapsed: 0,
    roundState: activePlayers.length <= 1 ? 'match-over' : 'intro',
    stateTimer: 1.3,
    cameraY: 0,
    nextTopY,
    chunkIndex,
    rects,
    runtimes,
    tickCounter: 0,
  };

  broadcastRoom(room, { type: 'countdown', go: false, roundNumber });
  broadcastSnapshot(room);
}

function buildSnapshotPayload(room: GravityRoom) {
  const g = room.game;
  if (!g) return null;
  const biome = BIOMES[(g.roundNumber - 1) % BIOMES.length];
  return {
    type: 'game_snapshot',
    roomId: room.id,
    roundNumber: g.roundNumber,
    roundSeed: g.roundSeed,
    roundElapsed: Number(g.roundElapsed.toFixed(2)),
    roundState: g.roundState,
    biomeId: biome.id,
    biomeName: biome.name,
    cameraY: Number(g.cameraY.toFixed(2)),
    targetScore: room.targetScore,
    players: g.runtimes.map((rt, idx) => ({
      id: rt.id,
      slotIndex: idx,
      colorId: rt.colorId,
      name: rt.name,
      score: room.players[idx]?.score ?? 0,
      x: Number(rt.x.toFixed(2)),
      worldY: Number(rt.worldY.toFixed(2)),
      vx: Number(rt.vx.toFixed(1)),
      grav: rt.grav,
      grounded: rt.grounded,
      dead: rt.dead,
      withdrawn: room.players[idx]?.withdrawn ?? false,
      runPhase: Number(rt.runPhase.toFixed(2)),
      squash: Number(rt.squash.toFixed(2)),
    })),
  };
}

function broadcastSnapshot(room: GravityRoom) {
  const snap = buildSnapshotPayload(room);
  if (snap) {
    broadcastRoom(room, snap);
  }
}

function finishMatch(room: GravityRoom, winnerPlayer: RoomPlayer, winnerColorId: PlayerColorId) {
  const g = room.game;
  if (g) {
    g.roundState = 'match-over';
  }
  room.status = 'finished';
  stopRoomLoop(room);

  const standings = room.players.map((p, idx) => ({
    id: p.id,
    name: p.name,
    colorId: (PLAYER_PALETTE[idx] ?? PLAYER_PALETTE[0]).id,
    mainColor: (PLAYER_PALETTE[idx] ?? PLAYER_PALETTE[0]).main,
    score: p.score,
  }));

  broadcastRoom(room, {
    type: 'match_end',
    winnerId: winnerPlayer.id,
    winnerName: winnerPlayer.name,
    winnerColorId,
    roundsPlayed: g?.roundNumber ?? 1,
    standings,
  });
  broadcastRoom(room, serializeRoomLobby(room));
}

function stopRoomLoop(room: GravityRoom) {
  if (room.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }
}

function startRoomLoop(room: GravityRoom) {
  stopRoomLoop(room);
  const dt = 1 / 60;

  room.interval = setInterval(() => {
    const g = room.game;
    if (!g || room.status !== 'playing') {
      stopRoomLoop(room);
      return;
    }

    if (g.roundState === 'match-over') {
      stopRoomLoop(room);
      return;
    }

    const speed = computeScrollSpeed(g.roundElapsed, g.roundNumber, true);

    if (g.roundState === 'intro') {
      g.stateTimer -= dt;
      g.cameraY -= speed * 0.4 * dt;
      for (const rt of g.runtimes) {
        if (!rt.dead) {
          rt.worldY -= speed * 0.4 * dt;
          rt.runPhase += dt * 14;
        }
      }
      g.tickCounter++;
      if (g.stateTimer <= 0) {
        g.roundState = 'playing';
        broadcastRoom(room, { type: 'countdown', go: true, roundNumber: g.roundNumber });
        broadcastSnapshot(room);
      } else if (g.tickCounter % 2 === 0) {
        broadcastSnapshot(room);
      }
      return;
    }

    if (g.roundState === 'round-over') {
      g.stateTimer -= dt;
      if (g.stateTimer <= 0) {
        const activePlayers = room.players.filter((p) => !p.withdrawn);
        const topScorer = room.players.find((p) => p.score >= room.targetScore);
        if (topScorer) {
          const idx = room.players.indexOf(topScorer);
          const color = PLAYER_PALETTE[idx] ?? PLAYER_PALETTE[0];
          finishMatch(room, topScorer, color.id);
          return;
        }
        if (activePlayers.length === 1) {
          const idx = room.players.indexOf(activePlayers[0]);
          const color = PLAYER_PALETTE[idx] ?? PLAYER_PALETTE[0];
          finishMatch(room, activePlayers[0], color.id);
          return;
        }
        if (activePlayers.length === 0) {
          room.status = 'finished';
          stopRoomLoop(room);
          return;
        }
        initGameRound(room, g.roundNumber + 1);
      }
      return;
    }

    // Playing state
    g.roundElapsed += dt;
    g.cameraY -= speed * dt;

    while (g.nextTopY > g.cameraY - LOGICAL_H * 1.5) {
      const gen = generateVerticalChunks(g.nextTopY, g.chunkIndex, g.roundSeed, true);
      g.rects.push(...gen.rects);
      g.nextTopY = gen.nextTopY;
      g.chunkIndex++;
    }
    g.rects = g.rects.filter((r) => r.y < g.cameraY + LOGICAL_H + 180);

    for (let i = 0; i < g.runtimes.length; i++) {
      const rt = g.runtimes[i];
      if (rt.dead) continue;
      const res = stepGravityPlayer(rt, g.rects, g.cameraY, dt, speed);
      if (res.justDied) {
        broadcastRoom(room, {
          type: 'burst',
          x: res.deathX,
          y: res.deathScreenY,
          color: rt.mainColor,
          playerId: rt.id,
          playerName: rt.name,
        });
      }
    }

    const aliveRuntimes = g.runtimes.filter((rt) => !rt.dead);
    const activeSlots = room.players.filter((p) => !p.withdrawn);

    if (activeSlots.length <= 1) {
      if (activeSlots.length === 1) {
        const survivor = activeSlots[0];
        const idx = room.players.indexOf(survivor);
        const color = PLAYER_PALETTE[idx] ?? PLAYER_PALETTE[0];
        finishMatch(room, survivor, color.id);
      } else {
        room.status = 'finished';
        stopRoomLoop(room);
      }
      return;
    }

    if (aliveRuntimes.length <= 1) {
      if (aliveRuntimes.length === 1) {
        const winnerRt = aliveRuntimes[0];
        const p = room.players[winnerRt.slotIndex];
        if (p) {
          p.score += 1;
          broadcastRoom(room, {
            type: 'round_banner',
            text: `🏆 نقطة لـ ${p.name}!`,
          });
        }
      } else {
        broadcastRoom(room, {
          type: 'round_banner',
          text: '💥 سقوط متزامن — إعادة الجولة!',
        });
      }
      g.roundState = 'round-over';
      g.stateTimer = 1.05;
      broadcastSnapshot(room);
      broadcastRoom(room, serializeRoomLobby(room));
      return;
    }

    g.tickCounter++;
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
      // Compact slots cleanly so colors stay ordered [Red, Blue, Purple, Green, Yellow]
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
      const rt = room.game?.runtimes[pIdx];
      if (rt && !rt.dead) {
        rt.dead = true;
        const sy = rt.worldY - (room.game?.cameraY ?? 0);
        broadcastRoom(room, {
          type: 'burst',
          x: rt.x + rt.w / 2,
          y: Math.max(28, Math.min(LOGICAL_H - 28, sy + rt.h / 2)),
          color: rt.mainColor,
          playerId: rt.id,
          playerName: rt.name,
        });
      }
      broadcastRoom(room, {
        type: 'round_banner',
        text: `👋 انسحب ${player.name}`,
      });
      broadcastRoom(room, serializeRoomLobby(room));
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


  app.post('/api/internal/inline-room', (req, res) => {
    if (!process.env.BOT_TOKEN || req.headers['x-bot-token'] !== process.env.BOT_TOKEN) {
      res.sendStatus(403); return;
    }
    const hostId = `tg_${String(req.body?.userId || '').replace(/[^0-9]/g, '')}`;
    if (hostId === 'tg_') { res.status(400).json({ok:false,error:'Invalid host'}); return; }
    const name = sanitizeName(req.body?.name, 'اللاعب الأول');
    const roomId = makeRoomId();
    const room: GravityRoom = {
      id: roomId, hostId, status: 'lobby', targetScore: 3, createdAt: Date.now(),
      players: [{ id: hostId, name, score: 0, withdrawn: false, connected: false, ws: null }],
      spectators: new Map(), game: null, interval: null,
    };
    rooms.set(roomId, room);
    res.json({ok:true,roomId});
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  app.get('/api/gravity/room/:id', (req, res) => {
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
      res.setHeader('Content-Disposition', 'attachment; filename="gravity-game-project.zip"');
      res.send(buf);
    } catch (err) {
      console.error('Failed to build project zip:', err);
      res.status(500).json({ ok: false, error: 'تعذر ضغط ملفات المشروع' });
    }
  });

  app.get('/api/export/nawaf-addon.zip', async (_req, res) => {
    try {
      const zip = new JSZip();
      zip.file('mini_app/gravity.html', buildStandaloneGravityHtml());
      zip.file('patches/mini_app_index_patch.js', MINI_APP_INDEX_PATCH);
      zip.file('patches/mini_app_server_patch.py', MINI_APP_SERVER_PATCH);
      zip.file('patches/games_online_mode_patch.py', ONLINE_MODE_PY_PATCH);
      zip.file(
        'README_AR.txt',
        [
          'ملفات إضافة لعبة تحدي الجاذبية لمشروع nawaf-bot-v2:',
          '1) انسخ mini_app/gravity.html إلى مجلد mini_app داخل مشروعك.',
          '2) طبّق التعديلات الموجودة في patches/ على mini_app/index.html و mini_app_server.py و games/online_mode.py.',
          '',
          'لتشغيل المشروع الكامل (React + Express + WebSocket) مباشرةً على Node.js:',
          'حمّل ملف gravity-game-project.zip وشغّل: npm install && npm run dev',
        ].join('\n')
      );
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="nawaf-bot-v2-gravity-addon.zip"');
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
  const wss = new WebSocketServer({ server, path: '/ws/gravity' });

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
        const targetScore = Number(msg.targetScore) === 5 ? 5 : 3;

        const room: GravityRoom = {
          id: roomId,
          hostId: playerId,
          status: 'lobby',
          targetScore,
          createdAt: Date.now(),
          players: [
            {
              id: playerId,
              name,
              score: 0,
              withdrawn: false,
              connected: true,
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

        if (room.players.length >= 5) {
          sendJson(ws, { type: 'error', message: 'الغرفة مكتملة (الحد الأقصى 5 لاعبين)' });
          return;
        }

        room.players.push({
          id: playerId,
          name,
          score: 0,
          withdrawn: false,
          connected: true,
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
        const targetScore = Number(msg.targetScore) === 5 ? 5 : 3;
        room.targetScore = targetScore;
        broadcastRoom(room, serializeRoomLobby(room));
        return;
      }

      if (type === 'start_match') {
        if (room.hostId !== sess.playerId) {
          sendJson(ws, { type: 'error', message: 'بدء التحدي لصاحب الغرفة فقط' });
          return;
        }
        if (room.players.length < 2) {
          sendJson(ws, { type: 'error', message: 'يجب وجود لاعبين على الأقل (الحد الأدنى 2)' });
          return;
        }
        room.status = 'playing';
        for (const p of room.players) {
          p.score = 0;
          p.withdrawn = false;
        }
        initGameRound(room, 1);
        broadcastRoom(room, serializeRoomLobby(room));
        startRoomLoop(room);
        return;
      }

      if (type === 'rematch') {
        if (room.hostId !== sess.playerId) return;
        if (room.players.length < 2) return;
        room.status = 'playing';
        for (const p of room.players) {
          p.score = 0;
          p.withdrawn = false;
        }
        initGameRound(room, 1);
        broadcastRoom(room, serializeRoomLobby(room));
        startRoomLoop(room);
        return;
      }

      if (type === 'flip') {
        if (sess.isSpectator || room.status !== 'playing' || !room.game) return;
        if (room.game.roundState !== 'playing') return;
        const pIdx = room.players.findIndex((p) => p.id === sess.playerId);
        if (pIdx < 0 || room.players[pIdx].withdrawn) return;
        const rt = room.game.runtimes[pIdx];
        if (!rt || rt.dead || rt.flipCooldown > 0) return;

        if (rt.grounded || Math.abs(rt.vx) < 190) {
          rt.grav = rt.grav === 1 ? -1 : 1;
          rt.grounded = false;
          rt.vx = rt.grav * 230;
          rt.flipCooldown = 0.12;
          rt.squash = 1.24;
          broadcastRoom(room, {
            type: 'sfx',
            kind: 'flip',
            left: rt.grav === -1,
            playerId: rt.id,
          });
        }
      }
    });

    ws.on('close', () => {
      handleSocketLeave(ws, false);
    });
  });

  // Periodic cleanup for stale finished/empty rooms older than 2 hours
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
    console.log(`Gravity server running at http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
