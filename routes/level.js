const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

router.post('/update-level', (req, res) => {

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {

    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid token' });
    }

    const user_id = decoded.id;
    const { selected_level } = req.body;

    if (!selected_level) {
      return res.status(400).json({ success: false, error: 'Missing selected_level' });
    }

    const allowedLevels = ['beginner', 'assessment'];

    if (!allowedLevels.includes(selected_level)) {
      return res.status(400).json({ success: false, error: 'Invalid level' });
    }

    db.query(
      'UPDATE users SET selected_level = ? WHERE id = ?',
      [selected_level, user_id],
      (err, result) => {

        if (err) {
          console.error(err);
          return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }

        return res.json({ success: true });
      }
    );

  });

});

module.exports = router;