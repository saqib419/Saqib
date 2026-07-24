require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const StudySession = require('../models/StudySession');
const UserProgress = require('../models/UserProgress');

async function main() {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri);
  console.log('Connected to MongoDB\n');

  const students = await User.find({ role: 'student' }).select('_id name email');
  console.log(`Deleting ${students.length} student account(s):`);
  students.forEach(s => console.log(`  - ${s.name} <${s.email}>`));

  const studentIds = students.map(s => s._id);

  const sessRes = await StudySession.deleteMany({ user: { $in: studentIds } });
  console.log(`\nDeleted ${sessRes.deletedCount} StudySession record(s)`);

  const progRes = await UserProgress.deleteMany({ user: { $in: studentIds } });
  console.log(`Deleted ${progRes.deletedCount} UserProgress record(s)`);

  const userRes = await User.deleteMany({ role: 'student' });
  console.log(`Deleted ${userRes.deletedCount} student User account(s)`);

  console.log('\nDone. Mentor account was not touched.');
  await mongoose.disconnect();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
