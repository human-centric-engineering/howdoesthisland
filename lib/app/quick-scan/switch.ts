/**
 * The quick-scan switch (t-61).
 *
 * The owner may launch without the quick scan, so it sits behind one switch:
 * `QUICK_SCAN_ENABLED`, on by default outside production and off in
 * production, as the culture switch is (`lib/app/frameworks/culture.ts`).
 * Off, `POST /api/v1/scan` answers 404 and is absent from its OpenAPI
 * document and `/developers`. A page that later offers the quick scan checks
 * it too. It does **not** cover the engine's fallback when a judge fails,
 * calibration's quick mode, or the `quick` profile of `POST assessments`,
 * which a workspace member runs with their own account.
 *
 * Reads only the environment, so the route registry and its schemas can
 * import it without the auth and database stack. Who may run the quick scan
 * is `./access.ts`.
 *
 * Read per call, not at module load, so a test can flip it.
 */
import { env } from '@/lib/env';

export function isQuickScanEnabled(): boolean {
  return env.QUICK_SCAN_ENABLED ?? env.NODE_ENV !== 'production';
}
