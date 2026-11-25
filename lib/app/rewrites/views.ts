/**
 * A rewrite as the API answers it (t-81).
 */
import type { RewriteStatus } from '@prisma/client';
import { parsePlaceholders, type Placeholder } from '@/lib/app/frameworks/placeholders';

export type RewriteState = 'running' | 'completed' | 'failed';

export interface RewriteView {
  id: string;
  assessmentId: string;
  focus: string;
  status: RewriteState;
  /** What has been written so far while `running` (saved every few seconds), then the whole draft. */
  draft: string;
  /**
   * The gaps the draft leaves for facts only the writer knows (t-83), read
   * from it: each `[ADD: …]` once, in order. Answer them with a new rewrite's
   * `fromRewriteId` and `answers`.
   */
  placeholders: Placeholder[];
  /** Why it failed, for `failed`. */
  error: string | null;
  errorCode: string | null;
  model: string | null;
  costUsd: number;
  createdAt: string;
  completedAt: string | null;
}

/** The columns {@link toRewriteView} reads. */
export const REWRITE_VIEW_SELECT = {
  id: true,
  assessmentId: true,
  focus: true,
  status: true,
  draft: true,
  error: true,
  errorCode: true,
  modelName: true,
  costUsd: true,
  createdAt: true,
  completedAt: true,
} as const;

const STATE: Record<RewriteStatus, RewriteState> = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export function toRewriteView(row: {
  id: string;
  assessmentId: string;
  focus: string;
  status: RewriteStatus;
  draft: string;
  error: string | null;
  errorCode: string | null;
  modelName: string | null;
  costUsd: number;
  createdAt: Date;
  completedAt: Date | null;
}): RewriteView {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    focus: row.focus,
    status: STATE[row.status],
    draft: row.draft,
    placeholders: parsePlaceholders(row.draft),
    error: row.error,
    errorCode: row.errorCode,
    model: row.modelName,
    costUsd: row.costUsd,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
