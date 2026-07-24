const jwt = require('jsonwebtoken');

// CHANGED: now takes the full user object (was: signToken(userId)).
// Embeds role + permissionVersion so authorize() and the staleness check
// in middleware/auth.js can work without an extra DB round-trip per request
// for the role itself (permissionVersion is still checked against the DB
// to allow instant revocation).
const signToken = (user) =>
  jwt.sign(
    {
      id: user._id,
      role: user.role,
      organizationId: user.organizationId || null,
      permissionVersion: user.permissionVersion,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );

const verifyToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET);

module.exports = { signToken, verifyToken };
