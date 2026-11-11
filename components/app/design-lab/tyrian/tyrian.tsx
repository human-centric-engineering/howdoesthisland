import { useId } from 'react';
import { Instrument_Serif, Geist, GFS_Didot } from 'next/font/google';
import '@/components/app/design-lab/tyrian/tyrian.css';
import { SAMPLE, type AppealId } from '@/components/app/design-lab/sample';
import { segmentParagraphs } from '@/components/app/design-lab/segments';
import type { LabTheme } from '@/components/app/design-lab/lab-frame';

const serif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--ty-serif',
});
const sans = Geist({ subsets: ['latin'], variable: '--ty-sans' });
const greek = GFS_Didot({ weight: '400', subsets: ['greek'], variable: '--ty-greek' });

const APPEALS = SAMPLE.appeals.filter((a): a is typeof a & { id: AppealId } =>
  ['ethos', 'pathos', 'logos', 'kairos'].includes(a.id)
);

/* Coin emblems, ported from prototype/src/greek.part.jsx. */
const EMBLEMS: Record<AppealId | 'peitho', React.ReactNode> = {
  ethos: (
    <g>
      <path d="M50 30C66 30 72 44 72 58C72 74 62 84 50 84C38 84 28 74 28 58C28 44 34 30 50 30Z" />
      <path d="M36 35 31 22 44 31M64 35 69 22 56 31" />
      <circle cx="40" cy="49" r="8" />
      <circle cx="60" cy="49" r="8" />
      <circle cx="40" cy="49" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="60" cy="49" r="2.6" fill="currentColor" stroke="none" />
      <path d="M47 57 50 63 53 57Z" />
      <path d="M34 63C37 71 42 75 46 77M66 63C63 71 58 75 54 77M38 68h4M58 68h4M41 73h3M56 73h3" />
      <path d="M44 84v5M50 84v5M56 84v5" />
      <path d="M73 36C79 30 85 27 91 27" />
      <path d="M79 31Q80 25 85 25Q84 30 79 31ZM85 28Q87 23 91 23Q90 28 85 28ZM77 34Q72 31 72 27Q77 28 77 34Z" />
    </g>
  ),
  pathos: (
    <g>
      <path d="M28 26C40 20 60 20 72 26C74 46 70 66 50 82C30 66 26 46 28 26Z" />
      <path d="M36 43C40 38 46 38 46 45C42 47 38 47 36 43ZM64 43C60 38 54 38 54 45C58 47 62 47 64 43Z" />
      <path d="M33 36Q40 30 47 35M67 36Q60 30 53 35" />
      <path d="M50 46v8M47 56Q50 58 53 56" />
      <path d="M40 65Q50 57 60 65Q50 72 40 65Z" />
      <path d="M28 30C20 34 18 44 13 51M72 30C80 34 82 44 87 51" />
    </g>
  ),
  logos: (
    <g>
      <circle cx="40" cy="60" r="20" />
      <circle cx="60" cy="60" r="20" />
      <path d="M40 60 60 60 50 42.7Z" strokeWidth="2.6" />
      <circle cx="40" cy="60" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="60" cy="60" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="50" cy="42.7" r="2.2" fill="currentColor" stroke="none" />
      <path d="M22 86h56" strokeDasharray="1 4" />
    </g>
  ),
  kairos: (
    <g>
      <path d="M46 86 50 41 54 86Z" />
      <path d="M22 41h56" strokeWidth="2.6" />
      <path d="M26 41 18 59M26 41 34 59M74 41 66 59M74 41 82 59" />
      <path d="M15 59Q26 67 37 59ZM63 59Q74 67 85 59Z" />
      <path d="M56 74C64 68 72 68 79 62C76 71 67 77 58 79M57 80C64 77 70 78 76 75C72 81 65 84 58 84" />
      <circle cx="50" cy="38" r="2" fill="currentColor" stroke="none" />
    </g>
  ),
  peitho: (
    <g>
      <path
        d="M50 37.3A21 21 0 0 1 50 72.7A21 21 0 0 1 50 37.3Z"
        fill="var(--accent)"
        stroke="none"
      />
      <circle cx="39" cy="55" r="21" />
      <circle cx="61" cy="55" r="21" />
    </g>
  ),
};
const LEGEND: Record<AppealId | 'peitho', string> = {
  ethos: 'ΗΘΟΣ',
  pathos: 'ΠΑΘΟΣ',
  logos: 'ΛΟΓΟΣ',
  kairos: 'ΚΑΙΡΟΣ',
  peitho: 'ΠΕΙΘΩ',
};

function Coin({ id, size = 120 }: { id: AppealId | 'peitho'; size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const col = id === 'peitho' ? 'var(--ink)' : `var(--${id})`;
  const bare = size < 48;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      role="img"
      aria-label={`${LEGEND[id]} emblem`}
    >
      <defs>
        <path id={`arc${uid}`} d="M24 80A56 56 0 0 1 136 80" />
      </defs>
      {!bare && (
        <>
          <circle cx="80" cy="80" r="77" fill="var(--surface-2)" stroke="var(--line)" />
          <circle
            cx="80"
            cy="80"
            r="70"
            fill="none"
            stroke={col}
            strokeOpacity=".35"
            strokeWidth="2.2"
            strokeDasharray="0.1 5.2"
            strokeLinecap="round"
          />
          <circle cx="80" cy="80" r="64" fill="none" stroke={col} strokeOpacity=".25" />
          <text fill={col} fontFamily="var(--greek)" fontSize="15" letterSpacing="5">
            <textPath href={`#arc${uid}`} startOffset="50%" textAnchor="middle">
              {LEGEND[id]}
            </textPath>
          </text>
        </>
      )}
      <g
        transform={bare ? 'translate(0 -8) scale(1.6)' : 'translate(40 46) scale(.8)'}
        fill="none"
        stroke={col}
        strokeWidth={bare ? 3.4 : 2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: col }}
      >
        {EMBLEMS[id]}
      </g>
    </svg>
  );
}

function Meander() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg className="meander" aria-hidden="true">
      <defs>
        <pattern id={`mx${uid}`} width="28" height="14" patternUnits="userSpaceOnUse">
          <path
            d="M0 13H20V1H6V9H14V5H10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="square"
          />
          <path d="M20 13H28" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </pattern>
      </defs>
      <rect width="100%" height="14" fill={`url(#mx${uid})`} />
    </svg>
  );
}

function Ring({ value, appeal }: { value: number; appeal: AppealId }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke={`var(--${appeal})`}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * c} ${c}`}
        transform="rotate(-90 28 28)"
      />
      <text
        x="28"
        y="33"
        textAnchor="middle"
        fontSize="15"
        fill="var(--ink)"
        fontFamily="var(--ui)"
      >
        {value}
      </text>
    </svg>
  );
}

/** The sample's reader is cold and problem-aware, with medium involvement. */
function pickOption(options: readonly string[]): string {
  const want = ['Medium', 'Problem aware', 'Cold'];
  return options.find((o) => want.some((w) => o.startsWith(w))) ?? options[0];
}

function Header() {
  const items = ['Assess', 'Sample report', 'The model', 'API', 'About'];
  return (
    <header className="top">
      <span className="wordmark">
        <Coin id="peitho" size={34} />
        {SAMPLE.brand.name}
      </span>
      <nav aria-label="Main">
        {items.map((i) => (
          <a key={i} href="#hero">
            {i}
          </a>
        ))}
      </nav>
      <span className="right">
        <a className="btn" href="#hero">
          Sign in
        </a>
        <a className="btn btn-primary" href="#hero">
          Try it free
        </a>
      </span>
    </header>
  );
}

function Hero() {
  const { before, after } = SAMPLE;
  return (
    <section id="hero" className="screen">
      <div className="wrap">
        <p className="screen-label">Screen 1 · Landing hero</p>
        <Header />
        <div className="hero">
          <div>
            <h1>
              Find out why your words aren&rsquo;t landing, <em>before your reader does.</em>
            </h1>
            <p className="sub">{SAMPLE.brand.sub}</p>
            <div className="ctas">
              <a className="btn btn-primary btn-lg" href="#workbench">
                Assess your text
              </a>
              <a className="btn btn-lg" href="#report">
                See a sample report
              </a>
            </div>
          </div>
          <div className="panel specimen">
            <div className="specimen-head">
              <span className="display" style={{ fontSize: 22 }}>
                One cold email, four changes
              </span>
              <span className="chip">quick scan</span>
            </div>
            <div className="ba">
              <div>
                <div className="num">{before.scores.overall}</div>
                <div className="muted">Before · {before.scores.band}</div>
              </div>
              <div className="arrow">→</div>
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ color: 'var(--accent)' }}>
                  {after.scores.overall}
                </div>
                <div className="muted">After · {after.scores.band}</div>
              </div>
            </div>
            <div className="rings">
              {APPEALS.map((a) => (
                <div key={a.id}>
                  <Ring value={after.scores[a.id]} appeal={a.id} />
                  <div style={{ color: `var(--${a.id})` }}>{a.name}</div>
                  <div className="muted">from {before.scores[a.id]}</div>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 13, margin: '16px 0 0' }}>
              It opened with the sender&rsquo;s job title and asked for a 45-minute call. The
              rewrite starts with the reader&rsquo;s own problem and asks for one word.
            </p>
          </div>
        </div>
        <Meander />
        <div className="coins">
          {APPEALS.map((a) => (
            <div key={a.id}>
              <Coin id={a.id} size={120} />
              <h3 style={{ color: `var(--${a.id})` }}>{a.name}</h3>
              <span className="greek muted" style={{ fontSize: 18 }} lang="grc">
                {a.greek}
              </span>
              <p>{a.question}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Report() {
  const { before, notes, context } = SAMPLE;
  const paragraphs = segmentParagraphs(before.text, before.annotations);
  const numbered = before.annotations.filter((a) => a.change > 0);
  const others = before.annotations.filter(
    (a, i, all) => a.change === 0 && all.findIndex((b) => b.change === 0 && b.note === a.note) === i
  );
  return (
    <section id="report" className="screen">
      <div className="wrap">
        <p className="screen-label">Screen 2 · Report section with an annotated passage</p>
        <div className="cover">
          <div>
            <span className="chip">Assessment report</span>
            <h2>{before.title}</h2>
          </div>
          <dl>
            <dt>Content</dt>
            <dt>Reader</dt>
            <dt>Relationship</dt>
            <dt>Framework</dt>
            <dd>{context.contentType}</dd>
            <dd>
              {context.archetype}, {context.role}
            </dd>
            <dd>{context.relationship}</dd>
            <dd>Persuasion model v{SAMPLE.modelVersion}</dd>
          </dl>
        </div>

        <div className="verdict">
          <div className="panel score-hero">
            <div className="muted" style={{ fontSize: 12, letterSpacing: '.1em' }}>
              OVERALL
            </div>
            <div className="num">{before.scores.overall}</div>
            <span className="band">{before.scores.band}</span>
            <p className="muted" style={{ fontSize: 12.5, margin: '14px 0 0' }}>
              Balance {before.scores.balance_index} · {before.balance[0]?.name}
            </p>
          </div>
          <div>
            <p className="verdict-text">{notes.verdict}</p>
            <ol className="three" style={{ padding: 0, margin: 0 }}>
              {notes.changes.slice(0, 3).map((c) => (
                <li key={c.dim}>{c.title}</li>
              ))}
            </ol>
          </div>
        </div>

        <div className="appeal-rows">
          {APPEALS.map((a) => (
            <div className="appeal-row" key={a.id}>
              <Coin id={a.id} size={56} />
              <div>
                <h4 style={{ color: `var(--${a.id})` }}>{a.name}</h4>
                <span className="greek muted" lang="grc">
                  {a.greek}
                </span>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span className="muted">Score</span>
                  <b>{before.scores[a.id]}</b>
                </div>
                <div className="bar">
                  <span
                    style={{ width: `${before.scores[a.id]}%`, background: `var(--${a.id})` }}
                  />
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 14.5 }}>{notes.appeals[a.id]}</p>
            </div>
          ))}
        </div>

        <h3 className="display" style={{ fontSize: 34, margin: '0 0 6px' }}>
          The text, annotated
        </h3>
        <p className="muted" style={{ margin: '0 0 20px' }}>
          Numbered marks are the editor&rsquo;s changes; the rest come from the quick scan.
        </p>
        <div className="annotated">
          <div className="panel letter">
            {paragraphs.map((runs, i) => (
              <p key={i}>
                {runs.map((r, j) =>
                  r.annotation ? (
                    <mark
                      key={j}
                      style={{
                        background: `var(--${r.annotation.appeal}-hl)`,
                        boxShadow: `inset 0 -2px 0 var(--${r.annotation.appeal})`,
                      }}
                      title={`${r.annotation.dimension}: ${r.annotation.note}`}
                    >
                      {r.text}
                      {r.annotation.change > 0 && (
                        <sup style={{ background: `var(--${r.annotation.appeal})` }}>
                          {r.annotation.change}
                        </sup>
                      )}
                    </mark>
                  ) : (
                    <span key={j}>{r.text}</span>
                  )
                )}
              </p>
            ))}
          </div>
          <div className="notes">
            {numbered.map((a) => (
              <div className="note" key={a.start} style={{ borderColor: `var(--${a.appeal})` }}>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {a.change} · {a.dimension}
                </span>
                <b>{a.note}</b>
                {a.why}
              </div>
            ))}
            {others.slice(0, 3).map((a) => (
              <div
                className="note"
                key={a.start}
                style={{ borderColor: `var(--${a.appeal})`, background: 'transparent' }}
              >
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {a.dimension}
                </span>
                <div>{a.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Workbench() {
  const { before } = SAMPLE;
  return (
    <section id="workbench" className="screen">
      <div className="wrap">
        <p className="screen-label">Screen 3 · The workbench</p>
        <div className="app">
          <aside className="side">
            <div className="ws">Northwind Studio</div>
            <a href="#workbench">Home</a>
            <a href="#workbench" aria-current="page">
              Assess
            </a>
            <a href="#workbench">
              Projects <span className="muted">4</span>
            </a>
            <a href="#workbench">Compare</a>
            <a href="#workbench">Usage</a>
            <div style={{ marginTop: 'auto' }}>
              <Meander />
              <a href="#workbench">Settings</a>
            </div>
          </aside>
          <div className="editor">
            <div className="tabs" role="tablist">
              <span role="tab" aria-selected="true">
                Paste
              </span>
              <span role="tab" aria-selected="false">
                Upload a file
              </span>
              <span role="tab" aria-selected="false">
                From a URL
              </span>
              <span className="muted" style={{ marginLeft: 'auto' }}>
                Project: BrightPath outbound · 102 words
              </span>
            </div>
            <div className="draft">{before.text}</div>
            <div className="scanbar">
              <div>
                <div className="overall">{before.scores.overall}</div>
                <div className="muted">Quick scan · {before.scores.band}</div>
              </div>
              {APPEALS.map((a) => (
                <div key={a.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: `var(--${a.id})` }}>{a.name}</span>
                    <b>{before.scores[a.id]}</b>
                  </div>
                  <div className="bar" style={{ marginTop: 6 }}>
                    <span
                      style={{ width: `${before.scores[a.id]}%`, background: `var(--${a.id})` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <aside className="inspector">
            <div>
              <h3>The reader</h3>
              <div className="field">
                <label htmlFor="ty-ct">Content type</label>
                <select id="ty-ct" defaultValue={SAMPLE.context.contentType}>
                  {SAMPLE.contentTypes.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ty-ar">Reader archetype</label>
                <select id="ty-ar" defaultValue={SAMPLE.context.archetype}>
                  {SAMPLE.archetypes.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              {SAMPLE.audience.slice(0, 3).map((m) => (
                <div className="field" key={m.id}>
                  <label htmlFor={`ty-${m.id}`}>{m.name}</label>
                  <select id={`ty-${m.id}`} defaultValue={pickOption(m.options)}>
                    {m.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div>
              <h3>Judges</h3>
              {SAMPLE.judgeCatalogue.map((j) => (
                <label className="judge" key={j.id}>
                  <input
                    type="checkbox"
                    defaultChecked={j.always || j.id === 'craft'}
                    disabled={j.always}
                  />
                  <span>{j.name}</span>
                  <small>{j.description}</small>
                </label>
              ))}
            </div>
            <a
              className="btn btn-primary btn-lg"
              href="#report"
              style={{ justifyContent: 'center' }}
            >
              Assess with 5 judges · about a minute
            </a>
          </aside>
        </div>
      </div>
    </section>
  );
}

export function TyrianDirection({ theme }: { theme: LabTheme }) {
  return (
    <div className={`ty ${serif.variable} ${sans.variable} ${greek.variable}`} data-theme={theme}>
      <Hero />
      <Report />
      <Workbench />
    </div>
  );
}
