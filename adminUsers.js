const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const controller = require('./adminUsers.controller');
const { MODULES, ACTIONS } = require('../utils/rbacConstants');

router.use(protect);

router.post('/', authorize(MODULES.USER, ACTIONS.CREATE), controller.createUser);
router.get('/', authorize(MODULES.USER, ACTIONS.READ), controller.listUsers);
router.patch('/:id/suspend', authorize(MODULES.USER, ACTIONS.DELETE), controller.suspendUser);
router.patch('/:id/reactivate', authorize(MODULES.USER, ACTIONS.UPDATE), controller.reactivateUser);
router.patch('/:studentId/assign-mentor', authorize(MODULES.MENTOR_REQUEST, ACTIONS.UPDATE), controller.assignMentor);
router.patch('/:id/link-child', authorize(MODULES.USER, ACTIONS.UPDATE), controller.linkChild);
router.get('/students', authorize(MODULES.PROGRESS, ACTIONS.READ), controller.listStudents);

module.exports = router;
