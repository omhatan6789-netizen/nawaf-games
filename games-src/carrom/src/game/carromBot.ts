import {
  CarromDisc,
  DifficultyLevel,
  MAX_SHOT_SPEED,
  POCKETS,
  PlayerCount,
  QueenStatus,
  STRIKER_RADIUS,
  findNearestClearSlider,
  isStrikerSpotClear,
  sliderToStrikerPos,
} from './carromPhysics';

export interface BotShotPlan {
  sliderNorm: number;
  vx: number;
  vy: number;
}

function segmentClear(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  coins: CarromDisc[],
  ignoreIds: Set<string>,
  clearanceRadius: number
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1) return true;

  for (const c of coins) {
    if (c.pocketed || ignoreIds.has(c.id)) continue;
    const t = Math.max(
      0,
      Math.min(1, ((c.x - x1) * dx + (c.y - y1) * dy) / lenSq)
    );
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const distSq = (c.x - px) ** 2 + (c.y - py) ** 2;
    const minD = clearanceRadius + c.radius - 1.5;
    if (distSq < minD * minD) return false;
  }
  return true;
}

export function planNawafBotShot(params: {
  coins: CarromDisc[];
  slotIndex: number;
  playerCount: PlayerCount;
  difficulty: DifficultyLevel;
  queenStatus: QueenStatus;
  queenHolderSlot: number | null;
}): BotShotPlan {
  const {
    coins,
    slotIndex,
    playerCount,
    difficulty,
    queenStatus,
    queenHolderSlot,
  } = params;

  const myPieces = coins.filter((c) => !c.pocketed && c.kind === 'black');
  const queen = coins.find((c) => !c.pocketed && c.kind === 'queen');

  // Determine priority targets
  const mustCoverQueen =
    queenStatus === 'pending_cover' && queenHolderSlot === slotIndex;
  const shouldHuntQueen =
    Boolean(queen) &&
    !mustCoverQueen &&
    (myPieces.length <= 3 || myPieces.length === 0);

  const candidateTargets: CarromDisc[] = [];
  if (shouldHuntQueen && queen) {
    candidateTargets.push(queen);
  }
  candidateTargets.push(...myPieces);
  if (queen && !shouldHuntQueen && !mustCoverQueen && myPieces.length <= 6) {
    candidateTargets.push(queen);
  }
  if (candidateTargets.length === 0) {
    // Fallback to any remaining coin
    candidateTargets.push(...coins.filter((c) => !c.pocketed));
  }

  let bestScore = -Infinity;
  let bestPlan: BotShotPlan | null = null;

  // Test 17 slider positions across Bot's baseline
  const sliderCandidates: number[] = [];
  for (let i = -8; i <= 8; i++) {
    sliderCandidates.push(i / 8);
  }

  for (const target of candidateTargets) {
    for (const pocket of POCKETS) {
      const tpDx = pocket.x - target.x;
      const tpDy = pocket.y - target.y;
      const tpDist = Math.hypot(tpDx, tpDy);
      if (tpDist < 1) continue;
      const tpUx = tpDx / tpDist;
      const tpUy = tpDy / tpDist;

      // Ghost striker contact center
      const contactDist = STRIKER_RADIUS + target.radius;
      const gx = target.x - tpUx * contactDist;
      const gy = target.y - tpUy * contactDist;

      // Ensure ghost position is inside playing board
      if (gx < 74 || gx > 726 || gy < 74 || gy > 726) continue;

      const ignoreTarget = new Set([target.id]);
      const targetPathClear = segmentClear(
        target.x,
        target.y,
        pocket.x,
        pocket.y,
        coins,
        ignoreTarget,
        target.radius
      );

      for (const sNorm of sliderCandidates) {
        const sPos = sliderToStrikerPos(sNorm, slotIndex, playerCount);
        if (!isStrikerSpotClear(sPos.x, sPos.y, coins)) continue;

        const sgDx = gx - sPos.x;
        const sgDy = gy - sPos.y;
        const sgDist = Math.hypot(sgDx, sgDy);
        if (sgDist < 8) continue;
        const sgUx = sgDx / sgDist;
        const sgUy = sgDy / sgDist;

        // Cut angle cosine (1 = straight shot, <= 0 = impossible back-cut)
        const cosCut = sgUx * tpUx + sgUy * tpUy;
        if (cosCut < 0.28) continue;

        const strikerPathClear = segmentClear(
          sPos.x,
          sPos.y,
          gx,
          gy,
          coins,
          ignoreTarget,
          STRIKER_RADIUS
        );

        let score = cosCut * 120 - tpDist * 0.08 - sgDist * 0.05;
        if (targetPathClear) score += 90;
        if (strikerPathClear) score += 85;
        if (target.kind === 'queen') {
          score += myPieces.length <= 2 ? 75 : 22;
        }
        if (mustCoverQueen && target.kind === 'black') {
          score += 60;
        }

        // Slight preference for forward/downward shots from Bot's top baseline
        if (sgUy > 0.1) score += 12;

        if (score > bestScore) {
          bestScore = score;
          const baseSpeed = Math.min(
            MAX_SHOT_SPEED * 0.9,
            Math.max(760, 650 + (tpDist + sgDist) * 0.72 + (1 - cosCut) * 260)
          );
          bestPlan = {
            sliderNorm: sNorm,
            vx: sgUx * baseSpeed,
            vy: sgUy * baseSpeed,
          };
        }
      }
    }
  }

  if (!bestPlan) {
    // Fallback break / cluster nudge shot
    const sNorm = findNearestClearSlider(0, slotIndex, playerCount, coins);
    const sPos = sliderToStrikerPos(sNorm, slotIndex, playerCount);
    const fallbackTarget =
      candidateTargets[0] ?? coins.find((c) => !c.pocketed);
    const tx = fallbackTarget ? fallbackTarget.x : 400;
    const ty = fallbackTarget ? fallbackTarget.y : 400;
    const dx = tx - sPos.x;
    const dy = ty - sPos.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = 1120;
    bestPlan = {
      sliderNorm: sNorm,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
    };
  }

  // Apply difficulty-calibrated aim jitter
  const jitterRad =
    difficulty === 'سهل'
      ? (Math.random() - 0.5) * 0.14
      : difficulty === 'متوسط'
        ? (Math.random() - 0.5) * 0.055
        : (Math.random() - 0.5) * 0.015;

  const speedJitter =
    difficulty === 'سهل'
      ? 0.86 + Math.random() * 0.22
      : difficulty === 'متوسط'
        ? 0.94 + Math.random() * 0.12
        : 0.98 + Math.random() * 0.05;

  const cos = Math.cos(jitterRad);
  const sin = Math.sin(jitterRad);
  const rx = (bestPlan.vx * cos - bestPlan.vy * sin) * speedJitter;
  const ry = (bestPlan.vx * sin + bestPlan.vy * cos) * speedJitter;

  return {
    sliderNorm: bestPlan.sliderNorm,
    vx: rx,
    vy: ry,
  };
}
