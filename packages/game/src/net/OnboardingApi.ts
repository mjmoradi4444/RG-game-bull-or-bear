import { apiBase, launchGctx } from './Multiplayer';

/**
 * Onboarding state client (PRD-ONBOARDING-TASKS §5). Tutorial completion is
 * remembered server-side so a reinstall / second device doesn't re-force the FTUE.
 * A local mirror (localStorage) lets the tutorial decide instantly offline before
 * the server responds. No-ops without a launch context.
 */
export interface OnboardingView {
  tutorialDone: boolean;
  tutorialSkipped: boolean;
  seenTips: string[];
  isNew: boolean;
}

const LOCAL_KEY = 'bob_tutorial_done';
const gctx = (): string | null => launchGctx();

export function localTutorialDone(): boolean {
  try {
    return localStorage.getItem(LOCAL_KEY) === '1';
  } catch {
    return false;
  }
}

function setLocalDone(): void {
  try {
    localStorage.setItem(LOCAL_KEY, '1');
  } catch {
    /* ignore */
  }
}

export async function fetchOnboarding(): Promise<OnboardingView | null> {
  const g = gctx();
  if (!g) return null;
  try {
    const r = await fetch(`${apiBase()}/onboarding?gctx=${encodeURIComponent(g)}`);
    const d = (await r.json()) as { ok: boolean } & OnboardingView;
    return d.ok ? d : null;
  } catch {
    return null;
  }
}

export function setTutorial(done: boolean, skipped: boolean): void {
  if (done) setLocalDone();
  const g = gctx();
  if (!g) return;
  void fetch(`${apiBase()}/onboarding/tutorial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gctx: g, done, skipped }),
  }).catch(() => {});
}

export function markTip(tip: string): void {
  const g = gctx();
  if (!g) return;
  void fetch(`${apiBase()}/onboarding/tip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gctx: g, tip }),
  }).catch(() => {});
}
