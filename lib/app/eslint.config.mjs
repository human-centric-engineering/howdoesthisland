/**
 * Fork-owned ESLint config seam.
 *
 * **Fork-owned scaffold** — Sunrise ships this as `export default []` and does
 * NOT change it after release, so your edits here merge cleanly on upgrade (the
 * stable contract is this file's default export — an array of flat-config
 * blocks — not its contents). Treat it like the other `lib/app/*` seams.
 *
 * Auto-wired: the root `eslint.config.mjs` spreads this array **after** all
 * Sunrise core blocks, so a fork adds its own import-boundary rules (e.g. a
 * `framework ↔ core` layer boundary) here instead of editing the platform
 * config — no merge conflict on `git merge vX.Y.Z`.
 *
 * Two load-bearing rules of the seam:
 *
 * 1. **Spread order matters — this array lands LAST.** Because a later
 *    flat-config block overrides an earlier one for overlapping `files`, a fork
 *    block here wins for its own paths. A framework-tier fork (Sunrise →
 *    framework → leaf) spreads its `lib/framework/eslint.config.mjs` first and
 *    keeps this leaf seam last.
 *
 * 2. **`no-restricted-imports` REPLACES, it does not merge.** Flat config does
 *    not deep-merge rule options: a block that sets `no-restricted-imports` for
 *    a glob fully replaces any earlier setting for the files it matches — it
 *    does NOT add to it. So a fork block that restricts its own imports must
 *    **restate the base `@/`-alias ban** (the `no-restricted-imports` rule from
 *    core) for its globs, or relative-import enforcement silently drops on those
 *    paths. Restate the whole rule per glob; don't assume core's still applies.
 *
 * Example (a fork's `framework ↔ core` boundary — put the blocks in this array):
 *
 *   export default [
 *     {
 *       files: ['lib/framework/**\/*.{ts,tsx}'],
 *       rules: {
 *         'no-restricted-imports': ['error', { patterns: [
 *           // restate the core @/-alias ban for this glob (replace-not-merge)…
 *           { group: ['./*', '../*'], message: 'Use the @/ alias, not relative paths.' },
 *           // …then add the fork's own boundary rule:
 *           { group: ['@/lib/app/*'], message: 'framework must not import the leaf app tier.' },
 *         ] }],
 *       },
 *     },
 *   ];
 *
 * See CUSTOMIZATION.md §4 and .context/architecture/lint-toolchain.md.
 */
export default [
  // HowDoesThisLand: `prototype/` is the original Claude artefact, kept verbatim
  // as the reference the app is ported from (prototype/BRIEF.md). It is plain
  // JS/JSX built by its own toolchain, not app code, so it is not linted.
  // A block holding only `ignores` is a global ignore wherever it sits.
  { ignores: ['prototype/**'] },

  // HowDoesThisLand (t-91): Sunrise 0.21.0 rejects text written into the JSX
  // of its user and public screens (`react/jsx-no-literals`, §138), because
  // those read every string from its catalogue. Its globs (`app/(protected)/**`,
  // `app/(public)/**`) also take in this app's own routes, which are not on
  // the catalogue: the app ships English only. Sunrise's block says a fork's
  // own screens are the fork's call, so the rule is off for these routes
  // alone; Sunrise's screens beside them keep it. A route added under those
  // groups is listed here, or put on the catalogue.
  {
    files: [
      'app/(protected)/{assess,assessments,compare,home,projects,usage}/**/*.tsx',
      'app/(protected)/settings/{api-keys,webhooks,workspace}/**/*.tsx',
      'app/(public)/{developers,example-review,model,quick-scan,r,redeem}/**/*.tsx',
      'app/(public)/{opengraph-image,twitter-image}.tsx',
    ],
    rules: { 'react/jsx-no-literals': 'off' },
  },
];
