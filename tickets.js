const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const auditService = require('../services/auditService');
const Ticket = require('../models/Ticket');
const { MODULES, ACTIONS, SCOPES } = require('../utils/rbacConstants');

router.use(protect);

// Student raises a ticket. Mentors have no grant for MODULES.TICKET at all,
// so authorize() denies them automatically (fail closed) -- there is no
// path by which a mentor role can reach this route successfully.
router.post('/', authorize(MODULES.TICKET, ACTIONS.CREATE), async (req, res) => {
  try {
    const { category, description } = req.body;
    if (!category || !description || !description.trim()) {
      return res.status(400).json({ success: false, message: 'category and description are required.' });
    }

    const ticket = await Ticket.create({
      student: req.user._id,
      mentor: req.user.mentorId || null,
      category,
      description: description.trim(),
    });

    await auditService.log({
      actor: req.user,
      action: 'ticket.create',
      module: MODULES.TICKET,
      targetType: 'Ticket',
      targetId: ticket._id,
      after: { category, status: ticket.status },
      req,
    });

    res.status(201).json({ success: true, ticket });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to submit ticket.' });
  }
});

// List tickets -- students see only their own (scope OWN maps to their
// student field, not their _id, since a ticket is a separate document).
// Admin/Super Admin see everything in scope.
router.get('/', authorize(MODULES.TICKET, ACTIONS.READ), async (req, res) => {
  try {
    const filter = req.scope === SCOPES.OWN ? { student: req.user._id } : {};
    const tickets = await Ticket.find(filter)
      .sort({ createdAt: -1 })
      .populate('student', 'name email')
      .populate('mentor', 'name email')
      .lean();
    res.json({ success: true, tickets });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch tickets.' });
  }
});

// Admin updates status/notes/contacted-at.
router.patch('/:id', authorize(MODULES.TICKET, ACTIONS.UPDATE), async (req, res) => {
  try {
    const { status, adminNotes, markContacted } = req.body;
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    const before = { status: ticket.status, adminNotes: ticket.adminNotes };

    if (status) ticket.status = status;
    if (typeof adminNotes === 'string') ticket.adminNotes = adminNotes;
    if (markContacted) ticket.contactedAt = new Date();
    if (status === 'resolved') ticket.resolvedAt = new Date();

    await ticket.save();

    await auditService.log({
      actor: req.user,
      action: 'ticket.update',
      module: MODULES.TICKET,
      targetType: 'Ticket',
      targetId: ticket._id,
      before,
      after: { status: ticket.status, adminNotes: ticket.adminNotes },
      req,
    });

    res.json({ success: true, ticket });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update ticket.' });
  }
});

module.exports = router;
