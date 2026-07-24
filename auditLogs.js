const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const auditService = require('../services/auditService');
const { MODULES, ACTIONS } = require('../utils/rbacConstants');

router.use(protect);

router.get('/', authorize(MODULES.AUDIT_LOG, ACTIONS.READ), async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const result = await auditService.listForViewer(req.user, { page, limit });
  res.json({ success: true, ...result });
});

module.exports = router;
