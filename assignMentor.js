/**
 * Manually assign a student to a mentor.
 * Temporary tool until the admin panel exists.
 *
 * Usage:
 *   MONGO_URI="..." node scripts/assignMentor.js student@email.com mentor@email.com
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function run() {
  const [studentEmail, mentorEmail] = process.argv.slice(2);

  if (!studentEmail || !mentorEmail) {
    console.error('Usage: node scripts/assignMentor.js <studentEmail> <mentorEmail>');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const student = await User.findOne({ email: studentEmail.toLowerCase() });
  if (!student) {
    console.error(`❌ No user found with email: ${studentEmail}`);
    process.exit(1);
  }
  if (student.role !== 'student') {
    console.error(`❌ ${studentEmail} has role "${student.role}", not "student".`);
    process.exit(1);
  }

  const mentor = await User.findOne({ email: mentorEmail.toLowerCase() });
  if (!mentor) {
    console.error(`❌ No user found with email: ${mentorEmail}`);
    process.exit(1);
  }
  if (mentor.role !== 'mentor') {
    console.error(`❌ ${mentorEmail} has role "${mentor.role}", not "mentor". Set their role to "mentor" first.`);
    process.exit(1);
  }

  student.mentorId = mentor._id;
  await student.save();

  console.log(`✅ Assigned mentor "${mentor.name}" (${mentor.email}) to student "${student.name}" (${student.email})`);
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
