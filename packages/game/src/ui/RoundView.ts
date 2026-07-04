import type { Viewport } from '../engine/Viewport';
import type { Round } from '../game/Round';
import type { RoundStatus } from '../game/Match';
import type { Level } from '../game/levels';
import { colors, fonts } from '../brand/tokens';
import { COPY, assetLabel } from '../brand/copy';
import { CONFIG } from '../game/config';
import { explainOutcome } from '../game/priceAction';
import { clamp, damp, easeOutCubic, TAU } from '../engine/math';
import { wrapText } from './text';
import { roundRectPath } from './glass';
import { type Button, drawButton } from './Button';
import { chartPriceRange, drawChart, PRICE_AXIS_W, type Rect } from './Chart';
import { type ChipRect, drawVerifyChip, hitChip } from './VerifyChip';

/**
 * Renders one round across its phases (preroll → playback → decide → reveal → done)
 * and owns the small bits of view state the logic shouldn't: the smoothed chart
 * price range and whether the verify chip is expanded. Exposes plain hit rects so
 * the orchestrator's tap routing matches exactly what's drawn.
 */
const MIN_VIEW = 8;

export class RoundView {
  private curMin = 0;
  private curMax = 1;
  private inited = false;
  private verifyExpanded = false;
  private chipRect: ChipRect | null = null;

  // Zoom/pan view window over the context (decide phase only).
  private viewStart = 0;
  private viewCount = 0;
  private vInited = false;

  /** Call when a new round becomes current. */
  reset(): void {
    this.inited = false;
    this.verifyExpanded = false;
    this.chipRect = null;
    this.vInited = false;
  }

  // ---- zoom / pan (decide-phase chart navigation) ------------------------
  private ctxLen(round: Round): number {
    return round.puzzle.candles.length;
  }

  /** Visible window per phase: user-controlled during decide; fit-all otherwise. */
  private effectiveView(round: Round): { start: number; count: number } {
    const ctxLen = this.ctxLen(round);
    const futLen = round.puzzle.future.length;
    const dv = Math.min(CONFIG.DEFAULT_VIEW, ctxLen);
    if (round.phase === 'decide') {
      const count = clamp(this.viewCount || dv, MIN_VIEW, ctxLen);
      return { start: clamp(this.viewStart, 0, ctxLen - count), count };
    }
    if (round.phase === 'reveal' || round.phase === 'done') {
      // Recent context + the revealed future — not all 100 candles crammed in.
      return { start: ctxLen - dv, count: dv + futLen };
    }
    if (round.phase === 'playback') {
      // Live-scroll: the window follows the newest streamed candle (last dv shown).
      const shown = round.playbackFrac * ctxLen;
      return { start: clamp(shown - dv, 0, ctxLen - dv), count: dv };
    }
    return { start: ctxLen - dv, count: dv }; // preroll
  }

  /** Pinch / wheel zoom. factor > 1 = zoom IN (fewer, bigger candles). */
  zoomBy(factor: number, round: Round): void {
    if (round.phase !== 'decide') return;
    const ctxLen = this.ctxLen(round);
    const center = this.viewStart + this.viewCount / 2;
    this.viewCount = clamp(this.viewCount / factor, MIN_VIEW, ctxLen);
    this.viewStart = clamp(center - this.viewCount / 2, 0, ctxLen - this.viewCount);
  }

  /** One-finger drag pan (px). Dragging right reveals earlier candles. */
  panByPixels(dxPx: number, vp: Viewport, round: Round): void {
    if (round.phase !== 'decide') return;
    const ctxLen = this.ctxLen(round);
    const count = clamp(this.viewCount || ctxLen, MIN_VIEW, ctxLen);
    const plotW = Math.max(1, this.chartRect(vp).w - PRICE_AXIS_W);
    const slotW = plotW / count;
    this.viewStart = clamp(this.viewStart - dxPx / slotW, 0, ctxLen - count);
  }

  toggleVerify(): void {
    this.verifyExpanded = !this.verifyExpanded;
  }

  hitVerify(px: number, py: number): boolean {
    return hitChip(this.chipRect, px, py);
  }

  /** Smooth the y-axis to fit the VISIBLE window (zoom/pan rescales it). Future is
   *  included only once revealing (fairness). */
  update(dt: number, round: Round): void {
    if (!this.vInited) {
      const dv = Math.min(CONFIG.DEFAULT_VIEW, this.ctxLen(round));
      this.viewCount = dv;
      this.viewStart = this.ctxLen(round) - dv; // recent window, ending at the freeze
      this.vInited = true;
    }
    const revealing = round.phase === 'reveal' || round.phase === 'done';
    const all = revealing ? round.puzzle.candles.concat(round.puzzle.future) : round.puzzle.candles;
    const ev = this.effectiveView(round);
    const visible = all.slice(Math.floor(ev.start), Math.ceil(ev.start + ev.count));
    const [lo, hi] = chartPriceRange(visible.length ? visible : all);
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
    level?: Level,
  ): void {
    this.drawHeader(ctx, vp, round, statuses, level);

    const rect = this.chartRect(vp);
    const showFuture = round.phase === 'reveal' || round.phase === 'done';
    const ev = this.effectiveView(round);
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
      viewStart: ev.start,
      viewCount: ev.count,
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
    level?: Level,
  ): void {
    const cx = vp.w / 2;

    // Level chip, top-left.
    if (level) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `${fonts.weight.bold} 11px ${fonts.family}`;
      const label = level.name.toUpperCase();
      const cw = ctx.measureText(label).width + 22;
      roundRectPath(ctx, 12, vp.h * 0.05 - 11, cw, 22, 11);
      ctx.fillStyle = 'rgba(23,31,58,0.8)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(12 + 11, vp.h * 0.05, 3.5, 0, TAU);
      ctx.fillStyle = level.color;
      ctx.fill();
      ctx.fillStyle = colors.text;
      ctx.fillText(label, 12 + 19, vp.h * 0.05 + 0.5);
      ctx.textBaseline = 'alphabetic';
    }
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
    ctx.fillStyle = 'rgba(138,148,166,0.5)';
    ctx.font = `${fonts.weight.medium} 11px ${fonts.family}`;
    ctx.fillText(COPY.tapToSkip, vp.w / 2, vp.h * 0.675);
  }

  private drawDecide(ctx: CanvasRenderingContext2D, vp: Viewport, round: Round): void {
    const cx = vp.w / 2;

    // Gesture hint (pinch/drag replaces buttons — mobile-first).
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(138,148,166,0.6)';
    ctx.font = `${fonts.weight.medium} 10px ${fonts.family}`;
    ctx.fillText('pinch to zoom · drag to pan', cx, this.chartRect(vp).y + this.chartRect(vp).h + 13);

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
    // Lead: what the player called.
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
    const callTxt =
      round.call === 'up'
        ? `${COPY.locked}: ${COPY.buy} ▲`
        : round.call === 'down'
          ? `${COPY.locked}: ${COPY.sell} ▼`
          : COPY.noCall;
    ctx.fillText(callTxt, cx, vp.h * 0.585);

    if (!round.verdictShown) return;

    // Verdict (+ cosmetic streak, solo only — SPEC §5).
    const ok = round.correct;
    ctx.fillStyle = ok ? colors.up : colors.down;
    ctx.font = `${fonts.weight.black} ${Math.min(vp.w * 0.08, 32)}px ${fonts.family}`;
    const verdict = ok ? `✓ ${COPY.correct}` : `✗ ${COPY.wrong}`;
    ctx.fillText(ok && combo >= 2 ? `${verdict}  ×${combo}` : verdict, cx, vp.h * 0.632);

    // Price-action teaching: why it resolved that way (the requested explanation).
    const ex = explainOutcome(round.puzzle);
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.bold} 14px ${fonts.family}`;
    ctx.fillText(ex.pattern, cx, vp.h * 0.668);
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 12px ${fonts.family}`;
    wrapText(ctx, ex.why, Math.min(vp.w * 0.84, 350)).slice(0, 3).forEach((ln, i) =>
      ctx.fillText(ln, cx, vp.h * 0.692 + i * 15),
    );

    // Verify chip (trust) + a compact rebate reminder.
    this.chipRect = drawVerifyChip(ctx, vp, round.puzzle, vp.h * 0.77, this.verifyExpanded);

    ctx.fillStyle = 'rgba(245,196,81,0.85)';
    ctx.font = `${fonts.weight.medium} 11px ${fonts.family}`;
    ctx.textAlign = 'center';
    ctx.fillText(COPY.rebateReminder, cx, vp.h * 0.82);

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
