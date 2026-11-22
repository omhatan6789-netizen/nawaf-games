import {
  AIM_SPAN,
  BOARD_RADII,
  CLOCKWISE_SECTORS,
  type CheckoutTarget,
} from './dartsScoring';
import type {
  HitResult,
  PinnedDart,
  PlayerSide,
  TurnPhase,
} from './dartsTypes';

export interface RenderParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  rotation: number;
  spin: number;
  isStar: boolean;
}

export interface DartsRenderState {
  phase: TurnPhase;
  activeSide: PlayerSide;
  mySide: PlayerSide;
  activeLabel: string;
  countdownValue: number;
  turnIntroProgress: number; // 0 -> 1
  aimX: number; // normalized [-AIM_SPAN, AIM_SPAN]
  aimY: number; // normalized [-AIM_SPAN, AIM_SPAN]
  xLocked: boolean;
  yLocked: boolean;
  showHelp: boolean;
  hideAimDot: boolean;
  checkoutTargets: CheckoutTarget[];
  pulseTime: number;
  aimProgress: number; // 0..1 flight
  flightEndNorm: { x: number; y: number };
  flightFromSide: PlayerSide;
  zoomAmount: number; // 0..1
  zoomFocusNorm: { x: number; y: number };
  pinnedDart: PinnedDart | null;
  lastHit: HitResult | null;
  impactPopupAlpha: number;
  impactRingProgress: number;
  particles: RenderParticle[];
}

function drawRoundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Draws the dark braided, gold-collared, feathered arrow (IMG_7532_ba946d14.jpeg)
 * in crisp 3D depth perspective pointing INTO the dartboard (like IMG_7533_c803fa64.jpeg),
 * never flat against the screen.
 */
function drawPerspectiveDart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  side: PlayerSide,
  angleRad: number,
  pinnedMode = false
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);
  ctx.scale(scale, scale);

  const accentGlow = side === 'red' ? '#dc2626' : '#0ea5e9';
  const accentDark = side === 'red' ? '#7f1d1d' : '#0c4a6e';
  const goldLight = '#ead087';
  const goldDark = '#8f6e2d';
  const ink = '#090a0e';

  const drawGoldCollar = (cy: number, halfW: number, thick: number) => {
    const grad = ctx.createLinearGradient(-halfW, cy, halfW, cy);
    grad.addColorStop(0, goldDark);
    grad.addColorStop(0.5, goldLight);
    grad.addColorStop(1, goldDark);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(-halfW, cy - thick / 2, halfW * 2, thick, thick * 0.45);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = ink;
    ctx.stroke();
  };

  if (pinnedMode) {
    // Stuck straight INTO the dartboard in 3D depth:
    // Tip is buried at (0, 0); foreshortened braided shaft rises toward the viewer (0, -22),
    // topped by the gold collar and 3D radial feathered fletching fanning out around the nock!

    // Entry puncture shadow & embedded metallic broadhead base at (0, 0)
    ctx.beginPath();
    ctx.ellipse(0, 0, 6.5, 4.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5, 7, 12, 0.72)';
    ctx.fill();

    // Subtle embedded broadhead barbs peeking slightly out of the puncture point
    ctx.beginPath();
    ctx.moveTo(-8, -3);
    ctx.lineTo(0, 2);
    ctx.lineTo(8, -3);
    ctx.lineTo(4.2, -5.5);
    ctx.lineTo(-4.2, -5.5);
    ctx.closePath();
    ctx.fillStyle = '#1b1f29';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = ink;
    ctx.stroke();

    // Embedded gold collar near entry
    drawGoldCollar(-4, 4.2, 3.2);

    // Foreshortened dark braided shaft rising toward viewer (y: -4 -> -22)
    ctx.beginPath();
    ctx.moveTo(-2.4, -4);
    ctx.lineTo(2.4, -4);
    ctx.lineTo(3.4, -22);
    ctx.lineTo(-3.4, -22);
    ctx.closePath();
    const shaftGrad = ctx.createLinearGradient(-3.5, 0, 3.5, 0);
    shaftGrad.addColorStop(0, '#0d0f14');
    shaftGrad.addColorStop(0.45, '#3b4254');
    shaftGrad.addColorStop(1, '#11131a');
    ctx.fillStyle = shaftGrad;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = ink;
    ctx.stroke();

    // Braided scale texture lines
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 0.9;
    for (let sy = -8; sy >= -19; sy -= 4) {
      ctx.beginPath();
      ctx.moveTo(-2.4, sy);
      ctx.lineTo(2.4, sy - 2.2);
      ctx.stroke();
    }

    // 3D Radial Feathered Fletching fanning out around tail hub (0, -23)
    const hubX = 0;
    const hubY = -23;
    const drawRadialFeather = (angle: number, len: number) => {
      ctx.save();
      ctx.translate(hubX, hubY);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.quadraticCurveTo(-5.5, -len * 0.4, -4.5, -len * 0.72);
      ctx.lineTo(-2.5, -len * 0.78);
      ctx.lineTo(-4.2, -len);
      ctx.quadraticCurveTo(0, -len * 0.92, 3.2, -len * 0.65);
      ctx.lineTo(4.6, -len * 0.35);
      ctx.closePath();

      const fGrad = ctx.createLinearGradient(0, 0, 0, -len);
      fGrad.addColorStop(0, '#121319');
      fGrad.addColorStop(0.55, accentDark);
      fGrad.addColorStop(1, '#101116');
      ctx.fillStyle = fGrad;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = ink;
      ctx.stroke();

      // Feather barb highlights
      ctx.beginPath();
      ctx.moveTo(-0.5, -3);
      ctx.lineTo(-2.5, -len * 0.62);
      ctx.moveTo(1.2, -4);
      ctx.lineTo(2.4, -len * 0.55);
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = accentGlow;
      ctx.stroke();
      ctx.restore();
    };

    // Upper-center feather + bottom-left & bottom-right 3D vanes
    drawRadialFeather(0, 24);
    drawRadialFeather(-Math.PI * 0.66, 23);
    drawRadialFeather(Math.PI * 0.66, 23);

    // Tail gold collar & crisp dark nock center facing viewer
    drawGoldCollar(-20, 4.8, 3.6);
    ctx.beginPath();
    ctx.arc(hubX, hubY, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = '#1c202a';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ink;
    ctx.stroke();
  } else {
    // Ready / Slow-Motion Flying 3D Perspective Arrow aimed forward into depth (like holding IMG_7532 toward the board):
    // 1. Tail feathers behind (y: +14 -> +40) with V-notch & crimson/blue feather barbs
    const drawTailFeather = (dir: -1 | 1) => {
      ctx.beginPath();
      ctx.moveTo(dir * 2.2, 12);
      ctx.lineTo(dir * 12, 18);
      ctx.lineTo(dir * 10, 23);
      ctx.lineTo(dir * 15.5, 28);
      ctx.lineTo(dir * 12.5, 32);
      ctx.lineTo(dir * 17.5, 41);
      ctx.quadraticCurveTo(dir * 12, 43, dir * 4.5, 34);
      ctx.lineTo(dir * 2.4, 30);
      ctx.closePath();

      const fGrad = ctx.createLinearGradient(0, 12, dir * 16, 40);
      fGrad.addColorStop(0, '#101218');
      fGrad.addColorStop(0.55, accentDark);
      fGrad.addColorStop(1, '#111217');
      ctx.fillStyle = fGrad;
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = ink;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(dir * 3.2, 18);
      ctx.lineTo(dir * 10.5, 25);
      ctx.moveTo(dir * 3.2, 24);
      ctx.lineTo(dir * 13.5, 35);
      ctx.lineWidth = 1.15;
      ctx.strokeStyle = accentGlow;
      ctx.stroke();
    };
    drawTailFeather(-1);
    drawTailFeather(1);

    // Dorsal center feather ridge for 3D depth
    ctx.beginPath();
    ctx.moveTo(-2.5, 13);
    ctx.lineTo(0, 36);
    ctx.lineTo(2.5, 13);
    ctx.closePath();
    ctx.fillStyle = '#181a22';
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = ink;
    ctx.stroke();

    // 2. Foreshortened Dark Braided Shaft (tapers away toward tip: width 6.4 -> 4.4)
    ctx.beginPath();
    ctx.moveTo(-2.2, -23);
    ctx.lineTo(2.2, -23);
    ctx.lineTo(3.3, 16);
    ctx.lineTo(-3.3, 16);
    ctx.closePath();

    const shaftGrad = ctx.createLinearGradient(-3.5, 0, 3.5, 0);
    shaftGrad.addColorStop(0, '#0c0e13');
    shaftGrad.addColorStop(0.45, '#3b4355');
    shaftGrad.addColorStop(1, '#101218');
    ctx.fillStyle = shaftGrad;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = ink;
    ctx.stroke();

    // Subtle braided scale notches along foreshortened shaft
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 0.9;
    for (let sy = -18; sy <= 10; sy += 5.5) {
      ctx.beginPath();
      ctx.moveTo(-2.2, sy);
      ctx.lineTo(2.2, sy + 2.8);
      ctx.stroke();
    }

    // 3. Dual Gold Collars (scaled slightly smaller at front for 3D depth)
    drawGoldCollar(-23, 3.8, 3.4);
    drawGoldCollar(13, 4.6, 3.8);

    // 4. Foreshortened Sharp Barbed Broadhead Arrowhead pointing away toward board (y: -47 -> -23)
    ctx.beginPath();
    ctx.moveTo(0, -48);
    ctx.lineTo(11, -24);
    ctx.lineTo(8.2, -23.2);
    ctx.lineTo(3.8, -25.2);
    ctx.lineTo(2.8, -23);
    ctx.lineTo(-2.8, -23);
    ctx.lineTo(-3.8, -25.2);
    ctx.lineTo(-8.2, -23.2);
    ctx.lineTo(-11, -24);
    ctx.closePath();

    const headGrad = ctx.createLinearGradient(-11, -38, 11, -24);
    headGrad.addColorStop(0, '#2e3543');
    headGrad.addColorStop(0.5, '#151820');
    headGrad.addColorStop(1, '#0c0e13');
    ctx.fillStyle = headGrad;
    ctx.fill();
    ctx.lineWidth = 2.0;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ink;
    ctx.stroke();

    // Center bevel ridge + glowing crimson/blue inner runes
    ctx.beginPath();
    ctx.moveTo(0, -45.5);
    ctx.lineTo(0, -26);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.45)';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-2.1, -38.5);
    ctx.lineTo(-6.2, -27.5);
    ctx.lineTo(-3.1, -29);
    ctx.moveTo(2.1, -38.5);
    ctx.lineTo(6.2, -27.5);
    ctx.lineTo(3.1, -29);
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = accentGlow;
    ctx.stroke();
  }

  ctx.restore();
}

function drawGuideArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  label: string,
  labelX: number,
  labelY: number,
  fontSize: number
): void {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const angle = Math.atan2(dy, dx);
  const headLen = fontSize * 0.85;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const endShaftX = toX - Math.cos(angle) * (headLen * 0.5);
  const endShaftY = toY - Math.sin(angle) * (headLen * 0.5);

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(endShaftX, endShaftY);
  ctx.lineWidth = 5.5;
  ctx.strokeStyle = '#0f172a';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(endShaftX, endShaftY);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  const leftX = toX - headLen * Math.cos(angle - Math.PI / 6);
  const leftY = toY - headLen * Math.sin(angle - Math.PI / 6);
  const rightX = toX - headLen * Math.cos(angle + Math.PI / 6);
  const rightY = toY - headLen * Math.sin(angle + Math.PI / 6);

  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#0f172a';
  ctx.stroke();

  ctx.font = `900 ${fontSize}px Cairo, Tajawal, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.strokeText(label, labelX, labelY);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, labelX, labelY);
  ctx.restore();
}

export function renderDartsScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: DartsRenderState
): void {
  const isCountdown = state.phase === 'countdown';
  const isBlueTurn = state.activeSide === 'blue' && !isCountdown;
  const floorY = height * 0.835;

  // 1. Vertical Striped Wall Background
  const stripeCount = 11;
  const stripeW = width / stripeCount;
  const wallA = isCountdown ? '#162638' : isBlueTurn ? '#4b98c7' : '#dd795c';
  const wallB = isCountdown ? '#1c3045' : isBlueTurn ? '#57a4d3' : '#e78769';

  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? wallA : wallB;
    ctx.fillRect(i * stripeW, 0, Math.ceil(stripeW) + 1, floorY + 2);
  }

  const wallFade = ctx.createLinearGradient(0, floorY - height * 0.2, 0, floorY);
  wallFade.addColorStop(0, 'rgba(0, 0, 0, 0)');
  wallFade.addColorStop(
    1,
    isBlueTurn ? 'rgba(6, 20, 34, 0.58)' : 'rgba(28, 12, 8, 0.16)'
  );
  ctx.fillStyle = wallFade;
  ctx.fillRect(0, floorY - height * 0.2, width, height * 0.2);

  // 2. Perspective Wood Plank Floor
  const plankCount = 9;
  const vanishX = width * 0.5;
  const vanishY = floorY - height * 0.45;
  const plankColorA = isCountdown ? '#512415' : '#964526';
  const plankColorB = isCountdown ? '#441d10' : '#7f371c';

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, floorY, width, height - floorY);
  ctx.clip();

  for (let i = -2; i <= plankCount + 1; i++) {
    const t0 = i / plankCount;
    const t1 = (i + 1) / plankCount;
    const topX0 = t0 * width;
    const topX1 = t1 * width;
    const scaleBot = (height - vanishY) / Math.max(1, floorY - vanishY);
    const botX0 = vanishX + (topX0 - vanishX) * scaleBot;
    const botX1 = vanishX + (topX1 - vanishX) * scaleBot;

    ctx.beginPath();
    ctx.moveTo(topX0, floorY);
    ctx.lineTo(topX1, floorY);
    ctx.lineTo(botX1, height + 4);
    ctx.lineTo(botX0, height + 4);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? plankColorA : plankColorB;
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fillRect(0, floorY, width, 6);
  ctx.restore();

  // Glowing cyan frame vignette during Blue / Bot / Opponent turn
  if (isBlueTurn) {
    ctx.save();
    ctx.strokeStyle = '#36ecff';
    ctx.lineWidth = 8;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.roundRect(3, 3, width - 6, height - 6, 22);
    ctx.stroke();
    ctx.restore();
  }

  // 3. Camera Transform for Board + Pinned Arrow + Impact Zoom
  const boardCx = width * 0.5;
  const boardCy = height * 0.415;
  const outerBoardR = Math.min(width * 0.365, height * 0.255);
  const scoringR = outerBoardR / BOARD_RADII.NUMBER_RING;
  const arrowScaleBase = Math.min(width, height) / 430;

  const zoomScale = 1 + state.zoomAmount * 0.38;
  const focusX = boardCx + state.zoomFocusNorm.x * scoringR * 0.35;
  const focusY = boardCy + state.zoomFocusNorm.y * scoringR * 0.35;

  ctx.save();
  if (state.zoomAmount > 0.001) {
    ctx.translate(boardCx, boardCy);
    ctx.scale(zoomScale, zoomScale);
    ctx.translate(
      -(boardCx + (focusX - boardCx) * state.zoomAmount),
      -(boardCy + (focusY - boardCy) * state.zoomAmount)
    );
  }

  // Board drop shadow
  ctx.save();
  ctx.beginPath();
  ctx.arc(boardCx + 6, boardCy + 9, outerBoardR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
  ctx.fill();
  ctx.restore();

  // Outer black number ring
  ctx.beginPath();
  ctx.arc(boardCx, boardCy, outerBoardR, 0, Math.PI * 2);
  ctx.fillStyle = '#090a0d';
  ctx.fill();

  const checkoutGlowAlpha = 0.62 + 0.28 * Math.sin(state.pulseTime * 5.2);
  const hasCheckout = !state.showHelp && state.checkoutTargets.length > 0;

  // 20 Dartboard Sectors
  const angleStep = (Math.PI * 2) / 20;
  for (let i = 0; i < 20; i++) {
    const startAngle = -Math.PI / 2 - angleStep / 2 + i * angleStep;
    const endAngle = startAngle + angleStep;
    const isEven = i % 2 === 0;
    const sectorNum = CLOCKWISE_SECTORS[i];

    const singleColor = isEven ? '#090a0d' : '#ffffff';
    const ringColor = isEven ? '#8d3da8' : '#24be8b';

    const drawRingSlice = (
      rIn: number,
      rOut: number,
      color: string,
      goldOutline = false
    ) => {
      ctx.beginPath();
      ctx.arc(boardCx, boardCy, rOut * scoringR, startAngle, endAngle);
      ctx.arc(boardCx, boardCy, rIn * scoringR, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      if (goldOutline) {
        ctx.save();
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = '#fef08a';
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.restore();
      }
    };

    drawRingSlice(BOARD_RADII.OUTER_BULL, BOARD_RADII.TRIPLE_INNER, singleColor);
    drawRingSlice(BOARD_RADII.TRIPLE_INNER, BOARD_RADII.TRIPLE_OUTER, ringColor);
    drawRingSlice(BOARD_RADII.TRIPLE_OUTER, BOARD_RADII.DOUBLE_INNER, singleColor);
    drawRingSlice(BOARD_RADII.DOUBLE_INNER, BOARD_RADII.DOUBLE_OUTER, ringColor);

    // 1-Dart Winning Checkout Golden Alert Highlight
    if (hasCheckout) {
      const goldFill = `rgba(250, 204, 21, ${checkoutGlowAlpha})`;
      for (const ct of state.checkoutTargets) {
        if (ct.sector !== sectorNum) continue;
        if (ct.ring === 'single') {
          drawRingSlice(BOARD_RADII.OUTER_BULL, BOARD_RADII.TRIPLE_INNER, goldFill, true);
          drawRingSlice(BOARD_RADII.TRIPLE_OUTER, BOARD_RADII.DOUBLE_INNER, goldFill, true);
        } else if (ct.ring === 'triple') {
          drawRingSlice(BOARD_RADII.TRIPLE_INNER, BOARD_RADII.TRIPLE_OUTER, goldFill, true);
        } else if (ct.ring === 'double') {
          drawRingSlice(BOARD_RADII.DOUBLE_INNER, BOARD_RADII.DOUBLE_OUTER, goldFill, true);
        }
      }
    }

    // Help (?) highlights
    if (state.showHelp) {
      if (sectorNum === 7) {
        drawRingSlice(
          BOARD_RADII.OUTER_BULL,
          BOARD_RADII.TRIPLE_INNER,
          'rgba(234, 179, 8, 0.78)'
        );
        drawRingSlice(
          BOARD_RADII.TRIPLE_OUTER,
          BOARD_RADII.DOUBLE_INNER,
          'rgba(234, 179, 8, 0.78)'
        );
      } else if (sectorNum === 3) {
        drawRingSlice(
          BOARD_RADII.DOUBLE_INNER,
          BOARD_RADII.DOUBLE_OUTER,
          'rgba(234, 179, 8, 0.92)'
        );
      } else if (sectorNum === 17) {
        drawRingSlice(
          BOARD_RADII.TRIPLE_INNER,
          BOARD_RADII.TRIPLE_OUTER,
          'rgba(234, 179, 8, 0.92)'
        );
      }
    }
  }

  // Outer Bull (25 pts)
  const outerBullCheckout =
    hasCheckout && state.checkoutTargets.some((t) => t.ring === 'outer_bull');
  ctx.beginPath();
  ctx.arc(boardCx, boardCy, BOARD_RADII.OUTER_BULL * scoringR, 0, Math.PI * 2);
  ctx.fillStyle = state.showHelp
    ? '#facc15'
    : outerBullCheckout
      ? `rgba(250, 204, 21, ${Math.min(1, checkoutGlowAlpha + 0.15)})`
      : '#ffffff';
  ctx.fill();
  ctx.lineWidth = outerBullCheckout ? 2.6 : 1.6;
  ctx.strokeStyle = outerBullCheckout ? '#fef08a' : '#090a0d';
  if (outerBullCheckout) {
    ctx.save();
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.stroke();
  }

  // Inner Bullseye (50 pts)
  const innerBullCheckout =
    hasCheckout && state.checkoutTargets.some((t) => t.ring === 'inner_bull');
  ctx.beginPath();
  ctx.arc(boardCx, boardCy, BOARD_RADII.INNER_BULL * scoringR, 0, Math.PI * 2);
  ctx.fillStyle = innerBullCheckout ? '#facc15' : '#e02424';
  ctx.fill();
  ctx.lineWidth = innerBullCheckout ? 2.6 : 1.2;
  ctx.strokeStyle = innerBullCheckout ? '#fef08a' : '#090a0d';
  if (innerBullCheckout) {
    ctx.save();
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.stroke();
  }

  // Sector Numbers in Outer Black Ring
  const numR =
    scoringR * ((BOARD_RADII.DOUBLE_OUTER + BOARD_RADII.NUMBER_RING) * 0.5);
  const numFontSize = Math.round(outerBoardR * 0.125);
  ctx.font = `900 ${numFontSize}px Cairo, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 20; i++) {
    const a = -Math.PI / 2 + i * angleStep;
    const nx = boardCx + Math.cos(a) * numR;
    const ny = boardCy + Math.sin(a) * numR;
    ctx.fillText(String(CLOCKWISE_SECTORS[i]), nx, ny + 1);
  }

  // Live Translucent Aiming Dot on Board (hidden during Bot turns only)
  if (
    (state.phase === 'aim_x' || state.phase === 'aim_y') &&
    !state.showHelp &&
    !state.hideAimDot
  ) {
    const dotX = boardCx + state.aimX * scoringR;
    const dotY = boardCy + state.aimY * scoringR;
    ctx.beginPath();
    ctx.arc(dotX, dotY, Math.max(6, scoringR * 0.056), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20, 26, 38, 0.56)';
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.stroke();
  }

  // Pinned Dart Embedded at Impact Point + Angled Board Shadow (IMG_7533_c803fa64.jpeg)
  if (state.pinnedDart) {
    const px = boardCx + state.pinnedDart.xNorm * scoringR;
    const py = boardCy + state.pinnedDart.yNorm * scoringR;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI * 0.25);
    ctx.fillStyle = 'rgba(10, 14, 22, 0.30)';
    ctx.beginPath();
    ctx.roundRect(-2.8 * arrowScaleBase, 0, 5.6 * arrowScaleBase, 50 * arrowScaleBase, 2.8);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 46 * arrowScaleBase, 7.2 * arrowScaleBase, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawPerspectiveDart(
      ctx,
      px,
      py,
      arrowScaleBase * 0.78,
      state.pinnedDart.side,
      state.pinnedDart.rotationRad,
      true
    );

    // Bold outlined score popup directly above pinned dart (IMG_7533 style)
    if (
      state.phase === 'impact_zoom' &&
      state.lastHit &&
      state.impactPopupAlpha > 0.02
    ) {
      ctx.save();
      ctx.globalAlpha = state.impactPopupAlpha;
      const mainScore = state.lastHit.isBust ? 'تجاوز!' : String(state.lastHit.score);
      const subLabel =
        state.lastHit.multiplier === 3
          ? `3×${state.lastHit.sector}`
          : state.lastHit.multiplier === 2 && state.lastHit.ring === 'double'
            ? `2×${state.lastHit.sector}`
            : state.lastHit.ring === 'inner_bull'
              ? 'المنتصف'
              : state.lastHit.ring === 'outer_bull'
                ? 'منتصف'
                : '';

      const popY = Math.max(boardCy - outerBoardR * 0.92, py - 38 * arrowScaleBase);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const mainFont = Math.round(32 * arrowScaleBase);
      ctx.font = `900 ${mainFont}px Cairo, Tajawal, sans-serif`;
      ctx.lineWidth = 6 * arrowScaleBase;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#23262f';
      ctx.strokeText(mainScore, px, popY - (subLabel ? 14 * arrowScaleBase : 0));
      ctx.fillStyle = state.lastHit.isBust
        ? '#fca5a5'
        : state.pinnedDart.side === 'red'
          ? '#f25148'
          : '#38bdf8';
      ctx.fillText(mainScore, px, popY - (subLabel ? 14 * arrowScaleBase : 0));

      if (subLabel) {
        const subFont = Math.round(16 * arrowScaleBase);
        ctx.font = `900 ${subFont}px Cairo, Tajawal, sans-serif`;
        ctx.lineWidth = 4.5 * arrowScaleBase;
        ctx.strokeStyle = '#23262f';
        ctx.strokeText(subLabel, px, popY + 8 * arrowScaleBase);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(subLabel, px, popY + 8 * arrowScaleBase);
      }
      ctx.restore();
    }
  }

  // Impact Expanding Ring & Star Particles
  if (
    state.impactRingProgress > 0 &&
    state.impactRingProgress < 1 &&
    state.pinnedDart
  ) {
    const px = boardCx + state.pinnedDart.xNorm * scoringR;
    const py = boardCy + state.pinnedDart.yNorm * scoringR;
    const r = (10 + state.impactRingProgress * 56) * arrowScaleBase;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.lineWidth = 3.5 * (1 - state.impactRingProgress);
    ctx.strokeStyle =
      state.lastHit?.ring === 'triple'
        ? `rgba(192, 132, 252, ${1 - state.impactRingProgress})`
        : state.lastHit?.ring === 'double'
          ? `rgba(52, 211, 153, ${1 - state.impactRingProgress})`
          : `rgba(250, 204, 21, ${1 - state.impactRingProgress})`;
    ctx.stroke();
  }

  for (const p of state.particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.alpha);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    if (p.isStar) {
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const outerA = (k * Math.PI * 2) / 5 - Math.PI / 2;
        const innerA = outerA + Math.PI / 5;
        const ox = Math.cos(outerA) * p.size;
        const oy = Math.sin(outerA) * p.size;
        const ix = Math.cos(innerA) * (p.size * 0.45);
        const iy = Math.sin(innerA) * (p.size * 0.45);
        if (k === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
        ctx.lineTo(ix, iy);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Help (?) Pointer Arrows Overlay
  if (state.showHelp) {
    const labelFont = Math.max(13, Math.round(outerBoardR * 0.11));
    const bull25X = boardCx - scoringR * 0.095;
    const bull25Y = boardCy - scoringR * 0.04;
    const bull50X = boardCx + scoringR * 0.015;
    const bull50Y = boardCy - scoringR * 0.01;

    const a7 = -Math.PI / 2 + 12 * angleStep;
    const s7X = boardCx + Math.cos(a7) * scoringR * 0.72;
    const s7Y = boardCy + Math.sin(a7) * scoringR * 0.72;

    const a3 = -Math.PI / 2 + 10 * angleStep;
    const s3X = boardCx + Math.cos(a3) * scoringR * 0.94;
    const s3Y = boardCy + Math.sin(a3) * scoringR * 0.94;

    const a17 = -Math.PI / 2 + 9 * angleStep;
    const s17X = boardCx + Math.cos(a17) * scoringR * 0.54;
    const s17Y = boardCy + Math.sin(a17) * scoringR * 0.54;

    drawGuideArrow(
      ctx,
      boardCx - outerBoardR * 0.98,
      boardCy - outerBoardR * 0.98,
      bull25X,
      bull25Y,
      '25 نقطة',
      boardCx - outerBoardR * 0.72,
      boardCy - outerBoardR * 1.12,
      labelFont
    );
    drawGuideArrow(
      ctx,
      boardCx + outerBoardR * 0.56,
      boardCy - outerBoardR * 0.98,
      bull50X,
      bull50Y,
      '50 نقطة',
      boardCx + outerBoardR * 0.72,
      boardCy - outerBoardR * 1.12,
      labelFont
    );
    drawGuideArrow(
      ctx,
      boardCx - outerBoardR * 1.04,
      boardCy + outerBoardR * 1.04,
      s7X,
      s7Y,
      '1x',
      boardCx - outerBoardR * 0.95,
      boardCy + outerBoardR * 1.18,
      labelFont
    );
    drawGuideArrow(
      ctx,
      boardCx - outerBoardR * 0.24,
      boardCy + outerBoardR * 1.04,
      s3X,
      s3Y,
      '2x',
      boardCx,
      boardCy + outerBoardR * 1.18,
      labelFont
    );
    drawGuideArrow(
      ctx,
      boardCx + outerBoardR * 0.62,
      boardCy + outerBoardR * 1.04,
      s17X,
      s17Y,
      '3x',
      boardCx + outerBoardR * 0.86,
      boardCy + outerBoardR * 1.18,
      labelFont
    );
  }

  ctx.restore(); // End board camera zoom

  // 4. Two-Axis Aiming Bars
  const barsVisible =
    state.phase === 'aim_x' ||
    state.phase === 'aim_y' ||
    state.phase === 'turn_intro';
  if (barsVisible) {
    const barThick = Math.max(12, Math.round(outerBoardR * 0.1));
    const hBarW = outerBoardR * 1.62;
    const hBarX = boardCx - hBarW / 2;
    const hBarY = boardCy + outerBoardR + Math.max(24, height * 0.042);

    const vBarH = outerBoardR * 1.62;
    const vBarX = Math.max(22, boardCx - outerBoardR - Math.max(28, width * 0.068));
    const vBarY = boardCy - vBarH / 2;

    const hActive = state.phase === 'aim_x' && !state.showHelp;
    const vActive = state.phase === 'aim_y' && !state.showHelp;

    // Horizontal Bar (X)
    ctx.save();
    drawRoundedBar(ctx, hBarX, hBarY, hBarW, barThick, barThick / 2);
    ctx.fillStyle = hActive ? '#231f24' : 'rgba(255, 255, 255, 0.36)';
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(boardCx - 1, hBarY - 2, 2, barThick + 4);

    const normXRatio = (state.aimX / AIM_SPAN + 1) * 0.5;
    const tickX = hBarX + 6 + normXRatio * (hBarW - 12);
    ctx.fillStyle = hActive
      ? '#ffffff'
      : state.xLocked
        ? '#111115'
        : 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.roundRect(tickX - 2.5, hBarY - 4, 5, barThick + 8, 2.5);
    ctx.fill();
    if (!hActive && state.xLocked) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.stroke();
    }
    ctx.restore();

    // Vertical Bar (Y)
    ctx.save();
    drawRoundedBar(ctx, vBarX, vBarY, barThick, vBarH, barThick / 2);
    ctx.fillStyle = vActive ? '#231f24' : 'rgba(255, 255, 255, 0.36)';
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(vBarX - 2, boardCy - 1, barThick + 4, 2);

    const normYRatio = (state.aimY / AIM_SPAN + 1) * 0.5;
    const tickY = vBarY + 6 + normYRatio * (vBarH - 12);
    ctx.fillStyle = vActive
      ? '#ffffff'
      : state.yLocked
        ? '#111115'
        : 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.roundRect(vBarX - 4, tickY - 2.5, barThick + 8, 5, 2.5);
    ctx.fill();
    ctx.restore();
  }

  // 5. Ready / Slow-Motion Flying Arrow (ALWAYS launched from bottom-front!)
  const arrowStartX = boardCx;
  const arrowStartY = height * 0.785;

  if (state.phase === 'flying') {
    const endX = boardCx + state.flightEndNorm.x * scoringR;
    const endY = boardCy + state.flightEndNorm.y * scoringR;
    const t = state.aimProgress;
    // Smooth gentle slow-motion ease curve
    const ease = 1 - Math.pow(1 - t, 2.4);
    const arcLift = Math.sin(t * Math.PI) * (-height * 0.055);

    const curX = arrowStartX + (endX - arrowStartX) * ease;
    const curY = arrowStartY + (endY - arrowStartY) * ease + arcLift;

    // Subtle sleek speed ribbon trail
    ctx.save();
    const grad = ctx.createLinearGradient(arrowStartX, arrowStartY, curX, curY);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(
      1,
      state.flightFromSide === 'red'
        ? 'rgba(248, 113, 113, 0.36)'
        : 'rgba(56, 189, 248, 0.36)'
    );
    ctx.strokeStyle = grad;
    ctx.lineWidth = 4 * arrowScaleBase;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(arrowStartX, arrowStartY);
    ctx.lineTo(curX, curY);
    ctx.stroke();
    ctx.restore();

    const aimTilt = Math.atan2(endX - arrowStartX, arrowStartY - endY) * 0.32;
    drawPerspectiveDart(
      ctx,
      curX,
      curY,
      arrowScaleBase * (1.34 - 0.56 * ease),
      state.flightFromSide,
      aimTilt,
      false
    );
  } else if (state.phase === 'aim_x' || state.phase === 'aim_y') {
    // 3D foreshortened dart always waits in front at the bottom, colored for the active turn
    const subtleAimTilt = state.aimX * 0.14;
    drawPerspectiveDart(
      ctx,
      arrowStartX,
      arrowStartY,
      arrowScaleBase * 1.34,
      state.activeSide,
      subtleAimTilt,
      false
    );
  }

  // 6. Turn Headers & Banners
  if (isBlueTurn && state.phase !== 'impact_zoom') {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const topFont = Math.max(24, Math.round(width * 0.072));
    ctx.font = `900 ${topFont}px Cairo, Tajawal, sans-serif`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(12, 34, 56, 0.65)';
    ctx.strokeText(state.activeLabel, boardCx, height * 0.095);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(state.activeLabel, boardCx, height * 0.095);
    ctx.restore();
  }

  // Player Turn Intro Bottom Semicircle ("دورك")
  if (state.phase === 'turn_intro') {
    const t = Math.min(1, state.turnIntroProgress);
    const slide = t < 0.25 ? t / 0.25 : t > 0.78 ? (1 - t) / 0.22 : 1;
    const ease = Math.sin((slide * Math.PI) / 2);
    const semiR = Math.min(width * 0.39, height * 0.22);
    const semiY = height + semiR * (1 - ease * 0.82);

    ctx.save();
    ctx.beginPath();
    ctx.arc(boardCx, semiY, semiR, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = state.activeSide === 'blue' ? '#4b98c7' : '#df795b';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.font = `900 ${Math.max(26, Math.round(width * 0.076))}px Cairo, Tajawal, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(state.activeLabel, boardCx, semiY - semiR * 0.34);
    ctx.restore();
  }

  // Impact Callout Pill during Zoom
  if (
    state.phase === 'impact_zoom' &&
    state.lastHit &&
    state.impactPopupAlpha > 0.02
  ) {
    ctx.save();
    ctx.globalAlpha = state.impactPopupAlpha;
    const label = state.lastHit.labelAr;
    const fontPx = Math.max(18, Math.round(width * 0.055));
    ctx.font = `900 ${fontPx}px Cairo, Tajawal, sans-serif`;
    const metrics = ctx.measureText(label);
    const pillW = Math.min(width - 40, metrics.width + 42);
    const pillH = 48;
    const px = boardCx - pillW / 2;
    const py = height * 0.76;

    ctx.beginPath();
    ctx.roundRect(px, py, pillW, pillH, 24);
    ctx.fillStyle = state.lastHit.isBust
      ? 'rgba(185, 28, 28, 0.94)'
      : state.lastHit.isCheckout
        ? 'rgba(217, 119, 6, 0.96)'
        : state.lastHit.ring === 'triple'
          ? 'rgba(126, 34, 206, 0.94)'
          : state.lastHit.ring === 'double'
            ? 'rgba(5, 150, 105, 0.94)'
            : 'rgba(15, 23, 42, 0.88)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, boardCx, py + pillH / 2 + 1);
    ctx.restore();
  }

  // 7. Countdown Overlay
  if (isCountdown) {
    ctx.save();
    ctx.fillStyle = 'rgba(9, 17, 29, 0.44)';
    ctx.fillRect(0, 0, width, height);

    const pillW = Math.min(width * 0.24, 92);
    const pillH = Math.min(height * 0.16, 148);
    ctx.beginPath();
    ctx.roundRect(
      boardCx - pillW / 2,
      boardCy + outerBoardR * 0.04,
      pillW,
      pillH,
      22
    );
    ctx.fillStyle = 'rgba(148, 163, 184, 0.34)';
    ctx.fill();

    const numFont = Math.round(Math.min(width * 0.34, 146));
    ctx.font = `900 ${numFont}px Cairo, Tajawal, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.fillText(
      String(state.countdownValue),
      boardCx,
      boardCy + outerBoardR * 0.08
    );
    ctx.restore();
  }
}
