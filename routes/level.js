const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

router.post('/update-level', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ success: false, error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Invalid token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // استعمال env
    const user_id = decoded.id;

    const { selected_level } = req.body;
    if (!selected_level) return res.status(400).json({ success: false, error: 'Missing selected_level' });

    const allowedLevels = ['beginner', 'assessment'];
    if (!allowedLevels.includes(selected_level)) {
      return res.status(400).json({ success: false, error: 'Invalid level' });
    }

    const [result] = await db.execute(
      'UPDATE users SET selected_level = ? WHERE id = ?',
      [selected_level, user_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;