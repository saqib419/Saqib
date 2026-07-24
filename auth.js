const express  = require('express');
const crypto   = require('crypto');
const router   = express.Router();
const { body, validationResult } = require('express-validator');
const passport = require('../config/passport');
const User     = require('../models/User');
const { signToken } = require('../utils/jwt');
const { protect }   = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../services/email.service');

// ── Helper: send token response ───────────────────────────────
const sendToken = (res, user, statusCode = 200) => {
  const token = signToken(user);
  res.status(statusCode).json({
    success: true,
    token,
    user,
  });
};

// ── Helper: redirect with token (OAuth flows) ─────────────────
const redirectWithToken = (res, user) => {
  const token    = signToken(user);
  const clientUrl = process.env.CLIENT_REDIRECT_URL || process.env.CLIENT_URL || 'http://localhost:3000';
  res.redirect(`${clientUrl}?token=${token}`);
};

// ════════════════════════════════════════════════════════════════
// POST /api/auth/register
// ════════════════════════════════════════════════════════════════
router.post('/register', [
  body('email').isEmail().withMessage('Valid email required.'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
  body('name').notEmpty().withMessage('Name is required.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  try {
    const { name, email, password, phone } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    const user = await User.create({
      name,
      email,
      phone,
      passwordHash: password, // hashed by pre-save hook
    });

    sendToken(res, user, 201);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/auth/login
// ════════════════════════════════════════════════════════════════
router.post('/login', [
  body('identifier').notEmpty().withMessage('Email or phone required.'),
  body('password').notEmpty().withMessage('Password required.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  try {
    const { identifier, password } = req.body;

    // Find by email or phone
    const user = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, { phone: identifier }],
    });

    // Same "invalid credentials" message whether the account is locked-out-and-
    // guessed-right or just doesn't exist / wrong password — avoids leaking
    // which accounts exist or are currently locked.
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    if (user.isLocked()) {
      return res.status(423).json({
        success: false,
        message: 'Too many failed attempts on this account. Try again in a few minutes.',
      });
    }

    if (!(await user.comparePassword(password))) {
      await user.registerFailedLogin();
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'This account has been suspended.' + (user.suspendedReason ? ` Reason: ${user.suspendedReason}` : ''),
      });
    }

    await user.registerSuccessfulLogin();

    sendToken(res, user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/auth/me  (protected)
// ════════════════════════════════════════════════════════════════
router.get('/me', protect, (req, res) => {
  res.json({ success: true, user: req.user });
});
// ════════════════════════════════════════════════════════════════
// GET /api/auth/my-mentor  (protected) — the logged-in student's
// assigned mentor, or mentorAssigned: false if none yet.
// ════════════════════════════════════════════════════════════════
router.get('/my-mentor', protect, async (req, res) => {
  try {
    // Only students have an assigned mentor in the "My Mentor" sense. If a
    // non-student account (e.g. a mentor whose own mentorId field is
    // unexpectedly set) hits this, don't look anything up — otherwise a
    // mentor could see themselves (or another mentor) rendered as "their
    // mentor" on the student dashboard.
    if (req.user.role !== 'student') {
      return res.json({ success: true, mentorAssigned: false, mentor: null });
    }

    if (!req.user.mentorId) {
      return res.json({ success: true, mentorAssigned: false, mentor: null });
    }

    const mentor = await User.findById(req.user.mentorId)
      .select('name avatar mentorProfile email');

    if (!mentor) {
      return res.json({ success: true, mentorAssigned: false, mentor: null });
    }

    res.json({ success: true, mentorAssigned: true, mentor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
// PATCH /api/auth/onboarding  (protected) — save onboarding answers
// ════════════════════════════════════════════════════════════════
router.patch('/onboarding', protect, async (req, res) => {
  try {
    const { exam, level, institution, hours, prevScore, targetScore } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.onboarding = { exam, level, institution, hours, prevScore, targetScore };
    user.onboardingComplete = true;
    await user.save();

    res.json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});
// ════════════════════════════════════════════════════════════════
// GOOGLE OAuth
// ════════════════════════════════════════════════════════════════
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.CLIENT_URL}?error=google_failed` }),
  (req, res) => redirectWithToken(res, req.user)
);

// ════════════════════════════════════════════════════════════════
// APPLE Sign-In
// ════════════════════════════════════════════════════════════════
router.get('/apple',
  passport.authenticate('apple', { session: false })
);

router.post('/apple/callback',
  passport.authenticate('apple', { session: false, failureRedirect: `${process.env.CLIENT_URL}?error=apple_failed` }),
  (req, res) => redirectWithToken(res, req.user)
);

// ════════════════════════════════════════════════════════════════
// POST /api/auth/logout  (client just discards token; this is informational)
// ════════════════════════════════════════════════════════════════
router.post('/logout', protect, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
});


// ════════════════════════════════════════════════════════════════
// PATCH /api/auth/profile  (protected) — update own name/avatar
// ════════════════════════════════════════════════════════════════
router.patch('/profile', protect, async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    if (name !== undefined) user.name = name;
    if (avatar !== undefined) user.avatar = avatar;
    await user.save();

    res.json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/auth/forgot-password
// Always returns success (even for unknown emails / OAuth-only
// accounts) so the response can't be used to enumerate registered
// addresses. The real work only happens if a matching, password-based
// account exists.
// ════════════════════════════════════════════════════════════════
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Valid email required.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  const genericResponse = {
    success: true,
    message: 'If an account with that email exists, a reset link has been sent.',
  };

  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    // Don't reveal whether the account exists, and don't offer a
    // password reset for OAuth-only accounts (no passwordHash to reset).
    if (!user || !user.passwordHash) {
      return res.json(genericResponse);
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 min
    await user.save();

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const resetUrl = `${clientUrl}/reset-password.html?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

    await sendPasswordResetEmail(user, resetUrl);

    res.json(genericResponse);
  } catch (err) {
    console.error(err);
    // Still return the generic message — don't leak internal errors
    // through a difference in response shape.
    res.json(genericResponse);
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/auth/reset-password
// Body: { email, token, newPassword }
// ════════════════════════════════════════════════════════════════
router.post('/reset-password', [
  body('email').isEmail().withMessage('Valid email required.'),
  body('token').notEmpty().withMessage('Reset token required.'),
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  try {
    const { email, token, newPassword } = req.body;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      email: email.toLowerCase(),
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpires: { $gt: new Date() },
    }).select('+resetPasswordTokenHash +resetPasswordExpires');

    if (!user) {
      return res.status(400).json({ success: false, message: 'This reset link is invalid or has expired.' });
    }

    user.passwordHash = newPassword; // re-hashed by the pre-save hook
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpires = null;
    user.permissionVersion += 1; // invalidate any existing JWTs
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    res.json({ success: true, message: 'Password reset. Please log in with your new password.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
// PATCH /api/auth/change-password  (protected)
// ════════════════════════════════════════════════════════════════
router.patch('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(401).json({ success: false, message: 'Current password is incorrect.' });

    user.passwordHash = newPassword;
    user.permissionVersion += 1;
    await user.save();

    res.json({ success: true, message: 'Password updated. Please log in again.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});
module.exports = router;
