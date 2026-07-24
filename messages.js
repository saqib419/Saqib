const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { MODULES, ACTIONS } = require('../utils/rbacConstants');
const Message = require('../models/Message');
const User = require('../models/User');

router.use(protect);

// GET /api/admin/messages/conversations — platform-wide list of distinct
// conversation pairs, most-recent first, with a preview + unread count.
// Unlike /api/mentor/messages (scoped to a mentor's own mentee), this has
// no such restriction — Admin/Super Admin can see every conversation
// happening on the platform, between any two users.
router.get('/conversations', authorize(MODULES.MESSAGE, ACTIONS.READ), async (req, res) => {
  try {
    const messages = await Message.find({})
      .sort({ createdAt: -1 })
      .populate('sender', 'name role lastLogin')
      .populate('recipient', 'name role lastLogin')
      .lean();

    const byPair = new Map();
    for (const m of messages) {
      if (!m.sender || !m.recipient) continue; // skip orphaned rows (deleted user)
      const key = [m.sender._id.toString(), m.recipient._id.toString()].sort().join(':');
      if (!byPair.has(key)) {
        byPair.set(key, {
          userA: m.sender,
          userB: m.recipient,
          lastMessage: m.content,
          lastAt: m.createdAt,
          unreadCount: 0,
        });
      }
      if (!m.readAt) byPair.get(key).unreadCount += 1;
    }

    const conversations = Array.from(byPair.values()).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    res.json({ success: true, conversations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/admin/messages/thread/:userAId/:userBId — full thread between
// any two platform users (admin oversight — read-only view of their chat).
router.get('/thread/:userAId/:userBId', authorize(MODULES.MESSAGE, ACTIONS.READ), async (req, res) => {
  try {
    const { userAId, userBId } = req.params;
    const messages = await Message.find({
      $or: [
        { sender: userAId, recipient: userBId },
        { sender: userBId, recipient: userAId },
      ],
    }).sort('createdAt').lean();
    res.json({ success: true, messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/admin/messages/with/:userId — thread between the logged-in admin
// and a specific user (backs the admin's own DM composer).
router.get('/with/:userId', authorize(MODULES.MESSAGE, ACTIONS.READ), async (req, res) => {
  try {
    const otherUser = await User.findById(req.params.userId).select('name email role lastLogin').lean();
    if (!otherUser) return res.status(404).json({ success: false, message: 'User not found.' });

    const messages = await Message.find({
      $or: [
        { sender: req.user._id, recipient: req.params.userId },
        { sender: req.params.userId, recipient: req.user._id },
      ],
    }).sort('createdAt').lean();
    res.json({ success: true, messages, otherUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/admin/messages — admin sends a message to any user on the platform
router.post('/', authorize(MODULES.MESSAGE, ACTIONS.CREATE), async (req, res) => {
  try {
    const { recipientId, content } = req.body;
    if (!recipientId || !content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'recipientId and content are required.' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ success: false, message: 'Message is too long.' });
    }

    const recipient = await User.findById(recipientId);
    if (!recipient) return res.status(404).json({ success: false, message: 'Recipient not found.' });

    const message = await Message.create({
      sender: req.user._id,
      recipient: recipientId,
      content: content.trim(),
    });

    res.status(201).json({ success: true, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/admin/messages/directory — all users, for the "New Message"
// recipient picker.
router.get('/directory', authorize(MODULES.MESSAGE, ACTIONS.READ), async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } }).select('name email role').sort('name').lean();
    res.json({ success: true, users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
