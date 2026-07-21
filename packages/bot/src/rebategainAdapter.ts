import { config } from './config';

/**
 * The ONE seam to the RebateGain back office (PRD-ADMIN-EMAIL Part C).
 *
 * v1 is MANUAL: `findAccountByEmail` tells the operator to search by hand, and
 * `setRebateShare` only records what the operator did (the panel writes the audit
 * trail). When RebateGain exposes an API, ONLY this module changes — the panel,
 * schema, prize states, and audit log stay identical. Keep both signatures stable.
 */

export interface AccountMatch {
  /** Whether this ran against a real API (false = manual, operator does the search). */
  automated: boolean;
  /** Back-office account reference, if the automated path found one. */
  accountRef: string | null;
  /** A deep link to the back office for the operator to search, if configured. */
  searchUrl: string | null;
  note: string;
}

export function findAccountByEmail(email: string): AccountMatch {
  // v1: manual. Hand the operator a search entry point (deep link if configured).
  const searchUrl = config.backofficeUrl
    ? `${config.backofficeUrl.replace(/\/$/, '')}/search?email=${encodeURIComponent(email)}`
    : null;
  return {
    automated: false,
    accountRef: null,
    searchUrl,
    note: 'Search this email in the RebateGain back office, then record the account reference.',
  };
}

export interface SetShareResult {
  automated: boolean;
  applied: boolean;
  note: string;
}

export function setRebateShare(
  accountRef: string,
  pct: number,
  from: number,
  until: number,
): SetShareResult {
  // v1: manual. The operator sets the share in the back office; the panel records
  // it (share, dates, ref) to the audit log via applyPrize. Nothing to call yet.
  void accountRef;
  void pct;
  void from;
  void until;
  return {
    automated: false,
    applied: false,
    note: 'Set the rebate share manually in the back office, then mark the prize applied.',
  };
}
