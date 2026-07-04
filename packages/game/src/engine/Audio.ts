/**
 * Tiny WebAudio synth for SFX — no audio files, so it costs ~0 bytes of bundle and
 * never blocks first paint. The context is created lazily on the first user
 * gesture (browsers require this) and everything routes through a master gain so
 * mute is instant. Sampled SFX can replace these later if desired.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  /** Create/resume the context. Call from the first user gesture. */
  resume(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** A single enveloped oscillator tone, optionally pitch-sliding to `slideTo`. */
  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    slideTo?: number,
  ): void {
    if (this.muted || !this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + duration);
    }
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(env).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration);
  }

  /** Bright rising ping — the rebate coin landing in the jar (the hero sound). */
  coin(): void {
    this.tone(880, 0.12, 'triangle', 0.22, 1320);
  }

  /** Short pleasant blip — a winning trade. */
  win(): void {
    this.tone(523.25, 0.1, 'sine', 0.18, 659.25);
  }

  /** Low buzz — a losing trade. */
  loss(): void {
    this.tone(170, 0.18, 'sawtooth', 0.16, 90);
  }

  /** Soft clock tick — the last seconds of the decision countdown. */
  tick(): void {
    this.tone(1250, 0.05, 'square', 0.05);
  }
}
