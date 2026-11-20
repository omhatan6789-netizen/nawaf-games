import { planNawafBotShot } from './carromBot';
import {
  BOARD_SIZE,
  CarromDisc,
  CarromPlayerState,
  DifficultyLevel,
  FourPlayerMode,
  GameMode,
  MAX_PULL_DISTANCE,
  MAX_SHOT_SPEED,
  MIN_PULL_DISTANCE,
  PieceKind,
  PlayerCount,
  QueenStatus,
  STRIKER_RADIUS,
  createInitialCoins,
  createStriker,
  findNearestClearSlider,
  isStrikerSpotClear,
  resolveCarromTurn,
  sliderToStrikerPos,
  stepCarromPhysics,
} from './carromPhysics';
import { AimVisualState, CarromBoardRenderer, ImpactSpark } from './carromRenderer';
import { carromSound } from './carromSound';

export interface CarromHudSnapshot {
  players: CarromPlayerState[];
  turn: number;
  playerCount: PlayerCount;
  fourMode: FourPlayerMode;
  queenStatus: QueenStatus;
  queenHolderSlot: number | null;
  remainingWhite: number;
  remainingBlack: number;
  sliderNorm: number;
  strikerOverlapping: boolean;
  canInteract: boolean;
  shotMoving: boolean;
  hintText: string;
  spectating: boolean;
}

export interface CarromMatchResult {
  winnerName: string;
  winnerIsBot: boolean;
  winnerIsDraw: boolean;
  winnerSide: 'white' | 'black' | 'draw' | null;
  standings: Array<{
    id: string;
    name: string;
    side: 'white' | 'black' | 'solo';
    score: number;
    pocketedCount: number;
    hasQueen: boolean;
  }>;
  turnsPlayed: number;
}

export interface OnlineCarromSnapshot {
  roomId: string;
  playerCount: PlayerCount;
  fourMode: FourPlayerMode;
  players: CarromPlayerState[];
  coins: CarromDisc[];
  striker: CarromDisc | null;
  turn: number;
  shotMoving: boolean;
  sliderNorm: number;
  queenStatus: QueenStatus;
  queenHolderSlot: number | null;
  remoteAim?: AimVisualState | null;
}

export interface CarromMatchConfig {
  mode: GameMode;
  difficulty: DifficultyLevel;
  playerCount: PlayerCount;
  fourMode: FourPlayerMode;
  playerNames: string[];
  localSlotIndex?: number; // for online mode
  spectating?: boolean;
  onOnlineSliderMove?: (sliderNorm: number) => void;
  onOnlineAim?: (aim: AimVisualState | null) => void;
  onOnlineShoot?: (sliderNorm: number, vx: number, vy: number) => void;
}

export interface CarromEngineCallbacks {
  onHud: (hud: CarromHudSnapshot) => void;
  onToast: (msg: string) => void;
  onMatchEnd: (res: CarromMatchResult) => void;
}

export class CarromGameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderer = new CarromBoardRenderer();
  private config: CarromMatchConfig;
  private callbacks: CarromEngineCallbacks;

  private coins: CarromDisc[] = [];
  private striker: CarromDisc | null = null;
  private players: CarromPlayerState[] = [];
  private turn = 0;
  private sliderNorm = 0;
  private queenStatus: QueenStatus = 'on_board';
  private queenHolderSlot: number | null = null;

  private shotMoving = false;
  private matchOver = false;
  private turnsPlayed = 0;
  private pocketedThisTurn: PieceKind[] = [];
  private strikerPocketedThisTurn = false;

  private draggingAim = false;
  private activePointerId: number | null = null;
  private aimState: AimVisualState | null = null;
  private remoteAimState: AimVisualState | null = null;
  private sparks: ImpactSpark[] = [];

  private rafId = 0;
  private lastTime = 0;
  private disposed = false;
  private botTimerIds: number[] = [];
  private lastOnlineSliderSentAt = 0;
  private lastOnlineAimSentAt = 0;

  constructor(
    canvas: HTMLCanvasElement,
    config: CarromMatchConfig,
    callbacks: CarromEngineCallbacks
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context unavailable');
    }
    this.ctx = context;
    this.config = config;
    this.callbacks = callbacks;

    this.attachEvents();
    this.initMatch();
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private clearBotTimers() {
    for (const id of this.botTimerIds) {
      window.clearTimeout(id);
    }
    this.botTimerIds = [];
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.clearBotTimers();
    this.detachEvents();
  }

  public restart() {
    this.clearBotTimers();
    this.initMatch();
  }

  private initMatch() {
    const { mode, playerCount, fourMode, playerNames } = this.config;
    const count: PlayerCount = mode === 'bot' ? 2 : playerCount;
    const isTeams = count === 4 && fourMode === 'teams';
    const isSolo = count === 4 && fourMode === 'solo';

    this.players = [];
    for (let i = 0; i < count; i++) {
      const defaultName =
        mode === 'bot'
          ? i === 0
            ? 'أنت'
            : 'بوت نواف'
          : `اللاعب ${i + 1}`;
      const name = playerNames[i]?.trim() || defaultName;
      const side: CarromPlayerState['side'] = isSolo
        ? 'solo'
        : i % 2 === 0
          ? 'white'
          : 'black';
      const teamIndex = isTeams ? i % 2 : i;

      this.players.push({
        id: `p_${i}`,
        name,
        slotIndex: i,
        side,
        teamIndex,
        score: 0,
        pocketedCount: 0,
        hasQueen: false,
      });
    }

    this.coins = createInitialCoins();
    this.turn = 0;
    this.queenStatus = 'on_board';
    this.queenHolderSlot = null;
    this.shotMoving = false;
    this.matchOver = false;
    this.turnsPlayed = 0;
    this.pocketedThisTurn = [];
    this.strikerPocketedThisTurn = false;
    this.draggingAim = false;
    this.aimState = null;
    this.remoteAimState = null;
    this.sparks = [];

    if (mode !== 'online') {
      this.placeStrikerForTurn(0);
    } else {
      this.striker = createStriker(0, count, 0);
    }

    this.emitHud();
  }

  private placeStrikerForTurn(preferNorm = 0) {
    const count: PlayerCount = this.config.mode === 'bot' ? 2 : this.config.playerCount;
    const clearNorm = findNearestClearSlider(preferNorm, this.turn, count, this.coins);
    this.sliderNorm = clearNorm;
    this.striker = createStriker(this.turn, count, clearNorm);
  }

  private getEffectivePlayerCount(): PlayerCount {
    return this.config.mode === 'bot' ? 2 : this.config.playerCount;
  }

  private canHumanInteract(): boolean {
    if (this.matchOver || this.shotMoving) return false;
    if (this.config.spectating) return false;
    if (this.config.mode === 'bot' && this.turn === 1) return false;
    if (
      this.config.mode === 'online' &&
      this.config.localSlotIndex !== undefined &&
      this.turn !== this.config.localSlotIndex
    ) {
      return false;
    }
    return Boolean(this.striker && !this.striker.pocketed);
  }

  private isCurrentStrikerOverlapping(): boolean {
    if (!this.striker || this.striker.pocketed) return false;
    return !isStrikerSpotClear(this.striker.x, this.striker.y, this.coins);
  }

  public setSliderNorm(nextNorm: number) {
    if (!this.canHumanInteract() || !this.striker) return;
    const clamped = Math.max(-1, Math.min(1, nextNorm));
    this.sliderNorm = clamped;
    const pos = sliderToStrikerPos(clamped, this.turn, this.getEffectivePlayerCount());
    this.striker.x = pos.x;
    this.striker.y = pos.y;

    if (this.config.mode === 'online') {
      const now = performance.now();
      if (now - this.lastOnlineSliderSentAt > 36) {
        this.lastOnlineSliderSentAt = now;
        this.config.onOnlineSliderMove?.(clamped);
      }
    }
    this.emitHud();
  }

  public commitSliderEnd() {
    if (this.config.mode === 'online' && this.canHumanInteract()) {
      this.config.onOnlineSliderMove?.(this.sliderNorm);
    }
  }

  public applyOnlineSnapshot(snap: OnlineCarromSnapshot) {
    this.config.playerCount = snap.playerCount;
    this.config.fourMode = snap.fourMode;
    this.players = snap.players.map((p) => ({ ...p }));
    this.coins = snap.coins.map((c) => ({ ...c }));
    this.striker = snap.striker ? { ...snap.striker } : null;
    this.turn = snap.turn;
    this.shotMoving = snap.shotMoving;
    this.sliderNorm = snap.sliderNorm;
    this.queenStatus = snap.queenStatus;
    this.queenHolderSlot = snap.queenHolderSlot;
    this.remoteAimState = snap.remoteAim ?? null;

    if (this.shotMoving) {
      this.draggingAim = false;
      this.aimState = null;
    }
    this.emitHud();
  }

  public handleRemoteSfx(payload: {
    kind: string;
    intensity?: number;
    isQueen?: boolean;
    isStriker?: boolean;
    x?: number;
    y?: number;
  }) {
    if (payload.kind === 'clack') {
      carromSound.playClack(payload.intensity ?? 0.5);
      if (payload.x !== undefined && payload.y !== undefined) {
        this.spawnSparks(payload.x, payload.y, '#fde68a', 4);
      }
    } else if (payload.kind === 'wall') {
      carromSound.playWall(payload.intensity ?? 0.5);
    } else if (payload.kind === 'pocket') {
      carromSound.playPocket(Boolean(payload.isQueen), Boolean(payload.isStriker));
      if (payload.x !== undefined && payload.y !== undefined) {
        this.spawnSparks(
          payload.x,
          payload.y,
          payload.isQueen ? '#ff4d5e' : '#fbbf24',
          10
        );
      }
    } else if (payload.kind === 'shoot') {
      carromSound.playShoot(payload.intensity ?? 0.6);
    }
  }

  public markOnlineMatchOver() {
    this.matchOver = true;
    this.shotMoving = false;
    this.draggingAim = false;
    this.aimState = null;
    this.remoteAimState = null;
    this.emitHud();
  }

  private getHintText(): string {
    if (this.matchOver) return 'انتهت المباراة!';
    const current = this.players[this.turn];
    const activeName = current?.name || 'اللاعب';

    if (this.config.spectating) {
      return `👀 وضع المشاهدة — الدور الآن: ${activeName}`;
    }
    if (this.shotMoving) {
      return 'الأقراص تتحرك...';
    }
    if (this.config.mode === 'bot' && this.turn === 1) {
      return '🤖 بوت نواف يختار زاوية التسديد...';
    }
    if (
      this.config.mode === 'online' &&
      this.config.localSlotIndex !== undefined &&
      this.turn !== this.config.localSlotIndex
    ) {
      return `⏳ دور ${activeName}...`;
    }
    if (this.isCurrentStrikerOverlapping()) {
      return '⚠️ حرّك السحّاب يمين أو يسار لمكان فارغ على الخط';
    }
    if (this.queenStatus === 'pending_cover' && this.queenHolderSlot === this.turn) {
      return '👑 غطِّ الملكة! أدخل قرصًا من لونك الآن لتثبيت الملكة';
    }
    return 'حرّك السحّاب لتحديد مكان القرص، ثم اسحب القرص للخلف وأفلته للتسديد';
  }

  private emitHud() {
    const remWhite = this.coins.filter((c) => !c.pocketed && c.kind === 'white').length;
    const remBlack = this.coins.filter((c) => !c.pocketed && c.kind === 'black').length;

    this.callbacks.onHud({
      players: this.players.map((p) => ({ ...p })),
      turn: this.turn,
      playerCount: this.getEffectivePlayerCount(),
      fourMode: this.config.fourMode,
      queenStatus: this.queenStatus,
      queenHolderSlot: this.queenHolderSlot,
      remainingWhite: remWhite,
      remainingBlack: remBlack,
      sliderNorm: this.sliderNorm,
      strikerOverlapping: this.isCurrentStrikerOverlapping(),
      canInteract: this.canHumanInteract(),
      shotMoving: this.shotMoving,
      hintText: this.getHintText(),
      spectating: Boolean(this.config.spectating),
    });
  }

  private toBoardPos(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * BOARD_SIZE,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * BOARD_SIZE,
    };
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.canHumanInteract() || !this.striker) return;
    carromSound.unlock();

    const pos = this.toBoardPos(e.clientX, e.clientY);
    const dist = Math.hypot(pos.x - this.striker.x, pos.y - this.striker.y);
    if (dist > STRIKER_RADIUS * 2.75) return;

    e.preventDefault();
    this.draggingAim = true;
    this.activePointerId = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    this.updateAimFromPoint(pos.x, pos.y);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.draggingAim || e.pointerId !== this.activePointerId) return;
    e.preventDefault();
    const pos = this.toBoardPos(e.clientX, e.clientY);
    this.updateAimFromPoint(pos.x, pos.y);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.draggingAim || e.pointerId !== this.activePointerId) return;
    e.preventDefault();
    this.draggingAim = false;
    this.activePointerId = null;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const aim = this.aimState;
    this.aimState = null;

    if (this.config.mode === 'online') {
      this.config.onOnlineAim?.(null);
    }

    if (!aim || !aim.validPull || !this.striker) {
      return;
    }

    if (this.isCurrentStrikerOverlapping()) {
      this.callbacks.onToast('⚠️ حرّك السحّاب إلى مكان فارغ على الخط أولًا!');
      return;
    }

    const speed = aim.powerNorm * MAX_SHOT_SPEED;
    const vx = aim.dirX * speed;
    const vy = aim.dirY * speed;

    this.executeShot(vx, vy);
  };

  private updateAimFromPoint(px: number, py: number) {
    if (!this.striker) return;
    const dx = this.striker.x - px;
    const dy = this.striker.y - py;
    const pullDist = Math.hypot(dx, dy);
    const clampedPull = Math.min(MAX_PULL_DISTANCE, pullDist);
    const validPull = pullDist >= MIN_PULL_DISTANCE;

    let dirX = 0;
    let dirY = -1;
    if (pullDist > 0.5) {
      dirX = dx / pullDist;
      dirY = dy / pullDist;
    }

    const pullX =
      pullDist > MAX_PULL_DISTANCE
        ? this.striker.x - dirX * MAX_PULL_DISTANCE
        : px;
    const pullY =
      pullDist > MAX_PULL_DISTANCE
        ? this.striker.y - dirY * MAX_PULL_DISTANCE
        : py;

    const powerNorm = validPull
      ? Math.min(1, (clampedPull - MIN_PULL_DISTANCE) / (MAX_PULL_DISTANCE - MIN_PULL_DISTANCE))
      : 0;

    const nextAim: AimVisualState = {
      active: true,
      pullX,
      pullY,
      powerNorm: Math.max(0.08, powerNorm),
      dirX,
      dirY,
      validPull,
    };
    this.aimState = nextAim;

    if (this.config.mode === 'online') {
      const now = performance.now();
      if (now - this.lastOnlineAimSentAt > 55) {
        this.lastOnlineAimSentAt = now;
        this.config.onOnlineAim?.(nextAim);
      }
    }
  }

  private executeShot(vx: number, vy: number) {
    if (!this.striker) return;
    const speed = Math.hypot(vx, vy);
    const powerNorm = Math.min(1, speed / MAX_SHOT_SPEED);
    carromSound.playShoot(powerNorm);

    if (this.config.mode === 'online') {
      this.config.onOnlineShoot?.(this.sliderNorm, vx, vy);
      return;
    }

    this.striker.vx = vx;
    this.striker.vy = vy;
    this.shotMoving = true;
    this.pocketedThisTurn = [];
    this.strikerPocketedThisTurn = false;
    this.turnsPlayed += 1;
    this.emitHud();
  }

  private scheduleBotTurn() {
    this.clearBotTimers();
    if (this.disposed || this.matchOver || this.config.mode !== 'bot' || this.turn !== 1) {
      return;
    }

    const plan = planNawafBotShot({
      coins: this.coins,
      slotIndex: 1,
      playerCount: 2,
      difficulty: this.config.difficulty,
      queenStatus: this.queenStatus,
      queenHolderSlot: this.queenHolderSlot,
    });

    // Step 1: Smoothly slide Bot's striker along top baseline so player sees Bot choosing position
    const startNorm = this.sliderNorm;
    const targetNorm = plan.sliderNorm;
    const slideSteps = 14;
    for (let s = 1; s <= slideSteps; s++) {
      const t = window.setTimeout(() => {
        if (this.disposed || this.matchOver || !this.striker) return;
        const frac = s / slideSteps;
        const ease = 1 - Math.pow(1 - frac, 3);
        const norm = startNorm + (targetNorm - startNorm) * ease;
        this.sliderNorm = norm;
        const pos = sliderToStrikerPos(norm, 1, 2);
        this.striker.x = pos.x;
        this.striker.y = pos.y;
        this.emitHud();
      }, 240 + s * 28);
      this.botTimerIds.push(t);
    }

    // Step 2: Show Bot's aim arrow briefly before release
    const aimTimer = window.setTimeout(() => {
      if (this.disposed || this.matchOver || !this.striker) return;
      const spd = Math.hypot(plan.vx, plan.vy) || 1;
      const ux = plan.vx / spd;
      const uy = plan.vy / spd;
      const pNorm = Math.min(1, spd / MAX_SHOT_SPEED);
      const pullDist = MIN_PULL_DISTANCE + pNorm * 95;
      this.aimState = {
        active: true,
        pullX: this.striker.x - ux * pullDist,
        pullY: this.striker.y - uy * pullDist,
        powerNorm: pNorm,
        dirX: ux,
        dirY: uy,
        validPull: true,
      };
    }, 700);
    this.botTimerIds.push(aimTimer);

    // Step 3: Release and fire!
    const shootTimer = window.setTimeout(() => {
      if (this.disposed || this.matchOver || !this.striker) return;
      this.aimState = null;
      this.executeShot(plan.vx, plan.vy);
    }, 1150);
    this.botTimerIds.push(shootTimer);
  }

  private spawnSparks(x: number, y: number, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 140;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: 0.28 + Math.random() * 0.16,
        maxLife: 0.44,
        color,
        size: 2.2 + Math.random() * 2.4,
      });
    }
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(0.033, Math.max(0.001, rawDt));

    // Advance pocket-drop animations
    for (const c of this.coins) {
      if (c.pocketed && c.pocketAnim !== undefined && c.pocketAnim < 1) {
        c.pocketAnim = Math.min(1, c.pocketAnim + dt * 4.5);
      }
    }
    if (
      this.striker &&
      this.striker.pocketed &&
      this.striker.pocketAnim !== undefined &&
      this.striker.pocketAnim < 1
    ) {
      this.striker.pocketAnim = Math.min(1, this.striker.pocketAnim + dt * 4.5);
    }

    // Advance sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.life -= dt;
      if (sp.life <= 0) {
        this.sparks.splice(i, 1);
      }
    }

    // Local physics simulation (bot / local mode)
    if (this.config.mode !== 'online' && this.shotMoving) {
      const { events, anyMoving } = stepCarromPhysics(this.coins, this.striker, dt);
      for (const ev of events) {
        if (ev.type === 'clack') {
          carromSound.playClack(ev.intensity);
          if (ev.intensity > 0.22) {
            this.spawnSparks(ev.x, ev.y, '#fde68a', 4);
          }
        } else if (ev.type === 'wall') {
          carromSound.playWall(ev.intensity);
        } else if (ev.type === 'pocket') {
          const isQ = ev.kind === 'queen';
          const isS = ev.kind === 'striker';
          carromSound.playPocket(isQ, isS);
          this.spawnSparks(ev.x, ev.y, isQ ? '#ff4d5e' : '#fbbf24', 10);
          if (isS) {
            this.strikerPocketedThisTurn = true;
          } else if (ev.kind === 'white' || ev.kind === 'black' || ev.kind === 'queen') {
            this.pocketedThisTurn.push(ev.kind);
          }
        }
      }

      if (!anyMoving) {
        this.shotMoving = false;
        this.handleLocalTurnEnd();
      }
    }

    // Ensure HiDPI backing resolution matches display size
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const targetW = Math.max(400, Math.round(rect.width * dpr));
    const targetH = Math.max(400, Math.round(rect.height * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    const scaleToBoard = targetW / BOARD_SIZE;
    this.renderer.render(this.ctx, scaleToBoard, {
      coins: this.coins,
      striker: this.striker,
      strikerOverlapping: this.isCurrentStrikerOverlapping(),
      canInteract: this.canHumanInteract(),
      aim: this.aimState ?? this.remoteAimState,
      sparks: this.sparks,
    });

    this.rafId = requestAnimationFrame(this.loop);
  };

  private handleLocalTurnEnd() {
    const count = this.getEffectivePlayerCount();
    const { resolution, nextQueenStatus, nextQueenHolderSlot } = resolveCarromTurn({
      turn: this.turn,
      players: this.players,
      playerCount: count,
      fourMode: this.config.fourMode,
      coins: this.coins,
      pocketedThisTurn: this.pocketedThisTurn,
      strikerPocketed: this.strikerPocketedThisTurn,
      queenStatus: this.queenStatus,
      queenHolderSlot: this.queenHolderSlot,
    });

    this.queenStatus = nextQueenStatus;
    this.queenHolderSlot = nextQueenHolderSlot;

    if (resolution.toastText) {
      this.callbacks.onToast(resolution.toastText);
    }

    if (resolution.matchFinished) {
      this.matchOver = true;
      this.turn = resolution.nextTurn;
      this.emitHud();

      const isBotWin = this.config.mode === 'bot' && resolution.winnerSide === 'black';
      const isDraw = resolution.winnerSide === 'draw';
      let winnerName = 'الفائز';

      if (isDraw) {
        winnerName = 'تعادل';
      } else if (count === 4 && this.config.fourMode === 'teams') {
        winnerName = resolution.winnerTeam === 0 ? 'الفريق الأبيض' : 'الفريق الأسود';
      } else if (resolution.winnerSlot !== null && this.players[resolution.winnerSlot]) {
        winnerName = this.players[resolution.winnerSlot].name;
      }

      carromSound.playVictory(!isBotWin);
      this.callbacks.onMatchEnd({
        winnerName,
        winnerIsBot: isBotWin,
        winnerIsDraw: isDraw,
        winnerSide: resolution.winnerSide,
        standings: this.players.map((p) => ({
          id: p.id,
          name: p.name,
          side: p.side,
          score: p.score,
          pocketedCount: p.pocketedCount,
          hasQueen: p.hasQueen,
        })),
        turnsPlayed: this.turnsPlayed,
      });
      return;
    }

    this.turn = resolution.nextTurn;
    this.placeStrikerForTurn(0);
    this.emitHud();

    if (this.config.mode === 'bot' && this.turn === 1) {
      this.scheduleBotTurn();
    }
  }

  private attachEvents() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  private detachEvents() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
  }
}
