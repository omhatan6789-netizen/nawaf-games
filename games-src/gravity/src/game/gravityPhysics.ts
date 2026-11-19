import {
  LOGICAL_H,
  PLAYER_PALETTE,
  WALL_BASE_W,
  WORLD_W,
} from './gravityBiomes.ts';
import type {
  DifficultyLevel,
  PlayerColorId,
  SolidRect,
} from './gravityBiomes.ts';

export interface PlayerRuntime {
  slotIndex: number;
  id: string;
  colorId: PlayerColorId;
  mainColor: string;
  darkColor: string;
  name: string;
  x: number;
  worldY: number;
  vx: number;
  w: number;
  h: number;
  grav: -1 | 1;
  grounded: boolean;
  dead: boolean;
  flipCooldown: number;
  aiCooldown: number;
  runPhase: number;
  squash: number;
  anchorOffsetY: number;
}

export const BOT_DIFF_PARAMS: Record<
  DifficultyLevel,
  { safeSeconds: number; slipChance: number }
> = {
  سهل: { safeSeconds: 30, slipChance: 0.45 },
  متوسط: { safeSeconds: 40, slipChance: 0.36 },
  صعب: { safeSeconds: 60, slipChance: 0.28 },
};

export function createPlayersForMatch(
  descriptors: Array<{ id: string; name: string }>
): PlayerRuntime[] {
  return descriptors.slice(0, 5).map((desc, idx) => {
    const color = PLAYER_PALETTE[idx] ?? PLAYER_PALETTE[0];
    const startLeft = idx % 2 === 0;
    const laneRank = Math.floor(idx / 2);
    const anchorOffsetY = laneRank * 42;
    return {
      slotIndex: idx,
      id: desc.id,
      colorId: color.id,
      mainColor: color.main,
      darkColor: color.dark,
      name: desc.name,
      x: startLeft ? WALL_BASE_W + 1 : WORLD_W - WALL_BASE_W - 31,
      worldY: LOGICAL_H - 190 - anchorOffsetY,
      vx: 0,
      w: 30,
      h: 28,
      grav: startLeft ? -1 : 1,
      grounded: true,
      dead: false,
      flipCooldown: 0,
      aiCooldown: 0,
      runPhase: startLeft ? 0 : Math.PI,
      squash: 1,
      anchorOffsetY,
    };
  });
}

export function stepGravityPlayer(
  p: PlayerRuntime,
  rects: SolidRect[],
  cameraY: number,
  dt: number,
  scrollSpeed: number
): { justDied: boolean; deathX: number; deathScreenY: number } {
  if (p.dead) {
    return { justDied: false, deathX: 0, deathScreenY: 0 };
  }

  p.flipCooldown = Math.max(0, p.flipCooldown - dt);
  p.squash = p.squash + (1 - p.squash) * Math.min(1, 14 * dt);

  const targetWorldY = cameraY + LOGICAL_H - 190 - p.anchorOffsetY;
  const behind = p.worldY - targetWorldY;
  const catchup = behind > 10 ? Math.min(18, (behind - 10) * 0.14) : 0;
  const vy = -(scrollSpeed + catchup);

  let nextY = p.worldY + vy * dt;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (p.x + p.w > r.x + 5 && p.x < r.x + r.w - 5) {
      if (p.worldY >= r.y + r.h - 6 && nextY < r.y + r.h) {
        nextY = r.y + r.h;
      }
    }
  }
  p.worldY = nextY;

  const gravityAcc = 2450;
  p.vx += p.grav * gravityAcc * dt;
  p.vx = Math.max(-780, Math.min(780, p.vx));

  let nextX = p.x + p.vx * dt;
  let landed = false;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (p.worldY + p.h > r.y + 3 && p.worldY < r.y + r.h - 3) {
      if (p.vx > 0 && p.x + p.w <= r.x + 12 && nextX + p.w >= r.x) {
        nextX = r.x - p.w;
        if (p.grav === 1 && !p.grounded) p.squash = 0.78;
        p.vx = 0;
        if (p.grav === 1) landed = true;
      } else if (p.vx < 0 && p.x >= r.x + r.w - 12 && nextX <= r.x + r.w) {
        nextX = r.x + r.w;
        if (p.grav === -1 && !p.grounded) p.squash = 0.78;
        p.vx = 0;
        if (p.grav === -1) landed = true;
      }
    }
  }

  p.x = nextX;
  p.grounded = landed;
  if (landed) {
    p.runPhase += dt * 18;
  }

  const screenY = p.worldY - cameraY;
  if (p.x < -34 || p.x > WORLD_W + 34 || screenY > LOGICAL_H + 18) {
    p.dead = true;
    return {
      justDied: true,
      deathX: Math.max(24, Math.min(WORLD_W - 24, p.x + p.w / 2)),
      deathScreenY: Math.max(28, Math.min(LOGICAL_H - 28, screenY + p.h / 2)),
    };
  }

  return { justDied: false, deathX: 0, deathScreenY: 0 };
}

export function simulateBotPath(
  bot: PlayerRuntime,
  rects: SolidRect[],
  cameraY: number,
  scrollSpeed: number,
  flip: boolean,
  maxSteps: number
): boolean {
  let sx = bot.x;
  let sy = bot.worldY;
  const sg: -1 | 1 = flip ? (bot.grav === 1 ? -1 : 1) : bot.grav;
  let svx = flip ? sg * 230 : bot.vx;
  const sw = bot.w;
  const sh = bot.h;
  const dt = 1 / 60;
  let landGrace = -1;

  for (let s = 0; s < maxSteps; s++) {
    const targetWorldY =
      cameraY - scrollSpeed * dt * s + LOGICAL_H - 190 - bot.anchorOffsetY;
    const behind = sy - targetWorldY;
    const catchup = behind > 10 ? Math.min(18, (behind - 10) * 0.14) : 0;
    const vy = -(scrollSpeed + catchup);

    const ny = sy + vy * dt;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (sx + sw > r.x + 5 && sx < r.x + r.w - 5) {
        if (sy >= r.y + r.h - 6 && ny < r.y + r.h) {
          return false;
        }
      }
    }
    sy = ny;

    svx += sg * 2450 * dt;
    svx = Math.max(-780, Math.min(780, svx));
    let nx = sx + svx * dt;
    let landed = false;

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (sy + sh > r.y + 3 && sy < r.y + r.h - 3) {
        if (svx > 0 && sx + sw <= r.x + 12 && nx + sw >= r.x) {
          nx = r.x - sw;
          svx = 0;
          if (sg === 1) landed = true;
        } else if (svx < 0 && sx >= r.x + r.w - 12 && nx <= r.x + r.w) {
          nx = r.x + r.w;
          svx = 0;
          if (sg === -1) landed = true;
        }
      }
    }

    sx = nx;
    if (sx < -16 || sx > WORLD_W + 16) {
      return false;
    }

    if (flip && landed && landGrace < 0) {
      landGrace = 5;
    }
    if (landGrace >= 0) {
      if (landGrace === 0) return true;
      landGrace--;
    }
  }

  if (flip && landGrace < 0) {
    return false;
  }
  return true;
}

export function updateBotDecision(
  bot: PlayerRuntime,
  rects: SolidRect[],
  cameraY: number,
  dt: number,
  roundElapsed: number,
  scrollSpeed: number,
  difficulty: DifficultyLevel
): boolean {
  bot.aiCooldown = Math.max(0, bot.aiCooldown - dt);
  if (bot.dead || bot.aiCooldown > 0) return false;
  if (!bot.grounded && Math.abs(bot.vx) >= 190) return false;

  const params = BOT_DIFF_PARAMS[difficulty];
  const pastSafePhase = roundElapsed >= params.safeSeconds;

  const lookSteps = pastSafePhase ? 10 : 34;
  const staySafe = simulateBotPath(bot, rects, cameraY, scrollSpeed, false, lookSteps);

  if (!staySafe) {
    if (pastSafePhase && Math.random() < params.slipChance) {
      bot.aiCooldown = 0.68;
      return false;
    }

    const flipSafe = simulateBotPath(bot, rects, cameraY, scrollSpeed, true, 54);
    if (flipSafe) {
      bot.grav = bot.grav === 1 ? -1 : 1;
      bot.grounded = false;
      bot.vx = bot.grav * 230;
      bot.aiCooldown = pastSafePhase ? 0.14 : 0.04;
      bot.squash = 1.2;
      return true;
    }
  }
  return false;
}
