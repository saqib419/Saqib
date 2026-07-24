/**
 * List all pending mentor-change requests, for manual admin review.
 * Temporary tool until an admin panel exists.
 *
 * Usage:
 *   MONGO_URI="..." node scripts/listChangeRequests.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const MentorRequest = require('../models/MentorRequest');
require('../models/User'); // registers the User schema for populate()

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const requests = await MentorRequest.find({ status: 'pending' })
    .populate('student', 'name email')
    .populate('currentMentor', 'name email')
    .populate('preferredMentor', 'name email')
    .sort('-createdAt');

  if (requests.length === 0) {
    console.log('No pending mentor-change requests.');
    process.exit(0);
  }

  console.log(`${requests.length} pending request(s):\n`);
  requests.forEach((r) => {
    console.log(`ID: ${r._id}`);
    console.log(`  Student:          ${r.student.name} <${r.student.email}>`);
    console.log(`  Current mentor:   ${r.currentMentor.name} <${r.currentMentor.email}>`);
    console.log(`  Preferred mentor: ${r.preferredMentor ? `${r.preferredMentor.name} <${r.preferredMentor.email}>` : '(no preference — admin picks)'}`);
    console.log(`  Reason:           ${r.reason}`);
    console.log(`  Submitted:        ${r.createdAt.toLocaleString()}`);
    console.log('');
  });

  console.log('To resolve one:');
  console.log('  node scripts/resolveChangeRequest.js <requestId> approve [newMentorEmail]');
  console.log('  node scripts/resolveChangeRequest.js <requestId> reject');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
