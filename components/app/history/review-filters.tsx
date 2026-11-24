'use client';

/**
 * The filters over a review list (t-79): its project, its type of copy and
 * its band. Each lives in the page's address (`?projectId=`, `?contentType=`,
 * `?band=`), so a filtered list can be linked to and survives a reload; a
 * change goes back to the first page. The page reads them and makes the one
 * list call (`reviewListEndpoint`).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WORDS } from '@/lib/app/reports/words';
import {
  FILTER_KEYS,
  filterHref,
  type FilterCatalogue,
  type ReviewFilter,
} from '@/components/app/history/schemas';

/** The choice that means "any": Radix's Select takes no empty value. */
export const ANY = '__any';

export interface ReviewFiltersProps {
  /** The page the filters apply to, e.g. `/home`. */
  basePath: string;
  filter: ReviewFilter;
  catalogue: FilterCatalogue;
  /** The workspace's projects to filter by, or `null` to offer no project filter. */
  projects: Array<{ id: string; name: string }> | null;
}

export function ReviewFilters({ basePath, filter, catalogue, projects }: ReviewFiltersProps) {
  const router = useRouter();
  const set = (key: keyof ReviewFilter, value: string) =>
    router.push(filterHref(basePath, { ...filter, [key]: value === ANY ? undefined : value }));
  const filtered = FILTER_KEYS.some((key) => filter[key]);

  // A value the options lack (a type a newer version dropped, a project id that
  // is not the workspace's) is still offered, so the picker says what the list
  // is filtered by. Archived projects are among the options (`/home` loads them).
  const withCurrent = (options: Array<{ id: string; name: string }>, current?: string) =>
    current && !options.some((o) => o.id === current)
      ? [...options, { id: current, name: current }]
      : options;

  return (
    <div className="flex flex-wrap items-end gap-4">
      {projects ? (
        <FilterPicker
          id="filter-project"
          label="Project"
          value={filter.projectId}
          options={withCurrent(projects, filter.projectId)}
          onChange={(v) => set('projectId', v)}
        />
      ) : null}
      <FilterPicker
        id="filter-content-type"
        label={WORDS.TypeOfCopy}
        value={filter.contentType}
        options={withCurrent(catalogue.request.contentTypes, filter.contentType)}
        onChange={(v) => set('contentType', v)}
      />
      <FilterPicker
        id="filter-band"
        label="Band"
        value={filter.band}
        options={withCurrent(
          catalogue.result.bands.map((b) => ({ id: b, name: b })),
          filter.band
        )}
        onChange={(v) => set('band', v)}
      />
      {filtered ? (
        <Link href={basePath} className="pb-2 text-sm underline underline-offset-4">
          Clear filters
        </Link>
      ) : null}
    </div>
  );
}

function FilterPicker({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  options: Array<{ id: string; name: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="w-48 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? ANY} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
