require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Routes
const authRoutes = require('./routes/auth');
const levelRoutes = require('./routes/level');
const {router:quizRoutes} = require('./routes/quiz');
const taskRoutes = require('./routes/tasks'); 
const resultRoutes=require('./routes/resultRoute');
const courseRoutes = require('./routes/courses');
const studentCourseRoutes = require('./routes/studentCourse');



// routes
app.use('/api/auth', authRoutes);
app.use('/api', levelRoutes);
app.use('/api', quizRoutes);
app.use('/api/tasks', taskRoutes); // ✅ route تاع tasks
app.use('/api/result',resultRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/student/courses', studentCourseRoutes);

app.listen(process.env.PORT, () => {
  console.log('Server running on port ${process.env.PORT}');

});
