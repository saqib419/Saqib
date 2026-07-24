const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Question = require('../models/Question');
const TestAttempt = require('../models/TestAttempt');
const Subject = require('../models/Subject');
const { examGroupFor } = require('./curriculum');

// ════════════════════════════════════════════════════════════════
// GET /api/tests/subjects — subjects available for the user's exam,
// with a question count each, to power the test-setup screen.
// ════════════════════════════════════════════════════════════════
router.get('/subjects', protect, async (req, res) => {
  try {
    const examGroup = examGroupFor(req.user.onboarding);
    const subjects = await Subject.find({ examGroup }).sort('order').lean();

    const counts = await Question.aggregate([
      { $match: { examGroup } },
      { $group: { _id: '$subject', count: { $sum: 1 } } },
    ]);
    const countBySubject = {};
    counts.forEach(c => { countBySubject[c._id.toString()] = c.count; });

    const result = subjects.map(s => ({
      _id: s._id,
      name: s.name,
      color: s.color,
      questionCount: countBySubject[s._id.toString()] || 0,
    }));

    res.json({ success: true, subjects: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load subjects.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/tests/start — body: { subjectIds: [] (empty = all), count: 20 }
// Picks a random set of questions for the user's exam group and creates
// an in-progress TestAttempt. Returns questions WITHOUT correctKey/
// explanation, so the client can't peek at answers.
// ════════════════════════════════════════════════════════════════
router.post('/start', protect, async (req, res) => {
  try {
    const examGroup = examGroupFor(req.user.onboarding);
    const { subjectIds, count } = req.body;
    const questionCount = Math.min(Math.max(parseInt(count, 10) || 10, 5), 50);

    const match = { examGroup };
    if (Array.isArray(subjectIds) && subjectIds.length) {
      match.subject = { $in: subjectIds };
    }

    const questions = await Question.aggregate([
      { $match: match },
      { $sample: { size: questionCount } },
    ]);

    if (!questions.length) {
      return res.status(404).json({ success: false, message: 'No questions available yet for this selection.' });
    }

    const attempt = await TestAttempt.create({
      user: req.user._id,
      examGroup,
      subjects: Array.isArray(subjectIds) ? subjectIds : [],
      questions: questions.map(q => ({
        question: q._id,
        selectedKey: null,
        correctKey: q.correctKey,
        isCorrect: false,
      })),
      totalQuestions: questions.length,
      status: 'in_progress',
    });

    // Strip correctKey/explanation before sending questions to the client
    const safeQuestions = questions.map(q => ({
      _id: q._id,
      text: q.text,
      options: q.options,
      difficulty: q.difficulty,
    }));

    res.status(201).json({ success: true, attemptId: attempt._id, questions: safeQuestions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to start test.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/tests/:id/submit — body: { answers: { questionId: 'A'|'B'|'C'|'D' } }
// Grades the attempt server-side (client never had correct answers) and
// returns the full results including explanations for review.
// ════════════════════════════════════════════════════════════════
router.post('/:id/submit', protect, async (req, res) => {
  try {
    const attempt = await TestAttempt.findOne({ _id: req.params.id, user: req.user._id });
    if (!attempt) return res.status(404).json({ success: false, message: 'Test attempt not found.' });
    if (attempt.status === 'submitted') {
      return res.status(400).json({ success: false, message: 'This test has already been submitted.' });
    }

    const answers = req.body.answers || {};
    let correctCount = 0;

    attempt.questions.forEach(q => {
      const selected = answers[q.question.toString()] || null;
      q.selectedKey = selected;
      q.isCorrect = selected === q.correctKey;
      if (q.isCorrect) correctCount++;
    });

    attempt.correctCount = correctCount;
    attempt.scorePercent = Math.round((correctCount / attempt.totalQuestions) * 100);
    attempt.status = 'submitted';
    attempt.submittedAt = new Date();
    attempt.durationSeconds = Math.round((attempt.submittedAt - attempt.startedAt) / 1000);
    await attempt.save();

    // Populate question text/options/explanation for the review screen
    const populated = await TestAttempt.findById(attempt._id)
      .populate('questions.question', 'text options explanation')
      .lean();

    res.json({ success: true, attempt: populated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to submit test.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/tests/history — the user's past attempts, most recent first
// ════════════════════════════════════════════════════════════════
router.get('/history', protect, async (req, res) => {
  try {
    const attempts = await TestAttempt.find({ user: req.user._id, status: 'submitted' })
      .sort({ submittedAt: -1 })
      .limit(20)
      .lean();
    res.json({ success: true, attempts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load test history.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/tests/:id — a single attempt (for reviewing results)
// ════════════════════════════════════════════════════════════════
router.get('/:id', protect, async (req, res) => {
  try {
    const attempt = await TestAttempt.findOne({ _id: req.params.id, user: req.user._id })
      .populate('questions.question', 'text options explanation')
      .lean();
    if (!attempt) return res.status(404).json({ success: false, message: 'Test attempt not found.' });
    res.json({ success: true, attempt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load test attempt.' });
  }
});

module.exports = router;
