/**
 * A file the person chose, read in the browser for an API that takes files as
 * base64: a project's background document (t-74), a file to review (t-78).
 */

/** A file's bytes as base64, without the `data:` prefix `readAsDataURL` adds. */
export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}
