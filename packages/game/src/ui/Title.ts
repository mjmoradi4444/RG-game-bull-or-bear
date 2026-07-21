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

  /** Full flowed layout — ONE source of truth for render + hit-tests, so nothing
   *  can overlap on short screens: logo → title → banner slot → buttons →
   *  account chip → CTA, with the disclaimer pinned at the bottom. Spacing
   *  compresses on compact viewports instead of colliding. */
  layout(
    vp: Viewport,
    opts: { includeFree?: boolean; hasAccount?: boolean } = {},
  ): {
    buttons: Button[];
    account: { x: number; y: number; w: number; h: number };
    cta: { x: number; y: number; w: number; h: number };
    titleY: number;
    bannerY: number;
  } {
    const { w, h } = vp;
    const compact = h < 660;
    const bw = Math.min(w * 0.82, 340);
    const bx = w / 2 - bw / 2;
    const bh = compact ? 46 : 54;
    const gap = compact ? 9 : 12;
    const halfH = compact ? 40 : 46;

    // Block heights below the tagline.
    const buttonsH = bh * 2 + gap * 2 + (opts.includeFree ? halfH : bh);
    const accountH = opts.hasAccount ? 30 + 8 : 0;
    const ctaH = 30;
    const blockH = buttonsH + 10 + accountH + ctaH;

    // The block bottom-aligns just above the disclaimer; the title sits above it.
    const blockBottom = h * 0.915 - 14;
    const buttonsY0 = Math.max(h * 0.34, blockBottom - blockH);
    const titleY = Math.max(64, buttonsY0 - (compact ? 64 : 92));
    const bannerY = buttonsY0 - 12;

    const out: Button[] = [];
    let y = buttonsY0;
    out.push({ id: 'challenge', x: bx, y, w: bw, h: bh, label: COPY.challenge, kind: 'primary' });
    y += bh + gap;
    out.push({ id: 'practice', x: bx, y, w: bw, h: bh, label: COPY.practice, kind: 'gold' });
    y += bh + gap;
    if (opts.includeFree) {
      const half = (bw - gap) / 2;
      out.push({ id: 'free', x: bx, y, w: half, h: halfH, label: COPY.practiceFree, kind: 'ghost' });
      out.push({ id: 'leaderboard', x: bx + half + gap, y, w: half, h: halfH, label: COPY.leaderboard, kind: 'ghost' });
      y += halfH;
    } else {
      out.push({ id: 'leaderboard', x: bx, y, w: bw, h: bh, label: COPY.leaderboard, kind: 'ghost' });
      y += bh;
    }
    y += 10;
    const accountW = Math.min(w * 0.6, 220);
    const account = { x: w / 2 - accountW / 2, y: opts.hasAccount ? y : -100, w: accountW, h: 30 };
    if (opts.hasAccount) y += 38;
    const ctaW = Math.min(w * 0.66, 250);
    const cta = { x: w / 2 - ctaW / 2, y, w: ctaW, h: ctaH };

    return { buttons: out, account, cta, titleY, bannerY };
  }

  /** Mode buttons — kept for callers that only need the button list. */
  buttons(vp: Viewport, includeFree = false): Button[] {
    return this.layout(vp, { includeFree }).buttons;
  }

  render(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    pulse: number,
    banner: string | null = null,
    opts: { includeFree?: boolean; locked?: ReadonlySet<string>; hasAccount?: boolean } = {},
  ): void {
    const { w, h } = vp;
    const cx = w / 2;
    const L = this.layout(vp, opts);
    const compact = h < 660;

    // Logo plate scales down and everything between it and the title flexes, so
    // the flowed block below never collides on short viewports. 80px floor keeps
    // it clear of the two HUD chip rows (y 12–72) drawn by the Game on top.
    const logoTop = Math.max(80, h * (compact ? 0.075 : 0.12));
    let logoBottom = logoTop;
    if (this.ready) {
      const lw = Math.min(w * (compact ? 0.4 : 0.5), compact ? 210 : 280);
      const lh = lw * (this.lockup.height / this.lockup.width);
      const pad = Math.max(10, lw * 0.085);
      const pw = lw + pad * 2;
      const ph = lh + pad * 2;
      const px = cx - pw / 2;
      drawGlassPanel(ctx, px, logoTop, pw, ph, Math.min(26, ph * 0.22));
      ctx.drawImage(this.lockup, px + pad, logoTop + pad, lw, lh);
      logoBottom = logoTop + ph;
    }

    // Motif midway between the logo and the title (skipped when too tight).
    const motifY = (logoBottom + L.titleY - 44) / 2;
    if (motifY > logoBottom + 16) this.drawMotif(ctx, cx, motifY, Math.min(w * 0.05, 20), pulse);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.11, compact ? 38 : 46)}px ${fonts.family}`;
    ctx.fillText(COPY.title, cx, L.titleY);

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} ${Math.min(w * 0.042, compact ? 14 : 17)}px ${fonts.family}`;
    ctx.fillText(COPY.tagline, cx, L.titleY + (compact ? 22 : 28));

    // Incoming-challenge banner — so a challenged friend can't miss the duel.
    if (banner) {
      const ba = 0.75 + 0.25 * Math.sin(pulse * 3);
      ctx.save();
      ctx.globalAlpha = ba;
      ctx.fillStyle = colors.rebateGold;
      ctx.font = `${fonts.weight.bold} ${Math.min(w * 0.04, 14)}px ${fonts.family}`;
      ctx.fillText(banner, cx, L.bannerY);
      ctx.restore();
    }

    // Out-of-tokens: ranked buttons render dimmed (still tappable — the tap
    // explains the refill; Practice stays free — PRD Story 1).
    for (const b of L.buttons) {
      const locked = opts.locked?.has(b.id) ?? false;
      if (locked) ctx.save();
      if (locked) ctx.globalAlpha = 0.45;
      drawButton(ctx, b);
      if (locked) ctx.restore();
    }

    // Small, distinct brand CTA — a gold-rimmed pill with a soft pulse (subtle,
    // not another big button: the campaign hook stays light on the title).
    const cr = L.cta;
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
    ctx.font = `${fonts.weight.medium} ${compact ? 10 : 11}px ${fonts.family}`;
    const lines = wrapText(ctx, COPY.disclaimer, Math.min(w * 0.84, 360));
    lines.forEach((ln, i) => ctx.fillText(ln, cx, h * 0.935 + i * 13));
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
