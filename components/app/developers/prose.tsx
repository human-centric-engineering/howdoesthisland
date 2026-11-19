/**
 * A sentence written with backticks, as the registry and the OpenAPI document
 * write them, with each backticked span rendered as `<code>` (t-45).
 */
export function Prose({ children }: { children: string }) {
  const parts = children.split(/(`[^`]+`)/);
  return (
    <>
      {parts.map((part, i) =>
        part.length > 2 && part.startsWith('`') && part.endsWith('`') ? (
          <code key={i}>{part.slice(1, -1)}</code>
        ) : (
          part
        )
      )}
    </>
  );
}
