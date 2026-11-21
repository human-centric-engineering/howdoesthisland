/**
 * What the landing hero shows with the quick-scan switch off (t-62; the
 * owner's choice): a short passage of sample copy with a review's notes
 * marked in place, in the report's own mark-up (`MarkedUpCopy`). Static, with
 * no scores, so nothing on the page is quick-scan output. The notes are the
 * prototype's for calibration case ev05, a cold email, worded as the AI
 * reviewers write them.
 *
 * Replace with a stored full review when there is one to show.
 */

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

const NOTES = [
  {
    number: 1,
    dimension: 'Goodwill and reader focus',
    note: 'Start with her problem, not your job title. The more a message is about the sender, the less it is trusted.',
  },
  {
    number: 2,
    dimension: 'Specific claims and evidence',
    note: '“Leading provider” with nothing behind it. Name a client and a result, or cut the claim.',
  },
  {
    number: 3,
    dimension: 'Mechanism and reasoning',
    note: 'Show how, not just what. A named method makes a familiar promise believable.',
  },
  {
    number: 4,
    dimension: 'The call to act',
    note: 'Shrink the ask, and give a reason for now. A small first step is far more likely to be taken.',
  },
] as const;

export function SampleMarkUp() {
  return (
    <section
      aria-labelledby="sample-mark-up-heading"
      data-testid="sample-mark-up"
      className="border border-(--hd-rule) bg-(--hd-paper) p-6 sm:p-7"
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
                  <a
                    href={`#sample-note-${run.note}`}
                    aria-label={`Note ${run.note}`}
                    className="ml-0.5 align-super font-mono text-[0.6rem] text-(--hd-muted) no-underline"
                  >
                    {run.note}
                  </a>
                </mark>
              )
            )}
          </p>
        ))}
      </div>
      <ol className="mt-6 grid gap-3 text-sm" aria-label="Notes">
        {NOTES.map((n) => (
          <li
            key={n.number}
            id={`sample-note-${n.number}`}
            className="border-l-2 border-(--hd-red) pl-3"
          >
            <p className="font-mono text-[0.7rem] text-(--hd-muted) uppercase">
              {n.number} · To fix · {n.dimension}
            </p>
            <p className="mt-1">{n.note}</p>
          </li>
        ))}
      </ol>
      <p className="mt-5 border-t border-dashed border-(--hd-rule) pt-4 text-sm text-(--hd-muted)">
        An example of the notes a review writes. In yours, a note about a line quotes that line
        exactly.
      </p>
    </section>
  );
}
