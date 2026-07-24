/**
 * Manually create a mentor, admin, or parent account.
 * (Students self-register via /api/auth/register — this is only for
 * roles that get onboarded by you.)
 *
 * Usage:
 *   MONGO_URI="..." node scripts/createStaffUser.js mentor "Dr. Arjun Mehta" arjun@medclarivo.com SomePassword123 "AIIMS Delhi '19 · AIR 7"
 *
 * Args: role  name  email  password  [mentorTitle]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function run() {
  const [role, name, email, password, mentorTitle] = process.argv.slice(2);

  if (!role || !name || !email || !password) {
    console.error('Usage: node scripts/createStaffUser.js <mentor|admin|parent> <name> <email> <password> [mentorTitle]');
    process.exit(1);
  }
  if (!['mentor', 'admin', 'parent'].includes(role)) {
    console.error('❌ role must be one of: mentor, admin, parent');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    console.error(`❌ A user with email ${email} already exists (role: ${existing.role}).`);
    process.exit(1);
  }

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    passwordHash: password, // hashed automatically by the User pre-save hook
    role,
    isVerified: true,
    onboardingComplete: true, // staff roles skip the student onboarding flow
    ...(role === 'mentor' && mentorTitle ? { mentorProfile: { title: mentorTitle } } : {}),
  });

  console.log(`✅ Created ${role}: ${user.name} <${user.email}>`);
  console.log(`   They can log in at index.html with this email + password.`);
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
