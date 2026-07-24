/**
 * One-time migration: backfill availabilityType on existing mentor accounts
 * that predate this field.
 *
 * Run: node scripts/migrateAvailabilityType.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const result = await User.updateMany(
    { role: 'mentor', 'mentorProfile.availabilityType': { $exists: false } },
    { $set: { 'mentorProfile.availabilityType': 'full_time' } }
  );

  console.log(`Backfilled availabilityType on ${result.modifiedCount} mentor(s).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
