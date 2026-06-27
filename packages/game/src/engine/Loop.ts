/**
 * Fixed-timestep game loop with a render interpolation alpha.
 *
 * Physics/gameplay advance in fixed `step` increments (stable, deterministic),
 * while rendering runs every animation frame. dt is clamped so a backgrounded
 * tab can't accumulate a huge catch-up burst ("spiral of death").
 */
export class Loop {
  private rafId = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private paused = false;

  constructor(
    private readonly step: number,
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    // Reset the clock on resume so the gap doesn't register as one giant dt.
    if (!paused) this.last = performance.now();
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);
    if (this.paused) return;

    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;

    this.acc += dt;
    while (this.acc >= this.step) {
      this.update(this.step);
      this.acc -= this.step;
    }
    this.render(this.acc / this.step);
  };
}
