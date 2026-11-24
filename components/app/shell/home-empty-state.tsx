/**
 * The empty desk: what `/home` shows before someone has assessed anything
 * (t-79 replaced the M1 stand-in's "no action": `/assess` exists now).
 */
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { WORDS } from '@/lib/app/reports/words';

const LINES = 6;

export function HomeEmptyState() {
  return (
    <section aria-labelledby="home-empty-heading" className="hd-sheet mx-auto max-w-4xl">
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] md:grid-cols-[3.5rem_minmax(0,1fr)_13rem]">
        <div
          className="border-r py-10 pr-3 text-right font-mono text-[0.66rem] leading-[2.6] text-(--hd-faint)"
          aria-hidden="true"
        >
          {Array.from({ length: LINES }, (_, i) => (
            <div key={i}>{String(i + 1).padStart(2, '0')}</div>
          ))}
        </div>
        <div className="px-6 py-10 md:px-10">
          <p className="hd-slug">Galley 00 · Home</p>
          <h1 id="home-empty-heading" className="mt-3 text-4xl leading-none font-bold md:text-5xl">
            Nothing on the desk yet.
          </h1>
          <p className="text-muted-foreground mt-5 max-w-prose text-lg leading-relaxed">
            Your recent {WORDS.review}s will appear here, each with its score and the editor&rsquo;s
            marks, once you have run your first one.
          </p>
          <Button asChild className="mt-6">
            <Link href="/assess">Review some copy</Link>
          </Button>
        </div>
        <aside
          className="hidden content-start gap-5 border-l px-5 py-10 md:grid"
          aria-label="Proof marks"
        >
          <p className="hd-proof-mark">
            <b>stet</b>let it stand until there is work to show
          </p>
        </aside>
      </div>
    </section>
  );
}
