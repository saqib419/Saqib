const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize, scopeFilter } = require('../middleware/rbac');
const { MODULES, ACTIONS } = require('../utils/rbacConstants');
const Session = require('../models/Session');
const User = require('../models/User');
const auditService = require('../services/auditService');

router.use(protect);

router.get('/', authorize(MODULES.STUDY_SESSION, ACTIONS.READ), async (req, res) => {
  try {
    const filter = scopeFilter(req, { assignedField: 'mentor' });
    if (req.query.month) {
      const [y, m] = req.query.month.split('-').map(Number);
      const from = new Date(y, m - 1, 1);
      const to = new Date(y, m, 1);
      filter.startTime = { $gte: from, $lt: to };
    } else if (req.query.from && req.query.to) {
      filter.startTime = { $gte: new Date(req.query.from), $lt: new Date(req.query.to) };
    }
    const sessions = await Session.find(filter)
      .populate('mentor', 'name email')
      .populate('mentee', 'name email')
      .sort({ startTime: 1 })
      .lean();
    res.json({ success: true, sessions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.post('/', authorize(MODULES.STUDY_SESSION, ACTIONS.CREATE), async (req, res) => {
  try {
    const { mentorId, menteeId, startTime, category, topic, meetingLink } = req.body;
    if (!mentorId || !menteeId || !startTime) {
      return res.status(400).json({ success: false, message: 'mentorId, menteeId, and startTime are required.' });
    }
    const [mentor, mentee] = await Promise.all([
      User.findOne({ _id: mentorId, role: 'mentor' }),
      User.findById(menteeId),
    ]);
    if (!mentor) return res.status(400).json({ success: false, message: 'mentorId does not reference a valid Mentor.' });
    if (!mentee) return res.status(400).json({ success: false, message: 'menteeId does not reference a valid user.' });

    const session = await Session.create({
      mentor: mentorId,
      mentee: menteeId,
      startTime: new Date(startTime),
      category: category || 'academic',
      topic: topic || '',
      meetingLink: meetingLink || '',
    });

    await auditService.log({
      actor: req.user,
      action: 'session.create',
      module: MODULES.STUDY_SESSION,
      targetType: 'Session',
      targetId: session._id,
      after: { mentor: mentorId, mentee: menteeId, startTime, category },
      req,
    });

    const populated = await session.populate([{ path: 'mentor', select: 'name email' }, { path: 'mentee', select: 'name email' }]);
    res.status(201).json({ success: true, session: populated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.patch('/:id', authorize(MODULES.STUDY_SESSION, ACTIONS.UPDATE), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    const before = session.toObject();
    const { startTime, category, status, topic, meetingLink } = req.body;
    if (startTime) session.startTime = new Date(startTime);
    if (category) session.category = category;
    if (status) session.status = status;
    if (topic !== undefined) session.topic = topic;
    if (meetingLink !== undefined) session.meetingLink = meetingLink;
    await session.save();

    await auditService.log({
      actor: req.user,
      action: 'session.update',
      module: MODULES.STUDY_SESSION,
      targetType: 'Session',
      targetId: session._id,
      before,
      after: session.toObject(),
      req,
    });

    res.json({ success: true, session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.delete('/:id', authorize(MODULES.STUDY_SESSION, ACTIONS.DELETE), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    session.status = 'cancelled';
    await session.save();

    await auditService.log({
      actor: req.user,
      action: 'session.cancel',
      module: MODULES.STUDY_SESSION,
      targetType: 'Session',
      targetId: session._id,
      req,
    });

    res.json({ success: true, message: 'Session cancelled.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
