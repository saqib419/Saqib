/**
 * One-time migration: existing users predate the `permissionVersion` field,
 * so it's currently `undefined` on their documents. Without running this,
 * they'll just be forced to log in again once (harmless, but this avoids
 * that blanket forced re-login).
 *
 * Run: node scripts/migratePermissionVersion.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const result = await User.updateMany(
    { permissionVersion: { $exists: false } },
    { $set: { permissionVersion: 1, isActive: true } }
  );

  console.log(`Backfilled permissionVersion on ${result.modifiedCount} existing users.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
