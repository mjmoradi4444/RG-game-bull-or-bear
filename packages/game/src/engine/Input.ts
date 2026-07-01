/**
 * Unifies pointer, touch, and keyboard into high-level intents:
 *  - a "fire" tap (tap / click / Space / Enter), consumed once per update tick;
 *  - chart gestures: one-finger drag → pan, two-finger pinch → zoom, wheel → zoom.
 *
 * Mobile-first: the game is played on phones, so pan/zoom are pinch + drag on touch
 * (wheel + drag on desktop). A tap only fires if the pointer didn't move (so a drag
 * or pinch never triggers a BUY/SELL by accident). Also exposes the pointer position
 * and a one-time "first gesture" hook (used to unlock WebAudio).
 */
const TAP_SLOP = 8; // px of movement below which a press still counts as a tap

interface PointerState {
  x: number;
  y: number;
}

export class Input {
  pointerX = 0;
  pointerY = 0;

  private fireQueued = false;
  private firstGestureCbs: Array<() => void> = [];

  private readonly pointers = new Map<number, PointerState>();
  private downX = 0;
  private downY = 0;
  private moved = false;
  private pinchDist = 0;

  // Gesture accumulators, drained by takeGesture() each update tick.
  private panDx = 0;
  private zoomFactor = 1;

  constructor(target: HTMLElement) {
    // Stop the browser from scrolling/zooming the page during chart gestures.
    target.style.touchAction = 'none';
    target.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    target.addEventListener('pointermove', this.onPointerMove, { passive: false });
    target.addEventListener('pointerup', this.onPointerUp, { passive: true });
    target.addEventListener('pointercancel', this.onPointerUp, { passive: true });
    target.addEventListener('wheel', this.onWheel, { passive: false });
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

  /** Drain accumulated chart gestures since the last call. */
  takeGesture(): { panDx: number; zoomFactor: number } {
    const g = { panDx: this.panDx, zoomFactor: this.zoomFactor };
    this.panDx = 0;
    this.zoomFactor = 1;
    return g;
  }

  private flushFirstGesture(): void {
    if (this.firstGestureCbs.length === 0) return;
    for (const cb of this.firstGestureCbs) cb();
    this.firstGestureCbs = [];
  }

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    if (this.pointers.size === 1) {
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.moved = false;
    } else if (this.pointers.size === 2) {
      this.pinchDist = this.currentPinchDist();
    }
    this.flushFirstGesture();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      // Not pressed — just track position (desktop hover).
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      return;
    }
    const prevX = p.x;
    p.x = e.clientX;
    p.y = e.clientY;
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;

    if (this.pointers.size >= 2) {
      // Pinch → zoom.
      e.preventDefault();
      const d = this.currentPinchDist();
      if (this.pinchDist > 0 && d > 0) this.zoomFactor *= d / this.pinchDist;
      this.pinchDist = d;
      this.moved = true;
      return;
    }
    // One finger → pan.
    this.panDx += e.clientX - prevX;
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > TAP_SLOP) this.moved = true;
    e.preventDefault();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    // A stationary single-pointer press is a tap → fire.
    if (wasSingle && !this.moved) {
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      this.fireQueued = true;
    }
    if (this.pointers.size === 2) this.pinchDist = this.currentPinchDist();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Wheel up (negative deltaY) zooms in.
    this.zoomFactor *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.flushFirstGesture();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      this.fireQueued = true;
      this.flushFirstGesture();
    }
  };

  private currentPinchDist(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
  }
}
