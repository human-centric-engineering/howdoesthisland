import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';

/**
 * Branded like the rest of the app (the title is the PDF's document title),
 * and never indexed: pages here are made for a renderer, not to be found.
 */
export const metadata: Metadata = {
  title: { template: `%s - ${BRAND.name}`, default: BRAND.name },
  robots: { index: false, follow: false },
};

/**
 * The print route group (t-31): pages made to be turned into a document by
 * the PDF route's headless browser, not visited.
 *
 * No platform header, footer or navigation: a page here is the document and
 * nothing else. The root layout still applies, so the brand's fonts, tokens
 * and print stylesheet (`app/brand-theme.css`) are the web report's own.
 */
export default function PrintLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <main className="bg-white">{children}</main>;
}
