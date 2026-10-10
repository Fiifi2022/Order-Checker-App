export const APP_ROLES = ['admin', 'warehouse', 'cca', 'auditor', 'dco'] as const;
export type AppRole = typeof APP_ROLES[number];
type RoleProfile = { role?: string | null; roles?: readonly string[] };

// An explicit roles array is authoritative; legacy single-role records still work.
export function assignedRoles(profile: RoleProfile | null | undefined): AppRole[] {
  const values = profile?.roles ?? (profile?.role ? [profile.role] : []);
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((role): role is AppRole => APP_ROLES.includes(role as AppRole)))];
}
export function hasRole(profile: RoleProfile | null | undefined, role: AppRole): boolean {
  return assignedRoles(profile).includes(role);
}
export function roleAssignment(input: { role?: unknown; roles?: unknown }): AppRole[] {
  const values = input.roles === undefined ? [input.role] : input.roles;
  if (!Array.isArray(values) || !values.length || values.some(role => !APP_ROLES.includes(role as AppRole))) {
    throw new Error(`Select at least one valid role: ${APP_ROLES.join(', ')}`);
  }
  return [...new Set(values)] as AppRole[];
}
