import type { Difficulty, HitResult } from './dartsTypes';

/** Clockwise dartboard sector numbers starting from 12 o'clock (top) */
export const CLOCKWISE_SECTORS = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
] as const;

/** Normalized ring radii relative to outer Double edge (R = 1.0) */
export const BOARD_RADII = {
  INNER_BULL: 0.068,
  OUTER_BULL: 0.132,
  TRIPLE_INNER: 0.48,
  TRIPLE_OUTER: 0.59,
  DOUBLE_INNER: 0.88,
  DOUBLE_OUTER: 1.0,
  NUMBER_RING: 1.23,
} as const;

/** Aim bar sweeps smoothly across [-AIM_SPAN, +AIM_SPAN] in normalized board units */
export const AIM_SPAN = 1.08;

/**
 * Evaluates a throw at normalized board coordinates (xNorm, yNorm),
 * where (0, 0) is exact center and R = 1.0 is outer double wire.
 */
export function evaluateDartHit(xNorm: number, yNorm: number): HitResult {
  const r = Math.hypot(xNorm, yNorm);

  if (r <= BOARD_RADII.INNER_BULL) {
    return {
      score: 50,
      sector: 25,
      multiplier: 2,
      ring: 'inner_bull',
      labelAr: 'في المنتصف! 50',
      shortTag: '50',
    };
  }

  if (r <= BOARD_RADII.OUTER_BULL) {
    return {
      score: 25,
      sector: 25,
      multiplier: 1,
      ring: 'outer_bull',
      labelAr: 'منتصف خارجي 25',
      shortTag: '25',
    };
  }

  if (r > BOARD_RADII.DOUBLE_OUTER) {
    return {
      score: 0,
      sector: 0,
      multiplier: 0,
      ring: 'miss',
      labelAr: 'خارج اللوحة!',
      shortTag: 'خارج',
    };
  }

  // Clockwise angle from 12 o'clock (-y axis)
  const angleRad = Math.atan2(xNorm, -yNorm);
  const deg = ((angleRad * 180) / Math.PI + 360) % 360;
  const sectorIdx = Math.floor(((deg + 9) % 360) / 18);
  const sector = CLOCKWISE_SECTORS[sectorIdx];

  if (r >= BOARD_RADII.TRIPLE_INNER && r <= BOARD_RADII.TRIPLE_OUTER) {
    return {
      score: sector * 3,
      sector,
      multiplier: 3,
      ring: 'triple',
      labelAr: `تربل ×3 (${sector * 3})`,
      shortTag: `T${sector}`,
    };
  }

  if (r >= BOARD_RADII.DOUBLE_INNER && r <= BOARD_RADII.DOUBLE_OUTER) {
    return {
      score: sector * 2,
      sector,
      multiplier: 2,
      ring: 'double',
      labelAr: `دبل ×2 (${sector * 2})`,
      shortTag: `D${sector}`,
    };
  }

  const ring = r < BOARD_RADII.TRIPLE_INNER ? 'inner_single' : 'outer_single';
  return {
    score: sector,
    sector,
    multiplier: 1,
    ring,
    labelAr: `${sector} نقطة`,
    shortTag: `${sector}`,
  };
}

/** Applies exact-zero checkout & bust rules to a player's current remaining score */
export function applyScoreThrow(
  currentRemaining: number,
  rawHit: HitResult
): { nextRemaining: number; result: HitResult } {
  if (rawHit.score === 0) {
    return {
      nextRemaining: currentRemaining,
      result: { ...rawHit, isBust: false, isCheckout: false },
    };
  }

  const candidate = currentRemaining - rawHit.score;

  if (candidate < 0) {
    return {
      nextRemaining: currentRemaining,
      result: {
        ...rawHit,
        isBust: true,
        isCheckout: false,
        labelAr: `تجاوز الصفر! (${rawHit.score})`,
      },
    };
  }

  if (candidate === 0) {
    return {
      nextRemaining: 0,
      result: {
        ...rawHit,
        isBust: false,
        isCheckout: true,
        labelAr: `إقفال مثالي! (${rawHit.score})`,
      },
    };
  }

  return {
    nextRemaining: candidate,
    result: {
      ...rawHit,
      isBust: false,
      isCheckout: false,
    },
  };
}

function sectorCenterCoords(sector: number, radius: number): { x: number; y: number } {
  const idx = CLOCKWISE_SECTORS.indexOf(sector as (typeof CLOCKWISE_SECTORS)[number]);
  const angleRad = ((idx >= 0 ? idx : 0) * 18 * Math.PI) / 180;
  return {
    x: Math.sin(angleRad) * radius,
    y: -Math.cos(angleRad) * radius,
  };
}

/** Chooses a smart normalized target (x, y) for the Bot based on remaining points & difficulty */
export function pickBotTarget(
  remaining: number,
  difficulty: Difficulty
): { xNorm: number; yNorm: number } {
  let ideal = { x: 0, y: -0.535 }; // Default Triple 20

  if (remaining === 50) {
    ideal = { x: 0, y: 0 };
  } else if (remaining === 25) {
    ideal = { x: 0.08, y: -0.06 };
  } else if (remaining <= 20) {
    ideal = sectorCenterCoords(remaining, 0.73);
  } else if (remaining % 2 === 0 && remaining <= 40) {
    ideal = sectorCenterCoords(remaining / 2, 0.94);
  } else if (remaining % 3 === 0 && remaining <= 60) {
    ideal = sectorCenterCoords(remaining / 3, 0.535);
  } else if (remaining < 60) {
    // Pick highest scoring single/double/triple that stays <= remaining and leaves an easy finish
    const trySector = Math.min(20, remaining - 1);
    ideal = sectorCenterCoords(Math.max(1, trySector), 0.73);
  } else {
    // Aim Triple 20 (60) or Bull (50) for variety on Easy
    ideal =
      difficulty === 'easy' && Math.random() < 0.35
        ? { x: 0, y: 0 }
        : sectorCenterCoords(20, 0.535);
  }

  const sigma =
    difficulty === 'easy' ? 0.21 : difficulty === 'medium' ? 0.105 : 0.042;

  // Box-Muller like soft spread clamped inside aiming span
  const u1 = Math.max(0.001, Math.random());
  const u2 = Math.random();
  const mag = Math.sqrt(-2 * Math.log(u1)) * sigma;
  const theta = 2 * Math.PI * u2;

  const clamp = (v: number) => Math.max(-AIM_SPAN, Math.min(AIM_SPAN, v));
  return {
    xNorm: clamp(ideal.x + Math.cos(theta) * mag),
    yNorm: clamp(ideal.y + Math.sin(theta) * mag),
  };
}

export interface CheckoutTarget {
  ring: 'inner_bull' | 'outer_bull' | 'single' | 'double' | 'triple';
  sector: number;
}

/**
 * Returns all exact 1-dart winning targets if `remaining` can be cleared to 0
 * with a single throw; returns empty array if > 60 or unreachable in 1 dart.
 */
export function getOneDartCheckouts(remaining: number): CheckoutTarget[] {
  if (remaining <= 0 || remaining > 60) return [];
  const targets: CheckoutTarget[] = [];

  if (remaining === 50) {
    targets.push({ ring: 'inner_bull', sector: 25 });
  }
  if (remaining === 25) {
    targets.push({ ring: 'outer_bull', sector: 25 });
  }
  if (remaining >= 1 && remaining <= 20) {
    targets.push({ ring: 'single', sector: remaining });
  }
  if (remaining % 2 === 0 && remaining / 2 >= 1 && remaining / 2 <= 20) {
    targets.push({ ring: 'double', sector: remaining / 2 });
  }
  if (remaining % 3 === 0 && remaining / 3 >= 1 && remaining / 3 <= 20) {
    targets.push({ ring: 'triple', sector: remaining / 3 });
  }

  return targets;
}

