/**
 * Owns the canvas, its 2D context, and device-pixel-ratio-aware sizing.
 *
 * The backing store is sized to physical pixels (crisp on retina / high-DPI
 * phones) while all game code draws in CSS pixels via a base transform. Safe-area
 * insets are stubbed at 0 here and wired to real env(safe-area-inset-*) values in
 * the Phase 6 webview/safe-area pass.
 */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export class Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  w = 0;
  h = 0;
  dpr = 1;
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  private onResizeCb?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    window.addEventListener('resize', this.handleResize, { passive: true });
    this.handleResize();
  }

  onResize(cb: () => void): void {
    this.onResizeCb = cb;
  }

  /** Reset the base transform so every frame draws in CSS-pixel space. */
  begin(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private handleResize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.onResizeCb?.();
  };
}
