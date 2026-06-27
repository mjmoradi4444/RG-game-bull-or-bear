import { colors, fonts } from '../brand/tokens';
import { roundRectPath } from './glass';

/**
 * Minimal canvas button: a layout record that both the renderer and the tap
 * hit-test share, so what's drawn is exactly what's clickable. Three brand styles:
 *  - primary: brand blue gradient (the sign-up CTA — the one we want tapped),
 *  - gold:    rebate gold (Play Again),
 *  - ghost:   outline (secondary actions).
 */
export type ButtonKind = 'primary' | 'gold' | 'ghost';

export interface Button {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: ButtonKind;
}

export function hitButton(buttons: readonly Button[], px: number, py: number): string | null {
  for (const b of buttons) {
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.id;
  }
  return null;
}

export function drawButton(ctx: CanvasRenderingContext2D, b: Button): void {
  const r = Math.min(13, b.h / 2);
  roundRectPath(ctx, b.x, b.y, b.w, b.h, r);

  let textColor: string = colors.text;
  if (b.kind === 'primary') {
    ctx.save();
    ctx.shadowColor = 'rgba(10,120,255,0.45)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 5;
    const g = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
    g.addColorStop(0, colors.brandBlueFrom);
    g.addColorStop(1, colors.brandBlueTo);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  } else if (b.kind === 'gold') {
    const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    g.addColorStop(0, colors.rebateGoldLight);
    g.addColorStop(1, colors.rebateGold);
    ctx.fillStyle = g;
    ctx.fill();
    textColor = '#101830';
  } else {
    ctx.fillStyle = 'rgba(40,49,84,0.4)';
    ctx.fill();
    roundRectPath(ctx, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, r);
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.border;
    ctx.stroke();
  }

  ctx.fillStyle = textColor;
  ctx.font = `${fonts.weight.bold} ${Math.min(15, b.h * 0.42)}px ${fonts.family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
  ctx.textBaseline = 'alphabetic';
}
