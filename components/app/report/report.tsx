import type { ReactNode } from 'react';
import { MarkedUpCopy } from '@/components/app/report/marked-up-copy';
import { DIMENSION_MAX, type ReportView } from '@/lib/app/reports/view';
import { WORDS } from '@/lib/app/reports/words';

/**
 * Where the report is read. One component renders all three (app-plan §8.5),
 * so the PDF (x1) and the shared link (x2) cannot drift from the web report:
 *
 * - `web`: the signed-in workspace's page.
 * - `print`: what the PDF is made from. It goes to clients, so it leaves out
 *   what is the workspace's own business (the run's cost).
 * - `shared`: what a link opens, signed out. It leaves out the same, and
 *   anything naming the workspace or its people.
 */
export type ReportVariant = 'web' | 'print' | 'shared';

const APPEAL_COLOUR: Readonly<Record<string, string>> = {
  ethos: 'var(--hd-ethos)',
  pathos: 'var(--hd-pathos)',
  logos: 'var(--hd-logos)',
  kairos: 'var(--hd-kairos)',
};

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function Section({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="border-t px-6 py-10 md:px-10 print:break-inside-auto print:px-0 print:py-6"
    >
      <p className="hd-slug">§ {String(number).padStart(2, '0')}</p>
      <h2
        id={`${id}-heading`}
        className="mt-2 text-2xl font-bold md:text-3xl print:break-after-avoid"
      >
        {title}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Bar({ value, max = 100, colour }: { value: number; max?: number; colour?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span className="block h-1.5 w-full bg-(--hd-rule)" aria-hidden="true">
      <span
        className="block h-full"
        style={{ width: `${pct}%`, background: colour ?? 'var(--hd-ink)' }}
      />
    </span>
  );
}

export function Report({ view, variant }: { view: ReportView; variant: ReportVariant }) {
  const sections: { id: string; title: string; body: ReactNode }[] = [];
  const add = (id: string, title: string, body: ReactNode) => sections.push({ id, title, body });

  add('verdict', 'Verdict', <Verdict view={view} />);
  add('lands', 'How it lands', <HowItLands view={view} />);
  if (view.copy.notes.length > 0) {
    add('copy', 'The copy, marked up', <MarkedUpCopy copy={view.copy} />);
  }
  if (view.recommendations.length > 0) {
    add('recommendations', 'Recommendations', <Recommendations view={view} />);
  }
  if (view.flags.length > 0) add('flags', 'Red flags', <RedFlags view={view} />);
  if (view.dimensions.length > 0) add('dimensions', 'Dimensions', <Dimensions view={view} />);
  if (view.lenses.length > 0 || view.duties.rows.length > 0) {
    add('duties', 'Duties and lenses', <DutiesAndLenses view={view} />);
  }
  if (view.perspectives.length > 0) {
    add('perspectives', 'Influence perspectives', <Perspectives view={view} />);
  }
  add('craft', 'Craft metrics', <Craft view={view} />);
  if (view.culture) add('culture', 'Culture', <Culture culture={view.culture} />);
  add('method', 'Method and limitations', <Method view={view} variant={variant} />);

  return (
    <article
      className="hd-sheet mx-auto max-w-5xl print:max-w-none print:shadow-none"
      data-variant={variant}
      aria-labelledby="report-title"
    >
      <Cover view={view} />
      {sections.map((s, i) => (
        <Section key={s.id} id={s.id} number={i + 1} title={s.title}>
          {s.body}
        </Section>
      ))}
    </article>
  );
}

function Cover({ view }: { view: ReportView }) {
  const { cover } = view;
  return (
    <header className="px-6 py-12 md:px-10 print:px-0 print:pt-0">
      <p className="hd-slug">
        {WORDS.Review} · {view.mode === 'quick' ? 'Quick scan' : `${WORDS.AiReviewers}`}
        {view.status === 'partial' ? ' · Partial' : ''}
      </p>
      <h1 id="report-title" className="mt-3 text-4xl leading-tight font-bold md:text-5xl">
        {cover.title ?? 'Untitled copy'}
      </h1>
      <dl className="mt-6 grid gap-x-8 gap-y-2 font-mono text-xs sm:grid-cols-2">
        <div>
          <dt className="text-(--hd-muted) uppercase">{WORDS.TypeOfCopy}</dt>
          <dd>{cover.typeOfCopy}</dd>
        </div>
        {cover.audience.length > 0 ? (
          <div>
            <dt className="text-(--hd-muted) uppercase">Audience</dt>
            <dd>{cover.audience.join(' · ')}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-(--hd-muted) uppercase">Date</dt>
          <dd>{dateFormat.format(new Date(cover.date))}</dd>
        </div>
        <div>
          <dt className="text-(--hd-muted) uppercase">Model</dt>
          <dd>{cover.framework}</dd>
        </div>
        <div>
          <dt className="text-(--hd-muted) uppercase">Word count</dt>
          <dd>{cover.wordCount}</dd>
        </div>
      </dl>
    </header>
  );
}

function Verdict({ view }: { view: ReportView }) {
  const { verdict } = view;
  return (
    <div className="grid gap-8 md:grid-cols-[12rem_minmax(0,1fr)]">
      <div>
        <p className="font-serif text-7xl leading-none font-bold" data-testid="overall">
          {verdict.overall}
        </p>
        <p className="mt-2 font-mono text-sm uppercase">{verdict.band}</p>
      </div>
      {verdict.editor ? (
        <div className="grid gap-6">
          <p className="text-xl leading-relaxed">{verdict.editor.verdict}</p>
          {verdict.editor.changes.length > 0 ? (
            <div>
              <h3 className="font-mono text-xs text-(--hd-muted) uppercase">
                The changes that matter most
              </h3>
              <ol className="mt-3 grid list-decimal gap-3 pl-5">
                {verdict.editor.changes.map((c, i) => (
                  <li key={i}>
                    <p className="font-semibold">{c.change}</p>
                    <p className="text-(--hd-muted)">{c.why}</p>
                    {c.recommendation !== null ? (
                      <a href={`#rec-${c.recommendation}`} className="text-xs underline">
                        Recommendation {c.recommendation}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {verdict.editor.works.length > 0 ? (
            <div>
              <h3 className="font-mono text-xs text-(--hd-muted) uppercase">What already works</h3>
              <ul className="mt-3 grid list-disc gap-2 pl-5">
                {verdict.editor.works.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HowItLands({ view }: { view: ReportView }) {
  const { lands } = view;
  return (
    <div className="grid gap-6">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Appeal scores against the target mix</caption>
        <thead className="font-mono text-xs text-(--hd-muted) uppercase">
          <tr>
            <th scope="col" className="py-2">
              Appeal
            </th>
            <th scope="col" className="py-2">
              Score
            </th>
            <th scope="col" className="py-2">
              Weight in the target mix
            </th>
          </tr>
        </thead>
        <tbody>
          {lands.appeals.map((a) => (
            <tr key={a.id} className="border-t align-top">
              <th scope="row" className="py-3 pr-4 font-semibold">
                <span style={{ color: APPEAL_COLOUR[a.id] }}>{a.name}</span>
                <span className="block text-xs font-normal text-(--hd-muted)">{a.question}</span>
              </th>
              <td className="w-1/3 py-3 pr-4">
                <span className="font-mono">{a.score}</span>
                <Bar value={a.score} colour={APPEAL_COLOUR[a.id]} />
              </td>
              <td className="py-3 font-mono">{a.target}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <span className="font-mono text-xs text-(--hd-muted) uppercase">Balance index</span>{' '}
        <span className="font-mono">{lands.balanceIndex}</span>
        <span className="text-(--hd-muted)">
          {' '}
          / 100: how closely the four appeals match the target mix.
        </span>
      </p>
      {lands.caps.map((c, i) => (
        <p key={i} className="border-l-2 border-(--hd-red) pl-3">
          <b>
            {c.appealName} capped at {c.cap}.
          </b>{' '}
          {c.why}
        </p>
      ))}
      {lands.findings.length > 0 ? (
        <ul className="grid gap-2">
          {lands.findings.map((f, i) => (
            <li key={i}>
              <b>{f.name}.</b> {f.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Recommendations({ view }: { view: ReportView }) {
  return (
    <ol className="grid gap-8">
      {view.recommendations.map((r) => (
        <li key={r.number} id={`rec-${r.number}`} className="break-inside-avoid">
          <p className="font-mono text-xs text-(--hd-muted) uppercase">
            {r.number} · <span style={{ color: APPEAL_COLOUR[r.appealId] }}>{r.appealName}</span> ·{' '}
            {r.dimensionName} · {r.impact} impact
          </p>
          <p className="mt-2 text-lg font-semibold">{r.issue}</p>
          {r.move ? <p className="mt-1 text-sm text-(--hd-muted)">Move: {r.move}</p> : null}
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {r.original ? (
              <blockquote className="border-l-2 pl-3 text-(--hd-muted)">
                <p className="font-mono text-[0.65rem] uppercase">
                  {r.example ? 'For example' : 'Original'}
                </p>
                <p className="mt-1">{r.original}</p>
              </blockquote>
            ) : null}
            <blockquote className="border-l-2 border-(--hd-ink) pl-3">
              <p className="font-mono text-[0.65rem] uppercase">Rewrite</p>
              <p className="mt-1">{r.rewrite}</p>
            </blockquote>
          </div>
        </li>
      ))}
    </ol>
  );
}

function RedFlags({ view }: { view: ReportView }) {
  return (
    <ul className="grid gap-4">
      {view.flags.map((f, i) => (
        <li key={i} className="break-inside-avoid border-l-2 border-(--hd-red) pl-3">
          <p className="font-mono text-xs uppercase">
            {f.name} · {f.severity}
          </p>
          <p className="mt-1 italic">&ldquo;{f.quote}&rdquo;</p>
          {f.note ? <p className="mt-1">{f.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function Dimensions({ view }: { view: ReportView }) {
  return (
    <div className="grid gap-10">
      {view.dimensions.map((g) => (
        <div key={g.id} className="break-inside-avoid-page">
          <h3 className="flex items-baseline justify-between text-xl font-bold">
            <span style={{ color: APPEAL_COLOUR[g.id] }}>{g.name}</span>
            {g.score !== null ? <span className="font-mono text-base">{g.score}</span> : null}
          </h3>
          {g.summary ? <p className="mt-2 text-(--hd-muted)">{g.summary}</p> : null}
          <table className="mt-3 w-full text-left text-sm">
            <caption className="sr-only">{g.name} dimensions</caption>
            <tbody>
              {g.rows.map((d) => (
                <tr key={d.id} id={`dim-${d.id}`} className="border-t align-top">
                  <th scope="row" className="w-1/3 py-2 pr-4 font-semibold">
                    {d.name}
                  </th>
                  <td className="w-20 py-2 pr-4 font-mono">
                    {d.score}/{DIMENSION_MAX}
                  </td>
                  <td className="py-2">
                    {d.rationale ?? null}
                    {d.fromQuickScan ? (
                      <span className="ml-1 font-mono text-[0.65rem] text-(--hd-muted) uppercase">
                        quick scan
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function DutiesAndLenses({ view }: { view: ReportView }) {
  const { duties, lenses } = view;
  return (
    <div className="grid gap-8 md:grid-cols-2">
      {duties.rows.length > 0 ? (
        <div>
          <h3 className="font-mono text-xs text-(--hd-muted) uppercase">
            Duties · mostly {duties.primary}
            {duties.fit !== null ? ` · fit ${duties.fit}` : ''}
          </h3>
          <table className="mt-3 w-full text-left text-sm">
            <caption className="sr-only">Duty profile</caption>
            <thead className="font-mono text-[0.65rem] text-(--hd-muted) uppercase">
              <tr>
                <th scope="col">Duty</th>
                <th scope="col">Share</th>
                <th scope="col">Target</th>
              </tr>
            </thead>
            <tbody>
              {duties.rows.map((d) => (
                <tr key={d.id} className="border-t">
                  <th scope="row" className="py-2 pr-3 font-semibold">
                    {d.name}
                    <span className="block text-xs font-normal text-(--hd-muted)">{d.verb}</span>
                  </th>
                  <td className="py-2 pr-3 font-mono">{d.share}%</td>
                  <td className="py-2 font-mono">{d.target !== null ? `${d.target}%` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {lenses.length > 0 ? (
        <div>
          <h3 className="font-mono text-xs text-(--hd-muted) uppercase">Lenses</h3>
          <ul className="mt-3 grid gap-3">
            {lenses.map((l) => (
              <li key={l.id} id={`dim-${l.id}`}>
                <p className="flex justify-between">
                  <span className="font-semibold">{l.name}</span>
                  <span className="font-mono">{l.score}</span>
                </p>
                <p className="text-xs text-(--hd-muted)">{l.tagline}</p>
                <Bar value={l.score} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const LEVER_STATUS: Readonly<Record<string, string>> = {
  present: 'Used',
  absent: 'Missing',
  misused: 'Misused',
};

function Perspectives({ view }: { view: ReportView }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {view.perspectives.map((p) => (
        <div key={p.id} className="break-inside-avoid">
          <h3 className="flex justify-between font-semibold">
            <span>{p.name}</span>
            <span className="font-mono">{p.score !== null ? `${p.score}/4` : '–'}</span>
          </h3>
          <p className="text-xs text-(--hd-muted)">{p.question}</p>
          {p.summary ? <p className="mt-2 text-sm">{p.summary}</p> : null}
          {p.levers.length > 0 ? (
            <ul className="mt-2 grid gap-1 text-sm">
              {p.levers.map((l) => (
                <li key={l.id}>
                  <span className="font-mono text-[0.65rem] uppercase">
                    {LEVER_STATUS[l.status] ?? l.status}
                  </span>{' '}
                  {l.name}
                  {l.note ? <span className="text-(--hd-muted)">: {l.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Craft({ view }: { view: ReportView }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
      {view.craft.map((m) => (
        <div key={m.label}>
          <dt className="font-mono text-[0.65rem] text-(--hd-muted) uppercase">{m.label}</dt>
          <dd className="font-mono text-xl">{m.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Culture({ culture }: { culture: NonNullable<ReportView['culture']> }) {
  return (
    <div className="grid gap-4">
      <p>
        Read as for <b>{culture.reader}</b> ({culture.style})
        {culture.writer ? `, written from ${culture.writer}` : ''}.
      </p>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Culture scales: the copy against the reader</caption>
        <thead className="font-mono text-[0.65rem] text-(--hd-muted) uppercase">
          <tr>
            <th scope="col">Scale</th>
            <th scope="col">The copy</th>
            <th scope="col">The reader</th>
          </tr>
        </thead>
        <tbody>
          {culture.scales.map((s) => (
            <tr key={s.id} className="border-t align-top">
              <th scope="row" className="py-2 pr-3 font-semibold">
                {s.name}
                <span className="block text-xs font-normal text-(--hd-muted)">
                  {s.low} ↔ {s.high}
                </span>
              </th>
              <td className="py-2 pr-3 font-mono">{Math.round(s.position * 100)}</td>
              <td className="py-2 font-mono">{Math.round(s.target * 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const usd = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});

function Method({ view, variant }: { view: ReportView; variant: ReportVariant }) {
  const { method } = view;
  return (
    <div className="grid gap-6">
      {method.reviewers.length > 0 ? (
        <div>
          <h3 className="font-mono text-xs text-(--hd-muted) uppercase">{WORDS.AiReviewers}</h3>
          <ul className="mt-2 grid gap-1 text-sm">
            {method.reviewers.map((r) => (
              <li key={r.slot}>
                <b>{r.name}</b>
                {r.status === 'succeeded'
                  ? ` · ${r.model ?? 'model not recorded'}`
                  : r.status === 'failed'
                    ? ' · did not answer; its dimensions use the quick scan'
                    : ' · did not run; its dimensions use the quick scan'}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>
          A quick scan: the model&rsquo;s rules applied to the copy, with no {WORDS.aiReviewers}.
        </p>
      )}
      {method.fellBack.length > 0 ? (
        <p className="border-l-2 border-(--hd-kairos) pl-3">
          This {WORDS.review} is partial: {method.fellBack.join(', ')} fell back to the quick scan.
        </p>
      ) : null}
      {method.editor?.status === 'written' ? (
        <p className="text-sm">The verdict was written by the editor ({method.editor.model}).</p>
      ) : null}
      <p className="text-sm">Model: {method.framework}.</p>
      {variant === 'web' ? (
        <p className="text-sm">
          Cost of this {WORDS.review}: {usd.format(method.costUsd)}.
        </p>
      ) : null}
      <p className="font-semibold">{method.interpretation}</p>
      {method.limitations.length > 0 ? (
        <div>
          <h3 className="font-mono text-xs text-(--hd-muted) uppercase">Limitations</h3>
          <dl className="mt-3 grid gap-3 text-sm">
            {method.limitations.map((l) => (
              <div key={l.title} className="break-inside-avoid">
                <dt className="font-semibold">{l.title}</dt>
                <dd className="text-(--hd-muted)">{l.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
