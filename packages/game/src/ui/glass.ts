/**
 * Frosted-glass surface treatment, drawn on the 2D canvas.
 *
 * A soft drop shadow, a subtle vertical white gradient, a top sheen, and a thin
 * light border. Used first as the plate behind the brand lockup (so the dark navy
 * "Rebate Gain" wordmark reads against the dark game background) and reused for the
 * HUD and game-over cards in later phases.
 */

export interface GlassOptions {
  fillTop?: string;
  fillBottom?: string;
  border?: string;
  shadow?: boolean;
}

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawGlassPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  opts: GlassOptions = {},
): void {
  const {
    fillTop = 'rgba(255,255,255,0.97)',
    fillBottom = 'rgba(234,240,251,0.93)',
    border = 'rgba(255,255,255,0.75)',
    shadow = true,
  } = opts;

  // 1) Soft drop shadow + base fill.
  ctx.save();
  if (shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
  }
  roundRectPath(ctx, x, y, w, h, r);
  const base = ctx.createLinearGradient(0, y, 0, y + h);
  base.addColorStop(0, fillTop);
  base.addColorStop(1, fillBottom);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.restore();

  // 2) Top sheen — faint white highlight along the upper half (clipped to panel).
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
  sheen.addColorStop(0, 'rgba(255,255,255,0.6)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h * 0.55);
  ctx.restore();

  // 3) Thin light border for the crisp glass edge.
  ctx.save();
  roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.lineWidth = 1;
  ctx.strokeStyle = border;
  ctx.stroke();
  ctx.restore();
}
