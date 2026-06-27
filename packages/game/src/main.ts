import { Viewport } from './engine/Viewport';
import { Loop } from './engine/Loop';
import { Input } from './engine/Input';
import { Audio } from './engine/Audio';
import { Particles } from './engine/Particles';
import { Rng } from './engine/Rng';
import { Game } from './game/Game';
import { selectAdapter } from './telegram/selectAdapter';

/**
 * Phase 2 bootstrap: build the engine pieces, wire them into the Game, and run a
 * fixed-timestep loop. The platform-agnostic engine never touches Telegram — the
 * adapter (Noop in dev) is selected here and used for scores/leaderboard in later
 * phases.
 */
const canvas = document.getElementById('game') as HTMLCanvasElement;

const viewport = new Viewport(canvas);
const input = new Input(canvas);
const audio = new Audio();
const rng = new Rng();
const particles = new Particles(rng, 400);
const game = new Game(viewport, input, audio, particles, rng);

// Unlock WebAudio on the first user gesture (browser requirement).
input.onFirstGesture(() => audio.resume());

const loop = new Loop(
  1 / 60,
  (dt) => game.update(dt),
  (alpha) => game.render(alpha),
);

// Pause the simulation when the tab is hidden (saves battery, avoids dt spikes).
document.addEventListener('visibilitychange', () => {
  loop.setPaused(document.hidden);
});

async function boot(): Promise<void> {
  const adapter = selectAdapter();
  await adapter.ready();
  loop.start();
}

void boot();
