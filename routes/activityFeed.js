// ============================================================
//  routes/activityFeed.js  –  Verto LMS
//  GET /api/admin/activity-feed
//  Returns recent student activities sorted by latest first
//  Sources: enrollments + quiz_attempts (existing tables only)
//  ✅ Does NOT modify any existing table or logic
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
    next();
  });
}

// ━━━ GET /api/admin/activity-feed ━━━━━━━━━━━━━━━━━━━━━━━━━
// Unions 3 activity types from existing data:
//   1. enrolled        → when student enrolled in a course
//   2. started_content → when student first opened PDF or watched video
//   3. quiz_completed  → when student completed a quiz attempt
router.get('/', adminAuth, (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit) || 20);

  const sql = `
    SELECT * FROM (

      -- ① Enrollment activities
      SELECT
        u.name           AS student_name,
        c.title          AS course_title,
        'enrolled'       AS activity_type,
        e.enrolled_at    AS activity_time
      FROM enrollments e
      INNER JOIN users   u ON u.id = e.student_id
      INNER JOIN courses c ON c.id = e.course_id
      WHERE e.enrolled_at IS NOT NULL

      UNION ALL

      -- ② Started content (PDF opened OR video watched > 5%)
      --    We use enrolled_at as proxy time since we don't store
      --    exact open timestamps — but only show if activity exists
      SELECT
        u.name              AS student_name,
        c.title             AS course_title,
        'started_content'   AS activity_type,
        e.enrolled_at       AS activity_time
      FROM enrollments e
      INNER JOIN users   u ON u.id = e.student_id
      INNER JOIN courses c ON c.id = e.course_id
      WHERE e.pdf_opened = 1 OR e.video_progress > 0.05

      UNION ALL

      -- ③ Quiz completed activities (from quiz_attempts table)
      SELECT
        u.name              AS student_name,
        c.title             AS course_title,
        CASE
          WHEN qa.passed = 1 THEN 'quiz_passed'
          ELSE 'quiz_attempted'
        END                 AS activity_type,
        qa.attempted_at     AS activity_time
      FROM quiz_attempts qa
      INNER JOIN users   u ON u.id = qa.student_id
      INNER JOIN courses c ON c.id = qa.course_id
      WHERE qa.attempted_at IS NOT NULL

    ) AS feed
    ORDER BY activity_time DESC
    LIMIT ?`;

  db.query(sql, [limit], (err, rows) => {
    if (err) {
      console.error('[activity-feed] error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    // Shape each row into a clean activity object
    const activities = rows.map(row => ({
      student_name:  row.student_name,
      course_title:  row.course_title,
      activity_type: row.activity_type,
      activity_time: row.activity_time,
      label:         activityLabel(row.activity_type),
    }));

    return res.status(200).json({
      success:    true,
      count:      activities.length,
      activities,
    });
  });
});

// ── Helper: human-readable label ─────────────────────────
function activityLabel(type) {
  switch (type) {
    case 'enrolled':        return 'enrolled in a course';
    case 'started_content': return 'started studying';
    case 'quiz_passed':     return 'passed a quiz';
    case 'quiz_attempted':  return 'attempted a quiz';
    default:                return type;
  }
}

module.exports = router;