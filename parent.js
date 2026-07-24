const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Chapter = require('../models/Chapter');
const UserProgress = require('../models/UserProgress');
const { examGroupFor } = require('./curriculum');
const Message = require('../models/Message');
const StudySession = require('../models/StudySession');
const Session = require('../models/Session');
const SessionNote = require('../models/SessionNote');
const Ticket = require('../models/Ticket');
const auditService = require('../services/auditService');
const { MODULES } = require('../utils/rbacConstants');

// Shared helper: load the parent's linked child, or null with a clear reason.
async function getLinkedChild(req) {
  if (!req.user.childId) return null;
  const child = await User.findOne({ _id: req.user.childId, role: 'student' })
    .select('name email avatar onboarding mentorId totalStudyMinutes streak level xp xpPerLevel')
    .lean();
  return child || null;
}

// ════════════════════════════════════════════════════════════════
// GET /api/parent/child  (parent only)
// Overall report: name, streak/XP/level, overall mastery %, mentor info.
// ════════════════════════════════════════════════════════════════
router.get('/child', protect, restrictTo('parent'), async (req, res) => {
  try {
    const child = await getLinkedChild(req);
    if (!child) {
      return res.json({ success: true, linked: false, child: null });
    }

    const examGroup = examGroupFor(child.onboarding);
    const subjects = await Subject.find({ examGroup }).select('_id').lean();
    const subjectIds = subjects.map(s => s._id);
    const chapters = await Chapter.find({ subject: { $in: subjectIds } }).select('_id').lean();
    const chapterIds = chapters.map(c => c._id);

    const progress = await UserProgress.find({
      user: child._id,
      chapter: { $in: chapterIds },
    }).lean();

    const totalChapters = chapters.length;
    const completedChapters = progress.filter(p => p.status === 'completed').length;
    const totalPct = progress.reduce((sum, p) => sum + (p.percentComplete || 0), 0);
    const overallMastery = totalChapters ? Math.round(totalPct / totalChapters) : 0;

    let mentor = null;
    if (child.mentorId) {
      mentor = await User.findById(child.mentorId).select('name avatar mentorProfile').lean();
    }

    res.json({
      success: true,
      linked: true,
      child: {
        id: child._id,
        name: child.name,
        exam: (child.onboarding && child.onboarding.exam) || null,
        prevScore: (child.onboarding && child.onboarding.prevScore) ?? null,
        targetScore: (child.onboarding && child.onboarding.targetScore) ?? null,
        streak: child.streak || 0,
        level: child.level || 1,
        xp: child.xp || 0,
        xpPerLevel: child.xpPerLevel || 1000,
        totalStudyMinutes: child.totalStudyMinutes || 0,
        overallMastery,
        completedChapters,
        totalChapters,
      },
      mentor: mentor ? { id: mentor._id, name: mentor.name, avatar: mentor.avatar, title: mentor.mentorProfile && mentor.mentorProfile.title } : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch child report.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/parent/child/subjects  (parent only)
// Per-subject mastery breakdown, same shape as the mentor's view.
// ════════════════════════════════════════════════════════════════
router.get('/child/subjects', protect, restrictTo('parent'), async (req, res) => {
  try {
    const child = await getLinkedChild(req);
    if (!child) {
      return res.status(404).json({ success: false, message: 'No child linked to this account yet.' });
    }

    const examGroup = examGroupFor(child.onboarding);
    const subjects = await Subject.find({ examGroup }).sort('order').lean();
    const subjectIds = subjects.map(s => s._id);
    const chapters = await Chapter.find({ subject: { $in: subjectIds } }).lean();
    const progress = await UserProgress.find({
      user: child._id,
      chapter: { $in: chapters.map(c => c._id) },
    }).lean();

    const progressByChapter = {};
    progress.forEach(p => { progressByChapter[p.chapter.toString()] = p; });

    const result = subjects.map(subj => {
      const subjChapters = chapters.filter(c => c.subject.toString() === subj._id.toString());
      const totalPct = subjChapters.reduce((sum, c) => {
        const p = progressByChapter[c._id.toString()];
        return sum + (p ? p.percentComplete : 0);
      }, 0);
      const mastery = subjChapters.length ? Math.round(totalPct / subjChapters.length) : 0;
      return { id: subj._id, name: subj.name, mastery };
    });

    res.json({ success: true, subjects: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch subject breakdown.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/parent/messages  (parent only) — chat with the child's mentor
// ════════════════════════════════════════════════════════════════
router.get('/messages', protect, restrictTo('parent'), async (req, res) => {
  try {
    const child = await getLinkedChild(req);
    if (!child || !child.mentorId) {
      return res.json({ success: true, messages: [], mentorLinked: false });
    }

    const messages = await Message.find({
      $or: [
        { sender: req.user._id, recipient: child.mentorId },
        { sender: child.mentorId, recipient: req.user._id },
      ],
    }).sort('createdAt').lean();

    res.json({ success: true, messages, mentorLinked: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch messages.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/parent/messages  (parent only)
// ════════════════════════════════════════════════════════════════
router.post('/messages', protect, restrictTo('parent'), async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'content is required.' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ success: false, message: 'Message is too long.' });
    }

    const child = await getLinkedChild(req);
    if (!child || !child.mentorId) {
      return res.status(400).json({ success: false, message: 'No mentor linked to your child yet.' });
    }

    const message = await Message.create({
      sender: req.user._id,
      recipient: child.mentorId,
      content: content.trim(),
    });

    res.status(201).json({ success: true, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/parent/child/analytics  (parent only)
// Weekly study consistency for the linked child — same shape as the
// student's own /api/study/analytics, just scoped to the child instead
// of req.user, so parents can see *when* their child studies, not just
// lifetime totals.
// ════════════════════════════════════════════════════════════════
router.get('/child/analytics', protect, restrictTo('parent'), async (req, res) => {
  try {
    const child = await getLinkedChild(req);
    if (!child) {
      return res.status(404).json({ success: false, message: 'No child linked to this account yet.' });
    }

    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dailyMinutes = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(monday);
      dayStart.setDate(monday.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      if (dayStart > now) {
        dailyMinutes.push({ day: dayLabels[i], minutes: 0 });
        continue;
      }
      const sessions = await StudySession.find({
        user: child._id,
        completedAt: { $gte: dayStart, $lt: dayEnd },
      }).lean();
      const minutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
      dailyMinutes.push({ day: dayLabels[i], minutes });
    }

    const weekMinutesTotal = dailyMinutes.reduce((sum, d) => sum + d.minutes, 0);
    const weeklyHours = Math.round((weekMinutesTotal / 60) * 10) / 10;

    const daysElapsedThisWeek = dayOfWeek === 0 ? 7 : dayOfWeek;
    const daysStudied = dailyMinutes.slice(0, daysElapsedThisWeek).filter(d => d.minutes > 0).length;
    const consistencyPct = daysElapsedThisWeek > 0 ? Math.round((daysStudied / daysElapsedThisWeek) * 100) : 0;

    res.json({
      success: true,
      analytics: { weeklyHours, consistencyPct, dailyMinutes },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch study analytics.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/parent/child/sessions  (parent only)
// Upcoming + recent mentor sessions for the linked child, so a parent
// can see whether sessions are actually happening.
// ════════════════════════════════════════════════════════════════
router.get('/child/sessions', protect, restrictTo('parent'), async (req, res) => {
  try {
    const child = await getLinkedChild(req);
    if (!child) {
      return res.status(404).json({ success: false, message: 'No child linked to this account yet.' });
    }
    if (!child.mentorId) {
      return res.json({ success: true, upcoming: [], recent: [] });
    }

    const now = new Date();
    const upcoming = await Session.find({ mentee: child._id, startTime: { $gte: now }, status: 'scheduled' })
      .sort('startTime')
      .limit(5)
      .lean();
    const recent = await Session.find({ mentee: child._id, status: { $in: ['completed', 'cancelled'] } })
      .sort('-startTime')
      .limit(5)
      .lean();

    res.json({
      success: true,
      upcoming: upcoming.map(s => ({ id: s._id, startTime: s.startTime, topic: s.topic, status: s.status })),
      recent: recent.map(s => ({ id: s._id, startTime: s.startTime, topic: s.topic, status: s.status })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch sessions.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/parent/child/sessions/:sessionId/notes  (parent only)
// Returns only the mentor's *shared* notes for one of the child's own
// sessions — never privateNotes, which are mentor-only. Ownership is
// checked (mentee === the linked child) so a parent can't fetch notes
// for a session that isn't theirs.
// ════════════════════════════════════════════════════════════════
router.get('/child/sessions/:sessionId/notes', protect, restrictTo('parent'), async (req, res) => {
  try {
    const child = await getLinkedChild(req);
    if (!child) {
      return res.status(404).json({ success: false, message: 'No child linked to this account yet.' });
    }

    const session = await Session.findOne({ _id: req.params.sessionId, mentee: child._id }).lean();
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found.' });
    }

    const note = await SessionNote.findOne({ session: session._id }).select('sharedNotes updatedAt').lean();

    res.json({
      success: true,
      sharedNotes: (note && note.sharedNotes) || '',
      updatedAt: note ? note.updatedAt : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch session notes.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/parent/concerns  (parent only)
// Lets a parent report a concern about their child's mentor — the same
// underlying Ticket model students use to flag mentor conduct. Ticket
// is filed against the child (student field), but the audit log below
// correctly records the parent as the actor.
// ════════════════════════════════════════════════════════════════
router.post('/concerns', protect, restrictTo('parent'), async (req, res) => {
  try {
    const { category, description } = req.body;
    if (!category || !description || !description.trim()) {
      return res.status(400).json({ success: false, message: 'category and description are required.' });
    }

    const child = await getLinkedChild(req);
    if (!child) {
      return res.status(400).json({ success: false, message: 'No child linked to this account yet.' });
    }

    const ticket = await Ticket.create({
      student: child._id,
      mentor: child.mentorId || null,
      category,
      description: description.trim(),
    });

    await auditService.log({
      actor: req.user,
      action: 'ticket.create',
      module: MODULES.TICKET,
      targetType: 'Ticket',
      targetId: ticket._id,
      after: { category, status: ticket.status, filedByParent: true },
      req,
    });

    res.status(201).json({ success: true, ticket });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to submit report.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/parent/concerns  (parent only) — this parent's past reports
// ════════════════════════════════════════════════════════════════
router.get('/concerns', protect, restrictTo('parent'), async (req, res) => {
  try {
    const child = await getLinkedChild(req);
    if (!child) {
      return res.json({ success: true, tickets: [] });
    }
    const tickets = await Ticket.find({ student: child._id }).sort('-createdAt').lean();
    res.json({ success: true, tickets });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch reports.' });
  }
});

module.exports = router;
