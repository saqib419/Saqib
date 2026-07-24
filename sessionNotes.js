const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { MODULES, ACTIONS } = require('../utils/rbacConstants');
const SessionNote = require('../models/SessionNote');
const Session = require('../models/Session');
const auditService = require('../services/auditService');

router.use(protect);

router.get('/recent', authorize(MODULES.SESSION_NOTE, ACTIONS.READ), async (req, res) => {
  try {
    const sessions = await Session.find({})
      .populate('mentor', 'name')
      .populate('mentee', 'name')
      .sort({ startTime: -1 })
      .limit(25)
      .lean();
    const sessionIds = sessions.map((s) => s._id);
    const notes = await SessionNote.find({ session: { $in: sessionIds } }).select('session').lean();
    const notedSessionIds = new Set(notes.map((n) => n.session.toString()));
    const result = sessions.map((s) => ({ ...s, hasNote: notedSessionIds.has(s._id.toString()) }));
    res.json({ success: true, sessions: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.get('/:sessionId', authorize(MODULES.SESSION_NOTE, ACTIONS.READ), async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId).populate('mentor', 'name').populate('mentee', 'name');
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    const note = await SessionNote.findOne({ session: session._id }).lean();
    const timeline = await SessionNote.find({
      student: session.mentee._id,
      session: { $ne: session._id },
    })
      .populate('session', 'startTime category topic')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    res.json({ success: true, session, note: note || null, timeline });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.put('/:sessionId', authorize(MODULES.SESSION_NOTE, ACTIONS.UPDATE), async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    const { privateNotes, sharedNotes } = req.body;
    const note = await SessionNote.findOneAndUpdate(
      { session: session._id },
      {
        $set: { privateNotes: privateNotes ?? '', sharedNotes: sharedNotes ?? '', student: session.mentee, mentor: session.mentor },
        $setOnInsert: { createdBy: req.user._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await auditService.log({
      actor: req.user,
      action: 'session_note.save',
      module: MODULES.SESSION_NOTE,
      targetType: 'SessionNote',
      targetId: note._id,
      req,
    });

    res.json({ success: true, note });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.post('/:sessionId/recordings', authorize(MODULES.SESSION_NOTE, ACTIONS.UPDATE), async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    const { label, durationSeconds } = req.body;
    const note = await SessionNote.findOneAndUpdate(
      { session: session._id },
      {
        $push: { recordings: { label: label || 'Recording', durationSeconds: durationSeconds || 0 } },
        $setOnInsert: { student: session.mentee, mentor: session.mentor, createdBy: req.user._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, note });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
