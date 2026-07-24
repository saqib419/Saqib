const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// ════════════════════════════════════════════
// GET /api/settings — current user's settings
// ════════════════════════════════════════════
router.get('/', protect, async (req, res) => {
  // req.user already excludes passwordHash via toJSON()
  res.json({ success: true, user: req.user });
});

// ════════════════════════════════════════════
// PUT /api/settings/profile — name / email / phone
// ════════════════════════════════════════════
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim(), _id: { $ne: req.user._id } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'That email is already in use.' });
    }

    req.user.name = name?.trim() ?? req.user.name;
    req.user.email = email.toLowerCase().trim();
    req.user.phone = phone?.trim() ?? req.user.phone;
    await req.user.save();

    res.json({ success: true, user: req.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
});

// ════════════════════════════════════════════
// PUT /api/settings/password — change password
// ════════════════════════════════════════════
router.put('/password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
    }

    const match = await req.user.comparePassword(currentPassword);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    req.user.passwordHash = newPassword; // pre-save hook re-hashes this automatically
    await req.user.save();

    res.json({ success: true, message: 'Password updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update password.' });
  }
});

// ════════════════════════════════════════════
// PUT /api/settings/notifications
// ════════════════════════════════════════════
router.put('/notifications', protect, async (req, res) => {
  try {
    const { emailUpdates, sessionReminders, forumReplies } = req.body;
    req.user.notificationPrefs = {
      emailUpdates: emailUpdates ?? true,
      sessionReminders: sessionReminders ?? true,
      forumReplies: forumReplies ?? true,
    };
    await req.user.save();

    res.json({ success: true, user: req.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update notification preferences.' });
  }
});

// ════════════════════════════════════════════
// PUT /api/settings/avatar — update avatar URL
// (See note below on how the photo actually gets there)
// ════════════════════════════════════════════
router.put('/avatar', protect, async (req, res) => {
  try {
    const { avatarUrl } = req.body;
    if (!avatarUrl) {
      return res.status(400).json({ success: false, message: 'avatarUrl is required.' });
    }
    req.user.avatar = avatarUrl;
    await req.user.save();
    res.json({ success: true, user: req.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update avatar.' });
  }
});

module.exports = router;
