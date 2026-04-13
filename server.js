require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
// ✅ حذفنا: app.use('/uploads', express.static('uploads'));
// مش محتاجينه — الملفات على Cloudinary مباشرة

const authRoutes          = require('./routes/auth');
const levelRoutes         = require('./routes/level');
const { router: quizRoutes } = require('./routes/quiz');
const taskRoutes          = require('./routes/tasks');
const resultRoutes        = require('./routes/resultRoute');
const courseRoutes        = require('./routes/courses');
const studentCourseRoutes = require('./routes/studentCourse');
const notificationRoutes = require('./routes/notifications');




app.use('/api/auth',            authRoutes);
app.use('/api',                 levelRoutes);
app.use('/api',                 quizRoutes);
app.use('/api/tasks',           taskRoutes);
app.use('/api/result',          resultRoutes);
app.use('/api/courses',         courseRoutes);
app.use('/api/student/courses', studentCourseRoutes);
app.use('/api/quiz', quizRouteNew);
app.use('/api/notifications', notificationRoutes);



app.listen(process.env.PORT, () => {
  // ✅ تصحيح: كان template literal ما يشتغل مع single quotes
  console.log(`Server running on port ${process.env.PORT}`);
});


