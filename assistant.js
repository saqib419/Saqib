const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Chapter = require('../models/Chapter');
const UserProgress = require('../models/UserProgress');
const StudySession = require('../models/StudySession');
const { examGroupFor } = require('./curriculum');

// An Assistant's mentorId points at the Mentor they work under (set at
// creation time -- see scripts/createStaffUser.js / adminUsers.controller.js).
// Every route here is scoped to that mentor's students, never the
// Assistant's own record.

// ════════════════════════════════════════════════════════════════
// GET /api/assistant/students  (assistant only)
// ════════════════════════════════════════════════════════════════
router.get('/students', protect, restrictTo('assistant'), async (req, res) => {
  try {
    if (!req.user.mentorId) {
      return res.json({ success: true, count: 0, students: [], linked: false, mentor: null });
    }

    const mentor = await User.findById(req.user.mentorId).select('name mentorProfile').lean();
    const students = await User.find({ mentorId: req.user.mentorId, role: 'student' })
      .select('name email avatar onboarding streak xp level')
      .lean();

    const result = await Promise.all(students.map(async (student) => {
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
        streak: student.streak || 0,
        xp: student.xp || 0,
        level: student.level || 1,
        overallMastery,
        completedChapters,
        totalChapters,
      };
    }));

    res.json({
      success: true,
      count: result.length,
      students: result,
      linked: true,
      mentor: mentor ? { name: mentor.name, title: mentor.mentorProfile && mentor.mentorProfile.title } : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch students.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/assistant/students/:id/subjects
// ════════════════════════════════════════════════════════════════
router.get('/students/:id/subjects', protect, restrictTo('assistant'), async (req, res) => {
  try {
    const student = await User.findOne({ _id: req.params.id, mentorId: req.user.mentorId, role: 'student' })
      .select('onboarding')
      .lean();

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found or not under your mentor.' });
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
    res.status(500).json({ success: false, message: 'Failed to fetch subjects.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/assistant/students/:id/chapters?subjectId=...
// Chapter list for one subject, so the Assistant can pick a chapter
// when logging a session (mirrors the student's own study.html picker).
// ════════════════════════════════════════════════════════════════
router.get('/students/:id/chapters', protect, restrictTo('assistant'), async (req, res) => {
  try {
    const { subjectId } = req.query;
    if (!subjectId) {
      return res.status(400).json({ success: false, message: 'subjectId query param is required.' });
    }

    const student = await User.findOne({ _id: req.params.id, mentorId: req.user.mentorId, role: 'student' })
      .select('_id')
      .lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found or not under your mentor.' });
    }

    const chapters = await Chapter.find({ subject: subjectId }).sort('order').select('name order').lean();
    res.json({ success: true, chapters });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch chapters.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/assistant/students/:id/sessions
// Recent session history (most recent 15), so the Assistant can see
// what's already been logged rather than just current totals.
// ════════════════════════════════════════════════════════════════
router.get('/students/:id/sessions', protect, restrictTo('assistant'), async (req, res) => {
  try {
    const student = await User.findOne({ _id: req.params.id, mentorId: req.user.mentorId, role: 'student' })
      .select('_id')
      .lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found or not under your mentor.' });
    }

    const sessions = await StudySession.find({ user: student._id })
      .sort('-completedAt')
      .limit(15)
      .populate('chapter', 'name')
      .lean();

    res.json({
      success: true,
      sessions: sessions.map(s => ({
        id: s._id,
        chapterName: (s.chapter && s.chapter.name) || 'Unknown chapter',
        durationMinutes: s.durationMinutes,
        xpEarned: s.xpEarned,
        completedAt: s.completedAt,
        loggedByAssistant: !!s.loggedByAssistant,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch session history.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/assistant/students/:id/sessions
// Log a study session on behalf of a student. Mirrors the XP/streak/
// progress logic in routes/study.js POST /sessions exactly, so a
// session logged here behaves identically to one the student logs
// themselves.
// ════════════════════════════════════════════════════════════════
router.post('/students/:id/sessions', protect, restrictTo('assistant'), async (req, res) => {
  try {
    const { chapterId, durationMinutes } = req.body;

    if (!chapterId || !durationMinutes || durationMinutes <= 0) {
      return res.status(400).json({
        success: false,
        message: 'chapterId and durationMinutes (> 0) are required',
      });
    }

    const student = await User.findOne({ _id: req.params.id, mentorId: req.user.mentorId, role: 'student' });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found or not under your mentor.' });
    }

    const chapter = await Chapter.findById(chapterId);
    if (!chapter) {
      return res.status(404).json({ success: false, message: 'Chapter not found.' });
    }

    const xpEarned = Math.max(10, Math.floor(durationMinutes * 2));

    const session = new StudySession({
      user: student._id,
      chapter: chapterId,
      durationMinutes,
      xpEarned,
      completedAt: new Date(),
      loggedByAssistant: req.user._id,
    });
    await session.save();

    student.totalStudyMinutes = (student.totalStudyMinutes || 0) + durationMinutes;
    student.xp = (student.xp || 0) + xpEarned;

    const xpForCurrentLevel = (student.level - 1) * student.xpPerLevel;
    const xpIntoCurrentLevel = student.xp - xpForCurrentLevel;
    if (xpIntoCurrentLevel >= student.xpPerLevel) {
      student.level += 1;
    }

    const today = new Date().toDateString();
    const lastStudyDateString = student.lastStudyDate ? new Date(student.lastStudyDate).toDateString() : null;

    if (lastStudyDateString !== today) {
      if (lastStudyDateString) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (new Date(student.lastStudyDate).toDateString() === yesterday.toDateString()) {
          student.streak += 1;
        } else {
          student.streak = 1;
        }
      } else {
        student.streak = 1;
      }
      student.lastStudyDate = new Date();
    }

    await student.save();

    await UserProgress.findOneAndUpdate(
      { user: student._id, chapter: chapterId },
      { $set: { status: 'in_progress', lastAccessedAt: new Date() } },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      session,
      studentStats: {
        xpEarned,
        totalXp: student.xp,
        level: student.level,
        streak: student.streak,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to log study session.' });
  }
});

module.exports = router;
