/**
 * Approve or reject a pending mentor-change request.
 * Temporary tool until an admin panel exists.
 *
 * Usage:
 *   MONGO_URI="..." node scripts/resolveChangeRequest.js <requestId> approve [newMentorEmail]
 *   MONGO_URI="..." node scripts/resolveChangeRequest.js <requestId> reject
 *
 * If approving without newMentorEmail, the request's preferredMentor
 * (if the student named one) is used instead.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const MentorRequest = require('../models/MentorRequest');
const User = require('../models/User');

async function run() {
  const [requestId, action, newMentorEmail] = process.argv.slice(2);

  if (!requestId || !['approve', 'reject'].includes(action)) {
    console.error('Usage: node scripts/resolveChangeRequest.js <requestId> <approve|reject> [newMentorEmail]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const request = await MentorRequest.findById(requestId);
  if (!request) {
    console.error(`❌ No request found with id: ${requestId}`);
    process.exit(1);
  }
  if (request.status !== 'pending') {
    console.error(`❌ Request is already "${request.status}", not pending.`);
    process.exit(1);
  }

  if (action === 'approve') {
    let targetMentorId = request.preferredMentor;

    if (newMentorEmail) {
      const mentor = await User.findOne({ email: newMentorEmail.toLowerCase(), role: 'mentor' });
      if (!mentor) {
        console.error(`❌ No mentor found with email: ${newMentorEmail}`);
        process.exit(1);
      }
      targetMentorId = mentor._id;
    }

    if (!targetMentorId) {
      console.error('❌ No preferred mentor on this request and no newMentorEmail given. Provide one.');
      process.exit(1);
    }

    const targetMentor = await User.findById(targetMentorId);
    await User.findByIdAndUpdate(request.student, { mentorId: targetMentor._id });
    request.status = 'approved';
    console.log(`✅ Approved — student reassigned to mentor "${targetMentor.name}" <${targetMentor.email}>`);
  } else {
    request.status = 'rejected';
    console.log('✅ Rejected — student keeps their current mentor.');
  }

  request.resolvedAt = new Date();
  await request.save();

  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
