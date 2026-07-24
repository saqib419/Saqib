/**
 * Seeds the default (organizationId: null) permission rules — the rules
 * everyone falls under today since multi-tenancy is dormant.
 *
 * Run: node scripts/seedPermissions.js
 * Safe to re-run — it upserts, so tweaking a line here and re-running
 * updates existing rows instead of duplicating them.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Permission = require('../models/Permission');
const { ROLES, MODULES, ACTIONS, SCOPES } = require('../utils/rbacConstants');

const { CREATE, READ, UPDATE, DELETE } = ACTIONS;
const { ORG, ASSIGNED, OWN } = SCOPES;

// [role, module, action, scope]. Anything not listed here = denied by default.
const GRANTS = [
  // ---- Admin ----
  [ROLES.ADMIN, MODULES.USER, CREATE, ORG],
  [ROLES.ADMIN, MODULES.USER, READ, ORG],
  [ROLES.ADMIN, MODULES.USER, UPDATE, ORG],
  [ROLES.ADMIN, MODULES.USER, DELETE, ORG], // "delete" = suspend, see userController
  [ROLES.ADMIN, MODULES.ROLE_PERMISSION, READ, ORG],
  [ROLES.ADMIN, MODULES.ROLE_PERMISSION, UPDATE, ORG],
  [ROLES.ADMIN, MODULES.MENTOR_REQUEST, CREATE, ORG],
  [ROLES.ADMIN, MODULES.MENTOR_REQUEST, READ, ORG],
  [ROLES.ADMIN, MODULES.MENTOR_REQUEST, UPDATE, ORG],
  [ROLES.ADMIN, MODULES.STUDY_SESSION, READ, ORG],
  [ROLES.ADMIN, MODULES.CURRICULUM, CREATE, ORG],
  [ROLES.ADMIN, MODULES.CURRICULUM, READ, ORG],
  [ROLES.ADMIN, MODULES.CURRICULUM, UPDATE, ORG],
  [ROLES.ADMIN, MODULES.CURRICULUM, DELETE, ORG],
  [ROLES.ADMIN, MODULES.PROGRESS, READ, ORG],
  [ROLES.ADMIN, MODULES.DAILY_MISSION, CREATE, ORG],
  [ROLES.ADMIN, MODULES.DAILY_MISSION, READ, ORG],
  [ROLES.ADMIN, MODULES.DAILY_MISSION, UPDATE, ORG],
  [ROLES.ADMIN, MODULES.AUDIT_LOG, READ, ORG],
  [ROLES.ADMIN, MODULES.TICKET, READ, ORG],
  [ROLES.ADMIN, MODULES.TICKET, UPDATE, ORG],
  [ROLES.ADMIN, MODULES.SESSION_NOTE, CREATE, ORG],
  [ROLES.ADMIN, MODULES.SESSION_NOTE, READ, ORG],
  [ROLES.ADMIN, MODULES.SESSION_NOTE, UPDATE, ORG],
  [ROLES.ADMIN, MODULES.EVALUATION, CREATE, ORG],
  [ROLES.ADMIN, MODULES.EVALUATION, READ, ORG],
  [ROLES.ADMIN, MODULES.EVALUATION, UPDATE, ORG],
  [ROLES.ADMIN, MODULES.MESSAGE, CREATE, ORG],
  [ROLES.ADMIN, MODULES.MESSAGE, READ, ORG],

// ---- Mentor (scope: their own assigned students) ----
  [ROLES.MENTOR, MODULES.USER, CREATE, ASSIGNED],
  [ROLES.MENTOR, MODULES.USER, READ, ASSIGNED],
  [ROLES.MENTOR, MODULES.MENTOR_REQUEST, READ, ASSIGNED],
  [ROLES.MENTOR, MODULES.MENTOR_REQUEST, UPDATE, ASSIGNED], // accept/decline
  [ROLES.MENTOR, MODULES.STUDY_SESSION, CREATE, ASSIGNED],
  [ROLES.MENTOR, MODULES.STUDY_SESSION, READ, ASSIGNED],
  [ROLES.MENTOR, MODULES.STUDY_SESSION, UPDATE, ASSIGNED],
  [ROLES.MENTOR, MODULES.STUDY_SESSION, DELETE, ASSIGNED],
  [ROLES.MENTOR, MODULES.PROGRESS, READ, ASSIGNED],
  [ROLES.MENTOR, MODULES.CURRICULUM, READ, ORG],
  [ROLES.MENTOR, MODULES.DAILY_MISSION, READ, ASSIGNED],
  // Lets a mentor reach the admin team via /api/admin/messages (the same
  // route admins use for platform-wide messaging). Mentor-to-student
  // messaging is separate and already handled by /api/mentor/messages.
  [ROLES.MENTOR, MODULES.MESSAGE, CREATE, ASSIGNED],
  [ROLES.MENTOR, MODULES.MESSAGE, READ, ASSIGNED],

  // ---- Assistant (ceiling only — an Admin can further restrict this per
  //      Mentor via setPermission; this is just the platform-wide max) ----
  [ROLES.ASSISTANT, MODULES.USER, READ, ASSIGNED],
  [ROLES.ASSISTANT, MODULES.MENTOR_REQUEST, READ, ASSIGNED],
  [ROLES.ASSISTANT, MODULES.STUDY_SESSION, CREATE, ASSIGNED],
  [ROLES.ASSISTANT, MODULES.STUDY_SESSION, READ, ASSIGNED],
  [ROLES.ASSISTANT, MODULES.STUDY_SESSION, UPDATE, ASSIGNED],
  [ROLES.ASSISTANT, MODULES.PROGRESS, READ, ASSIGNED],

  // ---- Student (scope: their own data) ----
  [ROLES.STUDENT, MODULES.USER, READ, OWN],
  [ROLES.STUDENT, MODULES.MENTOR_REQUEST, CREATE, OWN],
  [ROLES.STUDENT, MODULES.MENTOR_REQUEST, READ, OWN],
  [ROLES.STUDENT, MODULES.STUDY_SESSION, CREATE, OWN],
  [ROLES.STUDENT, MODULES.STUDY_SESSION, READ, OWN],
  [ROLES.STUDENT, MODULES.STUDY_SESSION, UPDATE, OWN],
  [ROLES.STUDENT, MODULES.PROGRESS, READ, OWN],
  [ROLES.STUDENT, MODULES.CURRICULUM, READ, ORG],
  [ROLES.STUDENT, MODULES.DAILY_MISSION, READ, OWN],
  [ROLES.STUDENT, MODULES.TICKET, CREATE, OWN],
  [ROLES.STUDENT, MODULES.TICKET, READ, OWN],

  // ---- Parent ----
  // NOTE: there is currently no parent->child link field on User (e.g. a
  // `childIds` array). These grants are seeded for completeness but will
  // effectively return nothing useful until that link exists — see the
  // README section "Known gap: Parent role" for what to add.
  [ROLES.PARENT, MODULES.USER, READ, OWN],
  [ROLES.PARENT, MODULES.PROGRESS, READ, OWN],
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected. Seeding default permission rules...');

  for (const [role, module, action, scope] of GRANTS) {
    await Permission.findOneAndUpdate(
      { organizationId: null, role, module, action },
      { allowed: true, scope, note: 'Seeded default' },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  console.log(`Seeded/updated ${GRANTS.length} permission rows.`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
