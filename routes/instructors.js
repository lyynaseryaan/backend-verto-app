// ============================================================
//  routes/instructors.js  –  Verto LMS
//  ⚠️  Admin can NO LONGER create instructors manually.
//      All instructors must come from approved applications.
//      This file now only exposes GET (list) and DELETE.
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ━━━ Admin-only middleware ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function adminAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header)
    return res.status(401).json({ success: false, message: 'No token provided' });

  const token = header.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    if (decoded.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Admin access required' });
    req.adminId = decoded.id;
    next();
  });
}

// ━━━ Helper ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function queryAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ━━━ GET /api/instructors  –  list approved instructors ━━━
router.get('/', adminAuth, async (req, res) => {
  try {
    const rows = await queryAsync(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.created_at,
         i.id      AS instructor_id,
         i.subject
       FROM instructors i
       INNER JOIN users u ON u.id = i.user_id
       ORDER BY u.created_at DESC`
    );

    return res.status(200).json({
      success:     true,
      count:       rows.length,
      instructors: rows,
    });
  } catch (err) {
    console.error('[instructors] list error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━ DELETE /api/instructors/:id ━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/:id', adminAuth, async (req, res) => {
  const userId = parseInt(req.params.id);
  if (isNaN(userId))
    return res.status(400).json({ success: false, message: 'Invalid instructor id' });

  try {
    const rows = await queryAsync(
      'SELECT id FROM users WHERE id = ? AND role = ? LIMIT 1',
      [userId, 'teacher']
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: 'Teacher not found' });

    await queryAsync('DELETE FROM users WHERE id = ?', [userId]);

    return res.status(200).json({
      success: true,
      message: 'Teacher deleted successfully',
    });
  } catch (err) {
    console.error('[instructors] delete error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━ Block manual instructor creation ━━━━━━━━━━━━━━━━━━━━━
router.post('/', adminAuth, (req, res) => {
  return res.status(403).json({
    success: false,
    message:
      'Manual instructor creation is disabled. ' +
      'Instructors must apply via the application form and be approved by an admin.',
  });
});

module.exports = router;