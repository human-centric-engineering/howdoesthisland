/**
 * The judge prompts in the engine baseline (t-18), stored as a line table.
 *
 * The recorder captures the prototype's `judgePrompt()` for every judge slot
 * and every case: 594 prompts, about 7 MB as text. Most of each prompt is the
 * model's own wording (rubrics, moves, levers), the same in every case, so
 * the prompts are stored once as their distinct lines, and each prompt as the
 * list of its lines' indices. That is about 360 KB, lossless (`split('\n')`
 * and `join('\n')`), and still text: a changed line in the prototype shows in
 * a diff as that line.
 */

export interface PromptTable {
  /** Every distinct line, in the order first seen. */
  lines: string[];
  /** Case file (`eval/ev01.json`) → judge slot → its lines' indices, space-separated. */
  prompts: Record<string, Record<string, string>>;
}

/** Encodes prompts, by case then slot, in the order given. Deterministic for the same input. */
export function encodePrompts(
  byCase: ReadonlyArray<readonly [file: string, prompts: ReadonlyArray<readonly [string, string]>]>
): PromptTable {
  const index = new Map<string, number>();
  const prompts: Record<string, Record<string, string>> = {};
  for (const [file, slots] of byCase) {
    const entry: Record<string, string> = {};
    for (const [slot, prompt] of slots) {
      entry[slot] = prompt
        .split('\n')
        .map((line) => {
          let i = index.get(line);
          if (i === undefined) {
            i = index.size;
            index.set(line, i);
          }
          return String(i);
        })
        .join(' ');
    }
    prompts[file] = entry;
  }
  return { lines: [...index.keys()], prompts };
}

/** One prompt back from its indices. Throws on an index the table does not have. */
export function decodePrompt(table: Pick<PromptTable, 'lines'>, indices: string): string {
  return indices
    .split(' ')
    .map((i) => {
      const line = table.lines[Number(i)];
      if (line === undefined || !/^\d+$/.test(i)) {
        throw new Error(`prompt line index "${i}" is not in the table`);
      }
      return line;
    })
    .join('\n');
}
