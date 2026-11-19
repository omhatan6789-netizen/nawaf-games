export type PieceKind = 'white' | 'black' | 'queen';
export type GameMode = 'bot' | 'local' | 'online';
export type PlayerCount = 2 | 4;
export type FourPlayerMode = 'teams' | 'solo';
export type DifficultyLevel = 'سهل' | 'متوسط' | 'صعب';
export type QueenStatus = 'on_board' | 'pending_cover' | 'covered';

export const BOARD_SIZE = 800;
export const CENTER = 400;
export const INNER_MIN = 46;
export const INNER_MAX = 754;

export const COIN_RADIUS = 20.5;
export const QUEEN_RADIUS = 21;
export const STRIKER_RADIUS = 27.5;

export const POCKET_VISUAL_RADIUS = 41;
export const POCKET_CAPTURE_RADIUS = 36;
export const POCKETS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 87, y: 87 },
  { x: 713, y: 87 },
  { x: 87, y: 713 },
  { x: 713, y: 713 },
];

export const BASELINE_OFFSET = 132;
export const BASELINE_SPAN_MIN = 198;
export const BASELINE_SPAN_MAX = 602;
export const MAX_PULL_DISTANCE = 155;
export const MIN_PULL_DISTANCE = 14;
export const MAX_SHOT_SPEED = 1720; // logical px / sec

export interface CarromDisc {
  id: string;
  kind: PieceKind | 'striker';
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  pocketed: boolean;
  pocketAnim?: number; // 0 -> 1 drop animation when pocketed
  pocketTarget?: { x: number; y: number };
}

export interface CarromPlayerState {
  id: string;
  name: string;
  slotIndex: number;
  side: 'white' | 'black' | 'solo';
  teamIndex: number; // 0 or 1 in 2v2, or slotIndex in solo
  score: number;
  pocketedCount: number;
  hasQueen: boolean;
}

export interface PhysicsEvent {
  type: 'clack' | 'wall' | 'pocket';
  intensity: number;
  x: number;
  y: number;
  kind?: PieceKind | 'striker';
}

export interface TurnResolution {
  nextTurn: number;
  keepTurn: boolean;
  foul: boolean;
  returnedPieces: PieceKind[];
  queenJustCovered: boolean;
  queenReturned: boolean;
  toastText: string | null;
  matchFinished: boolean;
  winnerSide: 'white' | 'black' | 'draw' | null;
  winnerSlot: number | null;
  winnerTeam: number | null;
}

export interface BaselinePose {
  axis: 'x' | 'y';
  fixedCoord: number;
  minCoord: number;
  maxCoord: number;
  facingDir: number; // +1 or -1 towards center
}

export function getBaselineForSlot(slotIndex: number, playerCount: PlayerCount): BaselinePose {
  if (playerCount === 2) {
    if (slotIndex % 2 === 0) {
      return {
        axis: 'x',
        fixedCoord: BOARD_SIZE - BASELINE_OFFSET, // 674 (Bottom)
        minCoord: BASELINE_SPAN_MIN,
        maxCoord: BASELINE_SPAN_MAX,
        facingDir: -1,
      };
    }
    return {
      axis: 'x',
      fixedCoord: BASELINE_OFFSET, // 126 (Top)
      minCoord: BASELINE_SPAN_MIN,
      maxCoord: BASELINE_SPAN_MAX,
      facingDir: 1,
    };
  }

  // 4-player seating: 0 Bottom, 1 Left, 2 Top, 3 Right
  const seat = ((slotIndex % 4) + 4) % 4;
  if (seat === 0) {
    return {
      axis: 'x',
      fixedCoord: BOARD_SIZE - BASELINE_OFFSET,
      minCoord: BASELINE_SPAN_MIN,
      maxCoord: BASELINE_SPAN_MAX,
      facingDir: -1,
    };
  }
  if (seat === 1) {
    return {
      axis: 'y',
      fixedCoord: BASELINE_OFFSET,
      minCoord: BASELINE_SPAN_MIN,
      maxCoord: BASELINE_SPAN_MAX,
      facingDir: 1,
    };
  }
  if (seat === 2) {
    return {
      axis: 'x',
      fixedCoord: BASELINE_OFFSET,
      minCoord: BASELINE_SPAN_MIN,
      maxCoord: BASELINE_SPAN_MAX,
      facingDir: 1,
    };
  }
  return {
    axis: 'y',
    fixedCoord: BOARD_SIZE - BASELINE_OFFSET,
    minCoord: BASELINE_SPAN_MIN,
    maxCoord: BASELINE_SPAN_MAX,
    facingDir: -1,
  };
}

export function sliderToStrikerPos(
  sliderNorm: number, // -1 .. +1
  slotIndex: number,
  playerCount: PlayerCount
): { x: number; y: number } {
  const clamped = Math.max(-1, Math.min(1, sliderNorm));
  const pose = getBaselineForSlot(slotIndex, playerCount);
  const t = (clamped + 1) * 0.5;
  const variable = pose.minCoord + t * (pose.maxCoord - pose.minCoord);
  if (pose.axis === 'x') {
    return { x: variable, y: pose.fixedCoord };
  }
  return { x: pose.fixedCoord, y: variable };
}

export function strikerPosToSlider(
  x: number,
  y: number,
  slotIndex: number,
  playerCount: PlayerCount
): number {
  const pose = getBaselineForSlot(slotIndex, playerCount);
  const val = pose.axis === 'x' ? x : y;
  const t = (val - pose.minCoord) / (pose.maxCoord - pose.minCoord);
  return Math.max(-1, Math.min(1, t * 2 - 1));
}

export function isStrikerSpotClear(
  x: number,
  y: number,
  coins: CarromDisc[]
): boolean {
  for (const c of coins) {
    if (c.pocketed) continue;
    const dx = c.x - x;
    const dy = c.y - y;
    const minDist = c.radius + STRIKER_RADIUS + 2;
    if (dx * dx + dy * dy < minDist * minDist) {
      return false;
    }
  }
  return true;
}

export function findNearestClearSlider(
  preferredNorm: number,
  slotIndex: number,
  playerCount: PlayerCount,
  coins: CarromDisc[]
): number {
  const test = sliderToStrikerPos(preferredNorm, slotIndex, playerCount);
  if (isStrikerSpotClear(test.x, test.y, coins)) return preferredNorm;

  for (let delta = 0.04; delta <= 2.02; delta += 0.04) {
    for (const sign of [1, -1]) {
      const cand = Math.max(-1, Math.min(1, preferredNorm + sign * delta));
      const pos = sliderToStrikerPos(cand, slotIndex, playerCount);
      if (isStrikerSpotClear(pos.x, pos.y, coins)) {
        return cand;
      }
    }
  }
  return preferredNorm;
}

export function createInitialCoins(): CarromDisc[] {
  const coins: CarromDisc[] = [];

  // Center Red Queen
  coins.push({
    id: 'queen',
    kind: 'queen',
    x: CENTER,
    y: CENTER,
    vx: 0,
    vy: 0,
    radius: QUEEN_RADIUS,
    mass: 1.05,
    pocketed: false,
  });

  // Classic hexagonal Carrom flower rack (6 inner + 12 outer = 18 pieces: 9 white, 9 black)
  const d = COIN_RADIUS * 2 + 1.1; // ~32.1
  let whiteIdx = 0;
  let blackIdx = 0;

  const pushCoin = (kind: 'white' | 'black', x: number, y: number) => {
    const idx = kind === 'white' ? ++whiteIdx : ++blackIdx;
    coins.push({
      id: `${kind}_${idx}`,
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: COIN_RADIUS,
      mass: 1.0,
      pocketed: false,
    });
  };

  // Ring 1 (6 pieces: alternating white/black)
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    const kind: 'white' | 'black' = i % 2 === 0 ? 'white' : 'black';
    pushCoin(kind, CENTER + Math.cos(angle) * d, CENTER + Math.sin(angle) * d);
  }

  // Ring 2 (12 pieces: 6 corners at 2*d -> white forms classic Y-spokes, 6 edge midpoints at sqrt(3)*d -> black)
  // Wait: classic Y-rack has 3 white corner spokes (every 120deg) and 3 black corner spokes,
  // or alternating corners & edges so total is 9 white + 9 black:
  // Ring 1 has 3 white + 3 black.
  // Ring 2 corners (6 pieces): 3 white (aligned with inner white) + 3 black (aligned with inner black)?
  // Wait: if corners are 3W + 3B, and edge midpoints are 3W + 3B, total = 9W + 9B!
  for (let i = 0; i < 6; i++) {
    const cornerAngle = -Math.PI / 2 + (i * Math.PI) / 3;
    const cornerKind: 'white' | 'black' = i % 2 === 0 ? 'white' : 'black';
    pushCoin(
      cornerKind,
      CENTER + Math.cos(cornerAngle) * (d * 2),
      CENTER + Math.sin(cornerAngle) * (d * 2)
    );

    const edgeAngle = cornerAngle + Math.PI / 6;
    // Alternate edge midpoints so there are 3 white and 3 black -> exact 9W + 9B
    const edgeKind: 'white' | 'black' = i % 2 === 0 ? 'black' : 'white';
    pushCoin(
      edgeKind,
      CENTER + Math.cos(edgeAngle) * (d * Math.sqrt(3)),
      CENTER + Math.sin(edgeAngle) * (d * Math.sqrt(3))
    );
  }

  return coins;
}

export function createStriker(
  slotIndex: number,
  playerCount: PlayerCount,
  sliderNorm = 0
): CarromDisc {
  const pos = sliderToStrikerPos(sliderNorm, slotIndex, playerCount);
  return {
    id: 'striker',
    kind: 'striker',
    x: pos.x,
    y: pos.y,
    vx: 0,
    vy: 0,
    radius: STRIKER_RADIUS,
    mass: 2.35,
    pocketed: false,
  };
}

export function findFreeCenterSpot(
  coins: CarromDisc[],
  radius: number
): { x: number; y: number } {
  const isClear = (cx: number, cy: number) => {
    for (const c of coins) {
      if (c.pocketed) continue;
      const dx = c.x - cx;
      const dy = c.y - cy;
      const minDist = c.radius + radius + 1.5;
      if (dx * dx + dy * dy < minDist * minDist) return false;
    }
    return true;
  };

  if (isClear(CENTER, CENTER)) return { x: CENTER, y: CENTER };

  for (let r = 8; r <= 180; r += 8) {
    const steps = Math.max(8, Math.floor((2 * Math.PI * r) / 14));
    for (let i = 0; i < steps; i++) {
      const a = (i * 2 * Math.PI) / steps;
      const cx = CENTER + Math.cos(a) * r;
      const cy = CENTER + Math.sin(a) * r;
      if (isClear(cx, cy)) return { x: cx, y: cy };
    }
  }
  return { x: CENTER, y: CENTER };
}

export function returnPieceToCenter(
  coins: CarromDisc[],
  kind: PieceKind
): CarromDisc | null {
  const candidate = coins.find((c) => c.kind === kind && c.pocketed);
  if (!candidate) return null;
  const pos = findFreeCenterSpot(coins, candidate.radius);
  candidate.pocketed = false;
  candidate.pocketAnim = undefined;
  candidate.pocketTarget = undefined;
  candidate.x = pos.x;
  candidate.y = pos.y;
  candidate.vx = 0;
  candidate.vy = 0;
  return candidate;
}

export function stepCarromPhysics(
  coins: CarromDisc[],
  striker: CarromDisc | null,
  dt: number
): { events: PhysicsEvent[]; anyMoving: boolean } {
  const events: PhysicsEvent[] = [];
  const active: CarromDisc[] = [];
  for (const c of coins) {
    if (!c.pocketed) active.push(c);
  }
  if (striker && !striker.pocketed) {
    active.push(striker);
  }

  const substeps = 8;
  const subDt = dt / substeps;
  // Carrom powder glide: smooth exponential damping + gentle dry friction at very low speed
  const expDrag = Math.pow(0.24, subDt); // retains ~24% velocity per second
  const coulombDecel = 38 * subDt;
  const coinRestitution = 0.89;
  const wallRestitution = 0.82;

  for (let s = 0; s < substeps; s++) {
    // 1. Integrate & apply friction
    for (const d of active) {
      if (d.pocketed) continue;
      d.x += d.vx * subDt;
      d.y += d.vy * subDt;

      d.vx *= expDrag;
      d.vy *= expDrag;

      const speed = Math.hypot(d.vx, d.vy);
      if (speed > 0) {
        if (speed <= coulombDecel + 2.5) {
          d.vx = 0;
          d.vy = 0;
        } else {
          const nextSpeed = speed - coulombDecel;
          const ratio = nextSpeed / speed;
          d.vx *= ratio;
          d.vy *= ratio;
        }
      }
    }

    // 2. Pocket capture check before wall bounce so corner-hugging shots sink naturally
    for (const d of active) {
      if (d.pocketed) continue;
      for (const p of POCKETS) {
        const dx = d.x - p.x;
        const dy = d.y - p.y;
        if (dx * dx + dy * dy <= POCKET_CAPTURE_RADIUS * POCKET_CAPTURE_RADIUS) {
          d.pocketed = true;
          d.pocketAnim = 0;
          d.pocketTarget = { x: p.x, y: p.y };
          const speed = Math.hypot(d.vx, d.vy);
          d.vx = 0;
          d.vy = 0;
          events.push({
            type: 'pocket',
            intensity: Math.min(1, Math.max(0.25, speed / 700)),
            x: p.x,
            y: p.y,
            kind: d.kind,
          });
          break;
        }
      }
    }

    // 3. Cushion wall collisions
    for (const d of active) {
      if (d.pocketed) continue;
      const minBound = INNER_MIN + d.radius;
      const maxBound = INNER_MAX - d.radius;
      let hitWall = false;
      let wallImpact = 0;

      if (d.x < minBound) {
        d.x = minBound;
        wallImpact = Math.max(wallImpact, Math.abs(d.vx));
        d.vx = Math.abs(d.vx) * wallRestitution;
        hitWall = true;
      } else if (d.x > maxBound) {
        d.x = maxBound;
        wallImpact = Math.max(wallImpact, Math.abs(d.vx));
        d.vx = -Math.abs(d.vx) * wallRestitution;
        hitWall = true;
      }

      if (d.y < minBound) {
        d.y = minBound;
        wallImpact = Math.max(wallImpact, Math.abs(d.vy));
        d.vy = Math.abs(d.vy) * wallRestitution;
        hitWall = true;
      } else if (d.y > maxBound) {
        d.y = maxBound;
        wallImpact = Math.max(wallImpact, Math.abs(d.vy));
        d.vy = -Math.abs(d.vy) * wallRestitution;
        hitWall = true;
      }

      if (hitWall && wallImpact > 32 && s === 0) {
        events.push({
          type: 'wall',
          intensity: Math.min(1, wallImpact / 950),
          x: d.x,
          y: d.y,
        });
      }
    }

    // 4. Disc-to-disc elastic collisions
    const n = active.length;
    for (let i = 0; i < n; i++) {
      const a = active[i];
      if (a.pocketed) continue;
      for (let j = i + 1; j < n; j++) {
        const b = active[j];
        if (b.pocketed) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.radius + b.radius;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDist * minDist) {
          let dist = Math.sqrt(distSq);
          let nx = 1;
          let ny = 0;
          if (dist > 0.0001) {
            nx = dx / dist;
            ny = dy / dist;
          } else {
            dist = 0.0001;
          }

          // Positional correction to prevent sinking/sticking
          const overlap = minDist - dist;
          const invMassA = 1 / a.mass;
          const invMassB = 1 / b.mass;
          const invMassSum = invMassA + invMassB;
          const corr = (overlap / invMassSum) * 1.005;
          a.x -= nx * corr * invMassA;
          a.y -= ny * corr * invMassA;
          b.x += nx * corr * invMassB;
          b.y += ny * corr * invMassB;

          // Relative velocity along normal
          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const velAlongNormal = rvx * nx + rvy * ny;

          if (velAlongNormal < 0) {
            const jImpulse =
              (-(1 + coinRestitution) * velAlongNormal) / invMassSum;
            const ix = jImpulse * nx;
            const iy = jImpulse * ny;

            a.vx -= ix * invMassA;
            a.vy -= iy * invMassA;
            b.vx += ix * invMassB;
            b.vy += iy * invMassB;

            const impactSpeed = -velAlongNormal;
            if (impactSpeed > 26) {
              events.push({
                type: 'clack',
                intensity: Math.min(1, impactSpeed / 1000),
                x: (a.x + b.x) * 0.5,
                y: (a.y + b.y) * 0.5,
              });
            }
          }
        }
      }
    }
  }

  let anyMoving = false;
  for (const d of active) {
    if (d.pocketed) continue;
    if (Math.hypot(d.vx, d.vy) > 4) {
      anyMoving = true;
      break;
    } else {
      d.vx = 0;
      d.vy = 0;
    }
  }

  return { events, anyMoving };
}

export interface AimRayResult {
  endX: number;
  endY: number;
  hitKind: 'coin' | 'wall' | 'pocket' | null;
  hitX?: number;
  hitY?: number;
  targetNormalX?: number;
  targetNormalY?: number;
}

export function computeAimPreview(
  sx: number,
  sy: number,
  dirX: number,
  dirY: number,
  maxLen: number,
  coins: CarromDisc[]
): AimRayResult {
  let closestT = maxLen;
  let hitKind: AimRayResult['hitKind'] = null;
  let hitCoin: CarromDisc | null = null;

  // Check pocket distance along ray
  for (const p of POCKETS) {
    const ocx = p.x - sx;
    const ocy = p.y - sy;
    const proj = ocx * dirX + ocy * dirY;
    if (proj > 0 && proj < closestT) {
      const perpSq = ocx * ocx + ocy * ocy - proj * proj;
      if (perpSq <= POCKET_CAPTURE_RADIUS * POCKET_CAPTURE_RADIUS) {
        closestT = proj;
        hitKind = 'pocket';
      }
    }
  }

  // Check cushion walls
  const minB = INNER_MIN + STRIKER_RADIUS;
  const maxB = INNER_MAX - STRIKER_RADIUS;
  if (dirX < -0.0001) {
    const t = (minB - sx) / dirX;
    if (t > 0 && t < closestT) {
      closestT = t;
      hitKind = 'wall';
    }
  } else if (dirX > 0.0001) {
    const t = (maxB - sx) / dirX;
    if (t > 0 && t < closestT) {
      closestT = t;
      hitKind = 'wall';
    }
  }
  if (dirY < -0.0001) {
    const t = (minB - sy) / dirY;
    if (t > 0 && t < closestT) {
      closestT = t;
      hitKind = 'wall';
    }
  } else if (dirY > 0.0001) {
    const t = (maxB - sy) / dirY;
    if (t > 0 && t < closestT) {
      closestT = t;
      hitKind = 'wall';
    }
  }

  // Check coins
  for (const c of coins) {
    if (c.pocketed) continue;
    const sumR = STRIKER_RADIUS + c.radius;
    const ocx = c.x - sx;
    const ocy = c.y - sy;
    const b = ocx * dirX + ocy * dirY;
    if (b <= 0) continue;
    const perpSq = ocx * ocx + ocy * ocy - b * b;
    if (perpSq >= sumR * sumR) continue;
    const thc = Math.sqrt(sumR * sumR - perpSq);
    const t = b - thc;
    if (t > 0 && t < closestT) {
      closestT = t;
      hitKind = 'coin';
      hitCoin = c;
    }
  }

  const endX = sx + dirX * closestT;
  const endY = sy + dirY * closestT;

  if (hitKind === 'coin' && hitCoin) {
    const ndx = hitCoin.x - endX;
    const ndy = hitCoin.y - endY;
    const nlen = Math.hypot(ndx, ndy) || 1;
    return {
      endX,
      endY,
      hitKind: 'coin',
      hitX: hitCoin.x,
      hitY: hitCoin.y,
      targetNormalX: ndx / nlen,
      targetNormalY: ndy / nlen,
    };
  }

  return { endX, endY, hitKind };
}

export function resolveCarromTurn(params: {
  turn: number;
  players: CarromPlayerState[];
  playerCount: PlayerCount;
  fourMode: FourPlayerMode;
  coins: CarromDisc[];
  pocketedThisTurn: PieceKind[];
  strikerPocketed: boolean;
  queenStatus: QueenStatus;
  queenHolderSlot: number | null;
}): {
  resolution: TurnResolution;
  nextQueenStatus: QueenStatus;
  nextQueenHolderSlot: number | null;
} {
  const {
    turn,
    players,
    playerCount,
    fourMode,
    coins,
    pocketedThisTurn,
    strikerPocketed,
    queenStatus,
    queenHolderSlot,
  } = params;

  const isSolo4 = playerCount === 4 && fourMode === 'solo';
  const shooter = players[turn];
  const shooterSide = shooter.side; // 'white' | 'black' | 'solo'

  const whitePocketed = pocketedThisTurn.filter((k) => k === 'white').length;
  const blackPocketed = pocketedThisTurn.filter((k) => k === 'black').length;
  const queenPocketedNow = pocketedThisTurn.includes('queen');
  const ownPocketedCount = isSolo4
    ? whitePocketed + blackPocketed
    : shooterSide === 'white'
      ? whitePocketed
      : blackPocketed;

  let nextQueenStatus: QueenStatus = queenStatus;
  let nextQueenHolderSlot: number | null = queenHolderSlot;
  const returnedPieces: PieceKind[] = [];
  let queenJustCovered = false;
  let queenReturned = false;
  let foul = false;
  let keepTurn = false;
  let toastText: string | null = null;

  const returnQueen = () => {
    const q = returnPieceToCenter(coins, 'queen');
    if (q) {
      returnedPieces.push('queen');
      queenReturned = true;
    }
    nextQueenStatus = 'on_board';
    nextQueenHolderSlot = null;
  };

  // Update individual scores / pocketed counts first (for non-queen coins)
  if (isSolo4) {
    shooter.pocketedCount += whitePocketed + blackPocketed;
    shooter.score += whitePocketed + blackPocketed;
  } else {
    // Award White points to white side, Black points to black side
    const whitePlayer = players.find((p) => p.side === 'white');
    const blackPlayer = players.find((p) => p.side === 'black');
    if (whitePlayer && whitePocketed > 0) {
      if (playerCount === 4) {
        shooter.side === 'white'
          ? (shooter.score += whitePocketed)
          : (whitePlayer.score += whitePocketed);
      } else {
        whitePlayer.score += whitePocketed;
      }
    }
    if (blackPlayer && blackPocketed > 0) {
      if (playerCount === 4) {
        shooter.side === 'black'
          ? (shooter.score += blackPocketed)
          : (blackPlayer.score += blackPocketed);
      } else {
        blackPlayer.score += blackPocketed;
      }
    }
  }

  // Handle Striker Foul
  if (strikerPocketed) {
    foul = true;
    keepTurn = false;

    if (queenPocketedNow || (queenStatus === 'pending_cover' && queenHolderSlot === turn)) {
      returnQueen();
    }

    // Return 1 of shooter's pocketed pieces if any
    const kindToReturn: PieceKind | null = isSolo4
      ? ((coins.find((c) => c.pocketed && (c.kind === 'white' || c.kind === 'black'))?.kind as
          | PieceKind
          | undefined) ?? null)
      : shooterSide === 'white'
        ? 'white'
        : 'black';

    if (kindToReturn) {
      const ret = returnPieceToCenter(coins, kindToReturn);
      if (ret) {
        returnedPieces.push(kindToReturn);
        if (shooter.score > 0) shooter.score -= 1;
      }
    }

    toastText = '⚠️ فاول! سقط قرص التسديد وعاد قرص إلى المركز';
  } else {
    // No striker foul
    if (queenStatus === 'pending_cover' && queenHolderSlot === turn) {
      // Shooter was trying to cover the Queen on this shot
      if (ownPocketedCount > 0) {
        nextQueenStatus = 'covered';
        queenJustCovered = true;
        shooter.hasQueen = true;
        shooter.score += 3;
        keepTurn = true;
        toastText = '👑 تمت تغطية الملكة بنجاح! (+3 نقاط)';
      } else {
        returnQueen();
        keepTurn = false;
        toastText = 'لم تُغطَّ الملكة — عادت الملكة إلى المركز';
      }
    } else if (queenPocketedNow) {
      if (ownPocketedCount > 0) {
        // Covered on the exact same shot!
        nextQueenStatus = 'covered';
        nextQueenHolderSlot = turn;
        queenJustCovered = true;
        shooter.hasQueen = true;
        shooter.score += 3;
        keepTurn = true;
        toastText = '👑 أخذت الملكة وغطّيتها في ضربة واحدة! (+3)';
      } else {
        nextQueenStatus = 'pending_cover';
        nextQueenHolderSlot = turn;
        keepTurn = true;
        toastText = '👑 دخلت الملكة! أدخل قرصك الآن لتغطيتها';
      }
    } else if (ownPocketedCount > 0) {
      keepTurn = true;
      if (!isSolo4 && ownPocketedCount >= 2) {
        toastText = `🔥 ضربة موفقة! (${ownPocketedCount} أقراص)`;
      }
    } else {
      keepTurn = false;
      if (!isSolo4 && (whitePocketed > 0 || blackPocketed > 0)) {
        toastText = 'دخل قرص الخصم! انتقل الدور';
      }
    }
  }

  // Authentic Queen-before-last-piece rule in White vs Black mode:
  // If a side cleared all 9 of its pieces while the Queen is STILL on the board,
  // return 1 piece of that side so the Queen must be pocketed & covered first!
  const remainingWhite = coins.filter((c) => !c.pocketed && c.kind === 'white').length;
  const remainingBlack = coins.filter((c) => !c.pocketed && c.kind === 'black').length;
  const queenOnBoard = coins.some((c) => !c.pocketed && c.kind === 'queen');

  if (!isSolo4 && queenOnBoard) {
    if (remainingWhite === 0) {
      returnPieceToCenter(coins, 'white');
      returnedPieces.push('white');
      toastText = '👑 يجب أخذ الملكة الحمراء وتغطيتها قبل آخر قرص!';
      keepTurn = false;
    }
    if (remainingBlack === 0) {
      returnPieceToCenter(coins, 'black');
      returnedPieces.push('black');
      toastText = '👑 يجب أخذ الملكة الحمراء وتغطيتها قبل آخر قرص!';
      keepTurn = false;
    }
  }

  // Re-evaluate remaining after potential Queen-first guard
  const remWhiteAfter = coins.filter((c) => !c.pocketed && c.kind === 'white').length;
  const remBlackAfter = coins.filter((c) => !c.pocketed && c.kind === 'black').length;

  let matchFinished = false;
  let winnerSide: TurnResolution['winnerSide'] = null;
  let winnerSlot: number | null = null;
  let winnerTeam: number | null = null;

  if (isSolo4) {
    if (remWhiteAfter === 0 && remBlackAfter === 0 && nextQueenStatus !== 'pending_cover') {
      matchFinished = true;
      const sorted = [...players].sort((a, b) => b.score - a.score);
      if (sorted[0].score === sorted[1].score) {
        winnerSide = 'draw';
      } else {
        winnerSlot = sorted[0].slotIndex;
      }
    }
  } else {
    if (nextQueenStatus !== 'pending_cover') {
      if (remWhiteAfter === 0 && remBlackAfter === 0) {
        matchFinished = true;
        winnerSide = shooterSide === 'white' ? 'white' : 'black';
        winnerTeam = winnerSide === 'white' ? 0 : 1;
        winnerSlot = players.find((p) => p.side === winnerSide)?.slotIndex ?? 0;
      } else if (remWhiteAfter === 0) {
        matchFinished = true;
        winnerSide = 'white';
        winnerTeam = 0;
        winnerSlot = players.find((p) => p.side === 'white')?.slotIndex ?? 0;
      } else if (remBlackAfter === 0) {
        matchFinished = true;
        winnerSide = 'black';
        winnerTeam = 1;
        winnerSlot = players.find((p) => p.side === 'black')?.slotIndex ?? 1;
      }
    }
  }

  // Sync live remaining/pocketed counts on players
  if (!isSolo4) {
    const whiteTaken = 9 - remWhiteAfter;
    const blackTaken = 9 - remBlackAfter;
    for (const p of players) {
      p.pocketedCount = p.side === 'white' ? whiteTaken : blackTaken;
    }
  }

  const nextTurn = matchFinished
    ? turn
    : keepTurn
      ? turn
      : (turn + 1) % players.length;

  return {
    resolution: {
      nextTurn,
      keepTurn,
      foul,
      returnedPieces,
      queenJustCovered,
      queenReturned,
      toastText,
      matchFinished,
      winnerSide,
      winnerSlot,
      winnerTeam,
    },
    nextQueenStatus,
    nextQueenHolderSlot,
  };
}
