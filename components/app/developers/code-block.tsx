/**
 * A block of code or a shell session on `/developers` (t-45). Plain markup:
 * no highlighter script, so nothing loads from outside the site.
 */
export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="space-y-1">
      {label ? <figcaption className="hd-slug">{label}</figcaption> : null}
      <pre className="bg-muted overflow-x-auto rounded-md p-4 text-xs leading-relaxed">
        <code>{children}</code>
      </pre>
    </figure>
  );
}
