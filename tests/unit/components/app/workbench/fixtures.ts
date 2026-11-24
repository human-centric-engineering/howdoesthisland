/**
 * The workbench's catalogue (t-78): the projects pages' (`aCatalogue`), with
 * the groups and the AI reviewers a review names, as HowDoesThisLand's
 * catalogue serves them.
 */
import type { AssessCatalogue } from '@/components/app/workbench/schemas';
import { aCatalogue } from '@/tests/unit/components/app/projects/fixtures';

export function anAssessCatalogue({
  culture = false,
}: { culture?: boolean } = {}): AssessCatalogue {
  const base = aCatalogue({ culture });
  return {
    ...base,
    result: {
      ...base.result,
      groups: [
        { id: 'craft', name: 'Craft' },
        { id: 'culture', name: 'Culture' },
      ],
      reviewers: [
        { id: 'judge_ethos', covers: 'ethos' },
        { id: 'judge_pathos', covers: 'pathos' },
        { id: 'judge_craft', covers: 'craft' },
        { id: 'judge_culture', covers: 'culture' },
      ],
    },
  };
}

/** A quick-scan result as the engine assembles it: the appeal scores the panel reads. */
export const QUICK_RESULT = {
  effective_weights: { ethos: 0.3, pathos: 0.2, logos: 0.3, kairos: 0.2 },
  scores: { ethos: 61, pathos: 48, logos: 70, kairos: 55 },
};
