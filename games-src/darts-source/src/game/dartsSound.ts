import type { DartRing } from './dartsTypes';

class DartsSoundEngine {
  private ctx: AudioContext | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  unlock(): void {
    this.ensureContext();
  }

  playCountdownTick(step: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const freq = step === 1 ? 660 : 520;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.85, now + 0.11);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  playStartCue(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.055;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.21);
    });
  }

  playTurnIntro(isYourTurn: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    if (isYourTurn) {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.14);
    } else {
      osc.frequency.setValueAtTime(392, now);
      osc.frequency.exponentialRampToValueAtTime(311, now + 0.14);
    }
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  playAimLock(axis: 'x' | 'y'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(axis === 'x' ? 760 : 940, now);
    osc.frequency.exponentialRampToValueAtTime(axis === 'x' ? 540 : 680, now + 0.055);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.075);
  }

  playDartWhoosh(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 0.2);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(750, now);
    filter.frequency.exponentialRampToValueAtTime(1950, now + 0.15);
    filter.Q.value = 1.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.2);
  }

  playDartImpact(ring: DartRing, isBust: boolean, isCheckout: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Sisal board thud
    const thudOsc = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thudOsc.type = 'sine';
    thudOsc.frequency.setValueAtTime(ring === 'miss' ? 110 : 175, now);
    thudOsc.frequency.exponentialRampToValueAtTime(52, now + 0.085);
    thudGain.gain.setValueAtTime(0.28, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    thudOsc.connect(thudGain);
    thudGain.connect(ctx.destination);
    thudOsc.start(now);
    thudOsc.stop(now + 0.11);

    if (isBust || ring === 'miss') {
      // Soft downward buzz
      const buzz = ctx.createOscillator();
      const bg = ctx.createGain();
      buzz.type = 'sawtooth';
      buzz.frequency.setValueAtTime(210, now + 0.04);
      buzz.frequency.exponentialRampToValueAtTime(135, now + 0.24);
      bg.gain.setValueAtTime(0.001, now + 0.04);
      bg.gain.linearRampToValueAtTime(0.09, now + 0.06);
      bg.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      buzz.connect(bg);
      bg.connect(ctx.destination);
      buzz.start(now + 0.04);
      buzz.stop(now + 0.27);
      return;
    }

    if (isCheckout || ring === 'inner_bull' || ring === 'triple' || ring === 'double') {
      const notes =
        isCheckout
          ? [523.25, 659.25, 783.99, 1046.5]
          : ring === 'inner_bull'
            ? [587.33, 880, 1174.66]
            : ring === 'triple'
              ? [523.25, 659.25, 783.99]
              : [493.88, 659.25];
      notes.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        const t = now + 0.03 + idx * 0.055;
        osc.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.14, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.25);
      });
    } else {
      // Clean single pop
      const chime = ctx.createOscillator();
      const cg = ctx.createGain();
      chime.type = 'sine';
      chime.frequency.setValueAtTime(ring === 'outer_bull' ? 740 : 587, now + 0.03);
      cg.gain.setValueAtTime(0.001, now + 0.03);
      cg.gain.linearRampToValueAtTime(0.11, now + 0.045);
      cg.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      chime.connect(cg);
      cg.connect(ctx.destination);
      chime.start(now + 0.03);
      chime.stop(now + 0.17);
    }
  }

  playVictory(won: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const seq = won
      ? [523.25, 659.25, 783.99, 1046.5, 1318.5]
      : [392.0, 349.23, 311.13, 261.63];

    seq.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = won ? 'triangle' : 'sine';
      const t = now + i * 0.09;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  }
}

export const dartsSound = new DartsSoundEngine();
