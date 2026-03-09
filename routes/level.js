const express = require('express');
const router = express.Router();
const db = require('../db'); // الاتصال بالـ DB

router.post('/update-level', async (req, res) => {
  const { user_id, selected_level } = req.body;

  if (!user_id || !selected_level) {
    return res.status(400).json({ success: false, error: 'Missing parameters' });
  }

  const allowedLevels = ['beginner', 'assessment'];
  if (!allowedLevels.includes(selected_level)) {
    return res.status(400).json({ success: false, error: 'Invalid level' });
  }

  try {
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