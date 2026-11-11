import Link from 'next/link';
import { notFound } from 'next/navigation';

/**
 * The design lab (t-3) is for choosing a look by eye on `npm run dev`. It is
 * excluded from every other build by answering 404, and t-4 deletes it.
 */
export function designLabOnly(): void {
  if (process.env.NODE_ENV !== 'development') notFound();
}

export type LabTheme = 'light' | 'dark';

export function parseTheme(value: string | string[] | undefined): LabTheme {
  return value === 'dark' ? 'dark' : 'light';
}

export const DIRECTIONS = [
  {
    slug: 'tyrian',
    name: 'Tyrian & Graphite',
    note: "The artefact's own system: Instrument Serif and Geist, Tyrian purple, Greek coin emblems.",
  },
  {
    slug: 'concord',
    name: 'Concord',
    note: "The model's brand.visual: Newsreader and Schibsted Grotesk, the two-circle mark, overlapping forms.",
  },
  {
    slug: 'proof',
    name: 'Galley Proof',
    note: "An editor's desk: Fraunces, Spectral and Martian Mono, proof marks in the margin.",
  },
] as const;

export type DirectionSlug = (typeof DIRECTIONS)[number]['slug'];

const barStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 50,
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px 18px',
  alignItems: 'center',
  padding: '6px 16px',
  font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
  background: '#111',
  color: '#bbb',
};
const linkStyle = (active: boolean): React.CSSProperties => ({
  color: active ? '#fff' : '#999',
  textDecoration: active ? 'underline' : 'none',
});

/** A thin, deliberately unstyled bar so it never reads as part of a direction. */
export function LabBar({ current, theme }: { current: DirectionSlug; theme: LabTheme }) {
  return (
    <nav aria-label="Design lab" style={barStyle} data-lab-bar="">
      <Link href="/design-lab" style={linkStyle(false)}>
        design lab
      </Link>
      {DIRECTIONS.map((d) => (
        <Link
          key={d.slug}
          href={`/design-lab/${d.slug}?theme=${theme}`}
          style={linkStyle(d.slug === current)}
        >
          {d.name}
        </Link>
      ))}
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
        <a href="#hero" style={linkStyle(false)}>
          hero
        </a>
        <a href="#report" style={linkStyle(false)}>
          report
        </a>
        <a href="#workbench" style={linkStyle(false)}>
          workbench
        </a>
        <Link href={`/design-lab/${current}?theme=light`} style={linkStyle(theme === 'light')}>
          light
        </Link>
        <Link href={`/design-lab/${current}?theme=dark`} style={linkStyle(theme === 'dark')}>
          dark
        </Link>
      </span>
    </nav>
  );
}
