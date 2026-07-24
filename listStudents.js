require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri);
  console.log('Connected to MongoDB\n');

  const allUsers = await User.find({}).select('name email role lastLogin createdAt googleId passwordHash');
  console.log(`Total users in DB: ${allUsers.length}\n`);

  const byRole = {};
  allUsers.forEach(u => {
    const role = u.role || 'undefined/no-role-set';
    byRole[role] = byRole[role] || [];
    byRole[role].push(u);
  });

  Object.keys(byRole).forEach(role => {
    console.log(`--- role: ${role} (${byRole[role].length}) ---`);
    byRole[role].forEach(u => {
      const loginMethod = u.googleId ? 'Google OAuth' : (u.passwordHash ? 'Email/Password' : 'Unknown');
      const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never logged in';
      console.log(`  ${u.name || '(no name)'} <${u.email}> | login: ${loginMethod} | last login: ${lastLogin}`);
    });
    console.log('');
  });

  await mongoose.disconnect();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
