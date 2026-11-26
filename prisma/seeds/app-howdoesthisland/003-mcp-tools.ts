import type { Prisma } from '@prisma/client';
import type { SeedUnit } from '@/prisma/runner';
import { MCP_TOOL_ROWS } from '@/lib/app/mcp/definitions';

/**
 * Seed the `AiCapability` rows of HowDoesThisLand's MCP tools (t-92).
 *
 * A capability the dispatcher knows is not a tool until it has an active row,
 * and an MCP client sees it only once an admin also enables it on
 * `/admin/orchestration/mcp/tools` (an `McpExposedTool` row, default-deny,
 * which this seed does not write). No agent bindings either: a workspace's
 * agent gets one when someone gives it the tool.
 *
 * The row is a code projection for its code-owned half (`functionDefinition`,
 * `executionType`, `executionHandler`), re-applied on every run so a changed
 * schema reaches the database; the presentation half (`name`, `description`,
 * `category`, `rateLimit`, `isActive`) is the admin's, written once.
 * `hashInputs` re-runs it when the definitions change.
 */
const unit: SeedUnit = {
  name: 'app-howdoesthisland/003-mcp-tools',
  hashInputs: ['../../../lib/app/mcp/definitions.ts'],
  async run({ prisma, logger }) {
    logger.info('🛠️  Seeding the HowDoesThisLand MCP tools...');
    for (const row of MCP_TOOL_ROWS) {
      const slug = row.definition.name;
      const codeOwned = {
        executionType: 'internal' as const,
        executionHandler: row.handler,
        // Internal, typed data (the class's own definition), not external input.
        functionDefinition: row.definition as unknown as Prisma.InputJsonValue,
      };
      await prisma.aiCapability.upsert({
        where: { slug },
        update: { isSystem: true, ...codeOwned },
        create: {
          slug,
          name: row.name,
          description: row.description,
          category: 'howdoesthisland',
          rateLimit: row.rateLimit,
          isActive: true,
          isSystem: true,
          ...codeOwned,
        },
      });
    }
    logger.info(`✅ Seeded ${MCP_TOOL_ROWS.length} MCP tool capabilities (not yet exposed)`);
  },
};

export default unit;
