/**
 * The provider every new workspace is approved for, by slug.
 *
 * On its own so the judges' platform agents (`lib/app/judges/agents.ts`), whose
 * default provider this is, can name it without importing `provision.ts`, which
 * brings org creation into the platform-agent registry's import graph.
 */
export const WORKSPACE_PROVIDER_SLUG = 'openai';
