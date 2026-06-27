import { Viewport } from './engine/Viewport';
import { Loop } from './engine/Loop';
import { Input } from './engine/Input';
import { Audio } from './engine/Audio';
import { Particles } from './engine/Particles';
import { Rng } from './engine/Rng';
import { Game } from './game/Game';
import { selectAdapter } from './telegram/selectAdapter';

/**
 * Bootstrap: build the engine pieces + the runtime Telegram adapter (Noop in dev),
 * wire them into the Game, and run a fixed-timestep loop. The engine never touches
 * Telegram — only the adapter does.
 */
const canvas = document.getElementById('game') as HTMLCanvasElement;

const viewport = new Viewport(canvas);
const input = new Input(canvas);
const audio = new Audio();
const rng = new Rng();
const particles = new Particles(rng, 500);
const adapter = selectAdapter();
const game = new Game(viewport, input, audio, particles, adapter);

// Unlock WebAudio on the first user gesture (browser requirement).
input.onFirstGesture(() => audio.resume());

const loop = new Loop(
  1 / 60,
  (dt) => game.update(dt),
  (alpha) => game.render(alpha),
);

document.addEventListener('visibilitychange', () => {
  loop.setPaused(document.hidden);
});

// Dev-only inspection handle (stripped from production builds by Vite).
if (import.meta.env.DEV) {
  (window as unknown as { __rr: unknown }).__rr = { game, viewport };
}

async function boot(): Promise<void> {
  await adapter.ready();
  loop.start();
}

void boot();
