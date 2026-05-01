require('dotenv').config();
const express = require('express');
const path    = require('path');
const cors    = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// ── Serve uploaded CVs as static files (admin-gated in the route) ──
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Existing routes (UNCHANGED) ───────────────────────────────────
const authRoutes          = require('./routes/auth');
const levelRoutes         = require('./routes/level');
const { router: quizRoutes } = require('./routes/quiz');
const taskRoutes          = require('./routes/tasks');
const resultRoutes        = require('./routes/resultRoute');
const courseRoutes        = require('./routes/courses');
const studentCourseRoutes = require('./routes/studentCourse');
const notificationRoutes  = require('./routes/notifications');
const studentlistRoutes   = require('./routes/studentlist');
const adminProfileRoutes  = require('./routes/adminprofile');
const activityFeedRoutes  = require('./routes/activityFeed');
const instructorRoutes    = require('./routes/instructors');   // approved instructors
const chatbotRoutes       = require('./routes/chatbot');
const adminCoursesRoutes  = require('./routes/adminCourses');
const profileRoute        = require('./routes/profile');

app.use('/api/auth',             authRoutes);
app.use('/api',                  levelRoutes);
app.use('/api',                  quizRoutes);
app.use('/api/tasks',            taskRoutes);
app.use('/api/result',           resultRoutes);
app.use('/api/courses',          courseRoutes);
app.use('/api/student/courses',  studentCourseRoutes);
app.use('/api/notifications',    notificationRoutes);
app.use('/api/studentlist',      studentlistRoutes);
app.use('/api/admin',            adminProfileRoutes);
app.use('/api/activity-feed',    activityFeedRoutes);
app.use('/api/instructors',      instructorRoutes);
app.use('/api/chatbot',          chatbotRoutes);
app.use('/api/admin-courses', adminCoursesRoutes);
app.use('/api/profile', require('./routes/profile'));
// ── NEW route ─────────────────────────────────────────────────────
const instructorRequestsRoutes = require('./routes/instructorRequests');

app.use('/api/auth',                    authRoutes);
app.use('/api',                         levelRoutes);
app.use('/api',                         quizRoutes);
app.use('/api/tasks',                   taskRoutes);
app.use('/api/result',                  resultRoutes);
app.use('/api/courses',                 courseRoutes);
app.use('/api/student/courses',         studentCourseRoutes);
app.use('/api/notifications',           notificationRoutes);
app.use('/api/studentlist',             studentlistRoutes);
app.use('/api/admin',                   adminProfileRoutes);
app.use('/api/activity-feed',           activityFeedRoutes);
app.use('/api/instructors',             instructorRoutes);     // existing (GET/DELETE only now)
app.use('/api/chatbot',                 chatbotRoutes);
app.use('/api/admin-courses',           adminCoursesRoutes);

// ── Instructor application routes ─────────────────────────────────
// Public submit:   POST   /api/instructor-requests
// Admin list:      GET    /api/instructor-requests/admin
// Admin detail:    GET    /api/instructor-requests/admin/:id
// Admin approve:   PUT    /api/instructor-requests/admin/:id/approve
// Admin reject:    PUT    /api/instructor-requests/admin/:id/reject
// CV serve:        GET    /api/instructor-requests/cv/:filename
app.use('/api/instructor-requests', instructorRequestsRoutes);

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});