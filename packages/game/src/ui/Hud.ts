import type { Viewport } from '../engine/Viewport';
import { colors, fonts } from '../brand/tokens';
import { clamp, TAU } from '../engine/math';
import { drawGlassPanel, roundRectPath } from './glass';

/**
 * The in-game HUD — and the brand lesson rendered on screen.
 *
 *  - LEFT: the volatile P&L meter. Green when up, red when down, can go negative,
 *    flashes red on a loss. Cosmetic; never the score.
 *  - RIGHT: the rebate jar. Gold, fills as you climb broker tiers, and only ever
 *    rises. The hero element — coins fly into it on every trade.
 *
 * Render-only: all values are passed in as a snapshot each frame.
 */

export interface HudState {
  rebate: number;
  pnl: number;
  pnlFlash: number;
  combo: number;
  comboMul: number;
  lives: number;
  maxLives: number;
  tierName: string;
  tierMul: number;
  tierProgress: number;
  cooldown: number;
  jarBump: number;
  toastText: string | null;
  toastT: number;
}

interface JarRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Hud {
  private static jarRect(vp: Viewport): JarRect {
    const w = Math.min(vp.w * 0.15, 56);
    const h = w * 1.3;
    return { x: vp.w - 16 - w, y: 44, w, h };
  }

  /** Centre of the jar — where rebate coins fly to. */
  static jarPos(vp: Viewport): { x: number; y: number } {
    const r = Hud.jarRect(vp);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  render(ctx: CanvasRenderingContext2D, vp: Viewport, s: HudState): void {
    this.renderPnl(ctx, vp, s);
    this.renderRebate(ctx, vp, s);
    this.renderLives(ctx, vp, s);
    this.renderCombo(ctx, vp, s);
    this.renderCooldown(ctx, vp, s);
    this.renderToast(ctx, vp, s);
  }

  private renderPnl(ctx: CanvasRenderingContext2D, _vp: Viewport, s: HudState): void {
    const x = 16;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
    ctx.fillText('P&L', x, 28);

    const positive = s.pnl >= 0;
    const col = positive ? colors.up : colors.down;
    const value = `${positive ? '+' : '-'}$${Math.abs(Math.round(s.pnl))}`;
    ctx.fillStyle = col;
    ctx.font = `${fonts.weight.black} 24px ${fonts.family}`;
    ctx.fillText(value, x, 54);

    // Slim volatility bar: grows right (green) / left (red) from a centre pivot.
    const barW = 120;
    const pivot = x + barW / 2;
    const by = 64;
    ctx.fillStyle = 'rgba(40,49,84,0.7)';
    roundRectPath(ctx, x, by, barW, 4, 2);
    ctx.fill();
    const mag = clamp(Math.abs(s.pnl) / 600, 0, 1) * (barW / 2);
    ctx.fillStyle = col;
    if (positive) roundRectPath(ctx, pivot, by, mag, 4, 2);
    else roundRectPath(ctx, pivot - mag, by, mag, 4, 2);
    ctx.fill();

    // Red flash wash on a losing trade.
    if (s.pnlFlash > 0) {
      ctx.save();
      ctx.globalAlpha = 0.25 * s.pnlFlash;
      ctx.fillStyle = colors.down;
      ctx.fillRect(x - 6, 12, barW + 12, 60);
      ctx.restore();
    }
  }

  private renderRebate(ctx: CanvasRenderingContext2D, vp: Viewport, s: HudState): void {
    const jar = Hud.jarRect(vp);
    const rightX = vp.w - 16;

    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
    ctx.fillText('REBATE', rightX, 28);

    this.drawJar(ctx, jar, s.tierProgress, s.jarBump);

    // Big gold value below the jar.
    const pop = 1 + 0.12 * s.jarBump;
    const valY = jar.y + jar.h + 24;
    ctx.save();
    ctx.translate(rightX, valY);
    ctx.scale(pop, pop);
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.black} 22px ${fonts.family}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(s.rebate).toLocaleString('en-US')}`, 0, 0);
    ctx.restore();

    // Broker badge.
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
    ctx.fillText(`${s.tierName} ×${s.tierMul.toFixed(1)}`, rightX, valY + 18);
  }

  private drawJar(ctx: CanvasRenderingContext2D, jar: JarRect, fill: number, bump: number): void {
    const { x, y, w, h } = jar;
    const r = Math.min(w, h) * 0.24;

    // Bump glow.
    if (bump > 0.01) {
      ctx.save();
      ctx.shadowColor = colors.rebateGold;
      ctx.shadowBlur = 24 * bump;
      roundRectPath(ctx, x, y, w, h, r);
      ctx.fillStyle = 'rgba(245,196,81,0.18)';
      ctx.fill();
      ctx.restore();
    }

    // Jar body.
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = 'rgba(16,24,48,0.6)';
    ctx.fill();

    // Gold fill, clipped to the jar interior.
    ctx.save();
    roundRectPath(ctx, x + 2, y + 2, w - 4, h - 4, r - 1);
    ctx.clip();
    const innerTop = y + 3;
    const innerBot = y + h - 3;
    const level = innerBot - clamp(fill, 0, 1) * (innerBot - innerTop);
    const grad = ctx.createLinearGradient(0, level, 0, innerBot);
    grad.addColorStop(0, colors.rebateGoldLight);
    grad.addColorStop(1, colors.rebateGold);
    ctx.fillStyle = grad;
    ctx.fillRect(x, level, w, innerBot - level);
    // Meniscus highlight.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(x, level, w, 2);
    ctx.restore();

    // Glass outline.
    roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();
  }

  private renderLives(ctx: CanvasRenderingContext2D, vp: Viewport, s: HudState): void {
    const size = 9;
    const gap = 24;
    const total = (s.maxLives - 1) * gap;
    const startX = vp.w / 2 - total / 2;
    const y = 30;
    for (let i = 0; i < s.maxLives; i++) {
      const alive = i < s.lives;
      this.drawHeart(ctx, startX + i * gap, y, size, alive);
    }
  }

  private drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alive: boolean): void {
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.85);
    ctx.bezierCurveTo(cx - r * 1.3, cy - r * 0.2, cx - r * 0.55, cy - r * 1.1, cx, cy - r * 0.35);
    ctx.bezierCurveTo(cx + r * 0.55, cy - r * 1.1, cx + r * 1.3, cy - r * 0.2, cx, cy + r * 0.85);
    ctx.closePath();
    if (alive) {
      ctx.fillStyle = colors.down;
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(138,148,166,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private renderCombo(ctx: CanvasRenderingContext2D, vp: Viewport, s: HudState): void {
    if (s.combo < 2) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.bold} 15px ${fonts.family}`;
    ctx.fillText(`COMBO ×${s.comboMul.toFixed(1)}`, vp.w / 2, 56);
  }

  private renderCooldown(ctx: CanvasRenderingContext2D, vp: Viewport, s: HudState): void {
    const cx = vp.w / 2;
    const cy = vp.h - 52;
    const r = 20;
    const ready = s.cooldown >= 1;

    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(40,49,84,0.8)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = ready ? colors.rebateGold : colors.brandBlueFrom;
    if (ready) {
      ctx.shadowColor = colors.rebateGold;
      ctx.shadowBlur = 10;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(s.cooldown, 0, 1));
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = ready ? colors.text : colors.textMuted;
    ctx.font = `${fonts.weight.bold} 10px ${fonts.family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ready ? 'TAP' : '…', cx, cy);
    ctx.textBaseline = 'alphabetic';
  }

  private renderToast(ctx: CanvasRenderingContext2D, vp: Viewport, s: HudState): void {
    if (!s.toastText || s.toastT <= 0) return;
    // Ease in/out: fade + slight rise.
    const a = clamp(s.toastT < 0.2 ? s.toastT / 0.2 : s.toastT > 0.8 ? (1 - s.toastT) / 0.2 + 0.0 : 1, 0, 1);
    const w = Math.min(vp.w * 0.7, 300);
    const h = 46;
    const x = vp.w / 2 - w / 2;
    const y = vp.h * 0.26 - 10 * (1 - a);

    ctx.save();
    ctx.globalAlpha = a;
    drawGlassPanel(ctx, x, y, w, h, 14);
    ctx.fillStyle = '#101830';
    ctx.font = `${fonts.weight.bold} 14px ${fonts.family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.toastText, vp.w / 2, y + h / 2);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
}
