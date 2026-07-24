// routes/myMentor.js
//
// Mount in server.js (already done):
//   app.use('/api/student/mentor', myMentorRoutes);
//
// Matches your actual schema:
//   User.mentorId          -> ref to assigned mentor (User)
//   User.mentorProfile     -> { title, bio, specialty }
//   Session.mentor/mentee  -> refs
//   Session.startTime      -> Date
//   Session.status         -> 'scheduled' | 'completed' | 'cancelled'
//   Session.category       -> 'academic' | 'behavioral' | 'doubt' | 'exam'
//   Session.notes          -> plain text (not a link)
//   Session.meetingLink    -> join URL

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth'); // adjust name/path if different
const User = require('../models/User');
const Session = require('../models/Session');

router.get('/my-mentor', protect, async (req, res) => {
  try {
    const studentId = req.user.id || req.user._id;

    const student = await User.findById(studentId).select('mentorId').lean();

    if (!student || !student.mentorId) {
      return res.status(404).json({ success: false, message: 'No mentor assigned yet' });
    }

    const mentor = await User.findById(student.mentorId)
      .select('name mentorProfile')
      .lean();

    if (!mentor) {
      return res.status(404).json({ success: false, message: 'No mentor assigned yet' });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [allSessions, upcomingRaw, historyRaw] = await Promise.all([
      Session.find({ mentor: mentor._id, mentee: studentId }).lean(),
      Session.find({
        mentor: mentor._id,
        mentee: studentId,
        status: 'scheduled',
        startTime: { $gte: now },
      })
        .sort({ startTime: 1 })
        .limit(5)
        .lean(),
      Session.find({
        mentor: mentor._id,
        mentee: studentId,
        status: { $in: ['completed', 'cancelled'] },
      })
        .sort({ startTime: -1 })
        .limit(10)
        .lean(),
    ]);

    const sessionsThisMonth = allSessions.filter(
      (s) => new Date(s.startTime) >= startOfMonth
    ).length;
    const completedSessions = allSessions.filter((s) => s.status === 'completed').length;
    const openDoubts = allSessions.filter(
      (s) => s.category === 'doubt' && s.status === 'scheduled'
    ).length;

    const formatDate = (d) =>
      new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const formatTime = (d) =>
      new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const mentorSummary = {
      _id: mentor._id,
      name: mentor.name,
      credentials: mentor.mentorProfile?.title || '',
      bio: mentor.mentorProfile?.bio || '',
      specialties: mentor.mentorProfile?.specialty ? [mentor.mentorProfile.specialty] : [],
      joinLink: upcomingRaw[0]?.meetingLink || '#',
    };

    res.json({
      success: true,
      mentor: mentorSummary,
      stats: {
        totalSessions: allSessions.length,
        sessionsThisMonth,
        completedSessions,
        openDoubts,
      },
      upcomingSessions: upcomingRaw.map((s) => ({
        _id: s._id,
        startTime: s.startTime,
        date: formatDate(s.startTime),
        time: formatTime(s.startTime),
        topic: s.topic || '',
        category: s.category,
        status: s.status,
        meetingLink: s.meetingLink || '',
        mentor: mentorSummary,
      })),
      sessionHistory: historyRaw.map((s) => ({
        _id: s._id,
        startTime: s.startTime,
        date: formatDate(s.startTime),
        topic: s.topic || '',
        category: s.category,
        notes: s.notes || '',
        status: s.status,
        mentor: mentorSummary,
      })),
    });
  } catch (err) {
    console.error('GET /api/student/mentor/my-mentor error:', err);
    res.status(500).json({ message: 'Failed to load mentor details' });
  }
});

module.exports = router;


// myMentor route active
