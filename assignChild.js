/**
 * Manually link a parent account to their child (a student).
 * Same pattern as assignMentor.js. Temporary tool until the admin panel
 * has a UI for this.
 *
 * Usage:
 *   MONGO_URI="..." node scripts/assignChild.js parent@email.com student@email.com
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function run() {
  const [parentEmail, studentEmail] = process.argv.slice(2);

  if (!parentEmail || !studentEmail) {
    console.error('Usage: node scripts/assignChild.js <parentEmail> <studentEmail>');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const parent = await User.findOne({ email: parentEmail.toLowerCase() });
  if (!parent) {
    console.error(`❌ No user found with email: ${parentEmail}`);
    process.exit(1);
  }
  if (parent.role !== 'parent') {
    console.error(`❌ ${parentEmail} has role "${parent.role}", not "parent". Set their role to "parent" first (see createStaffUser.js).`);
    process.exit(1);
  }

  const student = await User.findOne({ email: studentEmail.toLowerCase() });
  if (!student) {
    console.error(`❌ No user found with email: ${studentEmail}`);
    process.exit(1);
  }
  if (student.role !== 'student') {
    console.error(`❌ ${studentEmail} has role "${student.role}", not "student".`);
    process.exit(1);
  }

  parent.childId = student._id;
  await parent.save();

  console.log(`✅ Linked parent "${parent.name}" (${parent.email}) to child "${student.name}" (${student.email})`);
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
