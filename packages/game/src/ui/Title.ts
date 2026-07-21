import type { Viewport } from '../engine/Viewport';
import { colors, fonts } from '../brand/tokens';
import { COPY } from '../brand/copy';
import { drawGlassPanel, roundRectPath } from './glass';
import { type Button, drawButton } from './Button';
import { wrapText } from './text';

/**
 * The title / mode-select screen.
 *
 * Reuses the founder-approved treatment (glass logo plate on brand-navy, Inter,
 * ambient glow from the Game background) — re-skinned for the duel: three mode
 * buttons and a BUY/SELL motif in place of the old rebate coin. The polish bar is
 * held exactly; only the labels and the motif changed (SPEC §6).
 */
export class Title {
  private readonly lockup = new Image();
  private ready = false;

  constructor() {
    this.lockup.onload = () => {
      this.ready = true;
    };
    this.lockup.src = '/brand/Logo2.png';
  }

  /** Mode buttons — shared by render and the tap hit-test. When the seasonal
   *  profile is live (`includeFree`), free Practice joins Leaderboard on a
   *  half-width row so the ranked/free split stays visible (PRD §5.A). */
  buttons(vp: Viewport, includeFree = false): Button[] {
    const bw = Math.min(vp.w * 0.82, 340);
    const bx = vp.w / 2 - bw / 2;
    const bh = 54;
    const gap = 12;
    let y = vp.h * 0.58;
    const out: Button[] = [];
    const add = (id: string, label: string, kind: Button['kind']): void => {
      out.push({ id, x: bx, y, w: bw, h: bh, label, kind });
      y += bh + gap;
    };
    add('challenge', COPY.challenge, 'primary');
    add('practice', COPY.practice, 'gold');
    if (includeFree) {
      const half = (bw - gap) / 2;
      const fh = 46;
      out.push({ id: 'free', x: bx, y, w: half, h: fh, label: COPY.practiceFree, kind: 'ghost' });
      out.push({ id: 'leaderboard', x: bx + half + gap, y, w: half, h: fh, label: COPY.leaderboard, kind: 'ghost' });
    } else {
      add('leaderboard', COPY.leaderboard, 'ghost');
    }
    return out;
  }

  /** The small brand-CTA chip under the mode buttons (this game IS the campaign —
   *  keep the funnel present but light on the title). */
  ctaRect(vp: Viewport): { x: number; y: number; w: number; h: number } {
    const h = 30;
    const w = Math.min(vp.w * 0.66, 250);
    return { x: vp.w / 2 - w / 2, y: vp.h * 0.865, w, h };
  }

  render(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    pulse: number,
    banner: string | null = null,
    opts: { includeFree?: boolean; locked?: ReadonlySet<string> } = {},
  ): void {
    const { w, h } = vp;
    const cx = w / 2;

    if (this.ready) {
      const lw = Math.min(w * 0.5, 280);
      const lh = lw * (this.lockup.height / this.lockup.width);
      const pad = Math.max(14, lw * 0.085);
      const pw = lw + pad * 2;
      const ph = lh + pad * 2;
      const px = cx - pw / 2;
      const py = h * 0.14;
      drawGlassPanel(ctx, px, py, pw, ph, Math.min(26, ph * 0.22));
      ctx.drawImage(this.lockup, px + pad, py + pad, lw, lh);
    }

    this.drawMotif(ctx, cx, h * 0.36, Math.min(w * 0.05, 20), pulse);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.11, 46)}px ${fonts.family}`;
    ctx.fillText(COPY.title, cx, h * 0.48);

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} ${Math.min(w * 0.042, 17)}px ${fonts.family}`;
    ctx.fillText(COPY.tagline, cx, h * 0.48 + 30);

    // Incoming-challenge banner — so a challenged friend can't miss the duel.
    if (banner) {
      const ba = 0.75 + 0.25 * Math.sin(pulse * 3);
      ctx.save();
      ctx.globalAlpha = ba;
      ctx.fillStyle = colors.rebateGold;
      ctx.font = `${fonts.weight.bold} ${Math.min(w * 0.04, 15)}px ${fonts.family}`;
      ctx.fillText(banner, cx, h * 0.552);
      ctx.restore();
    }

    // Out-of-tokens: ranked buttons render dimmed (still tappable — the tap
    // explains the refill; Practice stays free — PRD Story 1).
    for (const b of this.buttons(vp, opts.includeFree)) {
      const locked = opts.locked?.has(b.id) ?? false;
      if (locked) ctx.save();
      if (locked) ctx.globalAlpha = 0.45;
      drawButton(ctx, b);
      if (locked) ctx.restore();
    }

    // Small, distinct brand CTA — a gold-rimmed pill with a soft pulse (subtle,
    // not another big button: the campaign hook stays light on the title).
    const cr = this.ctaRect(vp);
    const glow = 0.35 + 0.18 * Math.sin(pulse * 2.2);
    roundRectPath(ctx, cr.x, cr.y, cr.w, cr.h, cr.h / 2);
    ctx.fillStyle = 'rgba(245,196,81,0.08)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(245,196,81,${glow.toFixed(3)})`;
    ctx.stroke();
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(COPY.titleCta, cx, cr.y + cr.h / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';

    // Compliance disclaimer (SPEC §9) — visible on the title, not buried.
    ctx.fillStyle = 'rgba(138,148,166,0.8)';
    ctx.font = `${fonts.weight.medium} 11px ${fonts.family}`;
    const lines = wrapText(ctx, COPY.disclaimer, Math.min(w * 0.84, 360));
    lines.forEach((ln, i) => ctx.fillText(ln, cx, h * 0.93 + i * 14));
  }

  private drawMotif(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    pulse: number,
  ): void {
    const bob = Math.sin(pulse * 2) * 5;
    this.triangle(ctx, cx - r * 1.7, cy + bob, r, true, colors.up);
    this.triangle(ctx, cx + r * 1.7, cy - bob, r, false, colors.down);
  }

  private triangle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    up: boolean,
    color: string,
  ): void {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (up) {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.9, cy + r * 0.7);
      ctx.lineTo(cx - r * 0.9, cy + r * 0.7);
    } else {
      ctx.moveTo(cx, cy + r);
      ctx.lineTo(cx + r * 0.9, cy - r * 0.7);
      ctx.lineTo(cx - r * 0.9, cy - r * 0.7);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
