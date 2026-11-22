/**
 * The free quick scan page's copy (t-68). The caveat itself is
 * `QUICK_SCAN_CAVEAT` (`lib/app/quick-scan/summary.ts`), one string for the
 * page and the API alike, shown beside every score.
 *
 * Words follow app-plan §4, "The words we use": the quick scan is "the quick
 * scan"; the free offer of a full review is never called a scan.
 */
export const QUICK_SCAN_COPY = {
  slug: 'Free quick scan',
  h1: 'Check your copy in seconds, free.',
  lead: 'Paste a draft and see a first score for credibility, emotion, logic and timing. No sign-up, and nothing is kept.',
  caveatH: 'What the quick scan can and can’t do',
  textLabel: 'Your copy',
  textHint: 'Paste the text itself, up to 40,000 characters.',
  typeLabel: 'Type of copy',
  typeHelp:
    'What kind of piece this is. Each type needs a different mix: a CV leans on credibility, a fundraising appeal on emotion. If none fits, leave it as general.',
  submit: 'Run the quick scan',
  running: 'Scanning…',
  resultH: 'Your quick scan',
  outOf: 'out of 100',
  fullH: 'Want to know how it will really land?',
  full: 'A full review gives your copy to a panel of AI reviewers. They read it as your reader would, mark the lines that win them over and the ones that lose them, and suggest what to say instead.',
  redeem: 'Have a code? Get your free review',
  signup: 'Create an account',
  failed: 'The quick scan didn’t run. Please try again.',
} as const;
