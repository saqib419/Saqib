const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const UserProgress = require('../models/UserProgress');
const StudySession = require('../models/StudySession');
const Evaluation = require('../models/Evaluation');

router.use(protect);

// Achievements are computed live from real data -- nothing is stored or
// faked. Every rule below reads from a field that already exists and is
// populated elsewhere in the app (User.streak/level/xp, UserProgress,
// StudySession, Evaluation).
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const progress = await UserProgress.find({ user: userId }).populate('chapter').lean();
    const chaptersCompleted = progress.filter(p => p.status === 'completed').length;

    // Mastery per subject: sum unitsCompleted vs sum totalUnits, grouped by
    // the chapter's subject. Take the best (highest) subject mastery.
    const subjectTotals = {};
    for (const p of progress) {
      if (!p.chapter) continue;
      const sid = String(p.chapter.subject);
      if (!subjectTotals[sid]) subjectTotals[sid] = { done: 0, total: 0 };
      subjectTotals[sid].done += p.unitsCompleted || 0;
      subjectTotals[sid].total += p.chapter.totalUnits || 1;
    }
    let bestMastery = 0;
    for (const sid in subjectTotals) {
      const t = subjectTotals[sid];
      const pct = t.total > 0 ? (t.done / t.total) * 100 : 0;
      if (pct > bestMastery) bestMastery = pct;
    }

    const sessions = await StudySession.find({ user: userId }).lean();
    const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

    const latestEval = await Evaluation.findOne({ student: userId, status: 'published' })
      .sort({ publishedAt: -1 })
      .lean();
    const diagnosticRating = latestEval
      ? Math.round(
          ((latestEval.academicScore || 0) +
            (latestEval.behaviourScore || 0) +
            (latestEval.attendanceScore || 0) +
            (latestEval.communicationScore || 0)) / 4
        )
      : null;

    const streak = user.streak || 0;
    const level = user.level || 1;
    const xp = user.xp || 0;

    const defs = [
      { id: 'streak_2',   title: '2-Day Streak',        description: 'Studied 2 days in a row',        icon: 'flame',      color: 'gold',   unlocked: streak >= 2 },
      { id: 'streak_7',   title: '7-Day Streak',        description: 'Studied 7 days in a row',        icon: 'flame',      color: 'gold',   unlocked: streak >= 7 },
      { id: 'streak_30',  title: '30-Day Streak',       description: 'Studied 30 days in a row',       icon: 'flame',      color: 'gold',   unlocked: streak >= 30 },
      { id: 'level_2',    title: 'Level 2',             description: 'Reached Level 2',                icon: 'trending-up', color: 'teal',   unlocked: level >= 2 },
      { id: 'level_5',    title: 'Level 5',             description: 'Reached Level 5',                icon: 'trending-up', color: 'teal',   unlocked: level >= 5 },
      { id: 'xp_500',     title: 'XP Grinder',          description: 'Earned 500 XP',                  icon: 'zap',        color: 'teal',   unlocked: xp >= 500 },
      { id: 'chapter_1',  title: 'First Chapter',       description: 'Completed your first chapter',   icon: 'book-check', color: 'teal',   unlocked: chaptersCompleted >= 1 },
      { id: 'chapter_10', title: 'Chapter Crusher',     description: 'Completed 10 chapters',          icon: 'book-check', color: 'teal',   unlocked: chaptersCompleted >= 10 },
      { id: 'mastery_25', title: 'Subject Explorer',    description: 'Reached 25% mastery in a subject', icon: 'compass',  color: 'purple', unlocked: bestMastery >= 25 },
      { id: 'mastery_50', title: 'Subject Specialist',  description: 'Reached 50% mastery in a subject', icon: 'sparkles', color: 'purple', unlocked: bestMastery >= 50 },
      { id: 'mastery_90', title: 'Subject Expert',      description: 'Reached 90% mastery in a subject', icon: 'sparkles', color: 'purple', unlocked: bestMastery >= 90 },
      { id: 'hours_1',    title: 'First Hour',          description: 'Logged 1 hour of study',         icon: 'clock',      color: 'blue',   unlocked: totalMinutes >= 60 },
      { id: 'hours_10',   title: 'Dedicated Learner',   description: 'Logged 10 hours of study',       icon: 'clock',      color: 'blue',   unlocked: totalMinutes >= 600 },
      { id: 'top_performer', title: 'Top Performer',    description: 'Scored 85+ on a mentor evaluation', icon: 'medal',  color: 'green',  unlocked: diagnosticRating !== null && diagnosticRating >= 85 },
    ];

    const unlockedCount = defs.filter(d => d.unlocked).length;

    res.json({ success: true, achievements: defs, unlockedCount, total: defs.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to compute achievements.' });
  }
});

module.exports = router;
