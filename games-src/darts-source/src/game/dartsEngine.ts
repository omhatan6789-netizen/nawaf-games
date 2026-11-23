import { renderDartsScene, type DartsRenderState, type RenderParticle } from './dartsRenderer';
import {
  AIM_SPAN,
  applyScoreThrow,
  evaluateDartHit,
  getOneDartCheckouts,
  pickBotTarget,
} from './dartsScoring';
import { dartsSound } from './dartsSound';
import type {
  DartsSettings,
  GameMode,
  HitResult,
  HudSnapshot,
  PinnedDart,
  PlayerSide,
  RoundThrowRecord,
  TurnPhase,
} from './dartsTypes';

export interface OnlineServerPayload {
  type: string;
  [key: string]: unknown;
}

export interface DartsEngineOptions {
  canvas: HTMLCanvasElement;
  mode: GameMode;
  mySide: PlayerSide;
  redName: string;
  blueName: string;
  settings: DartsSettings;
  onHudUpdate: (hud: HudSnapshot) => void;
  onSendOnlineAction?: (action: { type: 'lock_x' | 'lock_y'; value: number }) => void;
}

function triggerHaptic(enabled: boolean, kind: 'light' | 'medium' | 'heavy' | 'success' | 'error'): void {
  if (!enabled) return;
  try {
    const tg = (window as unknown as {
      Telegram?: {
        WebApp?: {
          HapticFeedback?: {
            impactOccurred?: (s: string) => void;
            notificationOccurred?: (t: string) => void;
          };
        };
      };
    }).Telegram?.WebApp?.HapticFeedback;
    if (!tg) return;
    if (kind === 'success' || kind === 'error') {
      tg.notificationOccurred?.(kind);
    } else {
      tg.impactOccurred?.(kind);
    }
  } catch {
    // Ignore outside Telegram
  }
}

export class DartsEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mode: GameMode;
  private mySide: PlayerSide;
  private redName: string;
  private blueName: string;
  private settings: DartsSettings;
  private onHudUpdate: (hud: HudSnapshot) => void;
  private onSendOnlineAction?: (action: { type: 'lock_x' | 'lock_y'; value: number }) => void;

  private rafId: number | null = null;
  private lastTs = 0;
  private destroyed = false;

  private phase: TurnPhase = 'countdown';
  private activeSide: PlayerSide = 'red';
  private redScore: number;
  private blueScore: number;
  private round = 1;
  private countdownTimer = 3.0;
  private lastCountdownShown = 3;

  private turnIntroTimer = 0;
  private aimClock = 0;
  private aimX = 0;
  private aimY = 0;
  private xLocked = false;
  private yLocked = false;
  private showHelp = false;

  // Bot automated aiming timers
  private botTarget = { xNorm: 0, yNorm: 0 };
  private botLockXTimer = 0;
  private botLockYTimer = 0;

  // Flight & impact state
  private flightProgress = 0;
  private flightEndNorm = { x: 0, y: 0 };
  private zoomProgress = 0;
  private impactTimer = 0;
  private pinnedDart: PinnedDart | null = null;
  private lastHit: HitResult | null = null;
  private pendingNextRemaining = 0;
  private pendingSide: PlayerSide = 'red';
  private particles: RenderParticle[] = [];
  private pulseTime = 0;

  private winnerSide: PlayerSide | null = null;
  private winnerName: string | null = null;
  private endReason: 'checkout' | 'withdraw' | null = null;
  private history: RoundThrowRecord[] = [];

  constructor(opts: DartsEngineOptions) {
    this.canvas = opts.canvas;
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.ctx = context;
    this.mode = opts.mode;
    this.mySide = opts.mySide;
    this.redName = opts.redName;
    this.blueName = opts.blueName;
    this.settings = opts.settings;
    this.onHudUpdate = opts.onHudUpdate;
    this.onSendOnlineAction = opts.onSendOnlineAction;

    this.redScore = opts.settings.startingScore;
    this.blueScore = opts.settings.startingScore;

    if (this.mode !== 'online') {
      dartsSound.playCountdownTick(3);
    }

    this.emitHud();
    this.lastTs = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  updateSettings(settings: DartsSettings): void {
    this.settings = settings;
  }

  canHumanAct(): boolean {
    if (this.phase !== 'aim_x' && this.phase !== 'aim_y') return false;
    if (this.showHelp) return false;
    if (this.mode === 'bot') return this.activeSide === 'red';
    if (this.mode === 'local') return true;
    return this.activeSide === this.mySide;
  }

  canShowHelpButton(): boolean {
    if (this.phase !== 'aim_x' && this.phase !== 'aim_y') return false;
    if (this.mode === 'bot') return this.activeSide === 'red';
    if (this.mode === 'local') return true;
    return this.activeSide === this.mySide;
  }

  toggleHelp(): void {
    if (!this.canShowHelpButton()) return;
    dartsSound.unlock();
    this.showHelp = !this.showHelp;
    triggerHaptic(this.settings.haptics, 'light');
    this.emitHud();
  }

  /** Handles player tap or Spacebar to lock X or lock Y */
  handleAimTap(): void {
    dartsSound.unlock();
    if (this.showHelp) {
      this.showHelp = false;
      this.emitHud();
      return;
    }
    if (!this.canHumanAct()) return;

    if (this.phase === 'aim_x') {
      const lockedX = this.aimX;
      this.xLocked = true;
      this.phase = 'aim_y';
      this.aimClock = Math.PI * 0.5;
      dartsSound.playAimLock('x');
      triggerHaptic(this.settings.haptics, 'light');
      if (this.mode === 'online') {
        this.onSendOnlineAction?.({ type: 'lock_x', value: lockedX });
      }
      this.emitHud();
      return;
    }

    if (this.phase === 'aim_y') {
      const lockedY = this.aimY;
      this.yLocked = true;
      dartsSound.playAimLock('y');
      triggerHaptic(this.settings.haptics, 'medium');
      if (this.mode === 'online') {
        this.onSendOnlineAction?.({ type: 'lock_y', value: lockedY });
        // Wait briefly for server authoritative throw, or preview flight immediately
        this.startFlight(this.aimX, lockedY, this.activeSide);
      } else {
        this.startFlight(this.aimX, lockedY, this.activeSide);
      }
    }
  }

  /** Receives authoritative state updates in Online mode */
  applyOnlineState(payload: OnlineServerPayload): void {
    if (this.mode !== 'online') return;

    if (payload.type === 'state_sync') {
      const nextPhase = payload.phase as TurnPhase;
      const nextSide = payload.activeSide as PlayerSide;
      const prevCountdown = this.lastCountdownShown;

      this.redScore = Number(payload.redScore ?? this.redScore);
      this.blueScore = Number(payload.blueScore ?? this.blueScore);
      this.round = Number(payload.round ?? this.round);
      this.activeSide = nextSide;

      if (typeof payload.redName === 'string') this.redName = payload.redName;
      if (typeof payload.blueName === 'string') this.blueName = payload.blueName;

      if (nextPhase === 'countdown') {
        const cd = Number(payload.countdownValue ?? 3);
        this.phase = 'countdown';
        this.lastCountdownShown = cd;
        if (cd !== prevCountdown && cd > 0) {
          dartsSound.playCountdownTick(cd);
        }
      } else if (nextPhase === 'turn_intro') {
        if (this.phase !== 'turn_intro') {
          this.beginTurn(nextSide, true);
        }
      } else if (nextPhase === 'aim_x') {
        if (this.phase !== 'aim_x') {
          this.phase = 'aim_x';
          this.xLocked = false;
          this.yLocked = false;
          this.aimClock = 0;
          this.pinnedDart = null;
        }
      } else if (nextPhase === 'aim_y') {
        if (this.phase !== 'aim_y') {
          this.aimX = Number(payload.lockedX ?? this.aimX);
          this.xLocked = true;
          this.phase = 'aim_y';
          this.aimClock = Math.PI * 0.5;
          if (this.activeSide !== this.mySide) {
            dartsSound.playAimLock('x');
          }
        }
      }

      this.emitHud();
      return;
    }

    if (payload.type === 'opponent_lock_x') {
      const val = Number(payload.value ?? 0);
      this.aimX = val;
      this.xLocked = true;
      this.phase = 'aim_y';
      this.aimClock = Math.PI * 0.5;
      dartsSound.playAimLock('x');
      this.emitHud();
      return;
    }

    if (payload.type === 'throw_resolved') {
      const side = payload.side as PlayerSide;
      const xNorm = Number(payload.xNorm ?? 0);
      const yNorm = Number(payload.yNorm ?? 0);
      const redAfter = Number(payload.redScore ?? this.redScore);
      const blueAfter = Number(payload.blueScore ?? this.blueScore);
      const record = payload.record as RoundThrowRecord | undefined;

      this.aimX = xNorm;
      this.aimY = yNorm;
      this.xLocked = true;
      this.yLocked = true;

      if (record) {
        this.history = [...this.history, record];
        this.lastHit = {
          ...evaluateDartHit(xNorm, yNorm),
          labelAr: record.labelAr,
          shortTag: record.shortTag,
          isBust: record.isBust,
          isCheckout: record.isCheckout,
        };
      }

      this.pendingSide = side;
      this.pendingNextRemaining = side === 'red' ? redAfter : blueAfter;
      this.redScore = redAfter;
      this.blueScore = blueAfter;

      // Trigger visual flight if not already flying
      if (this.phase !== 'flying' && this.phase !== 'impact_zoom') {
        this.startFlight(xNorm, yNorm, side, true);
      } else {
        this.flightEndNorm = { x: xNorm, y: yNorm };
      }

      if (payload.winnerSide) {
        this.winnerSide = payload.winnerSide as PlayerSide;
        this.winnerName = String(payload.winnerName ?? '');
        this.endReason = 'checkout';
      }
      this.emitHud();
      return;
    }

    if (payload.type === 'match_end') {
      this.winnerSide = (payload.winnerSide as PlayerSide) ?? null;
      this.winnerName = (payload.winnerName as string) ?? null;
      this.endReason = (payload.reason as 'checkout' | 'withdraw') ?? 'checkout';
      if (typeof payload.redScore === 'number') this.redScore = payload.redScore;
      if (typeof payload.blueScore === 'number') this.blueScore = payload.blueScore;
      if (Array.isArray(payload.history)) {
        this.history = payload.history as RoundThrowRecord[];
      }
      this.phase = 'finished';
      dartsSound.playVictory(this.winnerSide === this.mySide);
      this.emitHud();
    }
  }

  private beginTurn(side: PlayerSide, onlineControlled = false): void {
    this.activeSide = side;
    this.pinnedDart = null;
    this.lastHit = null;
    this.xLocked = false;
    this.yLocked = false;
    this.showHelp = false;
    this.aimX = 0;
    this.aimY = 0;
    this.aimClock = 0;
    this.zoomProgress = 0;

    if (side === 'red' || this.mode === 'local' || side === this.mySide) {
      this.phase = 'turn_intro';
      this.turnIntroTimer = 0;
      dartsSound.playTurnIntro(true);
    } else {
      // Bot or Online opponent starts aiming straight away with top header
      this.phase = 'aim_x';
      dartsSound.playTurnIntro(false);
      if (this.mode === 'bot' && !onlineControlled) {
        this.prepareBotTurn();
      }
    }
    this.emitHud();
  }

  private prepareBotTurn(): void {
    this.botTarget = pickBotTarget(this.blueScore, this.settings.difficulty);
    this.botLockXTimer = 0.72 + Math.random() * 0.45;
    this.botLockYTimer = 0.65 + Math.random() * 0.4;
  }

  private startFlight(
    xNorm: number,
    yNorm: number,
    side: PlayerSide,
    fromOnline = false
  ): void {
    this.phase = 'flying';
    this.flightProgress = 0;
    this.flightEndNorm = { x: xNorm, y: yNorm };
    this.showHelp = false;
    this.pendingSide = side;

    if (!fromOnline) {
      const current = side === 'red' ? this.redScore : this.blueScore;
      const raw = evaluateDartHit(xNorm, yNorm);
      const { nextRemaining, result } = applyScoreThrow(current, raw);
      this.lastHit = result;
      this.pendingNextRemaining = nextRemaining;
    } else {
      const raw = evaluateDartHit(xNorm, yNorm);
      this.lastHit = raw;
    }

    dartsSound.playDartWhoosh();
    this.emitHud();
  }

  private resolveImpact(): void {
    const { x, y } = this.flightEndNorm;
    const side = this.pendingSide;

    if (this.mode !== 'online') {
      const current = side === 'red' ? this.redScore : this.blueScore;
      const raw = evaluateDartHit(x, y);
      const { nextRemaining, result } = applyScoreThrow(current, raw);
      this.lastHit = result;

      if (side === 'red') {
        this.redScore = nextRemaining;
      } else {
        this.blueScore = nextRemaining;
      }

      const playerName = side === 'red' ? this.redName : this.blueName;
      this.history = [
        ...this.history,
        {
          round: this.round,
          side,
          playerName,
          hitScore: result.isBust ? 0 : result.score,
          shortTag: result.shortTag,
          labelAr: result.labelAr,
          remainingAfter: nextRemaining,
          isBust: Boolean(result.isBust),
          isCheckout: Boolean(result.isCheckout),
          xNorm: x,
          yNorm: y,
        },
      ];

      if (result.isCheckout) {
        this.winnerSide = side;
        this.winnerName = playerName;
        this.endReason = 'checkout';
      }
    }

    this.pinnedDart = {
      side,
      xNorm: x,
      yNorm: y,
      rotationRad: (Math.random() - 0.5) * 0.14,
    };

    const hit = this.lastHit ?? evaluateDartHit(x, y);
    dartsSound.playDartImpact(hit.ring, Boolean(hit.isBust), Boolean(hit.isCheckout));
    triggerHaptic(
      this.settings.haptics,
      hit.isBust ? 'error' : hit.isCheckout ? 'success' : 'heavy'
    );

    this.spawnImpactParticles(x, y, hit);
    this.phase = 'impact_zoom';
    this.impactTimer = 0;
    this.emitHud();
  }

  private spawnImpactParticles(xNorm: number, yNorm: number, hit: HitResult): void {
    const w = this.canvas.clientWidth || 360;
    const h = this.canvas.clientHeight || 640;
    const boardCx = w * 0.5;
    const boardCy = h * 0.415;
    const outerR = Math.min(w * 0.365, h * 0.255);
    const scoringR = outerR / 1.23;
    const px = boardCx + xNorm * scoringR;
    const py = boardCy + yNorm * scoringR;

    const palette =
      hit.ring === 'triple'
        ? ['#c084fc', '#facc15', '#ffffff']
        : hit.ring === 'double'
          ? ['#34d399', '#facc15', '#ffffff']
          : hit.ring === 'inner_bull'
            ? ['#f87171', '#facc15', '#ffffff']
            : ['#ffffff', '#fde047'];

    const count = hit.ring === 'miss' ? 4 : hit.multiplier >= 2 ? 16 : 9;
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const spd = 65 + Math.random() * 140;
      this.particles.push({
        x: px,
        y: py,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 20,
        size: 4 + Math.random() * 5,
        color: palette[i % palette.length],
        alpha: 1,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 6,
        isStar: hit.multiplier >= 2 || hit.ring === 'inner_bull',
      });
    }
  }

  private loop = (now: number): void => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTs) / 1000));
    this.lastTs = now;

    this.step(dt);
    this.render();

    this.rafId = requestAnimationFrame(this.loop);
  };

  private step(dt: number): void {
    this.pulseTime += dt;

    // Update particles
    if (this.particles.length > 0) {
      this.particles = this.particles
        .map((p) => ({
          ...p,
          x: p.x + p.vx * dt,
          y: p.y + p.vy * dt,
          vy: p.vy + 180 * dt,
          rotation: p.rotation + p.spin * dt,
          alpha: p.alpha - dt * 1.35,
        }))
        .filter((p) => p.alpha > 0);
    }

    const sweepSpeed = this.settings.aimSpeed === 'fast' ? 3.8 : 2.55;

    if (this.phase === 'countdown' && this.mode !== 'online') {
      this.countdownTimer -= dt;
      const shown = Math.max(1, Math.ceil(this.countdownTimer));
      if (shown !== this.lastCountdownShown && this.countdownTimer > 0) {
        this.lastCountdownShown = shown;
        dartsSound.playCountdownTick(shown);
        this.emitHud();
      }
      if (this.countdownTimer <= 0) {
        dartsSound.playStartCue();
        this.beginTurn('red');
      }
      return;
    }

    if (this.phase === 'turn_intro') {
      this.turnIntroTimer += dt / 1.05;
      if (this.turnIntroTimer >= 1) {
        this.phase = 'aim_x';
        this.aimClock = 0;
        this.emitHud();
      }
      return;
    }

    if (this.phase === 'aim_x') {
      if (!this.showHelp) {
        this.aimClock += dt * sweepSpeed;
        this.aimX = Math.sin(this.aimClock) * AIM_SPAN;
        this.aimY = 0;
      }

      if (this.mode === 'bot' && this.activeSide === 'blue') {
        this.botLockXTimer -= dt;
        // Blend cleanly toward bot target as timer approaches 0
        if (this.botLockXTimer <= 0) {
          this.aimX = this.botTarget.xNorm;
          this.xLocked = true;
          this.phase = 'aim_y';
          this.aimClock = Math.PI * 0.5;
          dartsSound.playAimLock('x');
          this.emitHud();
        }
      }
      return;
    }

    if (this.phase === 'aim_y') {
      if (!this.showHelp) {
        this.aimClock += dt * sweepSpeed;
        this.aimY = Math.sin(this.aimClock) * AIM_SPAN;
      }

      if (this.mode === 'bot' && this.activeSide === 'blue') {
        this.botLockYTimer -= dt;
        if (this.botLockYTimer <= 0) {
          this.aimY = this.botTarget.yNorm;
          this.yLocked = true;
          dartsSound.playAimLock('y');
          this.startFlight(this.aimX, this.aimY, 'blue');
        }
      }
      return;
    }

    if (this.phase === 'flying') {
      // Smooth gentle slow-motion flight (~0.58s)
      this.flightProgress += dt / 0.58;
      if (this.flightProgress >= 1) {
        this.flightProgress = 1;
        this.resolveImpact();
      }
      return;
    }

    if (this.phase === 'impact_zoom') {
      this.impactTimer += dt;
      // Smooth zoom in then slight hold
      this.zoomProgress = Math.min(1, this.impactTimer / 0.25);

      if (this.impactTimer >= 1.35) {
        if (this.winnerSide) {
          this.phase = 'finished';
          const iWon =
            this.mode === 'local'
              ? true
              : this.winnerSide === this.mySide;
          dartsSound.playVictory(iWon);
          this.emitHud();
          return;
        }

        if (this.mode !== 'online') {
          const nextSide: PlayerSide = this.activeSide === 'red' ? 'blue' : 'red';
          if (nextSide === 'red') {
            this.round += 1;
          }
          this.beginTurn(nextSide);
        }
      }
    }
  }

  private render(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const cssW = this.canvas.clientWidth || 360;
    const cssH = this.canvas.clientHeight || 640;
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);

    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    this.ctx.save();
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const activeLabel =
      this.activeSide === 'red'
        ? this.mode === 'local'
          ? `دور ${this.redName}`
          : this.mySide === 'red'
            ? 'دورك'
            : `دور ${this.redName}`
        : this.mode === 'bot'
          ? 'دور البوت'
          : this.mySide === 'blue'
            ? 'دورك'
            : `دور ${this.blueName}`;

    const isHumanTurn =
      (this.phase === 'aim_x' ||
        this.phase === 'aim_y' ||
        this.phase === 'turn_intro') &&
      (this.mode === 'local' || this.activeSide === this.mySide);
    const activeRemaining =
      this.activeSide === 'red' ? this.redScore : this.blueScore;
    const checkoutTargets = isHumanTurn
      ? getOneDartCheckouts(activeRemaining)
      : [];

    const flightZoom =
      this.phase === 'flying'
        ? Math.max(0, (this.flightProgress - 0.35) / 0.65) * 0.35
        : 0;

    const state: DartsRenderState = {
      phase: this.phase,
      activeSide: this.activeSide,
      mySide: this.mySide,
      activeLabel,
      countdownValue: this.lastCountdownShown,
      turnIntroProgress: Math.min(1, this.turnIntroTimer),
      aimX: this.aimX,
      aimY: this.aimY,
      xLocked: this.xLocked,
      yLocked: this.yLocked,
      showHelp: this.showHelp,
      hideAimDot: this.mode === 'bot' && this.activeSide === 'blue',
      checkoutTargets,
      pulseTime: this.pulseTime,
      aimProgress: this.flightProgress,
      flightEndNorm: this.flightEndNorm,
      flightFromSide: this.pendingSide,
      zoomAmount:
        this.phase === 'impact_zoom'
          ? Math.min(1, 0.35 + Math.sin(Math.min(1, this.zoomProgress) * (Math.PI / 2)) * 0.65)
          : flightZoom,
      zoomFocusNorm: this.flightEndNorm,
      pinnedDart: this.pinnedDart,
      lastHit: this.lastHit,
      impactPopupAlpha:
        this.phase === 'impact_zoom'
          ? Math.min(1, this.impactTimer * 4) *
            (this.impactTimer > 1.05 ? Math.max(0, 1 - (this.impactTimer - 1.05) / 0.3) : 1)
          : 0,
      impactRingProgress:
        this.phase === 'impact_zoom' ? Math.min(1, this.impactTimer / 0.65) : 0,
      particles: this.particles,
    };

    renderDartsScene(this.ctx, cssW, cssH, state);
    this.ctx.restore();
  }

  private emitHud(): void {
    this.onHudUpdate({
      phase: this.phase,
      activeSide: this.activeSide,
      mySide: this.mySide,
      mode: this.mode,
      redName: this.redName,
      blueName: this.blueName,
      redScore: this.redScore,
      blueScore: this.blueScore,
      startingScore: this.settings.startingScore,
      round: this.round,
      countdownValue: this.lastCountdownShown,
      showHelp: this.showHelp,
      canToggleHelp: this.canShowHelpButton(),
      lastHit: this.lastHit,
      winnerSide: this.winnerSide,
      winnerName: this.winnerName,
      endReason: this.endReason,
      history: this.history,
    });
  }
}
