import { Fraunces, Spectral, Martian_Mono } from 'next/font/google';
import '@/components/app/design-lab/proof/proof.css';
import { SAMPLE, type AppealId } from '@/components/app/design-lab/sample';
import {
  segmentParagraphs,
  type Annotation,
  type Segment,
} from '@/components/app/design-lab/segments';
import type { LabTheme } from '@/components/app/design-lab/lab-frame';

const display = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--pf-display',
});
const read = Spectral({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  style: ['normal', 'italic'],
  variable: '--pf-read',
});
const mono = Martian_Mono({ subsets: ['latin'], variable: '--pf-mono' });

const APPEALS = SAMPLE.appeals.filter((a): a is typeof a & { id: AppealId } =>
  ['ethos', 'pathos', 'logos', 'kairos'].includes(a.id)
);
const CODE: Record<AppealId, string> = { ethos: 'ETH', pathos: 'PAT', logos: 'LOG', kairos: 'KAI' };

function ticks(score: number): string {
  const n = Math.round(score / 10);
  return '▮'.repeat(n) + '▯'.repeat(10 - n);
}

/** Wavy proof underline in the appeal's colour, with a numbered reference for the editor's changes. */
function Runs({ runs, refs }: { runs: Segment[]; refs: boolean }) {
  return (
    <>
      {runs.map((r, j) =>
        r.annotation ? (
          <span
            key={j}
            className="wavy"
            style={{ textDecorationColor: `var(--${r.annotation.appeal})` }}
            title={`${r.annotation.dimension}: ${r.annotation.note}`}
          >
            {r.text}
            {refs && (
              <span className="ref" style={{ color: `var(--${r.annotation.appeal})` }}>
                {r.annotation.change > 0 ? r.annotation.change : '·'}
              </span>
            )}
          </span>
        ) : (
          <span key={j}>{r.text}</span>
        )
      )}
    </>
  );
}

function Header() {
  return (
    <header className="top">
      <span className="wordmark">
        {SAMPLE.brand.name}
        <sup>v{SAMPLE.modelVersion}</sup>
      </span>
      <nav aria-label="Main">
        <a href="#hero">Assess</a>
        <a href="#report">Sample report</a>
        <a href="#hero">The model</a>
        <a href="#hero">API</a>
      </nav>
      <span className="right">
        <a href="#hero" className="mono" style={{ fontSize: 12, textTransform: 'uppercase' }}>
          Sign in
        </a>
        <a className="btn btn-red" href="#workbench">
          Free scan
        </a>
      </span>
    </header>
  );
}

function Hero() {
  const { before, after, notes } = SAMPLE;
  const first = notes.changes[0];
  const last = notes.changes[3];
  return (
    <section id="hero" className="screen">
      <div className="wrap">
        <p className="screen-label">Screen 1 · Landing hero</p>
        <div className="sheet">
          <Header />
          <div className="hero">
            <div className="gutter" aria-hidden="true">
              {Array.from({ length: 14 }, (_, i) => (
                <div key={i}>{String(i + 1).padStart(2, '0')}</div>
              ))}
            </div>
            <div className="body">
              <p className="slug" style={{ marginTop: 0 }}>
                Galley 01 · {SAMPLE.brand.tagline}
              </p>
              <h1>
                Find out why your words aren&rsquo;t landing, <em>before your reader does.</em>
              </h1>
              <p className="sub">{SAMPLE.brand.sub}</p>
              <div style={{ display: 'flex', gap: 12 }}>
                <a className="btn btn-red" href="#workbench">
                  Assess your text →
                </a>
                <a className="btn" href="#report">
                  See a marked-up report
                </a>
              </div>
              <div className="galley">
                <div>
                  <p>
                    <del>{first.before}</del>
                    <span className="caret">‸</span>
                    <ins>{first.after}</ins>
                  </p>
                  <p>
                    <del>{last.before}</del>
                    <span className="caret">‸</span>
                    <ins>{last.after}</ins>
                  </p>
                </div>
                <div className="tally">
                  <div className="slug">Quick scan</div>
                  <span className="n" style={{ color: 'var(--muted)' }}>
                    {before.scores.overall}
                  </span>
                  <span className="n"> → </span>
                  <span className="n" style={{ color: 'var(--red)' }}>
                    {after.scores.overall}
                  </span>
                </div>
              </div>
            </div>
            <aside className="margin" aria-label="Proof marks">
              <div className="pm">
                <b>del</b>sender first
              </div>
              <div className="pm">
                <b>tr</b>reader&rsquo;s problem to the top
              </div>
              <div className="pm">
                <b>?</b>source for &lsquo;leading provider&rsquo;
              </div>
              <div className="pm">
                <b>stet</b>honest limits
              </div>
              <div className="pm" style={{ color: 'var(--muted)' }}>
                {SAMPLE.counts.studies} studies · {SAMPLE.counts.thinkers} thinkers · every finding
                quotes your text
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

function Report() {
  const { before, notes, context } = SAMPLE;
  const paragraphs = segmentParagraphs(before.text, before.annotations);
  const seen = new Set<string>();
  return (
    <section id="report" className="screen">
      <div className="wrap">
        <p className="screen-label">Screen 2 · Report section with an annotated passage</p>
        <div className="sheet report-sheet">
          <div className="masthead">
            <h2>{before.title}</h2>
            <span className="slug">
              {context.contentType} · {context.archetype}, {context.role}
              <br />
              {context.relationship} reader · model v{SAMPLE.modelVersion}
            </span>
          </div>
          <div className="prow">
            <div className="gutter" />
            <div className="mid">
              <div className="editor-note" style={{ padding: '34px 0 8px' }}>
                <div>
                  <div className="score">{before.scores.overall}</div>
                  <span className="stamp">{before.scores.band}</span>
                </div>
                <blockquote>
                  {notes.verdict}
                  <cite>— The editor&rsquo;s summary</cite>
                </blockquote>
              </div>
              <div className="table" style={{ margin: '26px 0 26px' }}>
                {APPEALS.map((a) => (
                  <div key={a.id}>
                    <span style={{ color: `var(--${a.id})` }}>{a.name.toUpperCase()}</span>
                    <span>{before.scores[a.id]}</span>
                    <span className="ticks" style={{ color: `var(--${a.id})` }}>
                      {ticks(before.scores[a.id])}
                    </span>
                    <span className="why">{notes.appeals[a.id]}</span>
                  </div>
                ))}
              </div>
              <p className="slug">The text, marked up</p>
            </div>
            <div className="side" />
          </div>
          {paragraphs.map((runs, i) => {
            const marks = runs
              .map((r) => r.annotation)
              .filter((a): a is Annotation => {
                if (!a) return false;
                if (a.change > 0) return true;
                if (seen.has(a.note)) return false;
                seen.add(a.note);
                return true;
              });
            return (
              <div className="prow" key={i}>
                <div className="gutter">{String(i + 1).padStart(2, '0')}</div>
                <div className="mid proof-text" style={{ padding: '0 48px' }}>
                  <p>
                    <Runs runs={runs} refs />
                  </p>
                </div>
                <div className="side">
                  {marks.map((a) => (
                    <div className="pm" key={a.start}>
                      <span style={{ color: `var(--${a.appeal})` }}>
                        {a.change > 0 ? `${a.change} ` : '· '}
                        {CODE[a.appeal]} · {a.dimension}
                      </span>
                      <em>{a.note}</em>
                      {a.why && <span className="muted">{a.why}</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div style={{ height: 32 }} />
        </div>
      </div>
    </section>
  );
}

function Workbench() {
  const { before } = SAMPLE;
  const paragraphs = segmentParagraphs(before.text, before.annotations);
  const rows: (Segment[] | null)[] = paragraphs.flatMap((p, i) => (i === 0 ? [p] : [null, p]));
  const opt = (id: string) => SAMPLE.audience.find((m) => m.id === id)?.options ?? [];
  const field = (label: string, options: readonly string[], value?: string) => (
    <label className="kv">
      <span className="muted">{label}</span>
      <select defaultValue={value}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.split(':')[0]}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section id="workbench" className="screen">
      <div className="wrap">
        <p className="screen-label">Screen 3 · The workbench</p>
        <div className="ide sheet">
          <div className="ide-top">
            <b
              style={{
                fontFamily: 'var(--display)',
                fontSize: 17,
                textTransform: 'none',
                letterSpacing: 0,
              }}
            >
              HDTL
            </b>
            <a href="#workbench">Home</a>
            <a href="#workbench" aria-current="page">
              Assess
            </a>
            <a href="#workbench">Projects</a>
            <a href="#workbench">Compare</a>
            <a href="#workbench">Usage</a>
            <span className="muted" style={{ marginLeft: 'auto' }}>
              Northwind Studio / BrightPath outbound
            </span>
          </div>
          <nav className="files" aria-label="Drafts">
            <h4>Drafts in this project</h4>
            <a href="#workbench" aria-current="page">
              cold-email-sarah.txt <span>34</span>
              <small>edited now · quick scan</small>
            </a>
            <a href="#workbench">
              cold-email-sarah-v2.txt <span>55</span>
              <small>2 h ago · 6 judges</small>
            </a>
            <a href="#workbench">
              landing-hero.md <span>61</span>
              <small>yesterday · 4 judges</small>
            </a>
            <a href="#workbench">
              board-paper-q3.docx <span>72</span>
              <small>3 days ago · 9 judges</small>
            </a>
            <h4 style={{ marginTop: 22 }}>Context the judges read</h4>
            <a href="#workbench">
              positioning.md
              <small>project brief</small>
            </a>
            <a href="#workbench">
              voice-guide.pdf
              <small>12 pages</small>
            </a>
          </nav>
          <div className="code">
            <div style={{ gridColumn: '1 / -1' }}>
              {rows.map((r, i) => (
                <div className="crow" key={i}>
                  <span className="ln">{i + 1}</span>
                  <div className="t">{r ? <Runs runs={r} refs={false} /> : ' '}</div>
                </div>
              ))}
            </div>
          </div>
          <aside className="inspect">
            <h4 style={{ marginTop: 0 }}>Reader</h4>
            {field('content', SAMPLE.contentTypes, SAMPLE.context.contentType)}
            {field('archetype', opt('archetype'), 'The Builder: Show me the plan')}
            {field('relation', opt('relationship'), "Cold: they don't know you")}
            {field('awareness', opt('awareness'), 'Problem aware')}
            {field('motive', opt('focus'), 'Safety: wants to avoid mistakes')}
            {field('expertise', opt('expertise'), 'Informed')}
            <h4>Judges</h4>
            {SAMPLE.judgeCatalogue.map((j) => (
              <label className="chk" key={j.id} title={j.description}>
                <input
                  type="checkbox"
                  defaultChecked={j.always || j.id === 'craft'}
                  disabled={j.always}
                />
                {j.name}
              </label>
            ))}
            <h4>Flags</h4>
            <span>
              <span style={{ color: 'var(--kairos)' }}>▲</span> {before.balance[0]?.name}
            </span>
            <span className="muted">{before.balance[0]?.message}</span>
          </aside>
          <div className="status">
            <span>
              QUICK SCAN <b>{before.scores.overall}</b> {before.scores.band.toUpperCase()}
            </span>
            {APPEALS.map((a) => (
              <span key={a.id}>
                {CODE[a.id]} {before.scores[a.id]}
              </span>
            ))}
            <span>BAL {before.scores.balance_index}</span>
            <span>102 W</span>
            <a className="run" href="#report">
              Run 5 judges ⏎
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ProofDirection({ theme }: { theme: LabTheme }) {
  return (
    <div className={`pf ${display.variable} ${read.variable} ${mono.variable}`} data-theme={theme}>
      <Hero />
      <Report />
      <Workbench />
    </div>
  );
}
