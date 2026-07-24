const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const Chapter = require('../models/Chapter');
const StudySession = require('../models/StudySession');
const UserProgress = require('../models/UserProgress');
const DailyMission = require('../models/DailyMission');

// ════════════════════════════════════════════════════════════════
// GET /api/study/in-progress
// Get chapters currently in progress for the logged-in user
// ════════════════════════════════════════════════════════════════
router.get('/in-progress', protect, async (req, res) => {
  try {
    const progresses = await UserProgress.find({
      user: req.user._id,
      status: 'in_progress',
    })
      .populate('chapter')
      .populate({
        path: 'chapter',
        populate: { path: 'subject' },
      })
      .limit(5);

    const chapters = progresses.map(p => ({
      _id: p.chapter._id,
      title: p.chapter.title,
      subject: p.chapter.subject,
      progress: p,
    }));

    res.json({ success: true, chapters });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch in-progress chapters' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/study/sessions
// Save a completed study session and update user stats
// ════════════════════════════════════════════════════════════════
router.post('/sessions', protect, async (req, res) => {
  try {
    const { chapterId } = req.body;
    let { durationMinutes } = req.body;
    durationMinutes = Number(durationMinutes);

    // Server-side sanity cap — durationMinutes is client-reported (the
    // client can't be trusted to enforce this itself), so without a
    // ceiling a single request can hand out unlimited XP/level/streak.
    // 480 min = 8 hours, generous for one sitting.
    const MAX_SESSION_MINUTES = 480;

    if (!chapterId || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return res.status(400).json({
        success: false,
        message: 'chapterId and durationMinutes (> 0) are required',
      });
    }
    if (durationMinutes > MAX_SESSION_MINUTES) {
      return res.status(400).json({
        success: false,
        message: `A single session can't exceed ${MAX_SESSION_MINUTES} minutes. Log it as multiple sessions instead.`,
      });
    }

    const chapter = await Chapter.findById(chapterId);
    if (!chapter) {
      return res.status(404).json({ success: false, message: 'Chapter not found' });
    }

    // Calculate XP: 10 XP per 5 minutes (2 XP per minute)
    const xpEarned = Math.max(10, Math.floor(durationMinutes * 2));

    // Create study session
    const session = new StudySession({
      user: req.user._id,
      chapter: chapterId,
      durationMinutes,
      xpEarned,
      completedAt: new Date(),
    });
    await session.save();

    // Update user stats
    const user = await User.findById(req.user._id);
    user.totalStudyMinutes = (user.totalStudyMinutes || 0) + durationMinutes;
    user.xp = (user.xp || 0) + xpEarned;

    // Update level if XP threshold crossed
    const xpForCurrentLevel = (user.level - 1) * user.xpPerLevel;
    const xpIntoCurrentLevel = user.xp - xpForCurrentLevel;
    if (xpIntoCurrentLevel >= user.xpPerLevel) {
      user.level += 1;
    }

    // Update streak
    const today = new Date().toDateString();
    const lastStudyDateString = user.lastStudyDate ? new Date(user.lastStudyDate).toDateString() : null;
    
    if (lastStudyDateString !== today) {
      // It's a new day, or first session ever
      if (lastStudyDateString) {
        // Check if it was yesterday (streak continues)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (new Date(user.lastStudyDate).toDateString() === yesterday.toDateString()) {
          user.streak += 1;
        } else {
          // Streak broken, reset
          user.streak = 1;
        }
      } else {
        // First study session ever
        user.streak = 1;
      }
      user.lastStudyDate = new Date();
    }

    await user.save();

    // Update chapter progress (mark as in-progress if not already)
    const progress = await UserProgress.findOneAndUpdate(
      { user: req.user._id, chapter: chapterId },
      {
        $set: { status: 'in_progress', lastAccessedAt: new Date() },
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      session,
      userStats: {
        xpEarned,
        totalXp: user.xp,
        level: user.level,
        streak: user.streak,
        totalStudyMinutes: user.totalStudyMinutes,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to save study session' });
  }
});

// ── Parse onboarding's "hours per day" range (e.g. "4-6", "8+") into a target in minutes ──
function parseDailyTargetMinutes(hoursStr) {
  const DEFAULT_MINUTES = 240; // 4 hrs/day fallback if the user never set this
  if (!hoursStr) return DEFAULT_MINUTES;
  const str = String(hoursStr).trim();
  if (str.endsWith('+')) {
    const n = parseFloat(str);
    return isNaN(n) ? DEFAULT_MINUTES : n * 60;
  }
  const parts = str.split('-').map(s => parseFloat(s));
  if (parts.length === 2 && !parts.some(isNaN)) {
    return ((parts[0] + parts[1]) / 2) * 60;
  }
  const n = parseFloat(str);
  return isNaN(n) ? DEFAULT_MINUTES : n * 60;
}

// ════════════════════════════════════════════════════════════════
// GET /api/study/stats  (protected)
// Real numbers for the dashboard header: XP/level/streak (from the
// user doc), rank (computed live against every other real user by
// XP), and today's/this week's study-goal progress (computed from
// real StudySession records, target derived from onboarding.hours).
// ════════════════════════════════════════════════════════════════
router.get('/stats', protect, async (req, res) => {
  try {
    const user = req.user;

    // Rank: how many real users have strictly more XP, +1
    const higherCount = await User.countDocuments({ xp: { $gt: user.xp || 0 } });
    const totalUsers = await User.countDocuments({});
    const rank = higherCount + 1;

    // Today's real study minutes
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todaySessions = await StudySession.find({ user: user._id, completedAt: { $gte: startOfToday } }).lean();
    const todayMinutes = todaySessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

    // This week's (last 7 days incl. today) real study minutes
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - 6);
    startOfWeek.setHours(0, 0, 0, 0);
    const weekSessions = await StudySession.find({ user: user._id, completedAt: { $gte: startOfWeek } }).lean();
    const weekMinutes = weekSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

    const dailyTargetMinutes = parseDailyTargetMinutes(user.onboarding && user.onboarding.hours);
    const weeklyTargetMinutes = dailyTargetMinutes * 7;
    const goalPct = dailyTargetMinutes > 0 ? Math.min(100, Math.round((todayMinutes / dailyTargetMinutes) * 100)) : 0;
    const weeklyPct = weeklyTargetMinutes > 0 ? Math.min(100, Math.round((weekMinutes / weeklyTargetMinutes) * 100)) : 0;

    res.json({
      success: true,
      stats: {
        xp: user.xp || 0,
        level: user.level || 1,
        xpPerLevel: user.xpPerLevel || 1000,
        streak: user.streak || 0,
        totalStudyMinutes: user.totalStudyMinutes || 0,
        rank,
        totalUsers,
        todayMinutes,
        dailyTargetMinutes,
        goalPct,
        weekMinutes,
        weeklyTargetMinutes,
        weeklyPct,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

function todayDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

router.get('/missions', protect, async (req, res) => {
  try {
    const date = todayDateString();
    const mission = await DailyMission.findOne({ user: req.user._id, date });
    res.json({
      success: true,
      date,
      tasks: mission ? mission.tasks : [],
      completedTaskIds: mission ? mission.completedTaskIds : [],
      assigned: !!(mission && mission.tasks && mission.tasks.length),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch missions' });
  }
});

router.patch('/missions', protect, async (req, res) => {
  try {
    const { taskId, done } = req.body;
    if (!taskId || typeof done !== 'boolean') {
      return res.status(400).json({ success: false, message: 'taskId and done (boolean) are required' });
    }
    const date = todayDateString();

    const existing = await DailyMission.findOne({ user: req.user._id, date });
    if (!existing || !existing.tasks.some(t => t.id === taskId)) {
      return res.status(404).json({ success: false, message: 'That task is not part of today\'s assigned mission.' });
    }

    const update = done
      ? { $addToSet: { completedTaskIds: taskId } }
      : { $pull: { completedTaskIds: taskId } };

    const mission = await DailyMission.findOneAndUpdate(
      { user: req.user._id, date },
      update,
      { new: true }
    );

    res.json({ success: true, date, completedTaskIds: mission.completedTaskIds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update mission' });
  }
});

router.get('/analytics', protect, async (req, res) => {
  try {
    const user = req.user;
    const dailyTargetMinutes = parseDailyTargetMinutes(user.onboarding && user.onboarding.hours);
    const period = req.query.period === 'month' ? 'month' : 'week';
    const now = new Date();

    // Heatmap is period-independent (always the trailing 9 weeks), computed once.
    const heatmapDays = 63;
    const heatStart = new Date(now);
    heatStart.setDate(now.getDate() - (heatmapDays - 1));
    heatStart.setHours(0, 0, 0, 0);

    const rangeSessions = await StudySession.find({
      user: user._id,
      completedAt: { $gte: heatStart },
    }).select('durationMinutes completedAt').lean();

    const minutesByDate = {};
    rangeSessions.forEach(s => {
      const key = new Date(s.completedAt).toISOString().slice(0, 10);
      minutesByDate[key] = (minutesByDate[key] || 0) + (s.durationMinutes || 0);
    });

    function levelFor(minutes) {
      if (minutes <= 0) return 0;
      if (minutes < 30) return 1;
      if (minutes < 60) return 2;
      if (minutes < 120) return 3;
      return 4;
    }

    const heatmap = [];
    for (let i = 0; i < heatmapDays; i++) {
      const d = new Date(heatStart);
      d.setDate(heatStart.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const minutes = minutesByDate[key] || 0;
      heatmap.push({ date: key, minutes, level: levelFor(minutes) });
    }

    if (period === 'month') {
      // Current calendar month, bucketed into 7-day chunks (Wk 1 = days 1-7, etc.)
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const daysElapsedThisMonth = now.getDate(); // 1-indexed "today"

      const monthSessions = await StudySession.find({
        user: user._id,
        completedAt: { $gte: monthStart },
      }).select('durationMinutes completedAt').lean();

      const minutesByDayOfMonth = {};
      monthSessions.forEach(s => {
        const dom = new Date(s.completedAt).getDate();
        minutesByDayOfMonth[dom] = (minutesByDayOfMonth[dom] || 0) + (s.durationMinutes || 0);
      });

      const bucketCount = Math.ceil(daysInMonth / 7);
      const weeklyBuckets = [];
      for (let b = 0; b < bucketCount; b++) {
        const startDay = b * 7 + 1;
        const endDay = Math.min(startDay + 6, daysInMonth);
        let bucketMinutes = 0;
        for (let d = startDay; d <= endDay; d++) {
          bucketMinutes += minutesByDayOfMonth[d] || 0;
        }
        weeklyBuckets.push({ label: `Wk ${b + 1}`, minutes: bucketMinutes });
      }

      const monthMinutesTotal = Object.values(minutesByDayOfMonth).reduce((sum, m) => sum + m, 0);
      const monthlyHours = Math.round((monthMinutesTotal / 60) * 10) / 10;
      const monthlyTargetHours = Math.round((dailyTargetMinutes * daysInMonth / 60) * 10) / 10;

      const daysStudiedThisMonth = Object.keys(minutesByDayOfMonth).filter(d => minutesByDayOfMonth[d] > 0).length;
      const consistencyPct = daysElapsedThisMonth > 0
        ? Math.round((daysStudiedThisMonth / daysElapsedThisMonth) * 100)
        : 0;

      const avgSessionMinutes = monthSessions.length
        ? Math.round(monthSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / monthSessions.length)
        : 0;

      return res.json({
        success: true,
        period: 'month',
        analytics: {
          monthlyHours, monthlyTargetHours, consistencyPct, avgSessionMinutes,
          weeklyBuckets, dailyTargetMinutes, heatmap,
        },
      });
    }

    // ── Default: week ──
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
        user: user._id,
        completedAt: { $gte: dayStart, $lt: dayEnd },
      }).lean();
      const minutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
      dailyMinutes.push({ day: dayLabels[i], minutes });
    }

    const weekMinutesTotal = dailyMinutes.reduce((sum, d) => sum + d.minutes, 0);
    const weeklyHours = Math.round((weekMinutesTotal / 60) * 10) / 10;
    const weeklyTargetHours = Math.round((dailyTargetMinutes * 7 / 60) * 10) / 10;

    const daysElapsedThisWeek = dayOfWeek === 0 ? 7 : dayOfWeek;
    const daysStudied = dailyMinutes.slice(0, daysElapsedThisWeek).filter(d => d.minutes > 0).length;
    const consistencyPct = daysElapsedThisWeek > 0 ? Math.round((daysStudied / daysElapsedThisWeek) * 100) : 0;

    const allSessions = await StudySession.find({ user: user._id }).select('durationMinutes').lean();
    const avgSessionMinutes = allSessions.length
      ? Math.round(allSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / allSessions.length)
      : 0;

    res.json({
      success: true,
      period: 'week',
      analytics: {
        weeklyHours, weeklyTargetHours, consistencyPct, avgSessionMinutes,
        dailyMinutes, dailyTargetMinutes, heatmap,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
});

module.exports = router;
