/**
 * Prisma errors the app reads by their code: `lib/app` does not import
 * Prisma's runtime, only its types.
 */

/** Prisma's P2003: a foreign key that no longer resolves, as when its parent was deleted meanwhile. */
export function isForeignKeyFailure(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2003';
}
