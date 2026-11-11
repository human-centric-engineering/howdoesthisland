import { Newsreader, Schibsted_Grotesk } from 'next/font/google';
import '@/components/app/design-lab/concord/concord.css';
import { SAMPLE, type AppealId } from '@/components/app/design-lab/sample';
import { segmentParagraphs, type Annotation } from '@/components/app/design-lab/segments';
import type { LabTheme } from '@/components/app/design-lab/lab-frame';

const serif = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: ['300', '400', '500'],
  variable: '--cc-serif',
});
const sans = Schibsted_Grotesk({ subsets: ['latin'], variable: '--cc-sans' });

const APPEALS = SAMPLE.appeals.filter((a): a is typeof a & { id: AppealId } =>
  ['ethos', 'pathos', 'logos', 'kairos'].includes(a.id)
);

/** The lens two equal circles share: where perspectives meet. */
function lens(cx1: number, cx2: number, cy: number, r: number): string {
  const x = (cx1 + cx2) / 2;
  const h = Math.sqrt(r * r - ((cx2 - cx1) / 2) ** 2);
  return `M${x} ${cy - h}A${r} ${r} 0 0 1 ${x} ${cy + h}A${r} ${r} 0 0 1 ${x} ${cy - h}Z`;
}

function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size * 1.5} height={size} viewBox="0 0 42 28" aria-hidden="true">
      <path d={lens(14, 28, 14, 12)} fill="var(--accent)" />
      <circle cx="14" cy="14" r="12" fill="none" stroke="var(--ink)" strokeWidth="1.6" />
      <circle cx="28" cy="14" r="12" fill="none" stroke="var(--ink)" strokeWidth="1.6" />
    </svg>
  );
}

function Header() {
  return (
    <header className="top">
      <span className="wordmark">
        <Mark />
        {SAMPLE.brand.name}
      </span>
      <nav aria-label="Main">
        <a href="#hero">How it works</a>
        <a href="#report">Sample report</a>
        <a href="#hero">The model</a>
        <a href="#hero">Developers</a>
      </nav>
      <span className="right">
        <a href="#hero">Sign in</a>
        <a className="btn btn-primary btn-sm" href="#workbench">
          Try the free scan
        </a>
      </span>
    </header>
  );
}

function HeroVenn() {
  const { before, after } = SAMPLE;
  const r = 165;
  const [a, b, cy] = [185, 345, 200];
  return (
    <svg
      className="venn"
      viewBox="0 0 530 400"
      role="img"
      aria-label="What you wrote meets what they read"
    >
      <circle cx={a} cy={cy} r={r} fill="none" stroke="var(--left)" strokeWidth="1.4" />
      <circle cx={b} cy={cy} r={r} fill="none" stroke="var(--left)" strokeWidth="1.4" />
      <path d={lens(a, b, cy, r)} fill="var(--accent)" />
      <text
        x={a - 92}
        y={cy - 8}
        fontSize="13"
        fill="var(--muted)"
        textAnchor="middle"
        letterSpacing="1.5"
      >
        WHAT YOU WROTE
      </text>
      <text x={a - 92} y={cy + 22} fontSize="15" fill="var(--ink)" textAnchor="middle">
        “a 45-minute call”
      </text>
      <text
        x={b + 92}
        y={cy - 8}
        fontSize="13"
        fill="var(--muted)"
        textAnchor="middle"
        letterSpacing="1.5"
      >
        WHAT SHE READS
      </text>
      <text x={b + 92} y={cy + 22} fontSize="15" fill="var(--ink)" textAnchor="middle">
        “another vendor”
      </text>
      <text
        x={(a + b) / 2}
        y={cy - 46}
        fontSize="11"
        fill="var(--bg)"
        textAnchor="middle"
        letterSpacing="1.5"
      >
        HOW IT LANDS
      </text>
      <text
        x={(a + b) / 2}
        y={cy + 18}
        fontSize="58"
        fill="var(--bg)"
        textAnchor="middle"
        style={{ fontFamily: 'var(--serif)' }}
      >
        {before.scores.overall}
      </text>
      <text x={(a + b) / 2} y={cy + 48} fontSize="12" fill="var(--bg)" textAnchor="middle">
        → {after.scores.overall} rewritten
      </text>
    </svg>
  );
}

function Hero() {
  return (
    <section id="hero" className="screen">
      <div className="wrap">
        <p className="screen-label">Screen 1 · Landing hero</p>
        <Header />
        <div className="hero">
          <div>
            <span className="eyebrow">{SAMPLE.brand.tagline}</span>
            <h1>
              Find out why your words aren&rsquo;t landing, <i>before your reader does.</i>
            </h1>
            <p className="sub">{SAMPLE.brand.sub}</p>
            <div style={{ display: 'flex', gap: 12 }}>
              <a className="btn btn-primary" href="#workbench">
                Assess your text →
              </a>
              <a className="btn" href="#report">
                Read a sample report
              </a>
            </div>
          </div>
          <HeroVenn />
        </div>
        <div className="facts">
          <div>
            <b>4</b>
            <span className="muted">appeals, from Aristotle to now</span>
          </div>
          <div>
            <b>{SAMPLE.counts.perspectives}</b>
            <span className="muted">schools of influence research</span>
          </div>
          <div>
            <b>{SAMPLE.counts.studies}</b>
            <span className="muted">studies, each marked by how well it held up</span>
          </div>
          <div>
            <b>{SAMPLE.counts.moves}</b>
            <span className="muted">rewrite moves, none that invent proof</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Four overlapping circles, one per appeal; each circle's area tracks its score. */
function AppealChain({ scores }: { scores: Record<AppealId, number> }) {
  const base = 64;
  return (
    <svg viewBox="0 0 420 200" role="img" aria-label="Scores for the four appeals">
      {APPEALS.map((a, i) => {
        const r = Math.max(18, base * Math.sqrt(scores[a.id] / 50));
        const cx = 80 + i * 86;
        return (
          <g key={a.id}>
            <circle
              cx={cx}
              cy={92}
              r={r}
              fill={`var(--${a.id})`}
              fillOpacity=".78"
              className="blend"
            />
            <text x={cx} y={186} textAnchor="middle" fontSize="13" fill="var(--muted)">
              {a.name}
            </text>
            <text
              x={cx}
              y={99}
              textAnchor="middle"
              fontSize="20"
              fill="var(--bg)"
              style={{ fontFamily: 'var(--serif)' }}
            >
              {scores[a.id]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SideNote({ a }: { a: Annotation }) {
  return (
    <div className="side-note" style={{ borderTop: `2px solid var(--${a.appeal})`, paddingTop: 8 }}>
      <span
        className="muted"
        style={{ fontSize: 11.5, letterSpacing: '.06em', textTransform: 'uppercase' }}
      >
        {a.change > 0 ? `Change ${a.change} · ` : ''}
        {a.dimension}
      </span>
      <b>{a.note}</b>
      {a.why && <span className="muted">{a.why}</span>}
    </div>
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
        <div className="doc">
          <div className="doc-head">
            <div>
              <span className="eyebrow">Assessment</span>
              <h2>{before.title}</h2>
              <div className="meta">
                <span>{context.contentType}</span>
                <span>
                  For {context.archetype}, {context.role}
                </span>
                <span>{context.relationship} reader</span>
                <span>Persuasion model v{SAMPLE.modelVersion}</span>
              </div>
            </div>
            <Mark size={34} />
          </div>

          <div className="verdict">
            <div>
              <div className="big">{before.scores.overall}</div>
              <div style={{ marginTop: 10, fontWeight: 600 }}>{before.scores.band}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                out of 100 · balance {before.scores.balance_index}
              </div>
            </div>
            <p className="pull">{notes.verdict}</p>
          </div>

          <div className="lands">
            <AppealChain scores={before.scores} />
            <dl>
              {APPEALS.map((a) => (
                <div key={a.id} style={{ display: 'contents' }}>
                  <dt style={{ color: `var(--${a.id})` }}>{a.name}</dt>
                  <dd className="n">{before.scores[a.id]}</dd>
                  <dd>{notes.appeals[a.id]}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="sidenoted">
            <span className="eyebrow">The text, annotated</span>
            <div style={{ height: 18 }} />
            {paragraphs.map((runs, i) => {
              const notesHere = runs
                .map((r) => r.annotation)
                .filter((a): a is Annotation => {
                  if (!a) return false;
                  if (a.change > 0) return true;
                  if (seen.has(a.note)) return false;
                  seen.add(a.note);
                  return true;
                });
              return (
                <div className="row" key={i}>
                  <p>
                    {runs.map((r, j) =>
                      r.annotation ? (
                        <span
                          key={j}
                          className="cc-mark"
                          style={{ textDecorationColor: `var(--${r.annotation.appeal})` }}
                        >
                          {r.text}
                          {r.annotation.change > 0 && (
                            <span
                              className="num"
                              style={{ color: `var(--${r.annotation.appeal})` }}
                            >
                              {r.annotation.change}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span key={j}>{r.text}</span>
                      )
                    )}
                  </p>
                  <aside>
                    {notesHere.map((a) => (
                      <SideNote key={a.start} a={a} />
                    ))}
                  </aside>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function Slot({
  options,
  value,
  label,
}: {
  options: readonly string[];
  value: string;
  label: string;
}) {
  return (
    <span className="slot">
      <select aria-label={label} defaultValue={value}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.split(':')[0]}
          </option>
        ))}
      </select>
    </span>
  );
}

function Workbench() {
  const { before } = SAMPLE;
  const opt = (id: string) => SAMPLE.audience.find((m) => m.id === id)?.options ?? [];
  return (
    <section id="workbench" className="screen">
      <div className="wrap">
        <p className="screen-label">Screen 3 · The workbench</p>
        <div className="app">
          <div className="appbar">
            <span className="wordmark" style={{ fontSize: 18 }}>
              <Mark size={20} />
            </span>
            <a href="#workbench">Home</a>
            <a href="#workbench" aria-current="page">
              Assess
            </a>
            <a href="#workbench">Projects</a>
            <a href="#workbench">Compare</a>
            <a href="#workbench">Usage</a>
            <span className="muted" style={{ marginLeft: 'auto' }}>
              Northwind Studio ▾
            </span>
          </div>
          <div className="brief">
            I&rsquo;m writing a{' '}
            <Slot
              label="Content type"
              options={SAMPLE.contentTypes}
              value={SAMPLE.context.contentType}
            />{' '}
            for{' '}
            <Slot
              label="Reader archetype"
              options={opt('archetype')}
              value="The Builder: Show me the plan"
            />
            , a reader who is{' '}
            <Slot
              label="Relationship"
              options={opt('relationship')}
              value="Cold: they don't know you"
            />
            , <Slot label="Awareness" options={opt('awareness')} value="Problem aware" /> motivated
            by{' '}
            <Slot
              label="Motivation"
              options={opt('focus')}
              value="Safety: wants to avoid mistakes"
            />
            .
          </div>
          <div className="judges">
            <span className="muted" style={{ marginRight: 6 }}>
              Judges
            </span>
            {SAMPLE.judgeCatalogue.map((j) => (
              <button
                key={j.id}
                type="button"
                className="pill"
                aria-pressed={j.always || j.id === 'craft' || j.id === 'audience'}
                title={j.description}
              >
                {j.name}
              </button>
            ))}
          </div>
          <div className="work">
            <div className="page">{before.text}</div>
            <aside className="rail">
              <div>
                <span className="eyebrow">Quick scan · as you type</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10 }}>
                  <span className="big" style={{ fontSize: 72 }}>
                    {before.scores.overall}
                  </span>
                  <span>{before.scores.band}</span>
                </div>
              </div>
              {APPEALS.map((a) => (
                <div className="scan-row" key={a.id}>
                  <span>{a.name}</span>
                  <span className="track">
                    <i style={{ left: `${before.scores[a.id]}%`, background: `var(--${a.id})` }} />
                  </span>
                  <span style={{ textAlign: 'right', fontWeight: 600 }}>{before.scores[a.id]}</span>
                </div>
              ))}
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                {before.balance[0]?.name}: {before.balance[0]?.message}
              </p>
              <a
                className="btn btn-primary"
                href="#report"
                style={{ marginTop: 'auto', justifyContent: 'center' }}
              >
                Run 6 judges · about a minute
              </a>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ConcordDirection({ theme }: { theme: LabTheme }) {
  return (
    <div className={`cc ${serif.variable} ${sans.variable}`} data-theme={theme}>
      <Hero />
      <Report />
      <Workbench />
    </div>
  );
}
