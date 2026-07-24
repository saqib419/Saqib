const express       = require('express');
const router        = express.Router();
const Subject       = require('../models/Subject');
const Chapter       = require('../models/Chapter');
const UserProgress  = require('../models/UserProgress');
const { protect }   = require('../middleware/auth');

// ── Map a user's onboarding answers to the right curriculum group ──
function examGroupFor(onboarding) {
  const exam  = (onboarding && onboarding.exam) || 'NEET UG';
  const level = ((onboarding && onboarding.level) || '').toLowerCase();

  if (exam === 'NEET UG') return 'NEET_UG';
  if (exam === 'NEET PG' || exam === 'AIIMS' || exam === 'JIPMER') return 'PG_CLINICAL';
  if (exam === 'USMLE') {
    if (level.includes('step 3') || level.includes('preparing step 3')) return 'USMLE_STEP3';
    if (level.includes('step 2') || level.includes('preparing step 2')) return 'USMLE_STEP2';
    return 'USMLE_STEP1';
  }
  return 'NEET_UG';
}

// ════════════════════════════════════════════════════════════════
// GET /api/curriculum/subjects  (protected)
// Real, complete subject list for the user's OWN exam (auto-derived
// server-side from their onboarding data — no query param needed).
// Each subject includes mastery %, plus a lightweight embedded
// chapter list (id/title/status/percentComplete) so callers like
// study.html don't need N extra round trips per subject.
// ════════════════════════════════════════════════════════════════
router.get('/subjects', protect, async (req, res) => {
  try {
    const examGroup = examGroupFor(req.user.onboarding);
    const subjects = await Subject.find({ examGroup }).sort('order').lean();
    const subjectIds = subjects.map(s => s._id);

    const chapters = await Chapter.find({ subject: { $in: subjectIds } }).sort('order').lean();
    const progress = await UserProgress.find({
      user: req.user._id,
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
      const completedChapters = subjChapters.filter(c => {
        const p = progressByChapter[c._id.toString()];
        return p && p.status === 'completed';
      }).length;

      return {
        id: subj._id,
        name: subj.name,
        color: subj.color,
        mastery,
        chapterCount: subjChapters.length,
        completedChapters,
        chapters: subjChapters.map(c => {
          const p = progressByChapter[c._id.toString()];
          return {
            id: c._id,
            title: c.title,
            status: p ? p.status : 'not_started',
            percentComplete: p ? p.percentComplete : 0,
          };
        }),
      };
    });

    res.json({ success: true, examGroup, subjects: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/curriculum/subjects/:id/chapters  (protected)
// Full chapter list for one subject, with this user's real progress.
// ════════════════════════════════════════════════════════════════
router.get('/subjects/:id/chapters', protect, async (req, res) => {
  try {
    const chapters = await Chapter.find({ subject: req.params.id }).sort('order').lean();
    const progress = await UserProgress.find({
      user: req.user._id,
      chapter: { $in: chapters.map(c => c._id) },
    }).lean();

    const progressByChapter = {};
    progress.forEach(p => { progressByChapter[p.chapter.toString()] = p; });

    const result = chapters.map(c => {
      const p = progressByChapter[c._id.toString()];
      return {
        id: c._id,
        title: c.title,
        totalUnits: c.totalUnits,
        estimatedMinutes: c.estimatedMinutes,
        status: p ? p.status : 'not_started',
        unitsCompleted: p ? p.unitsCompleted : 0,
        percentComplete: p ? p.percentComplete : 0,
      };
    });

    res.json({ success: true, chapters: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/curriculum/continue-learning  (protected)
// User's real in-progress chapters, most recently touched first.
// ════════════════════════════════════════════════════════════════
router.get('/continue-learning', protect, async (req, res) => {
  try {
    const items = await UserProgress.find({ user: req.user._id, status: 'in_progress' })
      .sort('-lastAccessedAt')
      .limit(3)
      .populate({ path: 'chapter', populate: { path: 'subject' } })
      .lean();

    const result = items
      .filter(i => i.chapter && i.chapter.subject)
      .map(i => ({
        progressId: i._id,
        chapterId: i.chapter._id,
        subjectName: i.chapter.subject.name,
        subjectColor: i.chapter.subject.color,
        chapterTitle: i.chapter.title,
        unitsCompleted: i.unitsCompleted,
        totalUnits: i.chapter.totalUnits,
        percentComplete: i.percentComplete,
        estimatedMinutes: i.chapter.estimatedMinutes,
      }));

    res.json({ success: true, items: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
// PATCH /api/curriculum/progress/:chapterId  (protected)
// Record real activity on a chapter.
// ════════════════════════════════════════════════════════════════
router.patch('/progress/:chapterId', protect, async (req, res) => {
  try {
    const chapter = await Chapter.findById(req.params.chapterId);
    if (!chapter) return res.status(404).json({ success: false, message: 'Chapter not found.' });

    let { unitsCompleted, percentComplete, status } = req.body;
    if (percentComplete === undefined && unitsCompleted !== undefined) {
      percentComplete = Math.round((unitsCompleted / chapter.totalUnits) * 100);
    }
    if (!status) {
      status = percentComplete >= 100 ? 'completed' : 'in_progress';
    }

    const update = { status, lastAccessedAt: new Date() };
    if (unitsCompleted !== undefined) update.unitsCompleted = unitsCompleted;
    if (percentComplete !== undefined) update.percentComplete = Math.min(100, Math.max(0, percentComplete));

    const progress = await UserProgress.findOneAndUpdate(
      { user: req.user._id, chapter: chapter._id },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, progress });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
module.exports.examGroupFor = examGroupFor;
