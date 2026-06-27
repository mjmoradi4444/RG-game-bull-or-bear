import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root (…/packages/data-pipeline). */
export const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CACHE_DIR = join(PKG_ROOT, '.cache');

export function cacheSub(name: string): string {
  const dir = join(CACHE_DIR, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Cache a fetched candle series so re-runs (and curation tweaks) don't re-fetch. */
export function readSeriesCache<T>(key: string): T | null {
  const file = join(cacheSub('series'), `${key}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null;
}

export function writeSeriesCache(key: string, data: unknown): void {
  writeFileSync(join(cacheSub('series'), `${key}.json`), JSON.stringify(data));
}
