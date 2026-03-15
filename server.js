require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Routes
const authRoutes = require('./routes/auth');
const levelRoutes = require('./routes/level');
const quizRoutes = require('./routes/quiz');
const taskRoutes = require('./routes/tasks'); 
const resultRoutes=require('./routes/resultRoute');

const app = express();

app.use(cors());
app.use(express.json());

// routes
app.use('/api/auth', authRoutes);
app.use('/api', levelRoutes);
app.use('/api', quizRoutes);
app.use('/api/tasks', taskRoutes); // ✅ route تاع tasks
app.use('/api/result', resultRoutes);

app.listen(process.env.PORT, () => {
  console.log('Server running on port ${process.env.PORT}');
});