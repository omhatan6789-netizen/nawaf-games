import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import zlib from 'zlib';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import { applyScoreThrow, evaluateDartHit } from './src/game/dartsScoring';
import type {
  PlayerSide,
  RoundThrowRecord,
  StartingScore,
  TurnPhase,
} from './src/game/dartsTypes';

const PORT = 3000;
const VALID_SCORES: StartingScore[] = [200, 300, 350, 501];

interface RoomPlayer {
  ws: WebSocket;
  name: string;
  side: PlayerSide;
  rematchReady: boolean;
}

interface DartsRoom {
  code: string;
  startingScore: StartingScore;
  status: 'lobby' | 'playing' | 'finished';
  phase: TurnPhase;
  activeSide: PlayerSide;
  redScore: number;
  blueScore: number;
  round: number;
  countdownValue: number;
  lockedX: number;
  winnerSide: PlayerSide | null;
  winnerName: string | null;
  history: RoundThrowRecord[];
  players: RoomPlayer[];
  timers: NodeJS.Timeout[];
}

const rooms = new Map<string, DartsRoom>();

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateCode() : code;
}

function clearRoomTimers(room: DartsRoom): void {
  for (const t of room.timers) clearTimeout(t);
  room.timers = [];
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(room: DartsRoom, payload: unknown): void {
  const raw = JSON.stringify(payload);
  for (const p of room.players) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(raw);
    }
  }
}

function getPlayerNames(room: DartsRoom): { redName: string; blueName: string } {
  const red = room.players.find((p) => p.side === 'red');
  const blue = room.players.find((p) => p.side === 'blue');
  return {
    redName: red?.name || 'اللاعب الأحمر',
    blueName: blue?.name || 'اللاعب الأزرق',
  };
}

function broadcastLobby(room: DartsRoom): void {
  broadcast(room, {
    type: 'room_update',
    code: room.code,
    startingScore: room.startingScore,
    status: room.status,
    players: room.players.map((p) => ({
      name: p.name,
      side: p.side,
    })),
  });
}

function broadcastStateSync(room: DartsRoom): void {
  const { redName, blueName } = getPlayerNames(room);
  broadcast(room, {
    type: 'state_sync',
    phase: room.phase,
    activeSide: room.activeSide,
    redScore: room.redScore,
    blueScore: room.blueScore,
    redName,
    blueName,
    round: room.round,
    countdownValue: room.countdownValue,
    lockedX: room.lockedX,
  });
}

function startTurn(room: DartsRoom, side: PlayerSide): void {
  clearRoomTimers(room);
  room.activeSide = side;
  room.lockedX = 0;
  room.phase = 'turn_intro';
  broadcastStateSync(room);

  const introDuration = 1050;
  const t = setTimeout(() => {
    if (room.status !== 'playing') return;
    room.phase = 'aim_x';
    broadcastStateSync(room);
  }, introDuration);
  room.timers.push(t);
}

function startMatch(room: DartsRoom): void {
  clearRoomTimers(room);
  room.status = 'playing';
  room.phase = 'countdown';
  room.activeSide = 'red';
  room.redScore = room.startingScore;
  room.blueScore = room.startingScore;
  room.round = 1;
  room.lockedX = 0;
  room.winnerSide = null;
  room.winnerName = null;
  room.history = [];
  for (const p of room.players) p.rematchReady = false;

  const { redName, blueName } = getPlayerNames(room);
  broadcast(room, {
    type: 'match_started',
    startingScore: room.startingScore,
    redName,
    blueName,
  });

  room.countdownValue = 3;
  broadcastStateSync(room);

  room.timers.push(
    setTimeout(() => {
      if (room.status !== 'playing') return;
      room.countdownValue = 2;
      broadcastStateSync(room);
    }, 900)
  );
  room.timers.push(
    setTimeout(() => {
      if (room.status !== 'playing') return;
      room.countdownValue = 1;
      broadcastStateSync(room);
    }, 1800)
  );
  room.timers.push(
    setTimeout(() => {
      if (room.status !== 'playing') return;
      startTurn(room, 'red');
    }, 2700)
  );
}

function finishMatch(
  room: DartsRoom,
  winnerSide: PlayerSide,
  reason: 'checkout' | 'withdraw'
): void {
  clearRoomTimers(room);
  room.status = 'finished';
  room.phase = 'finished';
  const { redName, blueName } = getPlayerNames(room);
  const winnerName = winnerSide === 'red' ? redName : blueName;
  room.winnerSide = winnerSide;
  room.winnerName = winnerName;

  broadcast(room, {
    type: 'match_end',
    winnerSide,
    winnerName,
    reason,
    redScore: room.redScore,
    blueScore: room.blueScore,
    history: room.history,
  });
}

function handleDisconnect(ws: WebSocket): void {
  for (const [code, room] of rooms.entries()) {
    const idx = room.players.findIndex((p) => p.ws === ws);
    if (idx === -1) continue;
    const leaving = room.players[idx];
    room.players.splice(idx, 1);

    if (room.players.length === 0) {
      clearRoomTimers(room);
      rooms.delete(code);
      return;
    }

    if (room.status === 'playing') {
      const winnerSide: PlayerSide = leaving.side === 'red' ? 'blue' : 'red';
      finishMatch(room, winnerSide, 'withdraw');
    } else {
      // Promote remaining player to red host if red left in lobby
      room.players[0].side = 'red';
      room.status = 'lobby';
      broadcastLobby(room);
    }
    return;
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function collectProjectFiles(rootDir: string): { relPath: string; data: Buffer }[] {
  const rootFiles = [
    '.env.example',
    '.gitignore',
    'index.html',
    'metadata.json',
    'package.json',
    'server.ts',
    'tsconfig.json',
    'vite.config.ts',
  ];
  const entries: { relPath: string; data: Buffer }[] = [];

  for (const file of rootFiles) {
    const full = path.join(rootDir, file);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      entries.push({ relPath: file, data: fs.readFileSync(full) });
    }
  }

  const walk = (dir: string, prefix: string) => {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      const rel = `${prefix}/${item.name}`;
      if (item.isDirectory()) {
        walk(full, rel);
      } else if (item.isFile()) {
        entries.push({ relPath: rel, data: fs.readFileSync(full) });
      }
    }
  };
  walk(path.join(rootDir, 'src'), 'src');
  return entries;
}

function buildProjectZipBuffer(rootDir: string): Buffer {
  const files = collectProjectFiles(rootDir);
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.relPath, 'utf8');
    const compressed = zlib.deflateRawSync(file.data);
    const crc = crc32(file.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(8, 8); // Compression: deflate
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(8, 10); // Deflate
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralSize = centralChunks.reduce((acc, b) => acc + b.length, 0);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // EOCD signature
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, ...centralChunks, endRecord]);
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, game: 'السهام', activeRooms: rooms.size });
  });

  app.get('/api/download-zip', (_req, res) => {
    const zipBuffer = buildProjectZipBuffer(process.cwd());
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="nawaf-darts-project.zip"'
    );
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.send(zipBuffer);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/darts' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'create_room') {
        handleDisconnect(ws);
        const name = String(msg.name || 'لاعب ١').trim().slice(0, 24) || 'لاعب ١';
        const reqScore = Number(msg.startingScore || 300) as StartingScore;
        const startingScore = VALID_SCORES.includes(reqScore) ? reqScore : 300;
        const code = generateCode();
        const room: DartsRoom = {
          code,
          startingScore,
          status: 'lobby',
          phase: 'countdown',
          activeSide: 'red',
          redScore: startingScore,
          blueScore: startingScore,
          round: 1,
          countdownValue: 3,
          lockedX: 0,
          winnerSide: null,
          winnerName: null,
          history: [],
          players: [{ ws, name, side: 'red', rematchReady: false }],
          timers: [],
        };
        rooms.set(code, room);
        sendJson(ws, { type: 'joined', code, side: 'red', startingScore });
        broadcastLobby(room);
        return;
      }

      if (type === 'join_room') {
        handleDisconnect(ws);
        const code = String(msg.code || '').trim().toUpperCase();
        const name = String(msg.name || 'لاعب ٢').trim().slice(0, 24) || 'لاعب ٢';
        const room = rooms.get(code);
        if (!room) {
          sendJson(ws, { type: 'error', message: 'الغرفة غير موجودة أو انتهت.' });
          return;
        }
        if (room.players.length >= 2) {
          sendJson(ws, { type: 'error', message: 'الغرفة ممتلئة بالفعل.' });
          return;
        }
        if (room.status !== 'lobby') {
          sendJson(ws, { type: 'error', message: 'المباراة بدأت بالفعل.' });
          return;
        }
        room.players.push({ ws, name, side: 'blue', rematchReady: false });
        sendJson(ws, {
          type: 'joined',
          code: room.code,
          side: 'blue',
          startingScore: room.startingScore,
        });
        broadcastLobby(room);
        return;
      }

      // Find player's room
      const room = Array.from(rooms.values()).find((r) =>
        r.players.some((p) => p.ws === ws)
      );
      if (!room) return;
      const player = room.players.find((p) => p.ws === ws)!;

      if (type === 'update_settings') {
        if (player.side !== 'red' || room.status !== 'lobby') return;
        const reqScore = Number(msg.startingScore || 300) as StartingScore;
        if (VALID_SCORES.includes(reqScore)) {
          room.startingScore = reqScore;
          broadcastLobby(room);
        }
        return;
      }

      if (type === 'start_match') {
        if (player.side !== 'red' || room.players.length < 2) return;
        startMatch(room);
        return;
      }

      if (type === 'lock_x') {
        if (
          room.status !== 'playing' ||
          room.phase !== 'aim_x' ||
          player.side !== room.activeSide
        ) {
          return;
        }
        const val = Math.max(-1.08, Math.min(1.08, Number(msg.value || 0)));
        room.lockedX = val;
        room.phase = 'aim_y';
        for (const p of room.players) {
          if (p.ws !== ws) {
            sendJson(p.ws, { type: 'opponent_lock_x', value: val });
          }
        }
        return;
      }

      if (type === 'lock_y') {
        if (
          room.status !== 'playing' ||
          room.phase !== 'aim_y' ||
          player.side !== room.activeSide
        ) {
          return;
        }
        const yNorm = Math.max(-1.08, Math.min(1.08, Number(msg.value || 0)));
        const xNorm = room.lockedX;
        const currentRemaining =
          player.side === 'red' ? room.redScore : room.blueScore;
        const raw = evaluateDartHit(xNorm, yNorm);
        const { nextRemaining, result } = applyScoreThrow(currentRemaining, raw);

        if (player.side === 'red') {
          room.redScore = nextRemaining;
        } else {
          room.blueScore = nextRemaining;
        }

        const record: RoundThrowRecord = {
          round: room.round,
          side: player.side,
          playerName: player.name,
          hitScore: result.isBust ? 0 : result.score,
          shortTag: result.shortTag,
          labelAr: result.labelAr,
          remainingAfter: nextRemaining,
          isBust: Boolean(result.isBust),
          isCheckout: Boolean(result.isCheckout),
          xNorm,
          yNorm,
        };
        room.history.push(record);

        room.phase = 'impact_zoom';

        broadcast(room, {
          type: 'throw_resolved',
          side: player.side,
          xNorm,
          yNorm,
          redScore: room.redScore,
          blueScore: room.blueScore,
          record,
          winnerSide: result.isCheckout ? player.side : null,
          winnerName: result.isCheckout ? player.name : null,
        });

        clearRoomTimers(room);
        if (result.isCheckout) {
          room.timers.push(
            setTimeout(() => {
              finishMatch(room, player.side, 'checkout');
            }, 1450)
          );
        } else {
          room.timers.push(
            setTimeout(() => {
              if (room.status !== 'playing') return;
              const nextSide: PlayerSide =
                player.side === 'red' ? 'blue' : 'red';
              if (nextSide === 'red') room.round += 1;
              startTurn(room, nextSide);
            }, 1650)
          );
        }
        return;
      }

      if (type === 'withdraw') {
        if (room.status === 'playing') {
          const winnerSide: PlayerSide = player.side === 'red' ? 'blue' : 'red';
          finishMatch(room, winnerSide, 'withdraw');
        } else {
          handleDisconnect(ws);
        }
        return;
      }

      if (type === 'rematch') {
        if (room.status !== 'finished' || room.players.length < 2) return;
        player.rematchReady = true;
        if (room.players.every((p) => p.rematchReady)) {
          startMatch(room);
        } else {
          broadcast(room, { type: 'rematch_waiting', bySide: player.side });
        }
      }
    });

    ws.on('close', () => {
      handleDisconnect(ws);
    });
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Darts server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
