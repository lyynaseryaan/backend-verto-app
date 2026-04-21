require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

const authRoutes          = require('./routes/auth');
const levelRoutes         = require('./routes/level');
const { router: quizRoutes } = require('./routes/quiz');
const taskRoutes          = require('./routes/tasks');
const resultRoutes        = require('./routes/resultRoute');
const courseRoutes        = require('./routes/courses');
const studentCourseRoutes = require('./routes/studentCourse');
const notificationRoutes  = require('./routes/notifications');
const instructorRoutes    = require('./routes/instructors');
const chatbotRoutes       = require('./routes/chatbot');
const studentlistRoutes   = require('./routes/studentlist');

app.use('/api/auth',            authRoutes);
app.use('/api',                 levelRoutes);
app.use('/api',                 quizRoutes);
app.use('/api/tasks',           taskRoutes);
app.use('/api/result',          resultRoutes);
app.use('/api/courses',         courseRoutes);
app.use('/api/student/courses', studentCourseRoutes);
app.use('/api/notifications',   notificationRoutes);
app.use('/api/instructors',     instructorRoutes);
app.use('/api/chatbot',         chatbotRoutes);
app.use('/api/studentlist',     studentlistRoutes);

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});