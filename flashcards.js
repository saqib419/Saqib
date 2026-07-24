const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Flashcard = require('../models/Flashcard');
const FlashcardProgress = require('../models/FlashcardProgress');
const Subject = require('../models/Subject');
const { examGroupFor } = require('./curriculum');

// ════════════════════════════════════════════════════════════════
// GET /api/flashcards/subjects — subjects with card count + how many
// the user has already marked 'known', for the deck-picker screen.
// ════════════════════════════════════════════════════════════════
router.get('/subjects', protect, async (req, res) => {
  try {
    const examGroup = examGroupFor(req.user.onboarding);
    const subjects = await Subject.find({ examGroup }).sort('order').lean();

    const cardCounts = await Flashcard.aggregate([
      { $match: { examGroup } },
      { $group: { _id: '$subject', count: { $sum: 1 } } },
    ]);
    const countBySubject = {};
    cardCounts.forEach(c => { countBySubject[c._id.toString()] = c.count; });

    const allCardIds = await Flashcard.find({ examGroup }).select('_id subject').lean();
    const progress = await FlashcardProgress.find({
      user: req.user._id,
      flashcard: { $in: allCardIds.map(c => c._id) },
      status: 'known',
    }).select('flashcard').lean();
    const knownCardIds = new Set(progress.map(p => p.flashcard.toString()));

    const knownBySubject = {};
    allCardIds.forEach(c => {
      if (knownCardIds.has(c._id.toString())) {
        const key = c.subject.toString();
        knownBySubject[key] = (knownBySubject[key] || 0) + 1;
      }
    });

    const result = subjects.map(s => ({
      _id: s._id,
      name: s.name,
      color: s.color,
      cardCount: countBySubject[s._id.toString()] || 0,
      knownCount: knownBySubject[s._id.toString()] || 0,
    }));

    res.json({ success: true, subjects: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load flashcard subjects.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/flashcards/deck/:subjectId — cards for a subject, with the
// user's own progress status merged in. Cards needing review (new or
// marked 'review') are ordered first.
// ════════════════════════════════════════════════════════════════
router.get('/deck/:subjectId', protect, async (req, res) => {
  try {
    const cards = await Flashcard.find({ subject: req.params.subjectId }).lean();
    if (!cards.length) return res.json({ success: true, cards: [] });

    const progress = await FlashcardProgress.find({
      user: req.user._id,
      flashcard: { $in: cards.map(c => c._id) },
    }).lean();
    const progressByCard = {};
    progress.forEach(p => { progressByCard[p.flashcard.toString()] = p.status; });

    const withStatus = cards.map(c => ({
      _id: c._id,
      front: c.front,
      back: c.back,
      status: progressByCard[c._id.toString()] || 'new',
    }));

    // 'known' cards go last, everything else (new/review) comes first
    withStatus.sort((a, b) => (a.status === 'known') - (b.status === 'known'));

    res.json({ success: true, cards: withStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load flashcard deck.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/flashcards/:id/review — body: { status: 'known'|'review' }
// ════════════════════════════════════════════════════════════════
router.post('/:id/review', protect, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['known', 'review'].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be 'known' or 'review'." });
    }

    const progress = await FlashcardProgress.findOneAndUpdate(
      { user: req.user._id, flashcard: req.params.id },
      {
        $set: { status, lastReviewedAt: new Date() },
        $inc: { timesReviewed: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, progress });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to save review.' });
  }
});

module.exports = router;
