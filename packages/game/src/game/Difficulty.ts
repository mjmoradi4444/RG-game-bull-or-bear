import { clamp } from '../engine/math';

/**
 * Time-based difficulty ramp. The chart scrolls faster and HIGH-SPREAD hazards
 * appear more often the longer a run lasts, so survival demands tighter timing.
 */
export class Difficulty {
  elapsed = 0;

  update(dt: number): void {
    this.elapsed += dt;
  }

  reset(): void {
    this.elapsed = 0;
  }

  /** Scroll-speed multiplier: 1.0 → ~2.2 over ~2.5 minutes. */
  get speedMul(): number {
    return 1 + clamp(this.elapsed / 150, 0, 1.2);
  }

  /** Probability a newly spawned candle is a HIGH-SPREAD hazard: 6% → 22%. */
  get hazardChance(): number {
    return clamp(0.06 + this.elapsed * 0.0012, 0.06, 0.22);
  }
}
