# Divergence ledger

Every edit HowDoesThisLand carries to a file Sunrise owns. Without this list the
next upstream sync would rediscover these as conflicts, or overwrite them. The
rule is `sunrise.divergences` in the Hub's `hub://process/sunrise-fork`: **an
edit to a Sunrise-owned file gets a row here in the same PR**, and each row says
what deletes it. The row shape and the sync steps are in
[`CUSTOMIZATION.md`](../../CUSTOMIZATION.md#the-divergence-ledger).

- **Base:** Sunrise `v0.18.0` (`68df9103`). `lib/sunrise-version.ts` reads
  `0.18.0`. After a sync, move the base to the release merged.
- **Not rows:**
  - new files, including everything under `prototype/`;
  - anything in the fork-owned tiers (`lib/app/**`, `components/app/**`,
    `.context/app/**`, `prisma/schema/app.prisma`). Filling a `lib/app/*`
    seam is not a divergence, but pinning the platform test that asserts the
    seam ships empty is (row 2);
  - `package.json` name, version, description, keywords and URLs, and the
    matching root lines of `package-lock.json` (CUSTOMIZATION.md §1 and §7).
    On conflict, keep ours for those fields and take theirs for everything
    else, then run `npm install --package-lock-only`.
- **Re-derive the list** of modified and deleted Sunrise files with:
  `git diff --diff-filter=MD --name-only 68df9103 HEAD -- . ':!lib/app' ':!components/app' ':!.context/app' ':!prisma/schema/app.prisma' ':!package.json' ':!package-lock.json'`
- **At a sync:** read the rows before you merge, then follow
  [CUSTOMIZATION.md §9](../../CUSTOMIZATION.md#pulling-a-release): retire the
  rows the release made unnecessary first, then resolve each remaining conflict
  by its row's merge action.

| #   | File                                  | Change                                                                                                                                              | Why no seam could carry it                                                                                                                                                                                                        | Merge action                                   | Upstream                                                                                                                                              | Delete when                                                                                       |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | `README.md`, `.env.development`       | README rewritten as HowDoesThisLand's. `PORT=3026`, with the ports the other HCE apps use listed above it.                                          | The README is this repo's front page. `.env.development` is the file CUSTOMIZATION.md §1 tells a fork to change, so two apps don't fight over port 3010.                                                                          | Keep mine.                                     | none — this is the fork's identity, which no upstream change should remove.                                                                           | Never.                                                                                            |
| 2   | `tests/unit/lib/app/defaults.test.ts` | Two rows pinned under `FORK` comments: `lib/app/eslint.config.mjs` to the `prototype/**` ignore, and `lib/app/reserved-tiers.ts` to `.context/app`. | The test asserts every seam ships empty, and its FORK NOTE says a fork that fills one pins the row rather than deleting it, so the seams it has not filled stay guarded.                                                          | Take theirs, then re-apply the two pins.       | none — working as designed upstream.                                                                                                                  | A pinned seam is emptied again, or upstream makes those rows read the fork's own declaration.     |
| 3   | `.prettierignore`                     | Adds `prototype`, at the end of the file.                                                                                                           | `prototype/` is the original artefact, kept verbatim as the reference to port from; formatting it would rewrite the reference. Prettier reads one ignore file at the repo root, and Sunrise has no fork-owned ignore list for it. | Take theirs, then re-add our block at the end. | not filed yet. Candidate ask: a fork-owned Prettier ignore list, as `lib/app/eslint.config.mjs` is for ESLint. Know Your Synth carries the same edit. | `prototype/` is removed, or Sunrise ships a fork-owned Prettier ignore and the entry moves there. |

Next row: 4
