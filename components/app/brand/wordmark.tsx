/**
 * The HowDoesThisLand wordmark: the name set in Fraunces. The element's text
 * and accessible name are the name exactly as written.
 */
export function Wordmark({ name }: { name: string }) {
  return <span className="hd-wordmark">{name}</span>;
}

/**
 * How the header writes a brand name. `BRAND.name` stays `HowDoesThisLand`:
 * page titles, emails and sentences ("Terms of Service for HowDoesThisLand")
 * use it as a name. The header sets it as the question the product asks.
 * Any other name, including Sunrise's default, is shown as it is.
 */
const HEADER_FORMS: Readonly<Record<string, string>> = {
  HowDoesThisLand: 'How does this land?',
};

export function headerForm(name: string): string {
  return HEADER_FORMS[name] ?? name;
}
