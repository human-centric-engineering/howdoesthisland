/**
 * The providers the app's workspaces run on, by slug.
 *
 * On its own so the judges' platform agents (`lib/app/judges/agents.ts`), whose
 * default provider is here, can name it without importing `provision.ts`, which
 * brings org creation into the platform-agent registry's import graph.
 */

/** The provider the judges and editor run on by default (D8, ruled 2026-11-17: Anthropic). */
export const JUDGE_PROVIDER_SLUG = 'anthropic';

/**
 * The providers every new workspace is approved for: the judges' and the
 * editor's, and OpenAI's, which the knowledge-base embedder runs on and whose
 * models stay on the judges' approved lists.
 */
export const WORKSPACE_PROVIDER_SLUGS: readonly string[] = [JUDGE_PROVIDER_SLUG, 'openai'];
