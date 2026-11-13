/**
 * Where the port's output differs from the prototype's baseline (t-13), and
 * why. Each difference traces to a fix; `baseline.test.ts` fails on any
 * difference not listed here, and on any listing that no longer differs.
 *
 * Do not add a case here to make a test pass without a fix it traces to. Do
 * not re-record the baseline to absorb a difference either: the baseline is
 * the prototype's, and this list is what the port changed about it.
 */

export interface ListedDifference {
  /** The fix it traces to. */
  fix: 'locate-offsets' | 'red-flag-penalty-key';
  /** Why the output differs. */
  why: string;
  /** Every differing path in the case must match one of these. */
  paths: readonly RegExp[];
  /** Fixture files (`corpus/…`, `eval/…`) whose output differs this way. */
  cases: readonly string[];
}

export const LISTED_DIFFERENCES: readonly ListedDifference[] = [
  {
    fix: 'locate-offsets',
    why:
      'BRIEF §5: the prototype’s locate() returned offsets into text.toLowerCase(), which is ' +
      'two code units longer per earlier İ (U+0130). The port maps them back into the text, so ' +
      'a judge highlight found case-insensitively, or once whitespace is collapsed, starts and ' +
      'ends where its quote is. These texts open on İstanbul and İzmir.',
    paths: [/^\$\.assemble\.full\.highlights\[\d+\]\.(start|end)$/],
    cases: [
      'corpus/istanbul-release-1.json',
      'corpus/istanbul-release-2.json',
      'corpus/istanbul-release-3.json',
      'corpus/istanbul-release-4.json',
      'corpus/izmir-update-1.json',
      'corpus/izmir-update-2.json',
      'corpus/izmir-update-3.json',
      'corpus/izmir-update-4.json',
    ],
  },
  {
    fix: 'red-flag-penalty-key',
    why:
      'The prototype’s quick scan follows its red flags with a penalty keyed on f.dimension, ' +
      'which a found flag does not carry. No real score moves; the penalty lands on a score ' +
      'and a note named "undefined" (the score NaN, recorded as null). The port keeps every ' +
      'score and drops the stray pair. In every case where the quick scan finds a red flag.',
    paths: [/^\$\.quickScan\.(scores|notes)\.undefined$/],
    cases: [
      'corpus/cover-letter-1.json',
      'corpus/cover-letter-2.json',
      'corpus/cover-letter-3.json',
      'corpus/cover-letter-4.json',
      'corpus/fundraising-1.json',
      'corpus/fundraising-2.json',
      'corpus/fundraising-3.json',
      'corpus/fundraising-4.json',
      'corpus/launch-email-1.json',
      'corpus/launch-email-2.json',
      'corpus/launch-email-3.json',
      'corpus/launch-email-4.json',
      'corpus/social-hype-1.json',
      'corpus/social-hype-2.json',
      'corpus/social-hype-3.json',
      'corpus/social-hype-4.json',
      'eval/ev01.json',
      'eval/ev07.json',
      'eval/ev09.json',
      'eval/ev11.json',
      'eval/ev12.json',
      'eval/ev16.json',
    ],
  },
];
