import type { Metadata } from 'next';
import { ConcordDirection } from '@/components/app/design-lab/concord/concord';
import { LabBar, designLabOnly, parseTheme } from '@/components/app/design-lab/lab-frame';

export const metadata: Metadata = { title: 'Design lab · Concord', robots: { index: false } };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  designLabOnly();
  const theme = parseTheme((await searchParams).theme);
  return (
    <>
      <LabBar current="concord" theme={theme} />
      <ConcordDirection theme={theme} />
    </>
  );
}
