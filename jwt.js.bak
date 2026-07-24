const jwt = require('jsonwebtoken');

const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });

const verifyToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET);

module.exports = { signToken, verifyToken };
