require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const passport   = require('./config/passport');

const authRoutes       = require('./routes/auth');
const studyRoutes      = require('./routes/study');
const curriculumRoutes = require('./routes/curriculum');
const mentorRoutes     = require('./routes/mentor');
const parentRoutes     = require('./routes/parent');
const assistantRoutes  = require('./routes/assistant');
const adminUserRoutes  = require('./routes/adminUsers');
const permissionRoutes = require('./routes/permissions');
const auditLogRoutes   = require('./routes/auditLogs');
const ticketRoutes = require('./routes/tickets');
const sessionRoutes = require('./routes/sessions');
const sessionNoteRoutes = require('./routes/sessionNotes');
const evaluationRoutes = require('./routes/evaluations');
const messageRoutes = require('./routes/messages');
const studentMessageRoutes = require('./routes/studentMessages');
const doubtRoutes = require('./routes/doubts');
const settingsRoutes = require('./routes/settings');
const achievementRoutes = require('./routes/achievements');
const testRoutes = require('./routes/tests');
const flashcardRoutes = require('./routes/flashcards');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Security & Middleware ─────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — allow GitHub Pages frontend
app.use(cors({
  origin: [
    process.env.CLIENT_URL,
    'http://localhost:3000',
    'http://127.0.0.1:5500',
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests. Please try again later.' },
}));

app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
}));

app.use('/api/auth/forgot-password', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many reset requests. Try again in 15 minutes.' },
}));

app.use(passport.initialize());

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/study',      studyRoutes);
app.use('/api/curriculum', curriculumRoutes);
app.use('/api/mentor',     mentorRoutes);
app.use('/api/parent',     parentRoutes);
app.use('/api/assistant',  assistantRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/tickets',    ticketRoutes);
app.use('/api/admin/sessions', sessionRoutes);
app.use('/api/admin/session-notes', sessionNoteRoutes);
app.use('/api/admin/evaluations', evaluationRoutes);
app.use('/api/admin/messages',   messageRoutes);
app.use('/api/student/messages', studentMessageRoutes);
app.use('/api/doubts',           doubtRoutes);
app.use('/api/settings',         settingsRoutes);
app.use('/api/achievements',     achievementRoutes);
app.use('/api/tests',            testRoutes);
app.use('/api/flashcards',       flashcardRoutes);
// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'MedClarivo Auth API',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

// ── Database & Start ─────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => {
      console.log(`🚀 MedClarivo API running on port ${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/health`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

module.exports = app;

const myMentorRoutes = require('./routes/myMentor');
app.use('/api/student/mentor', myMentorRoutes);
