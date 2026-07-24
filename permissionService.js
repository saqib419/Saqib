const Permission = require('../models/Permission');
const User = require('../models/User');
const { ROLES, SCOPES } = require('../utils/rbacConstants');

/**
 * Resolve the effective permission for (role, organizationId, module, action).
 *
 * Lookup order:
 *   1. Org-specific override (only relevant once organizationId is actually
 *      populated on users — dormant today).
 *   2. Global rule (organizationId: null) — this is what governs everyone
 *      right now.
 *   3. Deny by default — fail closed.
 *
 * Super Admin always passes, everything else must be explicitly granted.
 */
async function resolvePermission({ role, organizationId, module, action }) {
  if (role === ROLES.SUPER_ADMIN) {
    return { allowed: true, scope: SCOPES.ALL };
  }

  const orgOverride = organizationId
    ? await Permission.findOne({ organizationId, role, module, action }).lean()
    : null;

  if (orgOverride) {
    return { allowed: orgOverride.allowed, scope: orgOverride.scope };
  }

  const globalRule = await Permission.findOne({ organizationId: null, role, module, action }).lean();

  if (globalRule) {
    return { allowed: globalRule.allowed, scope: globalRule.scope };
  }

  return { allowed: false, scope: SCOPES.NONE };
}

async function can(user, module, action) {
  return resolvePermission({
    role: user.role,
    organizationId: user.organizationId || null,
    module,
    action,
  });
}

/**
 * Admin-facing: customize a Mentor's or Assistant's permission.
 * Cannot exceed the global rule (Super Admin's ceiling always wins).
 * Right now this always writes an organizationId: null row (since
 * multi-tenancy is dormant) UNLESS the acting admin has an organizationId
 * set, in which case it writes an org-scoped override ready for when
 * multi-tenancy is turned on.
 */
async function setPermission({ actingAdmin, targetRole, module, action, allowed, scope }) {
  if (![ROLES.MENTOR, ROLES.ASSISTANT].includes(targetRole)) {
    throw new Error('Only Mentor or Assistant permissions can be customized this way.');
  }

  const globalRule = await Permission.findOne({ organizationId: null, role: targetRole, module, action }).lean();
  if (!globalRule || !globalRule.allowed) {
    throw new Error(
      `Cannot grant "${action}" on "${module}" to ${targetRole}: exceeds the platform-wide default set by Super Admin.`
    );
  }

  const orgId = actingAdmin.organizationId || null;

  const updated = await Permission.findOneAndUpdate(
    { organizationId: orgId, role: targetRole, module, action },
    { allowed, scope, note: `Set by admin ${actingAdmin._id}` },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Bump permissionVersion for every affected user so old tokens go stale.
  const userFilter = { role: targetRole };
  if (orgId) userFilter.organizationId = orgId;
  await User.updateMany(userFilter, { $inc: { permissionVersion: 1 } });

  return updated;
}

module.exports = { resolvePermission, can, setPermission };
