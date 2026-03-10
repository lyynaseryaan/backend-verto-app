require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Routes
const authRoutes = require('./routes/auth');
const levelRoutes = require('./routes/level'); // <-- استيراد فقط

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api', levelRoutes); // كل route في level.js يبدأ بـ /api

app.listen(process.env.PORT, () => {
    console.log('Server running on port ${process.env.PORT}');
});