/**
 * What a rewrite can work on, for the report's drawer (t-82): `balanced`, or
 * one appeal. A plain module, so the report page (a server component) builds
 * the list it hands the drawer.
 */

/** A focus the drawer offers: `balanced`, or an appeal of the review's model. */
export interface RewriteFocusOption {
  id: string;
  name: string;
  /** What choosing it does, for its help. */
  help: string;
}

export const BALANCED = 'balanced';

/** The focuses for a report: balanced first, then each appeal it scored. */
export function rewriteFocuses(
  appeals: ReadonlyArray<{ id: string; name: string; question: string }>
): RewriteFocusOption[] {
  return [
    {
      id: BALANCED,
      name: 'Balanced',
      help: 'Works on the weakest appeal first and applies the recommendations across all four, keeping the mix this reader needs. The default.',
    },
    ...appeals.map((a) => ({
      id: a.id,
      name: a.name,
      help: `Raises ${a.name} without weakening the others, applying the recommendations about it. ${a.name} asks: ${a.question}`,
    })),
  ];
}
