/**
 * `convertToHtml`, which intake reads DOCX with (`extract-text.ts`). Merges
 * with the shim in `types/mammoth.d.ts` rather than editing it: that file is
 * Sunrise's.
 */
declare module 'mammoth' {
  interface ImageConverter {
    readonly __brand: 'mammoth.ImageConverter';
  }
  export const images: {
    imgElement(f: () => Promise<{ src: string }>): ImageConverter;
  };
  export function convertToHtml(
    input: { buffer: Buffer },
    options?: { convertImage?: ImageConverter }
  ): Promise<{ value: string; messages: Array<{ type: string; message: string }> }>;
}
