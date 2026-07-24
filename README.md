# MedClarivo Elite

Node.js/Express + MongoDB backend for a NEET/AIIMS/JIPMER/USMLE exam-prep
platform: student study tracking, curriculum content, mentor↔student↔parent
messaging and scheduling, an admin console with role-based permissions and
audit logging, and a support-ticket system. Static HTML frontends for each
role (student, mentor, parent, assistant, admin) are served alongside the
API.

## Features

- **Auth** — email/password, Google OAuth, Apple Sign-In, JWT sessions,
  password reset, per-account login lockout
- **RBAC** — a DB-driven permission engine (`role` × `module` × `action` →
  `allowed` + `scope`), so admins can customize what mentors/assistants can
  see without a code change. Falls back to simple `restrictTo(role)` gating
  on older routes.
- **Study** — session logging, XP/levels/streaks, daily missions, weekly
  analytics + a study heatmap
- **Curriculum** — subjects/chapters by exam group, per-user progress
- **Mentor** — mentee roster + progress, session scheduling, availability,
  messaging with students and parents, AI-drafted reply suggestions
  (Claude API)
- **Parent** — view a linked child's progress, message the mentor
- **Admin** — user management (create/suspend/reactivate/assign-mentor),
  role permissions, audit log, support tickets

## API

Full route list lives in `routes/`; below are the mount points.

| Base path              | File                          | Covers |
|-------------------------|-------------------------------|--------|
| `/api/auth`             | `routes/auth.js`              | Register, login, OAuth, password reset, profile |
| `/api/study`             | `routes/study.js`             | Sessions, stats, missions, analytics |
| `/api/curriculum`        | `routes/curriculum.js`        | Subjects, chapters |
| `/api/mentor`            | `routes/mentor.js`            | Mentees, requests, sessions, messaging, availability |
| `/api/parent`            | `routes/parent.js`            | Child progress, mentor messaging |
| `/api/assistant`         | `routes/assistant.js`         | Mentor-assistant delegated views |
| `/api/admin/users`       | `routes/adminUsers.js`        | User CRUD/suspension, mentor assignment |
| `/api/permissions`       | `routes/permissions.js`       | View/edit role permissions |
| `/api/audit-logs`        | `routes/auditLogs.js`         | Admin action history |
| `/api/tickets`           | `routes/tickets.js`           | Support tickets |
| `/health`                 | `server.js`                   | Health check |

### Auth endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register with email + password |
| POST | `/api/auth/login` | Login with email/phone + password |
| GET | `/api/auth/me` | Get current user (JWT required) |
| GET | `/api/auth/google` | Start Google OAuth |
| GET | `/api/auth/google/callback` | Google OAuth callback |
| GET | `/api/auth/apple` | Start Apple Sign-In |
| POST | `/api/auth/apple/callback` | Apple Sign-In callback |
| POST | `/api/auth/forgot-password` | Request a password-reset email |
| POST | `/api/auth/reset-password` | Complete a password reset with the emailed token |
| PATCH | `/api/auth/change-password` | Change password while logged in |
| PATCH | `/api/auth/profile` | Update own name/avatar |
| POST | `/api/auth/logout` | Logout (client discards JWT) |

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in values
cp .env.example .env

# 3. (optional) seed RBAC permissions and/or a super-admin account
node scripts/seedPermissions.js
node scripts/createSuperAdmin.js

# 4. Run in development
npm run dev

# 5. Run in production
npm start
```

## Environment Variables

See `.env.example` for the full list, including:

- **MongoDB** — any MongoDB Atlas connection string
- **JWT** — secret key + expiry
- **Google OAuth** — from Google Cloud Console
- **Apple Sign-In** — from Apple Developer account
- **Anthropic API key** — powers the mentor AI-drafted-reply feature
- **SMTP** — for password-reset emails (optional in development — resets
  are logged to the console if unset)

## Known limitations

- JWTs are stateless with a long default expiry (`JWT_EXPIRES_IN=30d`) and
  logout is client-side only; there's no server-side token blacklist, so a
  leaked token remains valid until it expires or a permission change bumps
  `permissionVersion`.
- No automated test suite yet.

## Deployment

Recommended: **Railway**, **Render**, or **Fly.io** (all have free tiers).

Set all `.env` variables in the platform's environment settings.

## License

MIT — see `LICENSE`.
