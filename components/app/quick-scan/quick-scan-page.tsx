import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { z } from 'zod';
import { FrameworkApiError, getFramework } from '@/lib/app/frameworks/api/service';
import { HOWDOESTHISLAND_SLUG } from '@/lib/app/frameworks/howdoesthisland/slug';
import { QUICK_SCAN_CAVEAT } from '@/lib/app/quick-scan/summary';
import { isQuickScanEnabled } from '@/lib/app/quick-scan/switch';
import { loadModelDocument } from '@/lib/app/reports/pdf/print-source';
import { logger } from '@/lib/logging';
import { QUICK_SCAN_COPY as C } from '@/components/app/quick-scan/quick-scan-copy';
import { QuickScanForm, type NamedOption } from '@/components/app/quick-scan/quick-scan-form';

/**
 * `/quick-scan`: the free quick scan, for anyone, signed out (t-68). The
 * route in `app/(public)/quick-scan/` is one line over this.
 *
 * Off with the quick-scan switch, as `POST /api/v1/scan` is: a 404. The
 * names the form needs (types of copy, appeals) are read in process from the
 * latest version, ids and names only; nothing else of the model reaches the
 * browser. If they cannot be read the
 * form still runs, on the general type, and names scores by id.
 */

const description =
  'Paste your copy and get a free first score for credibility, emotion, logic and timing, in seconds. No sign-up. A quick surface check, not a full review.';
const title = 'Free quick scan: check your copy in seconds';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/quick-scan' },
  openGraph: { title, description },
  twitter: { card: 'summary_large_image', title, description },
};

/** The two lists the form names things with, ids and names only. */
const namesSchema = z.object({
  content_types: z.array(z.object({ id: z.string(), name: z.string() })),
  appeals: z.array(z.object({ id: z.string(), name: z.string() })),
});

const idName = ({ id, name }: NamedOption): NamedOption => ({ id, name });

/** The types of copy and appeals of the latest version, or empty lists. */
async function namesForTheForm(): Promise<{ contentTypes: NamedOption[]; appeals: NamedOption[] }> {
  const none = { contentTypes: [], appeals: [] };
  try {
    const { latestVersion } = await getFramework(HOWDOESTHISLAND_SLUG);
    const document = latestVersion
      ? await loadModelDocument(HOWDOESTHISLAND_SLUG, latestVersion)
      : null;
    const names = namesSchema.safeParse(document);
    if (!names.success) return none;
    return {
      contentTypes: names.data.content_types.map(idName),
      appeals: names.data.appeals.map(idName),
    };
  } catch (err) {
    if (!(err instanceof FrameworkApiError)) {
      logger.error('Quick scan page: could not read the names for its form', err);
    }
    return none;
  }
}

export default async function QuickScanPage() {
  // Per request: the switch and the latest version are the running server's.
  await connection();
  if (!isQuickScanEnabled()) notFound();
  const { contentTypes, appeals } = await namesForTheForm();

  return (
    <div className="container mx-auto px-4 py-6 md:py-10">
      <article className="hd-sheet">
        <div className="grid gap-10 px-4 py-10 sm:px-6 md:px-12 md:py-14 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div>
            <p className="hd-slug">{C.slug}</p>
            <h1 className="mt-4 max-w-[16ch] text-4xl leading-[1.05] font-extrabold sm:text-6xl">
              {C.h1}
            </h1>
            <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-(--hd-muted)">{C.lead}</p>
          </div>
          <aside className="self-end border-t-2 border-(--hd-red) pt-4">
            <h2 className="text-lg font-semibold">{C.caveatH}</h2>
            <p className="mt-2 text-sm leading-relaxed text-(--hd-muted)">{QUICK_SCAN_CAVEAT}</p>
          </aside>
        </div>
        <div className="border-t border-(--hd-rule) px-4 py-10 sm:px-6 md:px-12 md:py-14">
          <QuickScanForm contentTypes={contentTypes} appeals={appeals} caveat={QUICK_SCAN_CAVEAT} />
        </div>
      </article>
    </div>
  );
}
