/**
 * The admin code routes' guard options (t-59).
 */
export const CODES_OWNERSHIP = {
  // Ownership: no ownership decision — a vendor surface, platform admin only. See RouteOwnership in lib/auth/guards.ts.
  ownership: {
    decidedBy: 'nothing',
    because:
      'A free review code is install-level config made by the platform, owned by no user or workspace; the guard limits making, reading and revoking codes to platform admins.',
  },
} as const;
