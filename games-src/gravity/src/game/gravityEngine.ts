import {
  BIOMES,
  computeScrollSpeed,
  drawVerticalBiomeBackdrop,
  drawVerticalSolidRect,
  generateVerticalChunks,
  LOGICAL_H,
  PLAYER_PALETTE,
  WORLD_W,
} from './gravityBiomes';
import type {
  BiomeTheme,
  DifficultyLevel,
  PlayerColorId,
  SolidRect,
} from './gravityBiomes';
import {
  createPlayersForMatch,
  stepGravityPlayer,
  updateBotDecision,
} from './gravityPhysics';
import type { PlayerRuntime } from './gravityPhysics';
import { gravitySound } from './gravitySound';

export type GravityMode = 'bot' | 'local' | 'online';
export type { DifficultyLevel, PlayerColorId };

export interface GravityMatchConfig {
  mode: GravityMode;
  difficulty: DifficultyLevel;
  targetScore: number;
  redName: string;
  blueName: string;
  localPlayerId?: string;
  onOnlineFlip?: () => void;
}

export interface HudPlayerScore {
  id: string;
  name: string;
  colorId: PlayerColorId;
  mainColor: string;
  score: number;
  dead: boolean;
  withdrawn: boolean;
}

export interface GravityHudState {
  redScore: number;
  blueScore: number;
  targetScore: number;
  roundNumber: number;
  biomeName: string;
  elapsedSeconds: number;
  countdownBadge: string | null;
  players: HudPlayerScore[];
  spectating: boolean;
}

export interface GravityMatchResult {
  winnerId: string;
  winnerColorId: PlayerColorId;
  winnerName: string;
  winnerIsBot: boolean;
  redScore: number;
  blueScore: number;
  roundsPlayed: number;
  standings?: HudPlayerScore[];
}

export interface OnlineGameSnapshot {
  roomId: string;
  roundNumber: number;
  roundSeed: number;
  roundElapsed: number;
  roundState: 'intro' | 'playing' | 'round-over' | 'match-over';
  biomeId: string;
  biomeName: string;
  cameraY: number;
  targetScore: number;
  players: Array<{
    id: string;
    slotIndex: number;
    colorId: PlayerColorId;
    name: string;
    score: number;
    x: number;
    worldY: number;
    vx: number;
    grav: -1 | 1;
    grounded: boolean;
    dead: boolean;
    withdrawn: boolean;
    runPhase: number;
    squash: number;
  }>;
}

interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

interface ShockRing {
  x: number;
  y: number;
  r: number;
  maxR: number;
  color: string;
  life: number;
  maxLife: number;
}

export class GravityDuelEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: GravityMatchConfig;
  private onHud: (hud: GravityHudState) => void;
  private onRoundEndBanner: (msg: string) => void;
  private onMatchEnd: (res: GravityMatchResult) => void;

  private rafId = 0;
  private lastTs = 0;
  private disposed = false;

  private scores: Record<string, number> = {};
  private roundNumber = 1;
  private roundSeed = 0;
  private roundElapsed = 0;
  private biome: BiomeTheme = BIOMES[0];

  private cameraY = 0;
  private targetCameraY = 0;
  private rects: SolidRect[] = [];
  private nextTopY = LOGICAL_H;
  private chunkIndex = 0;

  private players: PlayerRuntime[] = [];
  private onlineTargets: Map<
    string,
    { x: number; worldY: number; vx: number; grav: -1 | 1; grounded: boolean; dead: boolean; withdrawn: boolean; runPhase: number; squash: number; score: number }
  > = new Map();
  private lastOnlineRoundSeed = -1;
  private lastOnlineRoundNumber = -1;

  private particles: BurstParticle[] = [];
  private rings: ShockRing[] = [];

  private roundState: 'intro' | 'playing' | 'round-over' | 'match-over' = 'intro';
  private stateTimer = 0;
  private lastHudSync = 0;
  private blackFade = 0;

  constructor(
    canvas: HTMLCanvasElement,
    config: GravityMatchConfig,
    callbacks: {
      onHud: (hud: GravityHudState) => void;
      onRoundEndBanner: (msg: string) => void;
      onMatchEnd: (res: GravityMatchResult) => void;
    }
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2D canvas not supported');
    }
    this.ctx = context;
    this.config = config;
    this.onHud = callbacks.onHud;
    this.onRoundEndBanner = callbacks.onRoundEndBanner;
    this.onMatchEnd = callbacks.onMatchEnd;

    if (config.mode !== 'online') {
      this.scores = { red: 0, blue: 0 };
      this.initLocalRound(1);
    } else {
      this.initOnlineWorld(1, 0);
    }

    window.addEventListener('keydown', this.handleKeyDown);
    this.lastTs = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private initOnlineWorld(roundNum: number, seed: number) {
    this.roundNumber = roundNum;
    this.roundSeed = seed;
    this.lastOnlineRoundNumber = roundNum;
    this.lastOnlineRoundSeed = seed;
    this.biome = BIOMES[(roundNum - 1) % BIOMES.length];
    this.cameraY = 0;
    this.targetCameraY = 0;
    this.rects = [];
    this.nextTopY = LOGICAL_H;
    this.chunkIndex = 0;
    this.particles = [];
    this.rings = [];
    this.blackFade = 0.75;

    while (this.nextTopY > -LOGICAL_H * 1.8) {
      const gen = generateVerticalChunks(this.nextTopY, this.chunkIndex, seed, true);
      this.rects.push(...gen.rects);
      this.nextTopY = gen.nextTopY;
      this.chunkIndex++;
    }
  }

  private initLocalRound(roundNum: number) {
    this.roundNumber = roundNum;
    this.roundSeed = roundNum - 1;
    this.roundElapsed = 0;
    this.biome = BIOMES[(roundNum - 1) % BIOMES.length];
    this.cameraY = 0;
    this.rects = [];
    this.nextTopY = LOGICAL_H;
    this.chunkIndex = 0;
    this.particles = [];
    this.rings = [];

    while (this.nextTopY > -LOGICAL_H * 1.8) {
      const gen = generateVerticalChunks(this.nextTopY, this.chunkIndex, this.roundSeed);
      this.rects.push(...gen.rects);
      this.nextTopY = gen.nextTopY;
      this.chunkIndex++;
    }

    this.players = createPlayersForMatch([
      { id: 'red', name: this.config.redName },
      { id: 'blue', name: this.config.blueName },
    ]);
    this.roundState = 'intro';
    this.stateTimer = 1.3;
    this.blackFade = 0.8;
    gravitySound.playCountdownTick(false);
    this.syncHud(true);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (
      ['Space', 'KeyA', 'KeyD', 'KeyW', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter'].includes(
        e.code
      )
    ) {
      e.preventDefault();
    }

    if (this.config.mode === 'online') {
      if (['Space', 'KeyA', 'KeyD', 'KeyW', 'ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(e.code)) {
        this.flipMyOnlinePlayer();
      }
      return;
    }

    if (this.config.mode === 'bot') {
      if (['Space', 'KeyA', 'KeyD', 'KeyW', 'ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(e.code)) {
        this.flipPlayer('red');
      }
    } else {
      if (['Space', 'KeyA', 'KeyD', 'KeyW'].includes(e.code)) {
        this.flipPlayer('red');
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter'].includes(e.code)) {
        this.flipPlayer('blue');
      }
    }
  };

  public flipMyOnlinePlayer() {
    gravitySound.unlock();
    if (this.roundState !== 'playing') return;
    const me = this.players.find((p) => p.id === this.config.localPlayerId);
    if (!me || me.dead) return;
    this.config.onOnlineFlip?.();
  }

  public flipPlayer(id: 'red' | 'blue') {
    gravitySound.unlock();
    if (this.config.mode === 'online') {
      this.flipMyOnlinePlayer();
      return;
    }
    if (this.roundState !== 'playing') return;
    if (this.config.mode === 'bot' && id === 'blue') return;
    const p = this.players.find((pl) => pl.id === id);
    if (!p || p.dead || p.flipCooldown > 0) return;

    if (p.grounded || Math.abs(p.vx) < 190) {
      p.grav = p.grav === 1 ? -1 : 1;
      p.grounded = false;
      p.vx = p.grav * 230;
      p.flipCooldown = 0.12;
      p.squash = 1.24;
      gravitySound.playFlip(p.grav === -1);
    }
  }

  public applyOnlineSnapshot(snap: OnlineGameSnapshot) {
    if (this.config.mode !== 'online') return;

    if (
      snap.roundNumber !== this.lastOnlineRoundNumber ||
      snap.roundSeed !== this.lastOnlineRoundSeed
    ) {
      this.initOnlineWorld(snap.roundNumber, snap.roundSeed);
      this.players = [];
      this.onlineTargets.clear();
    }

    this.roundNumber = snap.roundNumber;
    this.roundSeed = snap.roundSeed;
    this.roundElapsed = snap.roundElapsed;
    this.roundState = snap.roundState;
    this.biome = BIOMES[(snap.roundNumber - 1) % BIOMES.length];
    this.targetCameraY = snap.cameraY;

    if (this.cameraY === 0 && Math.abs(snap.cameraY) > 60) {
      this.cameraY = snap.cameraY;
    }

    while (this.nextTopY > Math.min(this.cameraY, this.targetCameraY) - LOGICAL_H * 1.6) {
      const gen = generateVerticalChunks(this.nextTopY, this.chunkIndex, this.roundSeed, true);
      this.rects.push(...gen.rects);
      this.nextTopY = gen.nextTopY;
      this.chunkIndex++;
    }
    this.rects = this.rects.filter((r) => r.y < this.cameraY + LOGICAL_H + 220);

    // Ensure exact joined player count matches snapshot (2..5, never extra characters!)
    if (
      this.players.length !== snap.players.length ||
      snap.players.some((sp, idx) => this.players[idx]?.id !== sp.id)
    ) {
      this.players = createPlayersForMatch(
        snap.players.map((sp) => ({ id: sp.id, name: sp.name }))
      );
      snap.players.forEach((sp, idx) => {
        const rt = this.players[idx];
        if (!rt) return;
        const spec = PLAYER_PALETTE[sp.slotIndex] ?? PLAYER_PALETTE[idx] ?? PLAYER_PALETTE[0];
        rt.colorId = spec.id;
        rt.mainColor = spec.main;
        rt.darkColor = spec.dark;
        rt.x = sp.x;
        rt.worldY = sp.worldY;
        rt.vx = sp.vx;
        rt.grav = sp.grav;
        rt.grounded = sp.grounded;
        rt.dead = sp.dead;
        rt.runPhase = sp.runPhase;
        rt.squash = sp.squash;
      });
    }

    for (const sp of snap.players) {
      this.scores[sp.id] = sp.score;
      this.onlineTargets.set(sp.id, {
        x: sp.x,
        worldY: sp.worldY,
        vx: sp.vx,
        grav: sp.grav,
        grounded: sp.grounded,
        dead: sp.dead,
        withdrawn: sp.withdrawn,
        runPhase: sp.runPhase,
        squash: sp.squash,
        score: sp.score,
      });
    }

    this.syncHud(true);
  }

  public triggerBurst(x: number, screenY: number, color: string) {
    this.spawnExplosion(x, screenY, color);
  }

  private spawnExplosion(x: number, screenY: number, color: string) {
    this.rings.push({
      x,
      y: screenY,
      r: 10,
      maxR: 96,
      color,
      life: 0.45,
      maxLife: 0.45,
    });
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2 + Math.random() * 0.25;
      const spd = 110 + Math.random() * 200;
      this.particles.push({
        x,
        y: screenY,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 12,
        size: 7 + Math.random() * 6,
        color,
        life: 0.55,
        maxLife: 0.55,
      });
    }
    gravitySound.playBurstElimination();
  }

  private updateEffects(dt: number) {
    this.blackFade = Math.max(0, this.blackFade - dt * 2.1);

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.life -= dt;
      ring.r = ring.maxR * (1 - ring.life / ring.maxLife);
      if (ring.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.rot += pt.vrot * dt;
      if (pt.life <= 0) this.particles.splice(i, 1);
    }
  }

  private updateOnlineInterpolation(dt: number) {
    this.updateEffects(dt);
    const lerpFactor = Math.min(1, dt * 20);
    this.cameraY += (this.targetCameraY - this.cameraY) * lerpFactor;

    for (const p of this.players) {
      const target = this.onlineTargets.get(p.id);
      if (!target) continue;
      p.dead = target.dead;
      p.grav = target.grav;
      p.grounded = target.grounded;
      p.vx = target.vx;
      p.x += (target.x - p.x) * Math.min(1, dt * 24);
      p.worldY += (target.worldY - p.worldY) * Math.min(1, dt * 24);
      p.squash += (target.squash - p.squash) * Math.min(1, dt * 18);
      p.runPhase = target.runPhase;
    }
    this.syncHud();
  }

  private updateLocal(dt: number) {
    this.updateEffects(dt);
    if (this.roundState === 'match-over') return;

    const speed = computeScrollSpeed(this.roundElapsed, this.roundNumber);

    if (this.roundState === 'intro') {
      this.stateTimer -= dt;
      this.cameraY -= speed * 0.4 * dt;
      this.players.forEach((p) => {
        p.worldY -= speed * 0.4 * dt;
        p.runPhase += dt * 14;
      });
      if (this.stateTimer <= 0) {
        this.roundState = 'playing';
        gravitySound.playCountdownTick(true);
      }
      this.syncHud();
      return;
    }

    if (this.roundState === 'round-over') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        const redScore = this.scores.red ?? 0;
        const blueScore = this.scores.blue ?? 0;
        if (redScore >= this.config.targetScore || blueScore >= this.config.targetScore) {
          this.roundState = 'match-over';
          const redWon = redScore >= this.config.targetScore;
          const winnerIsBot = !redWon && this.config.mode === 'bot';
          gravitySound.playVictory();
          this.onMatchEnd({
            winnerId: redWon ? 'red' : winnerIsBot ? 'bot' : 'blue',
            winnerColorId: redWon ? 'red' : 'blue',
            winnerName: winnerIsBot
              ? 'فاز البوت'
              : redWon
                ? this.config.redName
                : this.config.blueName,
            winnerIsBot,
            redScore,
            blueScore,
            roundsPlayed: this.roundNumber,
          });
        } else {
          this.initLocalRound(this.roundNumber + 1);
        }
      }
      return;
    }

    this.roundElapsed += dt;
    this.cameraY -= speed * dt;

    while (this.nextTopY > this.cameraY - LOGICAL_H * 1.5) {
      const gen = generateVerticalChunks(this.nextTopY, this.chunkIndex, this.roundSeed);
      this.rects.push(...gen.rects);
      this.nextTopY = gen.nextTopY;
      this.chunkIndex++;
    }
    this.rects = this.rects.filter((r) => r.y < this.cameraY + LOGICAL_H + 180);

    if (this.config.mode === 'bot' && this.players[1]) {
      updateBotDecision(
        this.players[1],
        this.rects,
        this.cameraY,
        dt,
        this.roundElapsed,
        speed,
        this.config.difficulty
      );
    }

    for (const p of this.players) {
      const res = stepGravityPlayer(p, this.rects, this.cameraY, dt, speed);
      if (res.justDied) {
        this.spawnExplosion(res.deathX, res.deathScreenY, p.mainColor);
      }
    }

    const redDead = this.players[0]?.dead;
    const blueDead = this.players[1]?.dead;

    if (redDead || blueDead) {
      if (redDead && !blueDead) {
        this.scores.blue = (this.scores.blue ?? 0) + 1;
        this.onRoundEndBanner(
          this.config.mode === 'bot'
            ? '🔵 نقطة للبوت!'
            : `🔵 نقطة لـ ${this.config.blueName}!`
        );
      } else if (blueDead && !redDead) {
        this.scores.red = (this.scores.red ?? 0) + 1;
        this.onRoundEndBanner(`🔴 نقطة لـ ${this.config.redName}!`);
      } else {
        this.onRoundEndBanner('💥 سقوط مزدوج — إعادة الجولة!');
      }
      this.roundState = 'round-over';
      this.stateTimer = 0.95;
      this.syncHud(true);
    } else {
      this.syncHud();
    }
  }

  private drawCharacter(p: PlayerRuntime, showLabel: boolean) {
    if (p.dead) return;
    const ctx = this.ctx;
    const cx = p.x + p.w / 2;
    const cy = p.worldY - this.cameraY + p.h / 2;

    const mainCol = p.mainColor;
    const darkCol = p.darkColor;

    ctx.save();
    ctx.translate(cx, cy);
    if (p.grav === -1) {
      ctx.rotate(Math.PI / 2);
      ctx.scale(2 - p.squash, p.squash);
    } else {
      ctx.rotate(-Math.PI / 2);
      ctx.scale(-(2 - p.squash), p.squash);
    }

    const wave = Math.sin(p.runPhase * 1.3) * 4;
    ctx.fillStyle = mainCol;
    ctx.strokeStyle = '#141621';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(11, -7);
    ctx.lineTo(22, -10 + wave);
    ctx.lineTo(20, -4 + wave);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const stride = p.grounded ? Math.sin(p.runPhase) * 6 : 4;
    ctx.fillStyle = darkCol;
    ctx.beginPath();
    ctx.roundRect(-9 + stride, 9, 7, 7, 3);
    ctx.roundRect(2 - stride, 9, 7, 7, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = mainCol;
    ctx.beginPath();
    ctx.roundRect(-13, -13, 26, 25, 7);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = darkCol;
    ctx.fillRect(-13, -10, 26, 5);
    ctx.strokeRect(-13, -10, 26, 5);

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(-11, -4, 19, 11, 4);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-6.5, 1.5, 3.1, 4, 0, 0, Math.PI * 2);
    ctx.ellipse(1, 1.5, 3.1, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.arc(-7.5, 1.5, 1.5, 0, Math.PI * 2);
    ctx.arc(0, 1.5, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(-7, -13);
    ctx.lineTo(-8, -21);
    ctx.lineTo(-3, -17);
    ctx.lineTo(0, -23);
    ctx.lineTo(3, -17);
    ctx.lineTo(8, -21);
    ctx.lineTo(7, -13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // Subtle Telegram name tag in 3-5 player or online matches so players easily recognize themselves
    if (showLabel) {
      const isMe = this.config.localPlayerId && p.id === this.config.localPlayerId;
      const shortName = p.name.length > 10 ? p.name.slice(0, 9) + '…' : p.name;
      ctx.save();
      ctx.font = '800 11px Cairo, system-ui, sans-serif';
      const padX = 7;
      const textW = ctx.measureText(shortName).width;
      const pillW = textW + padX * 2;
      const offsetX = p.grav === -1 ? cx + 22 : cx - 22;
      const clampX = Math.max(pillW / 2 + 4, Math.min(WORLD_W - pillW / 2 - 4, offsetX));
      const pillY = cy - 22;
      ctx.fillStyle = isMe ? 'rgba(15, 23, 42, 0.88)' : 'rgba(15, 23, 42, 0.68)';
      ctx.strokeStyle = isMe ? '#facc15' : mainCol;
      ctx.lineWidth = isMe ? 1.8 : 1.3;
      ctx.beginPath();
      ctx.roundRect(clampX - pillW / 2, pillY - 9, pillW, 18, 9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(shortName, clampX, pillY);
      ctx.restore();
    }
  }

  private drawStar(x: number, y: number, r: number, rot: number, color: string, alpha: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = (i * Math.PI) / 5;
      if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private render() {
    const ctx = this.ctx;
    drawVerticalBiomeBackdrop(ctx, this.biome, WORLD_W, LOGICAL_H, this.cameraY);

    if (this.roundState === 'intro') {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.font = '900 175px Cairo, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(this.roundNumber), WORLD_W / 2, LOGICAL_H / 2);
      ctx.restore();
    }

    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];
      const sy = r.y - this.cameraY;
      if (sy + r.h < -40 || sy > LOGICAL_H + 40) continue;
      drawVerticalSolidRect(ctx, r, this.biome, sy);
    }

    const showLabels = this.config.mode === 'online' || this.players.length > 2;
    for (let i = 0; i < this.players.length; i++) {
      this.drawCharacter(this.players[i], showLabels);
    }

    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      const alpha = Math.max(0, ring.life / ring.maxLife);
      ctx.save();
      ctx.strokeStyle = ring.color;
      ctx.globalAlpha = alpha * 0.85;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (let i = 0; i < this.particles.length; i++) {
      const pt = this.particles[i];
      const alpha = Math.max(0, pt.life / pt.maxLife);
      this.drawStar(pt.x, pt.y, pt.size, pt.rot, pt.color, alpha);
    }

    if (this.blackFade > 0.01) {
      ctx.fillStyle = `rgba(0, 0, 0, ${this.blackFade})`;
      ctx.fillRect(0, 0, WORLD_W, LOGICAL_H);
    }
  }

  private syncHud(force = false) {
    const now = performance.now();
    if (!force && now - this.lastHudSync < 80) return;
    this.lastHudSync = now;

    const hudPlayers: HudPlayerScore[] = this.players.map((p) => {
      const onlineT = this.onlineTargets.get(p.id);
      return {
        id: p.id,
        name: p.name,
        colorId: p.colorId,
        mainColor: p.mainColor,
        score: this.scores[p.id] ?? 0,
        dead: p.dead,
        withdrawn: onlineT?.withdrawn ?? false,
      };
    });

    const me = this.config.localPlayerId
      ? this.players.find((p) => p.id === this.config.localPlayerId)
      : null;
    const spectating =
      this.config.mode === 'online' &&
      (!me || me.dead) &&
      this.roundState !== 'match-over';

    this.onHud({
      redScore: this.scores.red ?? hudPlayers[0]?.score ?? 0,
      blueScore: this.scores.blue ?? hudPlayers[1]?.score ?? 0,
      targetScore: this.config.targetScore,
      roundNumber: this.roundNumber,
      biomeName: this.biome.name,
      elapsedSeconds: Math.floor(this.roundElapsed),
      countdownBadge: this.roundState === 'intro' ? `الجولة ${this.roundNumber}` : null,
      players: hudPlayers,
      spectating,
    });
  }

  private loop = (ts: number) => {
    if (this.disposed) return;
    const dt = Math.min(0.035, Math.max(0.001, (ts - this.lastTs) / 1000));
    this.lastTs = ts;
    if (this.config.mode === 'online') {
      this.updateOnlineInterpolation(dt);
    } else {
      this.updateLocal(dt);
    }
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  public restart() {
    this.scores = { red: 0, blue: 0 };
    this.initLocalRound(1);
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}
