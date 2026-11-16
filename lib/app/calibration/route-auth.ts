/**
 * The admin calibration routes' guard options (t-38).
 */
export const PLATFORM_ONLY = {
  // Ownership: no ownership decision — a vendor surface, platform admin only. See RouteOwnership in lib/auth/guards.ts.
  ownership: {
    decidedBy: 'nothing',
    because:
      'Calibration runs are the install’s record of a framework version, not owned by a user; the guard limits them to platform admins.',
  },
} as const;
