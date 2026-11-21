import { z } from 'zod';

/**
 * App-defined server environment variables.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly when you pull an upstream
 * version (the stable contract is this file's export, not its body). Treat it
 * like the landing page: a starting point you're expected to modify.
 *
 * `lib/env.ts` merges this into the same fail-fast startup parse as the core
 * vars; server-side only. Extend, e.g.:
 *   `export const appEnvSchema = z.object({ STRIPE_SECRET_KEY: z.string().min(1) });`
 *
 * ## Framework tiers: the dynamic-import rule does NOT apply here (#535)
 *
 * §4 tells you to import your framework tier **dynamically** from the boot seam
 * (`await import('@/lib/framework')`), because a static framework specifier is
 * resolved at `next build` and breaks the build in vanilla Sunrise or any fork
 * without that folder.
 *
 * **That rule cannot be honoured at this file, and you should not try.**
 * `lib/env.ts` merges this schema during a synchronous module-load parse — the
 * schema has to exist at module-evaluation time, and `lib/env.ts` is imported by
 * essentially everything. There is no await to hang a dynamic import on. So a
 * framework tier declaring its own variables has exactly one option:
 *
 *   import { myFrameworkEnvSchema } from '@/lib/framework/env';   // necessarily static
 *   export const appEnvSchema = myFrameworkEnvSchema;
 *
 * This is safe **in your fork** for the same reason it is unsafe in core: the
 * specifier only has to resolve in a tree that actually has `lib/framework/`.
 * Yours does. Vanilla Sunrise ships `z.object({})` here and references no
 * framework vocabulary anywhere, which is the property the rule protects — and
 * it stays protected, because this file is fork-owned and Sunrise never edits it
 * after release.
 *
 * A mechanism to make this dynamic (lazy env, a registration callback) was
 * considered and rejected upstream: it would make the fail-fast startup parse
 * conditional, which is the one property the whole module exists for. Recorded
 * so nobody re-derives it.
 *
 * Full guide: CUSTOMIZATION.md §4 · .context/environment/overview.md
 */
export const appEnvSchema = z.object({
  /**
   * The culture module (app-plan D11): the Hofstede and Lewis data, and
   * everything built on it. `true` or `false`; unset means on outside
   * production and off in production, until the owner settles the data's
   * terms (`l2`). Read through `isCultureEnabled()`
   * (`lib/app/frameworks/culture.ts`), never directly.
   */
  CULTURE_MODULE_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true'))
    .describe('Serve the culture module (defaults to on outside production, off in production)'),
  /**
   * The quick scan (t-61): `POST /api/v1/scan`, its OpenAPI entry and its
   * place on `/developers`. `true` or `false`; unset means on outside production and
   * off in production, since the owner may launch without it. Read through
   * `isQuickScanEnabled()` (`lib/app/quick-scan.ts`), never directly.
   */
  QUICK_SCAN_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true'))
    .describe('Offer the quick scan (defaults to on outside production, off in production)'),
  PDF_CHROMIUM_PATH: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The Chromium (or Chrome) binary report PDFs are rendered with (t-31). Unset: ' +
        '/usr/bin/chromium-browser in the Docker image, and the usual Chrome install on macOS.'
    ),
});
