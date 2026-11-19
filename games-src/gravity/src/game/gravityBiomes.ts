export type BiomeId = 'space' | 'forest' | 'desert' | 'citadel';
export type DifficultyLevel = 'سهل' | 'متوسط' | 'صعب';

export type PlayerColorId = 'red' | 'blue' | 'purple' | 'green' | 'yellow';

export interface PlayerColorSpec {
  id: PlayerColorId;
  label: string;
  main: string;
  dark: string;
  emoji: string;
}

/**
 * Strict player color assignment order for 2..5 players:
 * 2 players -> Red, Blue
 * 3 players -> Red, Blue, Purple
 * 4 players -> Red, Blue, Purple, Green
 * 5 players -> Red, Blue, Purple, Green, Yellow
 */
export const PLAYER_PALETTE: PlayerColorSpec[] = [
  { id: 'red', label: 'أحمر', main: '#ef233c', dark: '#b91c1c', emoji: '🔴' },
  { id: 'blue', label: 'أزرق', main: '#0ea5e9', dark: '#1d4ed8', emoji: '🔵' },
  { id: 'purple', label: 'بنفسجي', main: '#a855f7', dark: '#6b21a8', emoji: '🟣' },
  { id: 'green', label: 'أخضر', main: '#22c55e', dark: '#15803d', emoji: '🟢' },
  { id: 'yellow', label: 'أصفر', main: '#eab308', dark: '#a16207', emoji: '🟡' },
];

export interface BiomeTheme {
  id: BiomeId;
  name: string;
  skyTop: string;
  skyBot: string;
  silhouetteColor: string;
  hillColor: string;
  wallFill: string;
  wallTrim: string;
  beamFill: string;
  beamTrim: string;
  outline: string;
  crateFill: string;
  crateInner: string;
}

export const BIOMES: BiomeTheme[] = [
  {
    id: 'space',
    name: 'مرحلة الفضاء',
    skyTop: '#5cb5f9',
    skyBot: '#4ca2ec',
    silhouetteColor: 'rgba(255,255,255,0.22)',
    hillColor: 'rgba(255,255,255,0.14)',
    wallFill: '#3b4056',
    wallTrim: '#5c6384',
    beamFill: '#854824',
    beamTrim: '#a86135',
    outline: '#141621',
    crateFill: '#9b5431',
    crateInner: '#7d3f22',
  },
  {
    id: 'forest',
    name: 'مرحلة الغابة',
    skyTop: '#bce994',
    skyBot: '#aee282',
    silhouetteColor: 'rgba(255,255,255,0.34)',
    hillColor: '#98d26a',
    wallFill: '#7c4322',
    wallTrim: '#39a833',
    beamFill: '#854824',
    beamTrim: '#a86135',
    outline: '#16161c',
    crateFill: '#9b5431',
    crateInner: '#7d3f22',
  },
  {
    id: 'desert',
    name: 'مرحلة الصحراء',
    skyTop: '#fde569',
    skyBot: '#fad952',
    silhouetteColor: 'rgba(255,255,255,0.35)',
    hillColor: '#f1c73e',
    wallFill: '#7d3e1e',
    wallTrim: '#e58b2b',
    beamFill: '#854824',
    beamTrim: '#a86135',
    outline: '#181414',
    crateFill: '#9b5431',
    crateInner: '#7d3f22',
  },
  {
    id: 'citadel',
    name: 'مرحلة نواف الخاصة',
    skyTop: '#d8b4fe',
    skyBot: '#c084fc',
    silhouetteColor: 'rgba(255,255,255,0.34)',
    hillColor: '#a855f7',
    wallFill: '#3b1521',
    wallTrim: '#b81728',
    beamFill: '#854824',
    beamTrim: '#a86135',
    outline: '#16080d',
    crateFill: '#9b5431',
    crateInner: '#7d3f22',
  },
];

export interface SolidRect {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'wall-left' | 'wall-right' | 'beam' | 'crate';
}

export const WORLD_W = 440;
export const LOGICAL_H = 780;
export const WALL_BASE_W = 36;

/**
 * Progressive scroll speed curve:
 * - Starts smoothly at 154 px/s (160 px/s in online duels)
 * - Ramps steadily and plateaus cleanly around 240-246 px/s so gameplay stays crisp, exciting, and fair.
 */
export function computeScrollSpeed(
  roundElapsed: number,
  roundNumber: number,
  _isOnline = false
): number {
  const start = 160;
  const timeRamp = Math.min(82, roundElapsed * 2.25);
  const roundBonus = Math.min(10, Math.max(0, roundNumber - 1) * 3.5);
  return Math.min(246, start + timeRamp + roundBonus);
}

/**
 * Progressive, logical obstacle chunks:
 * - Chunk 0: clean starting runway
 * - Chunk 1 (~first 5-7s): gentle warm-up with stepped walls, central beam, and spacious crates
 * - Chunks 2..3 (~7s..16s): engaging intermediate transitions (staggered beams, side windows, crates)
 * - Chunks 4+: 8 rich tactical patterns (zig-zag beams, 3-lane ladders, double-crate gates, twin beams, S-curves)
 *   all geometrically verified with >= 105px overlap on gaps so nothing is impossible or unfair.
 */
export function generateVerticalChunks(
  bottomY: number,
  chunkIndex: number,
  seedOffset = 0,
  isOnline = false
): { rects: SolidRect[]; nextTopY: number } {
  const rects: SolidRect[] = [];

  if (chunkIndex === 0) {
    const h = 520;
    const topY = bottomY - h;
    rects.push({ x: 0, y: topY, w: WALL_BASE_W, h, kind: 'wall-left' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h, kind: 'wall-right' });
    return { rects, nextTopY: topY };
  }

  // Warm-up chunk 1 (easy opening)
  if (chunkIndex === 1) {
    const h = 620;
    const topY = bottomY - h;
    rects.push({ x: 0, y: bottomY - 220, w: WALL_BASE_W, h: 220, kind: 'wall-left' });
    rects.push({ x: 0, y: bottomY - 430, w: 68, h: 210, kind: 'wall-left' });
    rects.push({ x: 0, y: topY, w: WALL_BASE_W, h: 190, kind: 'wall-left' });

    rects.push({ x: WORLD_W - 68, y: bottomY - 260, w: 68, h: 260, kind: 'wall-right' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h: 360, kind: 'wall-right' });

    rects.push({ x: WORLD_W / 2 - 11, y: topY + 130, w: 22, h: 280, kind: 'beam' });
    rects.push({ x: WALL_BASE_W, y: bottomY - 140, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: WORLD_W - WALL_BASE_W - 30, y: topY + 85, w: 30, h: 30, kind: 'crate' });
    return { rects, nextTopY: topY };
  }

  // Intermediate ramp (chunk 2), then full tactical tier from chunk 3+ in both Bot & Online
  const medCutoff = 2;
  if (chunkIndex <= medCutoff) {
    const medPick = (chunkIndex + seedOffset) % 3;
    if (medPick === 0) {
      // Staggered wooden beams + generous side windows + crate hazard
      const h = 700;
      const topY = bottomY - h;
      rects.push({ x: 0, y: bottomY - 235, w: WALL_BASE_W, h: 235, kind: 'wall-left' });
      rects.push({ x: 0, y: bottomY - 385, w: 72, h: 150, kind: 'wall-left' });
      rects.push({ x: 0, y: topY, w: WALL_BASE_W, h: 190, kind: 'wall-left' });

      rects.push({ x: WORLD_W - WALL_BASE_W, y: bottomY - 205, w: WALL_BASE_W, h: 205, kind: 'wall-right' });
      rects.push({ x: WORLD_W - 72, y: bottomY - 495, w: 72, h: 170, kind: 'wall-right' });
      rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h: 205, kind: 'wall-right' });

      rects.push({ x: 250, y: bottomY - 420, w: 22, h: 300, kind: 'beam' });
      rects.push({ x: 164, y: topY + 80, w: 22, h: 300, kind: 'beam' });
      rects.push({ x: WALL_BASE_W, y: bottomY - 125, w: 30, h: 30, kind: 'crate' });
      return { rects, nextTopY: topY };
    }

    if (medPick === 1) {
      // Stepped S-curve + 3 alternating crates (pushes behind if clipped!)
      const h = 660;
      const topY = bottomY - h;
      rects.push({ x: 0, y: bottomY - 300, w: WALL_BASE_W, h: 300, kind: 'wall-left' });
      rects.push({ x: 0, y: topY, w: 74, h: 360, kind: 'wall-left' });

      rects.push({ x: WORLD_W - 74, y: bottomY - 320, w: 74, h: 320, kind: 'wall-right' });
      rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h: 340, kind: 'wall-right' });

      rects.push({ x: WALL_BASE_W, y: bottomY - 175, w: 30, h: 30, kind: 'crate' });
      rects.push({ x: WORLD_W - WALL_BASE_W - 30, y: topY + 185, w: 30, h: 30, kind: 'crate' });
      rects.push({ x: 74, y: topY + 70, w: 30, h: 30, kind: 'crate' });
      return { rects, nextTopY: topY };
    }

    const h = 680;
    const topY = bottomY - h;
    rects.push({ x: 0, y: bottomY - 230, w: WALL_BASE_W, h: 230, kind: 'wall-left' });
    rects.push({ x: 0, y: bottomY - 470, w: 72, h: 240, kind: 'wall-left' });
    rects.push({ x: 0, y: topY, w: WALL_BASE_W, h: 210, kind: 'wall-left' });

    rects.push({ x: WORLD_W - 72, y: bottomY - 180, w: 72, h: 180, kind: 'wall-right' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: bottomY - 440, w: WALL_BASE_W, h: 260, kind: 'wall-right' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h: 240, kind: 'wall-right' });

    rects.push({ x: WALL_BASE_W, y: bottomY - 135, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: WORLD_W - WALL_BASE_W - 30, y: bottomY - 325, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: 72, y: bottomY - 460, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: WORLD_W - WALL_BASE_W - 30, y: topY + 75, w: 30, h: 30, kind: 'crate' });
    return { rects, nextTopY: topY };
  }

  // Tactical tier (chunks 3+/4+) — Exciting, skill-rewarding & logical (never impossible)
  const hardPick = (chunkIndex + seedOffset) % 8;

  // 0: Double crate gate + central plank + upper single-wall crates
  if (hardPick === 0) {
    const h = 680;
    const topY = bottomY - h;
    rects.push({ x: 0, y: topY, w: WALL_BASE_W, h, kind: 'wall-left' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h, kind: 'wall-right' });

    rects.push({ x: WALL_BASE_W, y: bottomY - 230, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: WORLD_W - WALL_BASE_W - 30, y: bottomY - 230, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: WORLD_W / 2 - 11, y: topY + 105, w: 22, h: 460, kind: 'beam' });
    rects.push({ x: WALL_BASE_W, y: topY + 150, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: WORLD_W - WALL_BASE_W - 30, y: topY + 60, w: 30, h: 30, kind: 'crate' });
    return { rects, nextTopY: topY };
  }

  // 1: Three-lane wooden beam ladder across open center gap + side entry crate
  if (hardPick === 1) {
    const h = 700;
    const topY = bottomY - h;
    rects.push({ x: 0, y: bottomY - 210, w: WALL_BASE_W, h: 210, kind: 'wall-left' });
    rects.push({ x: 0, y: topY, w: WALL_BASE_W, h: 210, kind: 'wall-left' });

    rects.push({ x: WORLD_W - WALL_BASE_W, y: bottomY - 210, w: WALL_BASE_W, h: 210, kind: 'wall-right' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h: 210, kind: 'wall-right' });

    rects.push({ x: 124, y: bottomY - 430, w: 22, h: 335, kind: 'beam' });
    rects.push({ x: WORLD_W - 146, y: bottomY - 430, w: 22, h: 335, kind: 'beam' });
    rects.push({ x: WORLD_W / 2 - 11, y: topY + 95, w: 22, h: 355, kind: 'beam' });
    rects.push({ x: WORLD_W - WALL_BASE_W - 30, y: topY + 75, w: 30, h: 30, kind: 'crate' });
    return { rects, nextTopY: topY };
  }

  // 2: Twin parallel wooden beams + staggered crates on entrance & exit walls
  if (hardPick === 2) {
    const h = 680;
    const topY = bottomY - h;
    rects.push({ x: 0, y: bottomY - 195, w: WALL_BASE_W, h: 195, kind: 'wall-left' });
    rects.push({ x: 0, y: topY, w: WALL_BASE_W, h: 195, kind: 'wall-left' });

    rects.push({ x: WORLD_W - WALL_BASE_W, y: bottomY - 195, w: WALL_BASE_W, h: 195, kind: 'wall-right' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h: 195, kind: 'wall-right' });

    rects.push({ x: 146, y: topY + 85, w: 22, h: 505, kind: 'beam' });
    rects.push({ x: WORLD_W - 168, y: topY + 85, w: 22, h: 505, kind: 'beam' });
    rects.push({ x: WALL_BASE_W, y: bottomY - 120, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: WORLD_W - WALL_BASE_W - 30, y: topY + 70, w: 30, h: 30, kind: 'crate' });
    return { rects, nextTopY: topY };
  }

  // 3: Split central beams + rhythmic outer windows (forces wall -> beam -> weave -> beam -> wall)
  if (hardPick === 3) {
    const h = 720;
    const topY = bottomY - h;
    rects.push({ x: 0, y: bottomY - 220, w: WALL_BASE_W, h: 220, kind: 'wall-left' });
    rects.push({ x: 0, y: bottomY - 500, w: WALL_BASE_W, h: 145, kind: 'wall-left' });
    rects.push({ x: 0, y: topY, w: WALL_BASE_W, h: 110, kind: 'wall-left' });

    rects.push({ x: WORLD_W - WALL_BASE_W, y: bottomY - 220, w: WALL_BASE_W, h: 220, kind: 'wall-right' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: bottomY - 500, w: WALL_BASE_W, h: 145, kind: 'wall-right' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h: 110, kind: 'wall-right' });

    // Lower-right beam & upper-left beam overlap generously in middle & overlap outer walls by >= 110px
    rects.push({ x: 244, y: bottomY - 460, w: 22, h: 360, kind: 'beam' });
    rects.push({ x: 174, y: topY + 40, w: 22, h: 375, kind: 'beam' });
    return { rects, nextTopY: topY };
  }

  // 4: Stepped corridor with twin staggered beams + dual crates
  if (hardPick === 4) {
    const h = 720;
    const topY = bottomY - h;
    rects.push({ x: 0, y: bottomY - 250, w: WALL_BASE_W, h: 250, kind: 'wall-left' });
    rects.push({ x: 0, y: bottomY - 395, w: 74, h: 145, kind: 'wall-left' });
    rects.push({ x: 0, y: topY, w: WALL_BASE_W, h: 205, kind: 'wall-left' });

    rects.push({ x: WORLD_W - WALL_BASE_W, y: bottomY - 205, w: WALL_BASE_W, h: 205, kind: 'wall-right' });
    rects.push({ x: WORLD_W - 74, y: bottomY - 500, w: 74, h: 175, kind: 'wall-right' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h: 210, kind: 'wall-right' });

    rects.push({ x: 252, y: bottomY - 430, w: 22, h: 315, kind: 'beam' });
    rects.push({ x: 166, y: topY + 85, w: 22, h: 315, kind: 'beam' });
    rects.push({ x: WALL_BASE_W, y: bottomY - 125, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: WORLD_W - WALL_BASE_W - 30, y: topY + 80, w: 30, h: 30, kind: 'crate' });
    return { rects, nextTopY: topY };
  }

  // 5: Three-step zig-zag weave across open outer gaps (lower side beams -> center beam -> upper walls)
  if (hardPick === 5) {
    const h = 740;
    const topY = bottomY - h;
    rects.push({ x: 0, y: bottomY - 210, w: WALL_BASE_W, h: 210, kind: 'wall-left' });
    rects.push({ x: 0, y: topY, w: WALL_BASE_W, h: 210, kind: 'wall-left' });

    rects.push({ x: WORLD_W - WALL_BASE_W, y: bottomY - 210, w: WALL_BASE_W, h: 210, kind: 'wall-right' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h: 210, kind: 'wall-right' });

    rects.push({ x: 124, y: bottomY - 410, w: 22, h: 315, kind: 'beam' });
    rects.push({ x: WORLD_W - 146, y: bottomY - 410, w: 22, h: 315, kind: 'beam' });
    rects.push({ x: WORLD_W / 2 - 11, y: topY + 115, w: 22, h: 355, kind: 'beam' });
    rects.push({ x: WALL_BASE_W, y: bottomY - 125, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: WORLD_W - WALL_BASE_W - 30, y: topY + 85, w: 30, h: 30, kind: 'crate' });
    return { rects, nextTopY: topY };
  }

  // 6: Narrow S-curve chicane with tactical push-back crates & central beam divider
  if (hardPick === 6) {
    const h = 680;
    const topY = bottomY - h;
    rects.push({ x: 0, y: bottomY - 220, w: WALL_BASE_W, h: 220, kind: 'wall-left' });
    rects.push({ x: 0, y: bottomY - 460, w: 78, h: 240, kind: 'wall-left' });
    rects.push({ x: 0, y: topY, w: WALL_BASE_W, h: 220, kind: 'wall-left' });

    rects.push({ x: WORLD_W - 78, y: bottomY - 175, w: 78, h: 175, kind: 'wall-right' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: bottomY - 430, w: WALL_BASE_W, h: 255, kind: 'wall-right' });
    rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h: 250, kind: 'wall-right' });

    rects.push({ x: WORLD_W / 2 - 11, y: topY + 140, w: 22, h: 390, kind: 'beam' });
    rects.push({ x: WALL_BASE_W, y: bottomY - 135, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: WORLD_W - WALL_BASE_W - 30, y: bottomY - 315, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: 78, y: bottomY - 445, w: 30, h: 30, kind: 'crate' });
    rects.push({ x: WORLD_W - WALL_BASE_W - 30, y: topY + 75, w: 30, h: 30, kind: 'crate' });
    return { rects, nextTopY: topY };
  }

  // 7: Split gate — outer walls open briefly, twin side beams + center wall crate challenge
  const h = 680;
  const topY = bottomY - h;
  rects.push({ x: 0, y: bottomY - 210, w: WALL_BASE_W, h: 210, kind: 'wall-left' });
  rects.push({ x: 0, y: topY, w: WALL_BASE_W, h: 220, kind: 'wall-left' });

  rects.push({ x: WORLD_W - WALL_BASE_W, y: bottomY - 210, w: WALL_BASE_W, h: 210, kind: 'wall-right' });
  rects.push({ x: WORLD_W - WALL_BASE_W, y: topY, w: WALL_BASE_W, h: 220, kind: 'wall-right' });

  rects.push({ x: 132, y: topY + 115, w: 22, h: 455, kind: 'beam' });
  rects.push({ x: WORLD_W - 154, y: topY + 115, w: 22, h: 455, kind: 'beam' });
  rects.push({ x: 154, y: bottomY - 330, w: 28, h: 28, kind: 'crate' });
  rects.push({ x: WORLD_W - 154 - 28, y: topY + 210, w: 28, h: 28, kind: 'crate' });
  return { rects, nextTopY: topY };
}

export function drawVerticalBiomeBackdrop(
  ctx: CanvasRenderingContext2D,
  biome: BiomeTheme,
  W: number,
  H: number,
  cameraY: number
) {
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, biome.skyTop);
  grad.addColorStop(1, biome.skyBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const parallax = (-cameraY * 0.14) % H;
  ctx.save();

  if (biome.id === 'space') {
    ctx.fillStyle = biome.silhouetteColor;
    ctx.strokeStyle = biome.silhouetteColor;

    const px = W * 0.56;
    const py = ((H * 0.35 + parallax) % (H + 220)) - 110;
    ctx.beginPath();
    ctx.arc(px, py, 64, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.ellipse(px, py, 112, 20, -0.35, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(W * 0.28, H * 0.72, 36, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    [
      [0.24, 0.2, 55],
      [0.74, 0.55, 62],
      [0.32, 0.85, 48],
    ].forEach(([rx, ry, l]) => {
      const sx = rx * W;
      const sy = ry * H;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - l * 0.45, sy + l);
      ctx.stroke();
    });
  } else if (biome.id === 'forest' || biome.id === 'citadel') {
    ctx.fillStyle = biome.silhouetteColor;
    [
      [0.32, 0.24],
      [0.68, 0.56],
      [0.42, 0.82],
    ].forEach(([rx, ry]) => {
      const cx = rx * W;
      const cy = ((ry * H + parallax * 0.5) % (H + 140)) - 70;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.arc(cx + 20, cy - 8, 24, 0, Math.PI * 2);
      ctx.arc(cx + 42, cy, 18, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = biome.hillColor;
    ctx.beginPath();
    ctx.arc(W * 0.25, H * 0.48, 85, 0, Math.PI * 2);
    ctx.arc(W * 0.72, H * 0.75, 95, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = biome.silhouetteColor;
    [
      [0.35, 0.25],
      [0.65, 0.68],
    ].forEach(([rx, ry]) => {
      const cx = rx * W;
      const cy = ((ry * H + parallax * 0.4) % (H + 140)) - 70;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.arc(cx + 20, cy - 7, 23, 0, Math.PI * 2);
      ctx.arc(cx + 41, cy, 17, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = biome.hillColor;
    [0.3, 0.72].forEach((ry, i) => {
      const py = ((ry * H + parallax * 0.6) % (H + 220)) - 110;
      const px = i === 0 ? W * 0.35 : W * 0.62;
      ctx.beginPath();
      ctx.moveTo(px - 80, py + 70);
      ctx.lineTo(px, py - 60);
      ctx.lineTo(px + 80, py + 70);
      ctx.closePath();
      ctx.fill();
    });
  }

  ctx.restore();
}

export function drawVerticalSolidRect(
  ctx: CanvasRenderingContext2D,
  rect: SolidRect,
  biome: BiomeTheme,
  screenY: number
) {
  const { x, w, h, kind } = rect;
  ctx.save();

  if (kind === 'crate') {
    ctx.fillStyle = biome.crateFill;
    ctx.strokeStyle = biome.outline;
    ctx.lineWidth = 3;
    ctx.fillRect(x, screenY, w, h);
    ctx.strokeRect(x, screenY, w, h);

    ctx.fillStyle = biome.crateInner;
    ctx.fillRect(x + 6, screenY + 6, w - 12, h - 12);
    ctx.strokeRect(x + 6, screenY + 6, w - 12, h - 12);

    ctx.beginPath();
    ctx.moveTo(x + 6, screenY + 6);
    ctx.lineTo(x + w - 6, screenY + h - 6);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (kind === 'beam') {
    ctx.fillStyle = biome.beamFill;
    ctx.strokeStyle = biome.outline;
    ctx.lineWidth = 3.2;
    ctx.fillRect(x, screenY, w, h);
    ctx.strokeRect(x, screenY, w, h);

    ctx.fillStyle = biome.beamTrim;
    ctx.fillRect(x + 3, screenY + 3, 5, h - 6);
    ctx.restore();
    return;
  }

  ctx.fillStyle = biome.wallFill;
  ctx.fillRect(x, screenY, w, h);

  const trimW = 13;
  const trimX = kind === 'wall-left' ? x + w - trimW : x;
  ctx.fillStyle = biome.wallTrim;
  ctx.fillRect(trimX, screenY, trimW, h);

  const bumpStep = 18;
  const edgeX = kind === 'wall-left' ? x + w : x;
  ctx.beginPath();
  for (let by = screenY + 9; by < screenY + h; by += bumpStep) {
    ctx.moveTo(edgeX, by);
    ctx.arc(edgeX, by, 8.5, 0, Math.PI * 2);
  }
  ctx.fill();

  ctx.strokeStyle = biome.outline;
  ctx.lineWidth = 3.2;
  ctx.strokeRect(x, screenY, w, h);

  ctx.restore();
}
