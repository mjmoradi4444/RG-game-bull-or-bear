import type { Viewport } from '../engine/Viewport';
import type { Round } from '../game/Round';
import type { RoundStatus } from '../game/Match';
import { colors, fonts } from '../brand/tokens';
import { COPY, assetLabel } from '../brand/copy';
import { CONFIG } from '../game/config';
import { clamp, damp, easeOutCubic, TAU } from '../engine/math';
import { wrapText } from './text';
import { roundRectPath } from './glass';
import { type Button, drawButton } from './Button';
import { chartPriceRange, drawChart, type Rect } from './Chart';
import { type ChipRect, drawVerifyChip, hitChip } from './VerifyChip';

/**
 * Renders one round across its phases (preroll → playback → decide → reveal → done)
 * and owns the small bits of view state the logic shouldn't: the smoothed chart
 * price range and whether the verify chip is expanded. Exposes plain hit rects so
 * the orchestrator's tap routing matches exactly what's drawn.
 */
export class RoundView {
  private curMin = 0;
  private curMax = 1;
  private inited = false;
  private verifyExpanded = false;
  private chipRect: ChipRect | null = null;

  /** Call when a new round becomes current. */
  reset(): void {
    this.inited = false;
    this.verifyExpanded = false;
    this.chipRect = null;
  }

  toggleVerify(): void {
    this.verifyExpanded = !this.verifyExpanded;
  }

  hitVerify(px: number, py: number): boolean {
    return hitChip(this.chipRect, px, py);
  }

  /** Smooth the y-axis range. Future is included only once revealing (fairness). */
  update(dt: number, round: Round): void {
    const revealing = round.phase === 'reveal' || round.phase === 'done';
    const candles = revealing
      ? round.puzzle.candles.concat(round.puzzle.future)
      : round.puzzle.candles;
    const [lo, hi] = chartPriceRange(candles);
    if (!this.inited) {
      this.curMin = lo;
      this.curMax = hi;
      this.inited = true;
    } else {
      this.curMin = damp(this.curMin, lo, 9, dt);
      this.curMax = damp(this.curMax, hi, 9, dt);
    }
  }

  // ---- layout (shared by render + hit-test) ------------------------------
  chartRect(vp: Viewport): Rect {
    // Bigger + more dominant so it reads like a real trading terminal, not a panel
    // (but leaving room below for the call / verdict text).
    return { x: vp.w * 0.06, y: vp.h * 0.135, w: vp.w * 0.88, h: vp.h * 0.42 };
  }

  buyRect(vp: Viewport): Rect {
    return this.callButtonRect(vp, 0);
  }

  sellRect(vp: Viewport): Rect {
    return this.callButtonRect(vp, 1);
  }

  private callButtonRect(vp: Viewport, side: 0 | 1): Rect {
    const x0 = vp.w * 0.06;
    const totalW = vp.w * 0.88;
    const gap = 14;
    const halfW = (totalW - gap) / 2;
    return { x: x0 + side * (halfW + gap), y: vp.h * 0.78, w: halfW, h: 64 };
  }

  continueButton(vp: Viewport, isLast: boolean): Button {
    const w = Math.min(vp.w * 0.7, 300);
    return {
      id: 'continue',
      x: vp.w / 2 - w / 2,
      y: vp.h * 0.84,
      w,
      h: 54,
      label: isLast ? COPY.seeResult : COPY.nextRound,
      kind: 'gold',
    };
  }

  // ---- render ------------------------------------------------------------
  render(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    round: Round,
    statuses: RoundStatus[],
    combo = 0,
  ): void {
    this.drawHeader(ctx, vp, round, statuses);

    const rect = this.chartRect(vp);
    const showFuture = round.phase === 'reveal' || round.phase === 'done';
    drawChart(ctx, rect, {
      context: round.puzzle.candles,
      future: round.puzzle.future,
      contextShown: round.playbackFrac * round.puzzle.candles.length,
      futureShown: round.revealFrac * round.puzzle.future.length,
      priceMin: this.curMin,
      priceMax: this.curMax,
      freezeClose: round.puzzle.freezeClose,
      showFreezeLine: round.phase !== 'preroll' && round.phase !== 'playback',
      timeframe: round.puzzle.timeframe,
    });

    if (showFuture) this.drawReveal(ctx, vp, round, combo);
    else if (round.phase === 'decide') this.drawDecide(ctx, vp, round);
    else if (round.phase === 'preroll') this.drawPreroll(ctx, vp, round);
    else this.drawScanning(ctx, vp); // playback

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private drawHeader(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    round: Round,
    statuses: RoundStatus[],
  ): void {
    const cx = vp.w / 2;
    // Tally pips.
    const n = statuses.length;
    const pipR = 4;
    const gap = 14;
    const totalW = (n - 1) * gap;
    let x = cx - totalW / 2;
    const py = vp.h * 0.05;
    for (const s of statuses) {
      ctx.beginPath();
      ctx.arc(x, py, pipR, 0, TAU);
      if (s === 'correct') ctx.fillStyle = colors.up;
      else if (s === 'wrong') ctx.fillStyle = colors.down;
      else if (s === 'current') ctx.fillStyle = colors.rebateGold;
      else ctx.fillStyle = 'rgba(138,148,166,0.35)';
      ctx.fill();
      x += gap;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
    ctx.fillText(COPY.roundOf(round.index + 1, round.total).toUpperCase(), cx, vp.h * 0.085);

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.bold} ${Math.min(vp.w * 0.052, 21)}px ${fonts.family}`;
    ctx.fillText(assetLabel(round.puzzle.asset), cx, vp.h * 0.122);
  }

  private drawPreroll(ctx: CanvasRenderingContext2D, vp: Viewport, round: Round): void {
    const cx = vp.w / 2;
    const a = easeOutCubic(clamp(round.t / 0.5, 0, 1));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.semibold} 14px ${fonts.family}`;
    ctx.fillText(COPY.roundOf(round.index + 1, round.total).toUpperCase(), cx, vp.h * 0.36);
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(vp.w * 0.085, 36)}px ${fonts.family}`;
    ctx.fillText(assetLabel(round.puzzle.asset), cx, vp.h * 0.43);
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 13px ${fonts.family}`;
    ctx.fillText('Get ready…', cx, vp.h * 0.48);
    ctx.restore();
  }

  private drawScanning(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(138,148,166,0.7)';
    ctx.font = `${fonts.weight.medium} 12px ${fonts.family}`;
    ctx.fillText('Reading the market…', vp.w / 2, vp.h * 0.64);
  }

  private drawDecide(ctx: CanvasRenderingContext2D, vp: Viewport, round: Round): void {
    const cx = vp.w / 2;

    // Countdown ring.
    const ry = vp.h * 0.64;
    const r = 27;
    const frac = clamp(round.decisionLeft / CONFIG.DECISION_SECONDS, 0, 1);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(40,49,84,0.7)';
    ctx.beginPath();
    ctx.arc(cx, ry, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = frac > 0.34 ? colors.brandBlueFrom : colors.down;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, ry, r, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.bold} 20px ${fonts.family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.ceil(round.decisionLeft)), cx, ry + 1);
    ctx.textBaseline = 'alphabetic';

    // "CALL IT" flash early in the window, then the quieter hint.
    const flash = clamp(1 - round.t / 0.6, 0, 1);
    if (flash > 0.01) {
      ctx.save();
      ctx.globalAlpha = flash;
      ctx.fillStyle = colors.text;
      ctx.font = `${fonts.weight.bold} ${Math.min(vp.w * 0.06, 24)}px ${fonts.family}`;
      ctx.fillText(COPY.callIt, cx, vp.h * 0.405);
      ctx.restore();
    }
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 12px ${fonts.family}`;
    ctx.fillText(COPY.callHint, cx, vp.h * 0.715);

    this.drawCallButton(ctx, this.buyRect(vp), 'buy', true);
    this.drawCallButton(ctx, this.sellRect(vp), 'sell', true);
  }

  private drawReveal(ctx: CanvasRenderingContext2D, vp: Viewport, round: Round, combo: number): void {
    const cx = vp.w / 2;
    // Locked call indicator (always show what was called).
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 13px ${fonts.family}`;
    const callTxt =
      round.call === 'up'
        ? `${COPY.locked}: ${COPY.buy} ▲`
        : round.call === 'down'
          ? `${COPY.locked}: ${COPY.sell} ▼`
          : COPY.noCall;
    ctx.fillText(callTxt, cx, vp.h * 0.6);

    if (!round.verdictShown) return;

    // Verdict.
    const ok = round.correct;
    ctx.fillStyle = ok ? colors.up : colors.down;
    ctx.font = `${fonts.weight.black} ${Math.min(vp.w * 0.085, 34)}px ${fonts.family}`;
    ctx.fillText(ok ? `✓ ${COPY.correct}` : `✗ ${COPY.wrong}`, cx, vp.h * 0.655);

    // Combo flair — cosmetic, solo only (SPEC §5): a gold streak on consecutive calls.
    if (ok && combo >= 2) {
      ctx.fillStyle = colors.rebateGold;
      ctx.font = `${fonts.weight.black} 14px ${fonts.family}`;
      ctx.fillText(`${COPY.streak} ×${combo}`, cx, vp.h * 0.69);
    }

    // Verify chip (the trust feature) + rebate reminder.
    this.chipRect = drawVerifyChip(ctx, vp, round.puzzle, vp.h * 0.715, this.verifyExpanded);

    ctx.fillStyle = 'rgba(245,196,81,0.9)';
    ctx.font = `${fonts.weight.medium} 12px ${fonts.family}`;
    ctx.textAlign = 'center';
    const yReminder = this.verifyExpanded ? vp.h * 0.765 : vp.h * 0.755;
    wrapText(ctx, COPY.rebateReminder, Math.min(vp.w * 0.82, 340)).forEach((ln, i) =>
      ctx.fillText(ln, cx, yReminder + i * 16),
    );

    if (round.phase === 'done') {
      drawButton(ctx, this.continueButton(vp, round.index >= round.total - 1));
    }
  }

  private drawCallButton(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    kind: 'buy' | 'sell',
    active: boolean,
  ): void {
    const buy = kind === 'buy';
    const col = buy ? colors.up : colors.down;
    ctx.save();
    if (!active) ctx.globalAlpha = 0.4;
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 14);
    ctx.fillStyle = buy ? 'rgba(22,199,132,0.16)' : 'rgba(234,57,67,0.16)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = col;
    ctx.stroke();

    const cxb = rect.x + rect.w / 2;
    const cyb = rect.y + rect.h / 2;
    // Direction triangle.
    ctx.fillStyle = col;
    const tr = 9;
    ctx.beginPath();
    if (buy) {
      ctx.moveTo(cxb - 26, cyb + tr * 0.6);
      ctx.lineTo(cxb - 26 + tr, cyb + tr * 0.6);
      ctx.lineTo(cxb - 26 + tr / 2, cyb - tr * 0.7);
    } else {
      ctx.moveTo(cxb - 26, cyb - tr * 0.6);
      ctx.lineTo(cxb - 26 + tr, cyb - tr * 0.6);
      ctx.lineTo(cxb - 26 + tr / 2, cyb + tr * 0.7);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = col;
    ctx.font = `${fonts.weight.black} 19px ${fonts.family}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(buy ? COPY.buy : COPY.sell, cxb - 10, cyb + 1);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
}
