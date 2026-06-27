/**
 * Unifies pointer, touch, and keyboard into one high-level intent: "fire a trade".
 * Tap anywhere / click / Space / Enter all queue a single fire, consumed once per
 * update tick. Also tracks the pointer position and exposes a one-time
 * "first gesture" hook (used to unlock WebAudio, which browsers gate behind a
 * user gesture).
 */
export class Input {
  pointerX = 0;
  pointerY = 0;

  private fireQueued = false;
  private firstGestureCbs: Array<() => void> = [];

  constructor(target: HTMLElement) {
    target.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    target.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Run a callback exactly once, on the first user gesture. */
  onFirstGesture(cb: () => void): void {
    this.firstGestureCbs.push(cb);
  }

  /** Returns true at most once per fire; resets the queued flag. */
  consumeFire(): boolean {
    if (!this.fireQueued) return false;
    this.fireQueued = false;
    return true;
  }

  private flushFirstGesture(): void {
    if (this.firstGestureCbs.length === 0) return;
    for (const cb of this.firstGestureCbs) cb();
    this.firstGestureCbs = [];
  }

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.fireQueued = true;
    this.flushFirstGesture();
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      this.fireQueued = true;
      this.flushFirstGesture();
    }
  };
}
