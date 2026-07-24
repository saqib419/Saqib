const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { MODULES, ACTIONS } = require('../utils/rbacConstants');
const Evaluation = require('../models/Evaluation');
const User = require('../models/User');
const auditService = require('../services/auditService');

router.use(protect);

router.get('/students', authorize(MODULES.EVALUATION, ACTIONS.READ), async (req, res) => {
  try {
    const students = await User.find({ role: 'student' }).select('name email mentorId').lean();
    const studentIds = students.map((s) => s._id);
    const [mentors, latestEvals] = await Promise.all([
      User.find({ role: 'mentor' }).select('name').lean(),
      Evaluation.find({ student: { $in: studentIds } }).sort({ createdAt: -1 }).lean(),
    ]);
    const mentorNameById = {};
    mentors.forEach((m) => { mentorNameById[m._id.toString()] = m.name; });
    const latestByStudent = {};
    latestEvals.forEach((e) => {
      const sid = e.student.toString();
      if (!latestByStudent[sid]) latestByStudent[sid] = e;
    });
    const result = students.map((s) => {
      const latest = latestByStudent[s._id.toString()];
      const rating = latest ? Math.round((latest.academicScore + latest.behaviourScore + latest.attendanceScore + latest.communicationScore) / 4) : null;
      return {
        _id: s._id,
        name: s.name,
        email: s.email,
        mentor: s.mentorId ? (mentorNameById[s.mentorId.toString()] || 'Unassigned') : 'Unassigned',
        grade: rating === null ? '—' : rating >= 90 ? 'A+' : rating >= 80 ? 'A' : rating >= 70 ? 'B+' : rating >= 60 ? 'B' : 'C',
      };
    });
    res.json({ success: true, students: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.get('/:studentId', authorize(MODULES.EVALUATION, ACTIONS.READ), async (req, res) => {
  try {
    const student = await User.findById(req.params.studentId).select('name email mentorId');
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
    const evaluation = await Evaluation.findOne({ student: student._id }).sort({ createdAt: -1 }).populate('mentor', 'name');
    res.json({ success: true, student, evaluation: evaluation || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.put('/:studentId', authorize(MODULES.EVALUATION, ACTIONS.UPDATE), async (req, res) => {
  try {
    const student = await User.findById(req.params.studentId);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
    const { academicScore, behaviourScore, attendanceScore, communicationScore, qualitativeComments, improvementAreas, milestones, mentorId } = req.body;
    let evaluation = await Evaluation.findOne({ student: student._id, status: 'draft' }).sort({ createdAt: -1 });
    if (!evaluation) {
      evaluation = new Evaluation({ student: student._id, mentor: mentorId || student.mentorId || req.user._id, createdBy: req.user._id });
    }
    if (academicScore !== undefined) evaluation.academicScore = academicScore;
    if (behaviourScore !== undefined) evaluation.behaviourScore = behaviourScore;
    if (attendanceScore !== undefined) evaluation.attendanceScore = attendanceScore;
    if (communicationScore !== undefined) evaluation.communicationScore = communicationScore;
    if (qualitativeComments !== undefined) evaluation.qualitativeComments = qualitativeComments;
    if (improvementAreas !== undefined) evaluation.improvementAreas = improvementAreas;
    if (milestones !== undefined) evaluation.milestones = milestones;
    await evaluation.save();

    await auditService.log({
      actor: req.user,
      action: 'evaluation.save',
      module: MODULES.EVALUATION,
      targetType: 'Evaluation',
      targetId: evaluation._id,
      req,
    });

    res.json({ success: true, evaluation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.post('/:id/publish', authorize(MODULES.EVALUATION, ACTIONS.UPDATE), async (req, res) => {
  try {
    const evaluation = await Evaluation.findById(req.params.id);
    if (!evaluation) return res.status(404).json({ success: false, message: 'Evaluation not found.' });
    evaluation.status = 'published';
    evaluation.publishedAt = new Date();
    evaluation.guardianStatus = 'notified';
    await evaluation.save();

    await auditService.log({
      actor: req.user,
      action: 'evaluation.publish',
      module: MODULES.EVALUATION,
      targetType: 'Evaluation',
      targetId: evaluation._id,
      req,
    });

    res.json({ success: true, evaluation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.post('/:id/notify-guardian', authorize(MODULES.EVALUATION, ACTIONS.UPDATE), async (req, res) => {
  try {
    const evaluation = await Evaluation.findById(req.params.id);
    if (!evaluation) return res.status(404).json({ success: false, message: 'Evaluation not found.' });
    evaluation.guardianStatus = 'notified';
    await evaluation.save();
    res.json({ success: true, evaluation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.post('/:id/remove-signature', authorize(MODULES.EVALUATION, ACTIONS.UPDATE), async (req, res) => {
  try {
    const evaluation = await Evaluation.findById(req.params.id);
    if (!evaluation) return res.status(404).json({ success: false, message: 'Evaluation not found.' });
    evaluation.guardianStatus = 'pending';
    evaluation.guardianReply = '';
    evaluation.guardianRespondedAt = null;
    await evaluation.save();
    res.json({ success: true, evaluation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
