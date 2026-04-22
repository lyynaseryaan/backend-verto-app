// ============================================================
//  routes/adminCourses.js  –  Verto LMS
//  GET /api/admin/courses  → list all courses (overview only)
//  GET /api/admin/courses/:id → single course overview
//  ⚠️  Does NOT touch any existing route or student logic
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('./db');
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

// ━━━ GET /api/admin/courses ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Returns all courses — overview fields only, no lesson content
router.get('/', adminAuth, async (req, res) => {
  try {
    const rows = await queryAsync(
      `SELECT
         id,
         title,
         description,
         course_type,
         chapter,
         image_path,
         created_at
       FROM courses
       ORDER BY created_at DESC`
    );

    return res.status(200).json({
      success: true,
      count:   rows.length,
      courses: rows,
    });

  } catch (err) {
    console.error('[adminCourses] list error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━ GET /api/admin/courses/:id ━━━━━━━━━━━━━━━━━━━━━━━━━━
// Returns a single course overview (no levels/content)
router.get('/:id', adminAuth, async (req, res) => {
  const courseId = parseInt(req.params.id);
  if (isNaN(courseId))
    return res.status(400).json({ success: false, message: 'Invalid course id' });

  try {
    const rows = await queryAsync(
      `SELECT
         id,
         title,
         description,
         course_type,
         chapter,
         image_path,
         created_at
       FROM courses
       WHERE id = ?
       LIMIT 1`,
      [courseId]
    );

    if (!rows.length)
      return res.status(404).json({ success: false, message: 'Course not found' });

    return res.status(200).json({ success: true, course: rows[0] });

  } catch (err) {
    console.error('[adminCourses] detail error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;