import { BRAND } from '@/lib/brand';
import { EyeMark } from '@/components/app/brand/eye-mark';
import { Wordmark, headerForm } from '@/components/app/brand/wordmark';

/**
 * BrandMark — the header/footer brand slot.
 *
 * **Fork-owned scaffold** — Sunrise ships this rendering `BRAND.name` as text
 * and does NOT change it after release; its header asks a fork to replace the
 * body, so this is not a divergence.
 *
 * HowDoesThisLand renders its mark, the reader's eye, beside the Galley Proof
 * wordmark (D15), with the name set as the question it asks ("How does this
 * land?", `headerForm`). The eye is decorative, so that text is the accessible
 * name; the surrounding `<Link>` supplies the link.
 *
 * Full guide: CUSTOMIZATION.md §2.
 */
export function BrandMark(): React.ReactNode {
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <EyeMark className="h-[1.4em] w-auto shrink-0" />
      <Wordmark name={headerForm(BRAND.name)} />
    </span>
  );
}
