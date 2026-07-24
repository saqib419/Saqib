const User = require('../models/User');
const UserProgress = require('../models/UserProgress');
const Session = require('../models/Session');
const auditService = require('../services/auditService');
const { scopeFilter } = require('../middleware/rbac');
const { ROLES, MANAGEABLE_ROLES, MODULES } = require('../utils/rbacConstants');

async function createUser(req, res) {
  const { name, email, password, role, mentorId, specialty, availabilityType } = req.body;

  const allowedRoles = MANAGEABLE_ROLES[req.user.role] || [];
  if (!allowedRoles.includes(role)) {
    return res.status(403).json({ success: false, message: `A ${req.user.role} cannot create a ${role}.` });
  }

  if (role === ROLES.ASSISTANT) {
    if (!mentorId) return res.status(400).json({ success: false, message: 'Assistants must be linked to a mentorId.' });
    const mentor = await User.findOne({ _id: mentorId, role: ROLES.MENTOR });
    if (!mentor) return res.status(400).json({ success: false, message: 'mentorId does not reference a valid Mentor.' });
  }

  try {
    const user = await User.create({
      name,
      email,
      passwordHash: password,
      role,
      mentorId: role === ROLES.ASSISTANT ? mentorId : null,
      mentorProfile: role === ROLES.MENTOR ? { specialty: specialty || '', availabilityType: availabilityType || 'full_time' } : undefined,
    });

    await auditService.log({
      actor: req.user,
      action: 'user.create',
      module: MODULES.USER,
      targetType: 'User',
      targetId: user._id,
      after: { name: user.name, email: user.email, role: user.role },
      req,
    });

    res.status(201).json({ success: true, user });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function listUsers(req, res) {
  const filter = scopeFilter(req, { assignedField: 'mentorId' });
  const users = await User.find(filter)
    .sort({ createdAt: -1 })
    .populate('childId', 'name email');
  res.json({ success: true, users });
}

async function suspendUser(req, res) {
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ success: false, message: 'User not found.' });

  const allowedRoles = MANAGEABLE_ROLES[req.user.role] || [];
  if (!allowedRoles.includes(target.role)) {
    return res.status(403).json({ success: false, message: `A ${req.user.role} cannot suspend a ${target.role}.` });
  }

  const before = { isActive: target.isActive };
  target.isActive = false;
  target.suspendedAt = new Date();
  target.suspendedReason = req.body.reason || null;
  target.permissionVersion += 1;
  await target.save();

  await auditService.log({
    actor: req.user,
    action: 'user.suspend',
    module: MODULES.USER,
    targetType: 'User',
    targetId: target._id,
    before,
    after: { isActive: false, reason: target.suspendedReason },
    req,
  });

  res.json({ success: true, message: 'User suspended.' });
}

async function reactivateUser(req, res) {
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ success: false, message: 'User not found.' });

  const allowedRoles = MANAGEABLE_ROLES[req.user.role] || [];
  if (!allowedRoles.includes(target.role)) {
    return res.status(403).json({ success: false, message: `A ${req.user.role} cannot reactivate a ${target.role}.` });
  }

  target.isActive = true;
  target.suspendedAt = null;
  target.suspendedReason = null;
  await target.save();

  await auditService.log({
    actor: req.user,
    action: 'user.reactivate',
    module: MODULES.USER,
    targetType: 'User',
    targetId: target._id,
    after: { isActive: true },
    req,
  });

  res.json({ success: true, message: 'User reactivated.' });
}


async function assignMentor(req, res) {
  const { studentId } = req.params;
  const { mentorId } = req.body; // pass null to unassign

  const student = await User.findOne({ _id: studentId, role: ROLES.STUDENT });
  if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

  if (mentorId) {
    const mentor = await User.findOne({ _id: mentorId, role: ROLES.MENTOR });
    if (!mentor) return res.status(400).json({ success: false, message: 'mentorId does not reference a valid Mentor.' });
  }

  const before = { mentorId: student.mentorId };
  student.mentorId = mentorId || null;
  await student.save();

  await auditService.log({
    actor: req.user,
    action: mentorId ? 'mentor_request.assign' : 'mentor_request.unassign',
    module: MODULES.MENTOR_REQUEST,
    targetType: 'User',
    targetId: student._id,
    before,
    after: { mentorId: student.mentorId },
    req,
  });

  res.json({ success: true, student });
}

async function linkChild(req, res) {
  const { id } = req.params;
  const { childId } = req.body; // pass null/omit to unlink

  const parent = await User.findById(id);
  if (!parent) return res.status(404).json({ success: false, message: 'User not found.' });
  if (parent.role !== ROLES.PARENT) {
    return res.status(400).json({ success: false, message: 'Only parent accounts can be linked to a child.' });
  }

  let child = null;
  if (childId) {
    child = await User.findOne({ _id: childId, role: ROLES.STUDENT });
    if (!child) return res.status(400).json({ success: false, message: 'childId does not reference a valid Student.' });
  }

  const before = { childId: parent.childId };
  parent.childId = childId || null;
  await parent.save();

  await auditService.log({
    actor: req.user,
    action: childId ? 'user.link_child' : 'user.unlink_child',
    module: MODULES.USER,
    targetType: 'User',
    targetId: parent._id,
    before,
    after: { childId: parent.childId },
    req,
  });

  const populated = await User.findById(parent._id).populate('childId', 'name email');
  res.json({ success: true, user: populated });
}

async function listStudents(req, res) {
  const filter = scopeFilter(req, { assignedField: 'assignedMentors' });
  filter.role = ROLES.STUDENT;

  const students = await User.find(filter).select('-passwordHash').lean();
  const studentIds = students.map((s) => s._id);

  const [progressRows, sessions, mentors] = await Promise.all([
    UserProgress.find({ user: { $in: studentIds } }).lean(),
    Session.find({ mentee: { $in: studentIds } }).lean(),
    User.find({ role: ROLES.MENTOR }).select('name').lean(),
  ]);

  const mentorNameById = {};
  mentors.forEach((m) => { mentorNameById[m._id.toString()] = m.name; });

  const now = new Date();

  const result = students.map((student) => {
    const sid = student._id.toString();

    const ownProgress = progressRows.filter((p) => p.user.toString() === sid);
    const avgProgress = ownProgress.length
      ? Math.round(ownProgress.reduce((sum, p) => sum + (p.percentComplete || 0), 0) / ownProgress.length)
      : null;

    const ownSessions = sessions.filter((s) => s.mentee.toString() === sid);
    const completedCount = ownSessions.filter((s) => s.status === 'completed').length;
    const cancelledCount = ownSessions.filter((s) => s.status === 'cancelled').length;
    const attendedTotal = completedCount + cancelledCount;
    const attendanceRate = attendedTotal > 0 ? Math.round((completedCount / attendedTotal) * 100) : null;

    const nextSession = ownSessions
      .filter((s) => s.status === 'scheduled' && new Date(s.startTime) >= now)
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))[0] || null;

    return {
      ...student,
      mentorName: student.mentorId ? mentorNameById[student.mentorId.toString()] || null : null,
      syllabusProgress: avgProgress,
      attendanceRate,
      nextSession: nextSession ? { startTime: nextSession.startTime, topic: nextSession.topic } : null,
    };
  });

  res.json({ success: true, students: result });
}
module.exports = { createUser, listUsers, suspendUser, reactivateUser, assignMentor, listStudents, linkChild };
