class CarromSoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;
  private lastClackAt = 0;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlock() {
    this.ensureContext();
  }

  public playClack(intensity = 0.6) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastClackAt < 0.022) return;
    this.lastClackAt = now;

    const gainVal = Math.max(0.03, Math.min(0.32, intensity * 0.28));

    // Woody resonant click
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = 720 + intensity * 440 + (Math.random() - 0.5) * 90;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(210, now + 0.045);

    g.gain.setValueAtTime(gainVal, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playWall(intensity = 0.5) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastClackAt < 0.025) return;
    this.lastClackAt = now;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260 + intensity * 120, now);
    osc.frequency.exponentialRampToValueAtTime(85, now + 0.065);
    g.gain.setValueAtTime(Math.max(0.03, intensity * 0.24), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.075);
  }

  public playPocket(isQueen = false, isStriker = false) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (isStriker) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.24);
      g.gain.setValueAtTime(0.14, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(g).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
      return;
    }

    const notes = isQueen ? [523.25, 659.25, 783.99, 1046.5] : [340, 490];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = isQueen ? 'triangle' : 'sine';
      const t0 = now + i * 0.055;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(isQueen ? 0.14 : 0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    });
  }

  public playShoot(powerNorm = 0.6) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190 + powerNorm * 140, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.07);
    g.gain.setValueAtTime(0.12 + powerNorm * 0.1, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.085);
  }

  public playVictory(isWin = true) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = isWin
      ? [523.25, 659.25, 783.99, 1046.5]
      : [392, 349.23, 311.13, 261.63];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      const t0 = now + i * 0.095;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.15, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.34);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.36);
    });
  }
}

export const carromSound = new CarromSoundEngine();
