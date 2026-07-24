// Single source of truth for the RBAC system.
//
// TO ADD A NEW ROLE LATER (e.g. "coordinator"):
//   1. Add it to ROLE_LIST below.
//   2. Add a line to MANAGEABLE_ROLES saying who can create/manage it.
//   3. Add its default permission grants in scripts/seedPermissions.js.
//   4. Run `node scripts/seedPermissions.js` again.
// No schema migration, no route rewrites — authorize() reads permissions
// from the database, not from code.

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MENTOR: 'mentor',
  ASSISTANT: 'assistant',
  STUDENT: 'student',
  PARENT: 'parent',
};

// This array IS the enum. Extend it here (and nowhere else) to add a role.
const ROLE_LIST = Object.values(ROLES);

// Strict hierarchy — who is allowed to create/suspend whom.
// Kept separate from ROLE_LIST so a new role can be added without
// immediately deciding its management rights (defaults to "nobody" below
// until you add it here explicitly — fail closed).
const MANAGEABLE_ROLES = {
  [ROLES.SUPER_ADMIN]: [ROLES.ADMIN, ROLES.MENTOR, ROLES.ASSISTANT, ROLES.STUDENT, ROLES.PARENT],
  [ROLES.ADMIN]: [ROLES.MENTOR, ROLES.ASSISTANT, ROLES.STUDENT, ROLES.PARENT],
  [ROLES.MENTOR]: [ROLES.ASSISTANT], // a Mentor can request/attach an Assistant to themselves
  [ROLES.ASSISTANT]: [],
  [ROLES.STUDENT]: [],
  [ROLES.PARENT]: [],
};

// Modules mapped to what actually exists in MedClarivo today.
// Add a new line here when a new model/feature needs permission gating.
const MODULES = {
  USER: 'user', // models/User.js
  MENTOR_REQUEST: 'mentor_request', // models/MentorRequest.js
  STUDY_SESSION: 'study_session', // models/StudySession.js, models/Session.js
  CURRICULUM: 'curriculum', // models/Subject.js, models/Chapter.js
  PROGRESS: 'progress', // models/UserProgress.js
  DAILY_MISSION: 'daily_mission', // models/DailyMission.js
  TICKET: 'ticket', // models/Ticket.js — student-raised concern reports (never visible to mentors)
  SESSION_NOTE: 'session_note', // models/SessionNote.js
  EVALUATION: 'evaluation', // models/Evaluation.js
  MESSAGE: 'message', // models/Message.js — admin oversight + DM any user
  ROLE_PERMISSION: 'role_permission', // the permission engine itself
  AUDIT_LOG: 'audit_log',
};

const MODULE_LIST = Object.values(MODULES);

const ACTIONS = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  APPROVE: 'approve',
  EXPORT: 'export',
};

const ACTION_LIST = Object.values(ACTIONS);

// Data scope a permission grants:
//   all      -> everything, every org (Super Admin, always)
//   org      -> everything within the caller's organization
//               (today: every non-null-org user is effectively in the same
//               implicit single org, so 'org' behaves like 'all' minus
//               Super-Admin-only rows, until organizationId is actually used)
//   assigned -> only records linked to the caller (a Mentor's own students,
//               an Assistant's linked Mentor's students)
//   own      -> only the caller's own record
const SCOPES = {
  ALL: 'all',
  ORG: 'org',
  ASSIGNED: 'assigned',
  OWN: 'own',
  NONE: 'none',
};

module.exports = {
  ROLES,
  ROLE_LIST,
  MANAGEABLE_ROLES,
  MODULES,
  MODULE_LIST,
  ACTIONS,
  ACTION_LIST,
  SCOPES,
};
