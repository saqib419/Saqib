/**
 * One-time bootstrap: creates the first Super Admin account directly in the
 * database. There is deliberately no API route for this — the very first
 * Super Admin can't be created "by" anyone, since no one with sufficient
 * privilege exists yet. Every Super Admin after this one can be created via
 * the API by an existing Super Admin.
 *
 * Run: node scripts/createSuperAdmin.js "Name" email@example.com password123
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const { ROLES } = require('../utils/rbacConstants');

async function run() {
  const [, , name, email, password] = process.argv;
  if (!name || !email || !password) {
    console.error('Usage: node scripts/createSuperAdmin.js "Name" email@example.com password123');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    console.error(`A user with email ${email} already exists (role: ${existing.role}).`);
    process.exit(1);
  }

  const superAdmin = new User({
    name,
    email,
    passwordHash: password, // hashed by the pre-save hook
    role: ROLES.SUPER_ADMIN,
    isVerified: true,
  });
  await superAdmin.save();

  console.log(`Super Admin created: ${superAdmin.email} (id: ${superAdmin._id})`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
