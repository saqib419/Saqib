const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const Doubt = require('../models/Doubt');

router.use(protect);

// GET /api/doubts — list doubts (students see their own, mentors see all their students')
router.get('/', async (req, res) => {
  try {
    const filter = req.user.role === 'student'
      ? { student: req.user._id }
      : {}; // mentors/admins see all
    const doubts = await Doubt.find(filter)
      .sort({ createdAt: -1 })
      .populate('student', 'name email avatar')
      .populate('replies.author', 'name role avatar')
      .lean();
    res.json({ success: true, doubts });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/doubts — student posts a new doubt
router.post('/', async (req, res) => {
  try {
    const { subject, topic, question, tags, priority } = req.body;
    if (!subject || !question) {
      return res.status(400).json({ success: false, message: 'subject and question are required.' });
    }
    const doubt = await Doubt.create({
      student: req.user._id,
      subject, topic, question,
      tags: tags || [],
      priority: priority || 'medium',
    });
    await doubt.populate('student', 'name email avatar');
    res.status(201).json({ success: true, doubt });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/doubts/:id — get single doubt with all replies
router.get('/:id', async (req, res) => {
  try {
    const doubt = await Doubt.findById(req.params.id)
      .populate('student', 'name email avatar')
      .populate('replies.author', 'name role avatar');
    if (!doubt) return res.status(404).json({ success: false, message: 'Doubt not found.' });
    doubt.views += 1;
    await doubt.save();
    res.json({ success: true, doubt });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/doubts/:id/reply — mentor/admin/student replies
router.post('/:id/reply', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ success: false, message: 'Reply content required.' });
    const doubt = await Doubt.findById(req.params.id);
    if (!doubt) return res.status(404).json({ success: false, message: 'Doubt not found.' });

    doubt.replies.push({ author: req.user._id, content: content.trim() });
    // Auto-mark as answered when mentor/admin replies
    if (['mentor','admin','super_admin'].includes(req.user.role) && doubt.status === 'open') {
      doubt.status = 'answered';
    }
    await doubt.save();
    await doubt.populate('replies.author', 'name role avatar');
    const reply = doubt.replies[doubt.replies.length - 1];
    res.status(201).json({ success: true, reply, doubtStatus: doubt.status });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// PATCH /api/doubts/:id/accept/:replyId — student marks a reply as accepted answer
router.patch('/:id/accept/:replyId', async (req, res) => {
  try {
    const doubt = await Doubt.findById(req.params.id);
    if (!doubt) return res.status(404).json({ success: false, message: 'Doubt not found.' });
    if (doubt.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the student who posted can accept an answer.' });
    }
    doubt.replies.forEach(r => { r.isAnswer = r._id.toString() === req.params.replyId; });
    doubt.status = 'answered';
    await doubt.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// PATCH /api/doubts/:id/close — student closes their doubt
router.patch('/:id/close', async (req, res) => {
  try {
    const doubt = await Doubt.findById(req.params.id);
    if (!doubt) return res.status(404).json({ success: false, message: 'Doubt not found.' });
    if (doubt.student.toString() !== req.user._id.toString() && !['admin','super_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }
    doubt.status = 'closed';
    await doubt.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
