const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Chapter = require('../models/Chapter');
const UserProgress = require('../models/UserProgress');
const { examGroupFor } = require('./curriculum');
const MentorRequest = require('../models/MentorRequest');
const Session = require('../models/Session');
const Message = require('../models/Message');
const MentorAvailability = require('../models/MentorAvailability');
const DailyMission = require('../models/DailyMission');
const { draftReply } = require('../services/anthropic.service');

// ════════════════════════════════════════════════════════════════
// GET /api/mentor/mentees  (mentor/admin only)
// ════════════════════════════════════════════════════════════════
router.get('/mentees', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const students = await User.find({ mentorId: req.user._id, role: 'student' })
      .select('name email avatar onboarding')
      .lean();

    const mentees = await Promise.all(students.map(async (student) => {
      const examGroup = examGroupFor(student.onboarding);
      const subjects = await Subject.find({ examGroup }).select('_id').lean();
      const subjectIds = subjects.map(s => s._id);
      const chapters = await Chapter.find({ subject: { $in: subjectIds } }).select('_id').lean();
      const chapterIds = chapters.map(c => c._id);

      const progress = await UserProgress.find({
        user: student._id,
        chapter: { $in: chapterIds },
      }).lean();

      const totalChapters = chapters.length;
      const completedChapters = progress.filter(p => p.status === 'completed').length;
      const totalPct = progress.reduce((sum, p) => sum + (p.percentComplete || 0), 0);
      const overallMastery = totalChapters ? Math.round(totalPct / totalChapters) : 0;

      return {
        id: student._id,
        name: student.name,
        exam: (student.onboarding && student.onboarding.exam) || null,
        overallMastery,
        completedChapters,
        totalChapters,
      };
    }));

    res.json({ success: true, count: mentees.length, mentees });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch mentees.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/mentor/mentees/:id/subjects  (mentor/admin only)
// ════════════════════════════════════════════════════════════════
router.get('/mentees/:id/subjects', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const student = await User.findOne({ _id: req.params.id, mentorId: req.user._id, role: 'student' })
      .select('onboarding')
      .lean();

    if (!student) {
      return res.status(404).json({ success: false, message: 'Mentee not found or not assigned to you.' });
    }

    const examGroup = examGroupFor(student.onboarding);
    const subjects = await Subject.find({ examGroup }).sort('order').lean();
    const subjectIds = subjects.map(s => s._id);
    const chapters = await Chapter.find({ subject: { $in: subjectIds } }).lean();
    const progress = await UserProgress.find({
      user: student._id,
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
    res.status(500).json({ success: false, message: 'Failed to fetch mentee subjects.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/mentor/requests
// ════════════════════════════════════════════════════════════════
router.get('/requests', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const requests = await MentorRequest.find({ mentor: req.user._id, status: 'pending' })
      .populate('student', 'name email avatar onboarding')
      .sort('-createdAt')
      .lean();
    res.json({ success: true, requests });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch requests.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/mentor/requests/:requestId/:action  (accept | decline)
// ════════════════════════════════════════════════════════════════
router.post('/requests/:requestId/:action', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const { requestId, action } = req.params;
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action.' });
    }

    const request = await MentorRequest.findOne({ _id: requestId, mentor: req.user._id });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    request.status = action === 'accept' ? 'accepted' : 'declined';
    request.respondedAt = new Date();
    await request.save();

    if (action === 'accept') {
      await User.findByIdAndUpdate(request.student, { mentorId: req.user._id });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update request.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/mentor/sessions/upcoming
// ════════════════════════════════════════════════════════════════
router.get('/sessions/upcoming', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    // Admins see sessions across every mentor (their own _id is never a
    // session's `mentor` field, so filtering by req.user._id here — same
    // as the mentor path — silently returned zero rows for admins).
    // Mentors keep the original "just mine" behavior.
    const mentorFilter = req.user.role === 'admin' ? {} : { mentor: req.user._id };

    const upcoming = await Session.find({ ...mentorFilter, startTime: { $gte: now }, status: 'scheduled' })
      .populate('mentee', 'name avatar')
      .populate('mentor', 'name avatar')
      .sort('startTime')
      .limit(req.user.role === 'admin' ? 20 : undefined)
      .lean();

    const recent = await Session.find({ ...mentorFilter, status: 'completed' })
      .populate('mentee', 'name avatar')
      .populate('mentor', 'name avatar')
      .sort('-startTime')
      .limit(10)
      .lean();

    const weeklyCount = await Session.countDocuments({
      ...mentorFilter,
      status: 'completed',
      startTime: { $gte: startOfWeek },
    });

    res.json({
      success: true,
      upcoming,
      recent,
      weeklySessionsCompleted: weeklyCount,
      weeklySessionTarget: (req.user.mentorProfile && req.user.mentorProfile.weeklySessionTarget) || 8,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch sessions.' });
  }
});

// ════════════════════════════════════════════════════════════════
// PATCH /api/mentor/sessions/:sessionId/complete
// ════════════════════════════════════════════════════════════════
router.patch('/sessions/:sessionId/complete', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const session = await Session.findOne({ _id: req.params.sessionId, mentor: req.user._id });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found.' });
    }
    session.status = 'completed';
    await session.save();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update session.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/mentor/ai/draft-reply
// ════════════════════════════════════════════════════════════════
router.post('/ai/draft-reply', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const { question, menteeName, subject } = req.body;
    if (!question || question.length > 2000) {
      return res.status(400).json({ success: false, message: 'Question is required and must be under 2000 characters.' });
    }
    const draft = await draftReply({ question, menteeName, subject });
    res.json({ success: true, draft });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to generate draft reply.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/mentor/available  (student only)
// ════════════════════════════════════════════════════════════════
router.get('/available', protect, restrictTo('student'), async (req, res) => {
  try {
    const mentors = await User.find({ role: 'mentor' })
      .select('name avatar mentorProfile')
      .lean();
    res.json({ success: true, mentors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch mentors.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/mentor/requests  (student only)
// ════════════════════════════════════════════════════════════════
router.post('/requests', protect, restrictTo('student'), async (req, res) => {
  try {
    const { mentorId, message } = req.body;
    if (!mentorId) {
      return res.status(400).json({ success: false, message: 'mentorId is required.' });
    }

    const mentor = await User.findOne({ _id: mentorId, role: 'mentor' });
    if (!mentor) {
      return res.status(404).json({ success: false, message: 'Mentor not found.' });
    }

    if (req.user.mentorId && req.user.mentorId.toString() === mentorId) {
      return res.status(400).json({ success: false, message: 'This mentor is already assigned to you.' });
    }

    const existing = await MentorRequest.findOne({
      mentor: mentorId,
      student: req.user._id,
      status: 'pending',
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You already have a pending request with this mentor.' });
    }

    const request = await MentorRequest.create({
      mentor: mentorId,
      student: req.user._id,
      message: message || '',
    });

    res.status(201).json({ success: true, request });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create request.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/mentor/sessions  (mentor only)
// ════════════════════════════════════════════════════════════════
router.post('/sessions', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const { menteeId, startTime, type, topic, meetingLink } = req.body;
    if (!menteeId || !startTime) {
      return res.status(400).json({ success: false, message: 'menteeId and startTime are required.' });
    }

    const mentee = await User.findOne({ _id: menteeId, mentorId: req.user._id, role: 'student' });
    if (!mentee) {
      return res.status(404).json({ success: false, message: 'Mentee not found or not assigned to you.' });
    }

    const session = await Session.create({
      mentor: req.user._id,
      mentee: menteeId,
      type: type || '1:1',
      topic: topic || '',
      startTime: new Date(startTime),
      meetingLink: meetingLink || '',
    });

    res.status(201).json({ success: true, session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create session.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/mentor/availability
// ════════════════════════════════════════════════════════════════
router.get('/messages/:menteeId', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    // Same fix as /sessions/upcoming and the student-list bug: an admin's
    // _id never equals a student's mentorId, so the mentor-only filter
    // silently 404'd for every admin request. Admins can message any
    // student; mentors are still restricted to their own mentees.
    const menteeQuery = req.user.role === 'admin'
      ? { _id: req.params.menteeId, role: 'student' }
      : { _id: req.params.menteeId, mentorId: req.user._id, role: 'student' };

    const mentee = await User.findOne(menteeQuery);
    if (!mentee) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const messages = await Message.find({
      $or: [
        { sender: req.user._id, recipient: mentee._id },
        { sender: mentee._id, recipient: req.user._id },
      ],
    }).sort('createdAt').lean();

    res.json({ success: true, messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch messages.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/mentor/messages
// ════════════════════════════════════════════════════════════════
router.post('/messages', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const { menteeId, content } = req.body;
    if (!menteeId || !content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'menteeId and content are required.' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ success: false, message: 'Message is too long.' });
    }

    const menteeQuery = req.user.role === 'admin'
      ? { _id: menteeId, role: 'student' }
      : { _id: menteeId, mentorId: req.user._id, role: 'student' };

    const mentee = await User.findOne(menteeQuery);
    if (!mentee) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const message = await Message.create({
      sender: req.user._id,
      recipient: menteeId,
      content: content.trim(),
    });

    res.status(201).json({ success: true, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});
// ════════════════════════════════════════════════════════════════
// PUT /api/mentor/availability
// Body: { slots: [{ day, startTime, endTime }, ...] }
// ════════════════════════════════════════════════════════════════
router.put('/availability', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const { slots } = req.body;
    if (!Array.isArray(slots)) {
      return res.status(400).json({ success: false, message: 'slots must be an array.' });
    }
    const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
    for (const s of slots) {
      if (typeof s.day !== 'number' || s.day < 0 || s.day > 6) {
        return res.status(400).json({ success: false, message: 'Each slot needs a valid day (0-6).' });
      }
      if (!timeRe.test(s.startTime) || !timeRe.test(s.endTime)) {
        return res.status(400).json({ success: false, message: 'Times must be in HH:MM 24-hour format.' });
      }
      if (s.startTime >= s.endTime) {
        return res.status(400).json({ success: false, message: 'Each slot\'s start time must be before its end time.' });
      }
    }

    const record = await MentorAvailability.findOneAndUpdate(
      { mentor: req.user._id },
      { mentor: req.user._id, slots },
      { upsert: true, new: true }
    );

    res.json({ success: true, slots: record.slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update availability.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/mentor/parents  (mentor/admin only)
// Parents linked to one of this mentor's students.
// ════════════════════════════════════════════════════════════════
router.get('/parents', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const students = await User.find({ mentorId: req.user._id, role: 'student' }).select('_id name').lean();
    const studentIds = students.map(s => s._id);
    const studentNameById = {};
    students.forEach(s => { studentNameById[s._id.toString()] = s.name; });

    const parents = await User.find({ childId: { $in: studentIds }, role: 'parent' })
      .select('name avatar childId')
      .lean();

    res.json({
      success: true,
      parents: parents.map(p => ({
        id: p._id,
        name: p.name,
        avatar: p.avatar,
        childName: studentNameById[p.childId.toString()] || null,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch parents.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/mentor/parent-messages/:parentId
// ════════════════════════════════════════════════════════════════
router.get('/parent-messages/:parentId', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const parent = await User.findOne({ _id: req.params.parentId, role: 'parent' }).lean();
    if (!parent || !parent.childId) {
      return res.status(404).json({ success: false, message: 'Parent not found.' });
    }
    const linkedStudent = await User.findOne({ _id: parent.childId, mentorId: req.user._id, role: 'student' }).lean();
    if (!linkedStudent) {
      return res.status(404).json({ success: false, message: 'This parent is not linked to one of your students.' });
    }

    const messages = await Message.find({
      $or: [
        { sender: req.user._id, recipient: parent._id },
        { sender: parent._id, recipient: req.user._id },
      ],
    }).sort('createdAt').lean();

    res.json({ success: true, messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch messages.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/mentor/parent-messages/:parentId
// ════════════════════════════════════════════════════════════════
router.post('/parent-messages/:parentId', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'content is required.' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ success: false, message: 'Message is too long.' });
    }

    const parent = await User.findOne({ _id: req.params.parentId, role: 'parent' }).lean();
    if (!parent || !parent.childId) {
      return res.status(404).json({ success: false, message: 'Parent not found.' });
    }
    const linkedStudent = await User.findOne({ _id: parent.childId, mentorId: req.user._id, role: 'student' }).lean();
    if (!linkedStudent) {
      return res.status(404).json({ success: false, message: 'This parent is not linked to one of your students.' });
    }

    const message = await Message.create({
      sender: req.user._id,
      recipient: parent._id,
      content: content.trim(),
    });

    res.status(201).json({ success: true, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/mentor/admin-messages  — unified thread of every message
// exchanged between the logged-in mentor and any Admin/Super Admin.
// Backs the "Admin Messages" panel on the mentor dashboard.
// ════════════════════════════════════════════════════════════════
router.get('/admin-messages', protect, restrictTo('mentor'), async (req, res) => {
  try {
    const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('name email role').lean();
    const adminIds = admins.map((a) => a._id);

    const messages = await Message.find({
      $or: [
        { sender: req.user._id, recipient: { $in: adminIds } },
        { sender: { $in: adminIds }, recipient: req.user._id },
      ],
    }).sort('createdAt').lean();

    res.json({ success: true, admins, messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load messages.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/mentor/admin-messages  — mentor replies to a specific admin
// ════════════════════════════════════════════════════════════════
router.post('/admin-messages', protect, restrictTo('mentor'), async (req, res) => {
  try {
    const { adminId, content } = req.body;
    if (!adminId || !content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'adminId and content are required.' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ success: false, message: 'Message is too long.' });
    }

    const admin = await User.findOne({ _id: adminId, role: { $in: ['admin', 'super_admin'] } });
    if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

    const message = await Message.create({
      sender: req.user._id,
      recipient: adminId,
      content: content.trim(),
    });

    res.status(201).json({ success: true, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/mentor/students/:id/mission  (mentor/admin only)
// View a student's mission for today (to edit it).
// ════════════════════════════════════════════════════════════════
router.get('/students/:id/mission', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const student = await User.findOne({ _id: req.params.id, mentorId: req.user._id, role: 'student' }).select('_id');
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found or not assigned to you.' });
    }

    const date = new Date().toISOString().slice(0, 10);
    const mission = await DailyMission.findOne({ user: student._id, date });

    res.json({
      success: true,
      date,
      tasks: mission ? mission.tasks : [],
      completedTaskIds: mission ? mission.completedTaskIds : [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch mission.' });
  }
});

// ════════════════════════════════════════════════════════════════
// PUT /api/mentor/students/:id/mission  (mentor/admin only)
// Set (replace) today's mission task list for a student.
// body: { tasks: [{ subject, title, durationLabel, priority }, ...] }
// ════════════════════════════════════════════════════════════════
router.put('/students/:id/mission', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const student = await User.findOne({ _id: req.params.id, mentorId: req.user._id, role: 'student' }).select('_id');
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found or not assigned to you.' });
    }

    const { tasks } = req.body;
    if (!Array.isArray(tasks)) {
      return res.status(400).json({ success: false, message: 'tasks must be an array.' });
    }
    if (tasks.length > 12) {
      return res.status(400).json({ success: false, message: 'Maximum 12 tasks per day.' });
    }

    const validPriorities = ['high', 'medium', 'low'];
    const cleanTasks = [];
    for (const t of tasks) {
      if (!t.subject || !t.title) {
        return res.status(400).json({ success: false, message: 'Each task needs a subject and a title.' });
      }
      cleanTasks.push({
        id: t.id || Math.random().toString(36).slice(2, 10),
        subject: String(t.subject).trim().slice(0, 40),
        title: String(t.title).trim().slice(0, 200),
        durationLabel: t.durationLabel ? String(t.durationLabel).trim().slice(0, 20) : '',
        priority: validPriorities.includes(t.priority) ? t.priority : 'medium',
      });
    }

    const date = new Date().toISOString().slice(0, 10);
    const validIds = new Set(cleanTasks.map(t => t.id));

    const existing = await DailyMission.findOne({ user: student._id, date });
    const keptCompletedIds = existing
      ? existing.completedTaskIds.filter(id => validIds.has(id))
      : [];

    const mission = await DailyMission.findOneAndUpdate(
      { user: student._id, date },
      {
        $set: {
          tasks: cleanTasks,
          completedTaskIds: keptCompletedIds,
          assignedBy: req.user._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, date, tasks: mission.tasks, completedTaskIds: mission.completedTaskIds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to set mission.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/mentor/analytics  (mentor/admin only)
// Real numbers for the "Mentoring Analytics" card: sessions held this
// week, response rate to mentee requests, satisfaction (real rating,
// honestly labeled if there are no reviews yet), a real Mon-Sun bar
// chart, a real 9-week heatmap, and genuine recognition milestones.
// ════════════════════════════════════════════════════════════════
router.get('/analytics', protect, restrictTo('mentor', 'admin'), async (req, res) => {
  try {
    const mentorId = req.user._id;
    const now = new Date();

    // ── This week's Mon–Sun window ──
    const dayOfWeek = now.getDay(); // 0=Sun..6=Sat
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dailyCounts = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(monday);
      dayStart.setDate(monday.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      if (dayStart > now) {
        dailyCounts.push({ day: dayLabels[i], count: 0 });
        continue;
      }
      const count = await Session.countDocuments({
        mentor: mentorId,
        status: 'completed',
        startTime: { $gte: dayStart, $lt: dayEnd },
      });
      dailyCounts.push({ day: dayLabels[i], count });
    }

    const weeklySessionsCompleted = dailyCounts.reduce((sum, d) => sum + d.count, 0);
    const weeklySessionTarget = (req.user.mentorProfile && req.user.mentorProfile.weeklySessionTarget) || 8;

    // ── Response rate: % of mentor requests that have been actioned ──
    const totalRequests = await MentorRequest.countDocuments({ mentor: mentorId });
    const respondedRequests = await MentorRequest.countDocuments({ mentor: mentorId, status: { $ne: 'pending' } });
    const responseRate = totalRequests > 0 ? Math.round((respondedRequests / totalRequests) * 100) : null;

    // ── Satisfaction: real rating/reviewCount, honestly labeled if empty ──
    const rating = req.user.mentorProfile ? req.user.mentorProfile.rating : null;
    const reviewCount = req.user.mentorProfile ? req.user.mentorProfile.reviewCount : 0;

    // ── 9-week heatmap of completed sessions ──
    const heatmapWeeks = 9;
    const heatmapStart = new Date(monday);
    heatmapStart.setDate(monday.getDate() - (heatmapWeeks - 1) * 7);

    const rangeSessions = await Session.find({
      mentor: mentorId,
      status: 'completed',
      startTime: { $gte: heatmapStart },
    }).select('startTime').lean();

    const countByDate = {};
    rangeSessions.forEach(s => {
      const key = new Date(s.startTime).toISOString().slice(0, 10);
      countByDate[key] = (countByDate[key] || 0) + 1;
    });

    function levelFor(count) {
      if (count <= 0) return 0;
      if (count === 1) return 2;
      if (count === 2) return 3;
      return 4;
    }

    const heatmap = [];
    for (let w = 0; w < heatmapWeeks; w++) {
      const weekStart = new Date(heatmapStart);
      weekStart.setDate(heatmapStart.getDate() + w * 7);
      const week = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(weekStart);
        day.setDate(weekStart.getDate() + d);
        const key = day.toISOString().slice(0, 10);
        const count = countByDate[key] || 0;
        week.push({ date: key, count, level: levelFor(count) });
      }
      heatmap.push(week);
    }

    // ── Recognition: genuine milestones ──
    const totalCompletedSessions = await Session.countDocuments({ mentor: mentorId, status: 'completed' });

    // Consecutive-week streak: walk backwards from this week while each
    // week has >=1 completed session.
    let streakWeeks = 0;
    for (let w = 0; w < 52; w++) {
      const weekStart = new Date(monday);
      weekStart.setDate(monday.getDate() - w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const count = await Session.countDocuments({
        mentor: mentorId,
        status: 'completed',
        startTime: { $gte: weekStart, $lt: weekEnd },
      });
      if (count > 0) streakWeeks++;
      else break;
    }

    const milestones = [];
    if (streakWeeks > 0) {
      milestones.push({ type: 'streak', label: `${streakWeeks}-Week Streak`, sub: 'Active every week' });
    }
    if (reviewCount >= 10 && rating >= 4.5) {
      milestones.push({ type: 'top_rated', label: 'Top Rated Mentor', sub: `${rating.toFixed(1)}★ over ${reviewCount} reviews` });
    }
    const sessionMilestones = [100, 50, 25, 10];
    const hitMilestone = sessionMilestones.find(m => totalCompletedSessions >= m);
    if (hitMilestone) {
      milestones.push({ type: 'sessions', label: `${hitMilestone} Sessions`, sub: 'Milestone reached' });
    }

    res.json({
      success: true,
      weeklySessionsCompleted,
      weeklySessionTarget,
      dailyCounts,
      responseRate,
      rating,
      reviewCount,
      heatmap,
      totalCompletedSessions,
      streakWeeks,
      milestones,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics.' });
  }
});

module.exports = router;
