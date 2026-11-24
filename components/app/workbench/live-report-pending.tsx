'use client';

/**
 * A report opened while its review runs (t-78): the review's live progress
 * (`ReviewProgress`), and once it is final the page reads it again, so the
 * report takes its place without a reload.
 */
import { useRouter } from 'next/navigation';
import {
  ReviewProgress,
  type ReviewProgressProps,
} from '@/components/app/workbench/review-progress';

export type LiveReportPendingProps = Omit<ReviewProgressProps, 'onDone'>;

export function LiveReportPending(props: LiveReportPendingProps) {
  const router = useRouter();
  return <ReviewProgress {...props} onDone={() => router.refresh()} />;
}
