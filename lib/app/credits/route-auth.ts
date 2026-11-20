/**
 * The admin credit routes' guard options (t-57).
 */
export const CREDITS_PLATFORM_ONLY = {
  // Ownership: no ownership decision — a vendor surface, platform admin only. See RouteOwnership in lib/auth/guards.ts.
  ownership: {
    decidedBy: 'nothing',
    because:
      'A workspace’s credits are given by the platform, not owned by a user; the guard limits granting and reading them across workspaces to platform admins.',
  },
} as const;
