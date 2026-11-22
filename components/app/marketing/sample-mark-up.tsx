/**
 * What the landing hero shows (t-62, t-69; the owner's choice): the opening
 * of a sample cold email with a review's notes marked in place, in the
 * report's own mark-up. Static. The email is the one `/example-review` takes
 * through a full review (`lib/app/example/example-review.ts`), and the whole
 * card links there: one link, so the note numbers are plain markers, not
 * links of their own.
 */
import Link from 'next/link';

type Run = string | { text: string; note: number };

const PASSAGE: readonly Run[][] = [
  ['Hi Sarah,'],
  [
    {
      text: 'My name is Tom and I am the Business Development Manager at BrightPath Consulting.',
      note: 1,
    },
    ' ',
    { text: 'We are a leading provider of digital transformation solutions.', note: 2 },
    ' ',
    { text: 'Our innovative approach delivers outstanding results for our clients.', note: 3 },
  ],
  [
    {
      text: 'I would love to set up a 45-minute call to walk you through our capabilities.',
      note: 4,
    },
  ],
];

/** The AI reviewers' notes on these lines in the full example (`/example-review`). */
const NOTES = [
  {
    number: 1,
    dimension: 'Goodwill and reader focus',
    note: 'The first line is about the sender. A cold reader decides in this sentence whether the email is for her.',
  },
  {
    number: 2,
    dimension: 'Integrity and candour',
    note: 'A self-awarded superlative with nothing behind it. A sceptical reader discounts it, and what follows.',
  },
  {
    number: 3,
    dimension: 'Borrowed credibility',
    note: 'Which clients, and what results? One named result would do more than both adjectives.',
  },
  {
    number: 4,
    dimension: 'The call to act',
    note: 'Forty-five minutes about “our capabilities” is a big ask from a stranger, and it is about him.',
  },
] as const;

export function SampleMarkUp({ href }: { href: string }) {
  return (
    <section
      aria-labelledby="sample-mark-up-heading"
      data-testid="sample-mark-up"
      className="group relative border border-(--hd-rule) bg-(--hd-paper) p-6 transition-[border-color,box-shadow,transform] duration-300 focus-within:border-(--hd-ink) hover:-translate-y-0.5 hover:border-(--hd-ink) hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-7"
    >
      <p className="hd-slug">Sample · A cold email</p>
      <h2 id="sample-mark-up-heading" className="mt-2 text-2xl leading-tight font-bold">
        What a review marks up
      </h2>
      <div className="mt-5 space-y-3 text-[1.05rem] leading-relaxed">
        {PASSAGE.map((para, i) => (
          <p key={i}>
            {para.map((run, j) =>
              typeof run === 'string' ? (
                <span key={j}>{run}</span>
              ) : (
                <mark
                  key={j}
                  className="bg-transparent text-inherit underline decoration-(--hd-red) decoration-2 underline-offset-4"
                >
                  {run.text}
                  <sup className="ml-0.5 font-mono text-[0.6rem] text-(--hd-muted)">{run.note}</sup>
                </mark>
              )
            )}
          </p>
        ))}
      </div>
      <ol className="mt-6 grid gap-3 text-sm" aria-label="Notes">
        {NOTES.map((n) => (
          <li key={n.number} className="border-l-2 border-(--hd-red) pl-3">
            <p className="font-mono text-[0.7rem] text-(--hd-muted) uppercase">
              {n.number} · To fix · {n.dimension}
            </p>
            <p className="mt-1">{n.note}</p>
          </li>
        ))}
      </ol>
      <p className="mt-5 border-t border-dashed border-(--hd-rule) pt-4 text-sm">
        <Link
          href={href}
          className="font-semibold underline-offset-4 group-hover:underline after:absolute after:inset-0 after:content-['']"
          data-testid="sample-mark-up-link"
        >
          See this email reviewed, step by step
          <span
            aria-hidden="true"
            className="ml-1 inline-block transition-transform group-hover:translate-x-1"
          >
            →
          </span>
        </Link>
      </p>
    </section>
  );
}
