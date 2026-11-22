import Link from 'next/link';
import { isJsonObject } from '@/lib/app/frameworks/codec';
import { recordHref, type BrowseModel, type BrowseRecord } from '@/lib/app/frameworks/browse';
import {
  SUBTITLE_FIELDS,
  TECHNICAL_FIELDS,
  TITLE_FIELDS,
  fieldLabel,
  kindLabel,
  readingOrder,
} from '@/components/app/model/presentation';

/**
 * One record of the model, as a card (t-63). Every field the record has is
 * shown, in the model's own order, so a field a later version adds appears
 * without a code change: text as text, lists as lists, maps as labelled
 * rows. An id the record refers to is shown as a link to that record.
 */

const TITLE_MAX = 64;

/** The field a heading comes from, or null when the record has none (the id is used). */
function titleField(record: BrowseRecord): string | null {
  return TITLE_FIELDS.find((f) => typeof record.attributes[f] === 'string') ?? null;
}

export function recordTitle(record: BrowseRecord): string {
  const field = titleField(record);
  return field ? String(record.attributes[field]) : record.id;
}

/** A title short enough for a link: a citation up to its year, else cut at a word. */
export function shortTitle(record: BrowseRecord): string {
  const full = recordTitle(record);
  if (full.length <= TITLE_MAX) return full;
  const year = full.indexOf(')');
  if (year > 0 && year < TITLE_MAX) return full.slice(0, year + 1);
  const cut = full.lastIndexOf(' ', TITLE_MAX);
  return `${full.slice(0, cut > 0 ? cut : TITLE_MAX)}…`;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isJsonObject(value)) return Object.values(value).every(isEmpty);
  return false;
}

interface ValueProps {
  value: unknown;
  links: ReadonlyMap<string, BrowseRecord>;
  base: string;
}

function RecordLink({ to, base }: { to: BrowseRecord; base: string }) {
  return (
    <Link
      href={recordHref(base, to)}
      className="underline decoration-(--hd-rule) underline-offset-4 hover:decoration-(--hd-ink)"
      data-model-link={`${to.kind}:${to.id}`}
    >
      {shortTitle(to)}
    </Link>
  );
}

function Entries({
  entries,
  links,
  base,
}: { entries: [string, unknown][] } & Omit<ValueProps, 'value'>) {
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(8rem,auto)_1fr]">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-sm font-semibold text-(--hd-muted)">{fieldLabel(key)}</dt>
          <dd className="min-w-0 text-sm leading-relaxed break-words">
            <FieldValue value={value} links={links} base={base} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FieldValue({ value, links, base }: ValueProps) {
  if (typeof value === 'string') {
    const to = links.get(value);
    return to ? <RecordLink to={to} base={base} /> : <>{value}</>;
  }
  if (typeof value === 'number') return <span className="tabular-nums">{value}</span>;
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  if (Array.isArray(value)) {
    const items: unknown[] = value.filter((v: unknown) => !isEmpty(v));
    if (items.every((v) => typeof v === 'string' && links.has(v))) {
      return (
        <span>
          {items.map((v, i) => (
            <span key={`${String(v)}-${i}`}>
              {i > 0 ? ', ' : null}
              <FieldValue value={v} links={links} base={base} />
            </span>
          ))}
        </span>
      );
    }
    return (
      <ul className="list-disc space-y-1 pl-5">
        {items.map((v, i) => (
          <li key={i}>
            <FieldValue value={v} links={links} base={base} />
          </li>
        ))}
      </ul>
    );
  }
  if (isJsonObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => !isEmpty(v));
    return <Entries entries={entries} links={links} base={base} />;
  }
  return null;
}

function groupByKind(records: readonly BrowseRecord[]): [string, BrowseRecord[]][] {
  const groups = new Map<string, BrowseRecord[]>();
  for (const r of records) groups.set(r.kind, [...(groups.get(r.kind) ?? []), r]);
  return [...groups];
}

interface CardProps {
  record: BrowseRecord;
  model: BrowseModel;
  base: string;
  /** Heading level: a nested record sits one below its parent. */
  level?: 3 | 4;
}

export function RecordCard({ record, model, base, level = 3 }: CardProps) {
  const links = model.links(record);
  const title = titleField(record);
  const shown = readingOrder(
    Object.entries(record.attributes).filter(
      ([key, value]) => key !== 'id' && key !== title && !isEmpty(value)
    )
  );
  const subtitles = shown.filter(
    ([key, value]) => SUBTITLE_FIELDS.includes(key) && typeof value === 'string'
  );
  const technical = shown.filter(([key]) => TECHNICAL_FIELDS.has(key));
  const body = shown.filter(
    ([key]) => !subtitles.some(([s]) => s === key) && !TECHNICAL_FIELDS.has(key)
  );
  const linkedFrom = model.referencedBy(record);
  const Heading = level === 3 ? 'h3' : 'h4';

  return (
    <article
      id={record.anchor}
      className="scroll-mt-24 border-t border-(--hd-rule) pt-6"
      data-model-record={`${record.kind}:${record.id}`}
    >
      <Heading
        className={
          level === 3 ? 'text-2xl leading-tight font-bold' : 'text-xl leading-tight font-semibold'
        }
      >
        <a href={`#${record.anchor}`} className="hover:underline">
          {recordTitle(record)}
        </a>
      </Heading>
      {subtitles.map(([key, value]) => (
        <p
          key={key}
          className="mt-1 text-(--hd-muted)"
          lang={key === 'greek' ? 'grc' : key === 'latin' ? 'la' : undefined}
        >
          {String(value)}
        </p>
      ))}
      {body.length > 0 && (
        <div className="mt-4">
          <Entries entries={body} links={links} base={base} />
        </div>
      )}
      {technical.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-(--hd-muted)">
            How the engine reads it
          </summary>
          <div className="mt-3 font-mono text-xs">
            <Entries entries={technical} links={links} base={base} />
          </div>
        </details>
      )}
      {record.children.length > 0 && (
        <div className="mt-6 space-y-6 border-l-2 border-(--hd-rule) pl-4 sm:pl-6">
          {record.children.map((child) => (
            <RecordCard key={child.anchor} record={child} model={model} base={base} level={4} />
          ))}
        </div>
      )}
      {linkedFrom.length > 0 && (
        <div className="mt-4 text-sm text-(--hd-muted)">
          <p className="font-semibold">Linked from</p>
          <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(8rem,auto)_1fr]">
            {groupByKind(linkedFrom).map(([kind, froms]) => (
              <div key={kind} className="contents">
                <dt>{kindLabel(kind, froms.length === 1 ? 'one' : 'many')}</dt>
                <dd className="min-w-0 break-words">
                  {froms.map((from, i) => (
                    <span key={`${from.kind}:${from.id}`}>
                      {i > 0 ? ', ' : null}
                      <RecordLink to={from} base={base} />
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </article>
  );
}
