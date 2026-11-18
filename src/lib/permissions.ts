// What each role may do in the UI. Mirrors the RLS policies in
// supabase/migrations/20261103_role_permissions.sql, which are the real
// enforcement: these helpers only hide actions the database would refuse.
// 'owner' is shown as 'admin' in the UI.
export type UserRole = 'admin' | 'accountant' | 'member' | 'observer';

export const USER_ROLES: readonly UserRole[] = ['admin', 'accountant', 'member', 'observer'];

/** Maps an org_members.role value to a UI role; unknown values get the least access. */
export function toUserRole(dbRole: string | null | undefined): UserRole {
  if (dbRole === 'owner') return 'admin';
  return (USER_ROLES as readonly string[]).includes(dbRole ?? '') ? dbRole as UserRole : 'observer';
}

/** Create and edit documents, clients, products, accounting entries. */
export const canWrite = (role: UserRole) => role !== 'observer';

/** Delete documents, clients, products. */
export const canDelete = (role: UserRole) => role === 'admin';

/** Post journal entries (owner, admin, accountant: my_posting_org_ids). */
export const canPost = (role: UserRole) => role === 'admin' || role === 'accountant';

/**
 * Issue credit notes (PRO-174): the roles that post entries, since a credit note books one
 * (owner, admin, accountant; credit_notes write policies).
 */
export const canCredit = (role: UserRole) => canPost(role);

/** Change the organisation's settings and manage the team. */
export const canManageOrg = (role: UserRole) => role === 'admin';
