import { selectAdapter } from './telegram/selectAdapter';
import { colors, fonts } from './brand/tokens';
import { drawGlassPanel } from './ui/glass';

/**
 * Phase 1 bootstrap. This is a deliberately minimal brand splash that proves the
 * scaffold runs end to end: DPR-aware canvas + resize, runtime adapter selection,
 * brand tokens, and brand-asset loading. The real engine (loop, input, renderer,
 * particles) lands in Phase 2 and replaces this draw().
 */

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const view = { w: 0, h: 0, dpr: 1 };

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = window.innerWidth;
  const h = window.innerHeight;
  view.w = w;
  view.h = h;
  view.dpr = dpr;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

// Horizontal brand lockup for the splash (SPEC §6: Logo2 = loading screen header).
const lockup = new Image();
let lockupReady = false;
lockup.onload = () => {
  lockupReady = true;
  draw();
};
lockup.src = '/brand/Logo2.png';

function draw(): void {
  const { w, h } = view;
  const cx = w / 2;

  // Background — the logo navy.
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, w, h);

  // Brand lockup on a frosted-glass plate. The wordmark in Logo2 is dark navy,
  // so it needs a light surface to read against the dark brand background.
  if (lockupReady) {
    const lw = Math.min(w * 0.5, 280);
    const lh = lw * (lockup.height / lockup.width);
    const pad = Math.max(18, lw * 0.09);
    const plateW = lw + pad * 2;
    const plateH = lh + pad * 2;
    const plateX = cx - plateW / 2;
    const plateY = h * 0.27 - plateH / 2;
    drawGlassPanel(ctx, plateX, plateY, plateW, plateH, Math.min(28, plateH * 0.22));
    ctx.drawImage(lockup, plateX + pad, plateY + pad, lw, lh);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Title.
  ctx.fillStyle = colors.text;
  ctx.font = `${fonts.weight.black} ${Math.min(w * 0.11, 48)}px ${fonts.family}`;
  ctx.fillText('Rebate Rush', cx, h * 0.45);

  // Tagline — the one lesson.
  ctx.fillStyle = colors.textMuted;
  ctx.font = `${fonts.weight.medium} ${Math.min(w * 0.042, 18)}px ${fonts.family}`;
  ctx.fillText('Win or lose, the rebate pays.', cx, h * 0.45 + 34);

  // A single gold rebate coin — palette sanity check + the hero color.
  const coinR = Math.min(w * 0.08, 34);
  const coinY = h * 0.62;
  const g = ctx.createRadialGradient(cx, coinY, coinR * 0.2, cx, coinY, coinR);
  g.addColorStop(0, colors.rebateGoldLight);
  g.addColorStop(1, colors.rebateGold);
  ctx.beginPath();
  ctx.arc(cx, coinY, coinR, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // Scaffold marker (removed in Phase 2).
  ctx.fillStyle = colors.textMuted;
  ctx.font = `${fonts.weight.medium} 12px ${fonts.family}`;
  ctx.fillText('Phase 1 · scaffold', cx, h - 28);
}

async function boot(): Promise<void> {
  const adapter = selectAdapter();
  await adapter.ready();
  window.addEventListener('resize', resize, { passive: true });
  resize();
}

void boot();
