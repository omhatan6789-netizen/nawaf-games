import {
  BASELINE_OFFSET,
  BASELINE_SPAN_MAX,
  BASELINE_SPAN_MIN,
  BOARD_SIZE,
  CENTER,
  CarromDisc,
  INNER_MAX,
  INNER_MIN,
  POCKETS,
  POCKET_VISUAL_RADIUS,
} from './carromPhysics';

export interface ImpactSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface AimVisualState {
  active: boolean;
  pullX: number;
  pullY: number;
  powerNorm: number; // 0..1
  dirX: number;
  dirY: number;
  validPull: boolean;
}

export class CarromBoardRenderer {
  private staticBoardCanvas: HTMLCanvasElement | null = null;
  private staticDpr = 0;

  private ensureStaticBoard(dpr: number): HTMLCanvasElement {
    const targetPx = Math.round(BOARD_SIZE * dpr);
    if (
      this.staticBoardCanvas &&
      this.staticBoardCanvas.width === targetPx &&
      Math.abs(this.staticDpr - dpr) < 0.05
    ) {
      return this.staticBoardCanvas;
    }

    const off = document.createElement('canvas');
    off.width = targetPx;
    off.height = targetPx;
    const ctx = off.getContext('2d')!;
    ctx.scale(dpr, dpr);

    this.paintStaticBoard(ctx);
    this.staticBoardCanvas = off;
    this.staticDpr = dpr;
    return off;
  }

  private paintStaticBoard(ctx: CanvasRenderingContext2D) {
    // 1. Dark walnut outer frame matching reference photo
    const outerGrad = ctx.createLinearGradient(0, 0, BOARD_SIZE, BOARD_SIZE);
    outerGrad.addColorStop(0, '#5a3121');
    outerGrad.addColorStop(0.35, '#2b130c');
    outerGrad.addColorStop(0.7, '#432014');
    outerGrad.addColorStop(1, '#1d0b06');

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, BOARD_SIZE, BOARD_SIZE, 38);
    ctx.fillStyle = outerGrad;
    ctx.fill();

    // Inner bevel edge on walnut frame
    ctx.strokeStyle = '#75412b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(6, 6, BOARD_SIZE - 12, BOARD_SIZE - 12, 34);
    ctx.stroke();

    // Recessed shadow channel around playing surface
    const innerSize = INNER_MAX - INNER_MIN;
    ctx.beginPath();
    ctx.roundRect(INNER_MIN - 6, INNER_MIN - 6, innerSize + 12, innerSize + 12, 16);
    ctx.fillStyle = '#1b0b06';
    ctx.fill();

    // 2. Warm natural birch / maple wood playing surface
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(INNER_MIN, INNER_MIN, innerSize, innerSize, 12);
    ctx.clip();

    const woodGrad = ctx.createRadialGradient(
      CENTER - 40,
      CENTER - 40,
      60,
      CENTER,
      CENTER,
      540
    );
    woodGrad.addColorStop(0, '#ebcca2');
    woodGrad.addColorStop(0.55, '#dcb686');
    woodGrad.addColorStop(1, '#c3915e');
    ctx.fillStyle = woodGrad;
    ctx.fillRect(INNER_MIN, INNER_MIN, innerSize, innerSize);

    // Subtle organic wood grain waves
    ctx.globalAlpha = 0.085;
    for (let i = 0; i < 24; i++) {
      const y = INNER_MIN + 14 + i * 29;
      ctx.beginPath();
      ctx.moveTo(INNER_MIN, y);
      ctx.bezierCurveTo(
        INNER_MIN + 210,
        y - 10 + (i % 3) * 7,
        INNER_MIN + 480,
        y + 11 - (i % 4) * 5,
        INNER_MAX,
        y - 3
      );
      ctx.strokeStyle = i % 2 === 0 ? '#7c4b27' : '#fff2dc';
      ctx.lineWidth = i % 3 === 0 ? 1.8 : 1.1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Soft inner cushion vignette shadow
    const vig = ctx.createRadialGradient(CENTER, CENTER, 290, CENTER, CENTER, 515);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(0.84, 'rgba(62,28,12,0.08)');
    vig.addColorStop(1, 'rgba(38,14,5,0.34)');
    ctx.fillStyle = vig;
    ctx.fillRect(INNER_MIN, INNER_MIN, innerSize, innerSize);

    // 3. Center 8-point compass rose & concentric rings (exact reference geometry)
    this.paintCenterMedallion(ctx);

    // 4. Four Baseline tracks + Coral-terracotta end circles
    this.paintBaselines(ctx);

    // 5. Four Diagonal Foul Arrows with curved circular tails
    this.paintDiagonalArrows(ctx);

    // 6. Four Corner Pockets with cross-hatched net & dark recess
    for (const p of POCKETS) {
      this.paintPocket(ctx, p.x, p.y);
    }

    ctx.restore(); // end playing surface clip

    // 7. Polished Copper / Rose-Gold Corner Caps wrapping the 4 corners (like reference photo)
    this.paintCornerCaps(ctx);

    ctx.restore();
  }

  private paintCenterMedallion(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(CENTER, CENTER);

    // Outer circle sized for larger 20.5px Carrom pieces
    ctx.beginPath();
    ctx.arc(0, 0, 106, 0, Math.PI * 2);
    ctx.strokeStyle = '#6c4228';
    ctx.lineWidth = 2.8;
    ctx.stroke();

    // Subtle dark inner fill behind star
    ctx.beginPath();
    ctx.arc(0, 0, 104, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(130, 82, 49, 0.08)';
    ctx.fill();

    // 8-point compass star facets extending past the outer ring
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const tipR = i % 2 === 0 ? 128 : 114;
      const baseR = 28;
      const sideA = Math.PI / 8;

      ctx.save();
      ctx.rotate(a);

      // Left half of star spike (dark)
      ctx.beginPath();
      ctx.moveTo(0, -tipR);
      ctx.lineTo(-Math.sin(sideA) * baseR, -Math.cos(sideA) * baseR);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fillStyle = '#6f4328';
      ctx.fill();

      // Right half of star spike (light cream wood)
      ctx.beginPath();
      ctx.moveTo(0, -tipR);
      ctx.lineTo(Math.sin(sideA) * baseR, -Math.cos(sideA) * baseR);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fillStyle = '#e6c499';
      ctx.fill();

      // Crisp outline
      ctx.beginPath();
      ctx.moveTo(0, -tipR);
      ctx.lineTo(-Math.sin(sideA) * baseR, -Math.cos(sideA) * baseR);
      ctx.lineTo(0, 0);
      ctx.lineTo(Math.sin(sideA) * baseR, -Math.cos(sideA) * baseR);
      ctx.closePath();
      ctx.strokeStyle = '#5f371f';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();
    }

    // Center Queen seat circle
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#b9362f';
    ctx.fill();
    ctx.strokeStyle = '#5f371f';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  private paintBaselines(ctx: CanvasRenderingContext2D) {
    const outerOffset = BASELINE_OFFSET - 17;
    const innerOffset = BASELINE_OFFSET + 17;
    const farOuter = BOARD_SIZE - outerOffset;
    const farInner = BOARD_SIZE - innerOffset;

    const drawTrack = (
      x1o: number,
      y1o: number,
      x2o: number,
      y2o: number,
      x1i: number,
      y1i: number,
      x2i: number,
      y2i: number
    ) => {
      ctx.beginPath();
      ctx.moveTo(x1o, y1o);
      ctx.lineTo(x2o, y2o);
      ctx.strokeStyle = '#6f442a';
      ctx.lineWidth = 4.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x1i, y1i);
      ctx.lineTo(x2i, y2i);
      ctx.strokeStyle = '#805235';
      ctx.lineWidth = 2.2;
      ctx.stroke();
    };

    drawTrack(BASELINE_SPAN_MIN, outerOffset, BASELINE_SPAN_MAX, outerOffset, BASELINE_SPAN_MIN, innerOffset, BASELINE_SPAN_MAX, innerOffset);
    drawTrack(BASELINE_SPAN_MIN, farOuter, BASELINE_SPAN_MAX, farOuter, BASELINE_SPAN_MIN, farInner, BASELINE_SPAN_MAX, farInner);
    drawTrack(outerOffset, BASELINE_SPAN_MIN, outerOffset, BASELINE_SPAN_MAX, innerOffset, BASELINE_SPAN_MIN, innerOffset, BASELINE_SPAN_MAX);
    drawTrack(farOuter, BASELINE_SPAN_MIN, farOuter, BASELINE_SPAN_MAX, farInner, BASELINE_SPAN_MIN, farInner, BASELINE_SPAN_MAX);

    const endpoints: ReadonlyArray<[number, number]> = [
      [BASELINE_SPAN_MIN, BASELINE_OFFSET],
      [BASELINE_SPAN_MAX, BASELINE_OFFSET],
      [BASELINE_SPAN_MIN, BOARD_SIZE - BASELINE_OFFSET],
      [BASELINE_SPAN_MAX, BOARD_SIZE - BASELINE_OFFSET],
      [BASELINE_OFFSET, BASELINE_SPAN_MIN],
      [BASELINE_OFFSET, BASELINE_SPAN_MAX],
      [BOARD_SIZE - BASELINE_OFFSET, BASELINE_SPAN_MIN],
      [BOARD_SIZE - BASELINE_OFFSET, BASELINE_SPAN_MAX],
    ];

    for (const [ex, ey] of endpoints) {
      ctx.beginPath();
      ctx.arc(ex, ey, 23, 0, Math.PI * 2);
      ctx.fillStyle = '#dcb585';
      ctx.fill();
      ctx.strokeStyle = '#6f442a';
      ctx.lineWidth = 2.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(ex, ey, 17.5, 0, Math.PI * 2);
      ctx.fillStyle = '#d36f56';
      ctx.fill();
      ctx.strokeStyle = '#6f442a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  private paintDiagonalArrows(ctx: CanvasRenderingContext2D) {
    // 4 diagonal arrows pointing toward the 4 pockets with curved circular loops inside
    const corners: ReadonlyArray<{ sx: number; sy: number }> = [
      { sx: -1, sy: -1 },
      { sx: 1, sy: -1 },
      { sx: -1, sy: 1 },
      { sx: 1, sy: 1 },
    ];

    for (const { sx, sy } of corners) {
      const startX = CENTER + sx * 158;
      const startY = CENTER + sy * 158;
      const endX = CENTER + sx * 280;
      const endY = CENTER + sy * 280;

      ctx.save();
      ctx.strokeStyle = '#6d4329';
      ctx.fillStyle = '#6d4329';
      ctx.lineWidth = 2.3;
      ctx.lineCap = 'round';

      // Straight diagonal shaft
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // Pocket-facing arrowhead
      const angle = Math.atan2(sy, sx);
      ctx.save();
      ctx.translate(endX, endY);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-9, -6.5);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-9, 6.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Small ring at the crossing between the two baseline circles
      const crossX = CENTER + sx * 234;
      const crossY = CENTER + sy * 234;
      ctx.beginPath();
      ctx.arc(crossX, crossY, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = '#dcb585';
      ctx.fill();
      ctx.strokeStyle = '#6d4329';
      ctx.lineWidth = 1.9;
      ctx.stroke();

      // Curved open circular arrow at the inner end (exact Carrom foul arc motif)
      const loopCx = CENTER + sx * 176;
      const loopCy = CENTER + sy * 176;
      const loopR = 30;
      const baseA = Math.atan2(-sy, -sx); // pointing back toward center
      const startA = baseA - 1.35 * Math.PI * 0.55;
      const endA = baseA + 1.35 * Math.PI * 0.55;

      ctx.beginPath();
      ctx.arc(loopCx, loopCy, loopR, startA, endA);
      ctx.strokeStyle = '#6d4329';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Arrowheads at both tips of the curved loop
      for (const tipAngle of [startA, endA]) {
        const tx = loopCx + Math.cos(tipAngle) * loopR;
        const ty = loopCy + Math.sin(tipAngle) * loopR;
        const tangent = tipAngle === endA ? tipAngle + Math.PI / 2 : tipAngle - Math.PI / 2;
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(tangent);
        ctx.beginPath();
        ctx.moveTo(4.5, 0);
        ctx.lineTo(-4, -3.5);
        ctx.lineTo(-4, 3.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    }
  }

  private paintPocket(ctx: CanvasRenderingContext2D, px: number, py: number) {
    ctx.save();

    // Recessed rim shadow
    ctx.beginPath();
    ctx.arc(px, py, POCKET_VISUAL_RADIUS + 4, 0, Math.PI * 2);
    ctx.fillStyle = '#3b1e10';
    ctx.fill();

    // Deep pocket pit
    const pitGrad = ctx.createRadialGradient(px, py, 6, px, py, POCKET_VISUAL_RADIUS);
    pitGrad.addColorStop(0, '#050302');
    pitGrad.addColorStop(0.75, '#0d0705');
    pitGrad.addColorStop(1, '#1d100a');
    ctx.beginPath();
    ctx.arc(px, py, POCKET_VISUAL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = pitGrad;
    ctx.fill();

    // Cross-hatched nylon/leather net mesh inside the pocket (like reference photo)
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, POCKET_VISUAL_RADIUS - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(130, 86, 56, 0.36)';
    ctx.lineWidth = 1.6;
    for (let k = -48; k <= 48; k += 10) {
      ctx.beginPath();
      ctx.moveTo(px - 42, py + k);
      ctx.lineTo(px + 42, py + k + 42);
      ctx.moveTo(px - 42, py + k + 42);
      ctx.lineTo(px + 42, py + k);
      ctx.stroke();
    }
    ctx.restore();

    // Inner pocket lip highlight
    ctx.beginPath();
    ctx.arc(px, py, POCKET_VISUAL_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = '#532d19';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.restore();
  }

  private paintCornerCaps(ctx: CanvasRenderingContext2D) {
    // Copper / Rose-Gold metallic corner guards wrapping all 4 outer corners
    const capArm = 112;
    const capThick = 34;

    const corners: ReadonlyArray<{ x: number; y: number; sx: number; sy: number }> = [
      { x: 0, y: 0, sx: 1, sy: 1 },
      { x: BOARD_SIZE, y: 0, sx: -1, sy: 1 },
      { x: 0, y: BOARD_SIZE, sx: 1, sy: -1 },
      { x: BOARD_SIZE, y: BOARD_SIZE, sx: -1, sy: -1 },
    ];

    for (const c of corners) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(c.sx, c.sy);

      const copperGrad = ctx.createLinearGradient(0, 0, 95, 95);
      copperGrad.addColorStop(0, '#f3c39e');
      copperGrad.addColorStop(0.32, '#cf885e');
      copperGrad.addColorStop(0.65, '#8f4c2c');
      copperGrad.addColorStop(1, '#e09d74');

      // L-shaped rounded corner cap hugging the outer frame corner
      ctx.beginPath();
      ctx.moveTo(0, 38);
      ctx.quadraticCurveTo(0, 0, 38, 0);
      ctx.lineTo(capArm, 0);
      ctx.quadraticCurveTo(capArm + 8, 0, capArm + 8, 10);
      ctx.lineTo(capArm + 8, capThick - 6);
      ctx.quadraticCurveTo(capArm + 8, capThick, capArm - 4, capThick);
      ctx.lineTo(68, capThick);
      ctx.quadraticCurveTo(36, 36, capThick, 68);
      ctx.lineTo(capThick, capArm - 4);
      ctx.quadraticCurveTo(capThick, capArm + 8, capThick - 6, capArm + 8);
      ctx.lineTo(10, capArm + 8);
      ctx.quadraticCurveTo(0, capArm + 8, 0, capArm);
      ctx.closePath();

      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = copperGrad;
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(255, 224, 198, 0.5)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.restore();
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    dpr: number,
    state: {
      coins: CarromDisc[];
      striker: CarromDisc | null;
      strikerOverlapping: boolean;
      canInteract: boolean;
      aim: AimVisualState | null;
      sparks: ImpactSpark[];
      flip?: boolean;
    }
  ) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state.flip) {
      ctx.translate(BOARD_SIZE, BOARD_SIZE);
      ctx.rotate(Math.PI);
    }
    ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);

    // Draw pre-rendered Carrom board
    const boardImg = this.ensureStaticBoard(dpr);
    ctx.drawImage(boardImg, 0, 0, BOARD_SIZE, BOARD_SIZE);

    // Draw pocket-dropping animation pieces
    for (const c of state.coins) {
      if (c.pocketed && c.pocketAnim !== undefined && c.pocketAnim < 1 && c.pocketTarget) {
        if (c.kind === 'striker') continue;
        const scale = Math.max(0.1, 1 - c.pocketAnim);
        const px = c.x + (c.pocketTarget.x - c.x) * c.pocketAnim;
        const py = c.y + (c.pocketTarget.y - c.y) * c.pocketAnim;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - c.pocketAnim * 0.9);
        ctx.translate(px, py);
        ctx.scale(scale, scale);
        this.drawDiscShape(ctx, c.kind, c.radius);
        ctx.restore();
      }
    }

    // Draw active coins on board
    for (const c of state.coins) {
      if (c.pocketed || c.kind === 'striker') continue;
      ctx.save();
      ctx.translate(c.x, c.y);
      this.drawDiscShape(ctx, c.kind, c.radius);
      ctx.restore();
    }

    // Draw Aiming Arrow & Trajectory Preview under Striker
    if (state.aim && state.aim.active && state.striker && !state.striker.pocketed) {
      this.drawAimOverlay(ctx, state.striker, state.aim, state.coins);
    }

    // Draw Striker
    if (state.striker) {
      if (
        state.striker.pocketed &&
        state.striker.pocketAnim !== undefined &&
        state.striker.pocketAnim < 1 &&
        state.striker.pocketTarget
      ) {
        const scale = Math.max(0.1, 1 - state.striker.pocketAnim);
        const px =
          state.striker.x + (state.striker.pocketTarget.x - state.striker.x) * state.striker.pocketAnim;
        const py =
          state.striker.y + (state.striker.pocketTarget.y - state.striker.y) * state.striker.pocketAnim;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - state.striker.pocketAnim * 0.9);
        ctx.translate(px, py);
        ctx.scale(scale, scale);
        this.drawStrikerShape(ctx, state.striker.radius, false, false);
        ctx.restore();
      } else if (!state.striker.pocketed) {
        ctx.save();
        ctx.translate(state.striker.x, state.striker.y);
        this.drawStrikerShape(
          ctx,
          state.striker.radius,
          state.strikerOverlapping,
          state.canInteract && !state.aim?.active
        );
        ctx.restore();
      }
    }

    // Impact sparks
    for (const sp of state.sparks) {
      const alpha = Math.max(0, sp.life / sp.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size * alpha, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  private drawDiscShape(
    ctx: CanvasRenderingContext2D,
    kind: 'white' | 'black' | 'queen',
    r: number
  ) {
    // Realistic cast shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetX = 1.5;
    ctx.shadowOffsetY = 3.5;

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);

    if (kind === 'queen') {
      // VIVID, OPAQUE, SOLID RUBY-CRIMSON RED QUEEN (explicitly requested: أحمر وواضح أكثر مب شفاف!)
      const qGrad = ctx.createRadialGradient(-r * 0.32, -r * 0.35, r * 0.08, 0, 0, r);
      qGrad.addColorStop(0, '#ff4d5e');
      qGrad.addColorStop(0.28, '#e60c22');
      qGrad.addColorStop(0.75, '#b80014');
      qGrad.addColorStop(1, '#75000c');
      ctx.fillStyle = qGrad;
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // Crisp outer bevel rim
      ctx.strokeStyle = '#ff8a95';
      ctx.lineWidth = 1.3;
      ctx.stroke();

      // Turned concentric groove rings
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(85, 0, 8, 0.6)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, r * 0.56, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 190, 195, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Crisp subtle crown emblem in center
      ctx.fillStyle = '#ffe4e6';
      ctx.font = 'bold 17px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♛', 0, 1.5);
      return;
    }

    if (kind === 'black') {
      const bGrad = ctx.createRadialGradient(-r * 0.32, -r * 0.35, r * 0.1, 0, 0, r);
      bGrad.addColorStop(0, '#4f4e52');
      bGrad.addColorStop(0.32, '#222124');
      bGrad.addColorStop(0.76, '#0d0d0f');
      bGrad.addColorStop(1, '#030304');
      ctx.fillStyle = bGrad;
      ctx.fill();
      ctx.shadowColor = 'transparent';

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1.1;
      ctx.stroke();

      // Concentric turned grooves matching reference image
      for (const frac of [0.74, 0.52, 0.28]) {
        ctx.beginPath();
        ctx.arc(0, 0, r * frac, 0, Math.PI * 2);
        ctx.strokeStyle =
          frac === 0.52 ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      return;
    }

    // White / Ivory carrom piece matching reference image
    const wGrad = ctx.createRadialGradient(-r * 0.32, -r * 0.35, r * 0.1, 0, 0, r);
    wGrad.addColorStop(0, '#ffffff');
    wGrad.addColorStop(0.45, '#f4efe6');
    wGrad.addColorStop(0.82, '#dfd5c5');
    wGrad.addColorStop(1, '#b8ab98');
    ctx.fillStyle = wGrad;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    ctx.strokeStyle = '#a89984';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Concentric turned grooves
    for (const frac of [0.74, 0.52, 0.28]) {
      ctx.beginPath();
      ctx.arc(0, 0, r * frac, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(138, 120, 96, 0.45)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
  }

  private drawStrikerShape(
    ctx: CanvasRenderingContext2D,
    r: number,
    overlapping: boolean,
    readyGlow: boolean
  ) {
    // Active ready halo or overlap error ring
    if (overlapping) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else if (readyGlow) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }

    // Drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.48)';
    ctx.shadowBlur = 9;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 4;

    // Gorgeous jewel-toned Emerald-Gold / Royal Turquoise Tournament Striker
    const sGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    if (overlapping) {
      sGrad.addColorStop(0, '#fca5a5');
      sGrad.addColorStop(0.5, '#dc2626');
      sGrad.addColorStop(1, '#7f1d1d');
    } else {
      sGrad.addColorStop(0, '#a7f3d0');
      sGrad.addColorStop(0.28, '#10b981');
      sGrad.addColorStop(0.68, '#047857');
      sGrad.addColorStop(1, '#064e3b');
    }

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = sGrad;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Gold outer tournament rim
    ctx.strokeStyle = overlapping ? '#fecaca' : '#fde68a';
    ctx.lineWidth = 2.6;
    ctx.stroke();

    // Inner gold inlaid ring
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2);
    ctx.strokeStyle = overlapping ? '#fee2e2' : '#f59e0b';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Decorative 8-point striker star motif
    ctx.save();
    ctx.strokeStyle = overlapping ? 'rgba(255,255,255,0.65)' : 'rgba(254, 243, 199, 0.85)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * -r * 0.56, Math.sin(a) * -r * 0.56);
      ctx.lineTo(Math.cos(a) * r * 0.56, Math.sin(a) * r * 0.56);
      ctx.stroke();
    }
    ctx.restore();

    // Pearl center jewel
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = overlapping ? '#fee2e2' : '#fef3c7';
    ctx.fill();
    ctx.strokeStyle = overlapping ? '#b91c1c' : '#b45309';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  private drawAimOverlay(
    ctx: CanvasRenderingContext2D,
    striker: CarromDisc,
    aim: AimVisualState,
    _coins: CarromDisc[]
  ) {
    const sx = striker.x;
    const sy = striker.y;
    const power = aim.powerNorm;
    const angle = Math.atan2(aim.dirY, aim.dirX);

    // Sleek Carrom power palette (Emerald -> Amber Gold -> Ruby Red)
    const primaryColor =
      power < 0.42 ? '#10b981' : power < 0.76 ? '#f59e0b' : '#ef4444';
    const lightColor =
      power < 0.42 ? '#a7f3d0' : power < 0.76 ? '#fef08a' : '#fecaca';
    const darkColor =
      power < 0.42 ? '#065f46' : power < 0.76 ? '#92400e' : '#991b1b';

    ctx.save();

    // 1. Circular Carrom power aura + radial progress arc around striker
    const haloR = striker.radius + 11 + power * 18;
    ctx.beginPath();
    ctx.arc(sx, sy, haloR, 0, Math.PI * 2);
    ctx.fillStyle = `${primaryColor}20`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (aim.validPull) {
      const arcSpan = Math.max(0.25, power * Math.PI * 2);
      ctx.beginPath();
      ctx.arc(sx, sy, haloR, angle - arcSpan * 0.5, angle + arcSpan * 0.5);
      ctx.strokeStyle = lightColor;
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // 2. Clean short pull-back grip handle behind striker
    const pullDx = aim.pullX - sx;
    const pullDy = aim.pullY - sy;
    const pullLen = Math.hypot(pullDx, pullDy);
    if (pullLen > striker.radius * 0.5) {
      const ux = pullDx / pullLen;
      const uy = pullDy / pullLen;
      const startPullX = sx + ux * (striker.radius + 4);
      const startPullY = sy + uy * (striker.radius + 4);

      ctx.beginPath();
      ctx.moveTo(startPullX, startPullY);
      ctx.lineTo(aim.pullX, aim.pullY);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(aim.pullX, aim.pullY, 10, 0, Math.PI * 2);
      ctx.fillStyle = lightColor;
      ctx.fill();
      ctx.strokeStyle = darkColor;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // 3. Sculpted Carrom Aiming Arrow (replaces billiards dotted raycast & ghost ball)
    if (aim.validPull) {
      const startOffset = striker.radius + 9;
      const shaftLen = 36 + power * 135;
      const headLen = 26 + power * 8;
      const headHalfW = 14 + power * 4;
      const tailHalfW = 4.5;
      const neckHalfW = 8.5 + power * 2;

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(angle);

      const x0 = startOffset;
      const xNeck = x0 + shaftLen;
      const xTip = xNeck + headLen;

      // Arrow silhouette path (tapered shaft + clean Carrom arrowhead)
      ctx.beginPath();
      ctx.moveTo(x0, -tailHalfW);
      ctx.lineTo(xNeck, -neckHalfW);
      ctx.lineTo(xNeck - 3, -headHalfW);
      ctx.lineTo(xTip, 0);
      ctx.lineTo(xNeck - 3, headHalfW);
      ctx.lineTo(xNeck, neckHalfW);
      ctx.lineTo(x0, tailHalfW);
      ctx.closePath();

      // Drop shadow for crisp separation from wood grain and pieces
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;

      const arrowGrad = ctx.createLinearGradient(x0, 0, xTip, 0);
      arrowGrad.addColorStop(0, primaryColor);
      arrowGrad.addColorStop(0.65, lightColor);
      arrowGrad.addColorStop(1, '#ffffff');
      ctx.fillStyle = arrowGrad;
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = darkColor;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Inner glowing chevrons inside the arrow shaft
      const chevronCount = power < 0.35 ? 1 : power < 0.72 ? 2 : 3;
      ctx.strokeStyle = darkColor;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < chevronCount; i++) {
        const cxPos = x0 + ((i + 1) / (chevronCount + 1)) * shaftLen;
        ctx.beginPath();
        ctx.moveTo(cxPos - 5, -5.5);
        ctx.lineTo(cxPos + 2, 0);
        ctx.lineTo(cxPos - 5, 5.5);
        ctx.stroke();
      }

      ctx.restore();
    }

    ctx.restore();
  }
}
