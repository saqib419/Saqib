const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const Message = require('../models/Message');
const User    = require('../models/User');

router.use(protect);

// GET /api/student/messages/conversations
// Returns all conversations the logged-in student is part of
router.get('/conversations', async (req, res) => {
  try {
    const me = req.user._id;
    const messages = await Message.find({
      $or: [{ sender: me }, { recipient: me }]
    })
    .sort({ createdAt: -1 })
    .populate('sender',    'name email role avatar')
    .populate('recipient', 'name email role avatar')
    .lean();

    const byPair = new Map();
    for (const m of messages) {
      if (!m.sender || !m.recipient) continue;
      const other = m.sender._id.toString() === me.toString() ? m.recipient : m.sender;
      const key = other._id.toString();
      if (!byPair.has(key)) {
        byPair.set(key, {
          otherUser:   other,
          lastMessage: m.content,
          lastAt:      m.createdAt,
          unread:      0,
        });
      }
      // Count messages sent TO me that I haven't read
      if (m.recipient._id.toString() === me.toString() && !m.readAt) {
        byPair.get(key).unread += 1;
      }
    }

    const conversations = Array.from(byPair.values())
      .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

    res.json({ success: true, conversations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/student/messages/with/:userId — full thread with a specific user
router.get('/with/:userId', async (req, res) => {
  try {
    const me    = req.user._id;
    const other = req.params.userId;

    const otherUser = await User.findById(other).select('name email role avatar').lean();
    if (!otherUser) return res.status(404).json({ success: false, message: 'User not found.' });

    const messages = await Message.find({
      $or: [
        { sender: me,    recipient: other },
        { sender: other, recipient: me   },
      ]
    }).sort('createdAt').lean();

    // Mark unread messages as read
    await Message.updateMany(
      { sender: other, recipient: me, readAt: null },
      { readAt: new Date() }
    );

    res.json({ success: true, messages, otherUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/student/messages — student sends a message
// Students can only message: their assigned mentor, admins, super_admins
router.post('/', async (req, res) => {
  try {
    const { recipientId, content } = req.body;
    if (!recipientId || !content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'recipientId and content are required.' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ success: false, message: 'Message too long (max 2000 chars).' });
    }

    const recipient = await User.findById(recipientId).select('name role').lean();
    if (!recipient) return res.status(404).json({ success: false, message: 'Recipient not found.' });

    // Students can only message mentors, admins, super_admins
   // Students can only message their own assigned mentor.
    if (recipient.role !== 'mentor' || String(req.user.mentorId) !== String(recipientId)) {
      return res.status(403).json({ success: false, message: 'You can only message your assigned mentor.' });
    }

    const message = await Message.create({
      sender:    req.user._id,
      recipient: recipientId,
      content:   content.trim(),
    });

    res.status(201).json({ success: true, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/student/messages/contacts — who the student can message
// Returns their assigned mentor + all admins/super_admins
router.get('/contacts', async (req, res) => {
  try {
    // Students can only message their assigned mentor — no direct admin contact.
    if (!req.user.mentorId) {
      return res.json({ success: true, contacts: [] });
    }

    const contacts = await User.find({
      _id: req.user.mentorId,
      role: 'mentor',
    }).select('name email role avatar').sort('name').lean();

    res.json({ success: true, contacts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/student/messages/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const count = await Message.countDocuments({ recipient: req.user._id, readAt: null });
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
