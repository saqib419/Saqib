const AuditLog = require('../models/AuditLog');
const { ROLES } = require('../utils/rbacConstants');

async function log({ actor, action, module, targetType = null, targetId = null, before = null, after = null, req = null, wasDenied = false }) {
  return AuditLog.create({
    actorId: actor._id,
    actorRole: actor.role,
    organizationId: actor.organizationId || null,
    action,
    module,
    targetType,
    targetId,
    before,
    after,
    ip: req ? req.ip : null,
    userAgent: req ? req.get('user-agent') : null,
    wasDenied,
  });
}

/**
 * Super Admin sees everything. Admin sees everything too for now (there's
 * only one implicit organization) — once multi-tenancy is turned on and
 * organizationId is populated, this automatically narrows to the Admin's
 * own org without any code change here.
 */
async function listForViewer(viewer, { page = 1, limit = 50 } = {}) {
  const filter = {};
  if (viewer.role !== ROLES.SUPER_ADMIN && viewer.organizationId) {
    filter.organizationId = viewer.organizationId;
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  return { items, total, page, pages: Math.ceil(total / limit) };
}

module.exports = { log, listForViewer };
