/**
 * `convertToHtml`, which intake reads DOCX with (`extract-text.ts`). Merges
 * with the shim in `types/mammoth.d.ts` rather than editing it: that file is
 * Sunrise's.
 */
declare module 'mammoth' {
  export function convertToHtml(input: {
    buffer: Buffer;
  }): Promise<{ value: string; messages: Array<{ type: string; message: string }> }>;
}
