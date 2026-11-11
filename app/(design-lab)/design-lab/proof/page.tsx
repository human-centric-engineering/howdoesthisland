import type { Metadata } from 'next';
import { ProofDirection } from '@/components/app/design-lab/proof/proof';
import { LabBar, designLabOnly, parseTheme } from '@/components/app/design-lab/lab-frame';

export const metadata: Metadata = { title: 'Design lab · Galley Proof', robots: { index: false } };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  designLabOnly();
  const theme = parseTheme((await searchParams).theme);
  return (
    <>
      <LabBar current="proof" theme={theme} />
      <ProofDirection theme={theme} />
    </>
  );
}
