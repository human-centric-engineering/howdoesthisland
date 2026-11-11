import { BRAND } from '@/lib/brand';
import { Wordmark } from '@/components/app/brand/wordmark';

/**
 * BrandMark — the header/footer brand slot.
 *
 * **Fork-owned scaffold** — Sunrise ships this rendering `BRAND.name` as text
 * and does NOT change it after release; its header asks a fork to replace the
 * body, so this is not a divergence.
 *
 * HowDoesThisLand renders the Galley Proof wordmark (D15). `BRAND.name` stays
 * the identity and accessible name; the surrounding `<Link>` supplies the link.
 *
 * Full guide: CUSTOMIZATION.md §2.
 */
export function BrandMark(): React.ReactNode {
  return <Wordmark name={BRAND.name} />;
}
