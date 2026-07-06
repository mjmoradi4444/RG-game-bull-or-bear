import type { Viewport } from '../engine/Viewport';
import type { Puzzle } from '../game/Puzzle';
import { colors, fonts } from '../brand/tokens';
import { sourceLabel } from '../brand/copy';
import { roundRectPath } from './glass';

export interface ChipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const monthYearFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const fullFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

/**
 * The trust feature (SPEC §3.4): on every reveal, prove the data is real by showing
 * the asset, the real month/year, and the source — tappable to expand the exact UTC
 * timestamp. Shown only AFTER the call, never during (anti-lookup, §3.5).
 */
export function drawVerifyChip(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  puzzle: Puzzle,
  cy: number,
  expanded: boolean,
): ChipRect {
  const date = new Date(puzzle.verify.realDateUtc);
  const label = `Real data · ${puzzle.asset} · ${monthYearFmt.format(date)} · via ${sourceLabel(
    puzzle.verify.source,
  )}`;

  ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
  const dotR = 3;
  const padX = 12;
  const gap = 7;
  const textW = ctx.measureText(label).width;
  const w = padX + dotR * 2 + gap + textW + padX;
  const h = 28;
  const x = vp.w / 2 - w / 2;
  const y = cy - h / 2;

  // Pill.
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(22,199,132,0.12)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(22,199,132,0.45)';
  ctx.stroke();

  // Verified dot.
  ctx.fillStyle = colors.up;
  ctx.beginPath();
  ctx.arc(x + padX + dotR, y + h / 2, dotR, 0, Math.PI * 2);
  ctx.fill();

  // Label.
  ctx.fillStyle = colors.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + padX + dotR * 2 + gap, y + h / 2 + 0.5);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';

  if (expanded) {
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 11px ${fonts.family}`;
    ctx.fillText(`${fullFmt.format(date)} UTC · tap to verify on any public chart`, vp.w / 2, y + h + 18);
  } else {
    ctx.fillStyle = 'rgba(138,148,166,0.7)';
    ctx.font = `${fonts.weight.medium} 10px ${fonts.family}`;
    ctx.fillText('tap to see exact time', vp.w / 2, y + h + 16);
  }

  return { x, y, w, h };
}

export function hitChip(rect: ChipRect | null, px: number, py: number): boolean {
  if (!rect) return false;
  // Generous vertical padding so the small pill and its sub-text are easy to tap.
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y - 10 && py <= rect.y + rect.h + 24;
}
