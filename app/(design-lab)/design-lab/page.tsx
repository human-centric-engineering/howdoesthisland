import Link from 'next/link';
import type { Metadata } from 'next';
import { DIRECTIONS, designLabOnly } from '@/components/app/design-lab/lab-frame';

export const metadata: Metadata = { title: 'Design lab', robots: { index: false } };

export default function DesignLabIndex() {
  designLabOnly();
  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '48px 24px',
        background: '#111',
        color: '#ddd',
        font: '15px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: 18, color: '#fff' }}>Design lab · t-3</h1>
        <p>
          Three directions, each rendering the same three screens with the same real content: the
          landing hero, a report section with an annotated passage, and the workbench. Choose by eye
          (D15). Development only; t-4 deletes this.
        </p>
        <ul style={{ padding: 0, listStyle: 'none', display: 'grid', gap: 16, marginTop: 32 }}>
          {DIRECTIONS.map((d) => (
            <li key={d.slug}>
              <Link href={`/design-lab/${d.slug}`} style={{ color: '#fff', fontSize: 17 }}>
                {d.name}
              </Link>
              <span style={{ marginLeft: 12 }}>
                <Link href={`/design-lab/${d.slug}?theme=dark`} style={{ color: '#999' }}>
                  dark
                </Link>
              </span>
              <p style={{ margin: '4px 0 0', color: '#999' }}>{d.note}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
