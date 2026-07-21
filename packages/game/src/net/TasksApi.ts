import { apiBase, launchGctx } from './Multiplayer';

/**
 * Client for the task system (PRD-ONBOARDING-TASKS §7). Same transport + no-op-
 * without-gctx pattern as the other net clients. Gameplay progress is computed
 * server-side; this only reads tasks, opens social links (visit), signals shares,
 * captures referral attribution, and claims.
 */
export type TaskState = 'locked' | 'in_progress' | 'completed' | 'claimed';

export interface TaskRow {
  id: string;
  kind: string;
  title: string;
  rewardType: 'rp' | 'token';
  rewardAmount: number;
  verifyMethod: 'server' | 'tg_member' | 'click_claim' | 'referral';
  url?: string;
  target: number;
  state: TaskState;
  progress: number;
  /** Player already opened this task's link (Join/Go pressed). */
  visited?: boolean;
  /** click_claim only: when the Claim button unlocks (server clock). */
  unlocksAt?: number;
}

export interface TasksView {
  daily: TaskRow[];
  general: TaskRow[];
  resetAt: number;
  claimable: number;
}

export type ClaimResult =
  | { ok: true; rewardType: 'rp' | 'token'; reward: number; seasonRp?: number; rank?: number; tokens?: number }
  | { ok: false; error: string };

const gctx = (): string | null => launchGctx();

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await r.json()) as T;
}

export async function fetchTasks(): Promise<TasksView | null> {
  const g = gctx();
  if (!g) return null;
  try {
    const r = await fetch(`${apiBase()}/tasks?gctx=${encodeURIComponent(g)}`);
    const d = (await r.json()) as { ok: boolean } & TasksView;
    return d.ok ? d : null;
  } catch {
    return null;
  }
}

export async function claimTask(taskId: string, day?: string): Promise<ClaimResult> {
  const g = gctx();
  if (!g) return { ok: false, error: 'network' };
  try {
    return await post<ClaimResult>('/tasks/claim', { gctx: g, taskId, day });
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** Record a link visit; resolves the server's unlock time for the Claim button. */
export async function visitTask(taskId: string): Promise<number | null> {
  const g = gctx();
  if (!g) return null;
  try {
    const d = await post<{ ok: boolean; unlockAt?: number | null }>('/tasks/visit', { gctx: g, taskId });
    return d.ok ? (d.unlockAt ?? null) : null;
  } catch {
    return null;
  }
}

export function shareTask(): void {
  const g = gctx();
  if (!g) return;
  void post('/tasks/share', { gctx: g }).catch(() => {});
}

/** Record who invited this player, when a `ref` deep-link param is present. */
export function sendReferral(ref: string): void {
  const g = gctx();
  if (!g) return;
  void post('/tasks/referral', { gctx: g, ref }).catch(() => {});
}
