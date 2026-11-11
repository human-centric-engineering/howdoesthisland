import type { Metadata } from 'next';
import { TyrianDirection } from '@/components/app/design-lab/tyrian/tyrian';
import { LabBar, designLabOnly, parseTheme } from '@/components/app/design-lab/lab-frame';

export const metadata: Metadata = { title: 'Design lab · Tyrian', robots: { index: false } };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  designLabOnly();
  const theme = parseTheme((await searchParams).theme);
  return (
    <>
      <LabBar current="tyrian" theme={theme} />
      <TyrianDirection theme={theme} />
    </>
  );
}
