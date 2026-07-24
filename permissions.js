const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const permissionService = require('../services/permissionService');
const auditService = require('../services/auditService');
const Permission = require('../models/Permission');
const { MODULES, ACTIONS } = require('../utils/rbacConstants');

router.use(protect);

// View effective permissions for a role (e.g. GET /api/permissions/mentor)
router.get('/:role', authorize(MODULES.ROLE_PERMISSION, ACTIONS.READ), async (req, res) => {
  const rows = await Permission.find({ organizationId: null, role: req.params.role }).lean();
  res.json({ success: true, permissions: rows });
});

// Admin customizes a Mentor/Assistant permission
router.put('/', authorize(MODULES.ROLE_PERMISSION, ACTIONS.UPDATE), async (req, res) => {
  const { role, module, action, allowed, scope } = req.body;
  try {
    const updated = await permissionService.setPermission({
      actingAdmin: req.user, targetRole: role, module, action, allowed, scope,
    });

    await auditService.log({
      actor: req.user,
      action: 'permission.update',
      module: MODULES.ROLE_PERMISSION,
      targetType: 'Permission',
      targetId: updated._id,
      after: { role, module, action, allowed, scope },
      req,
    });

    res.json({ success: true, permission: updated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
