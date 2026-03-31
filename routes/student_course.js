// ============================================================
//  routes/student_courses.js
//  GET /api/student/courses?level=Beginner&page=1&limit=10
//  Returns courses with ONLY file-path content matching student level
//  Supports basic pagination (page + limit)
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ─── Middleware: any logged-in user ───
function authStudent(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  const token = header.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
    req.userId = decoded.id;
    req.role   = decoded.role;
    next();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/courses?level=Intermediate&page=1&limit=10
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/courses', authStudent, (req, res) => {
  const { level } = req.query;

  // ─── Validate level ───
  const validLevels = ['Beginner', 'Intermediate', 'Advanced'];
  if (!level || !validLevels.includes(level)) {
    return res.status(400).json({
      success: false,
      message: `level is required. Must be one of: ${validLevels.join(', ')}`,
    });
  }

  // ─── Pagination params ───
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  // ─── Count total matching courses first ───
  const countSql = `
    SELECT COUNT(DISTINCT c.id) AS total
    FROM courses c
    INNER JOIN course_levels cl
      ON cl.course_id = c.id
      AND cl.level = ?`;

  db.query(countSql, [level], (err, countRows) => {
    if (err) {
      console.error('DB count error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    const total      = countRows[0].total;
    const totalPages = Math.ceil(total / limit);
    const hasNext    = page < totalPages;
    const hasPrev    = page > 1;

    // ─── Fetch paginated courses ───
    const sql = `
      SELECT
        c.id           AS course_id,
        c.title,
        c.description,
        c.course_type,
        c.chapter,
        c.image_path,
        cl.id          AS level_id,
        cl.level,
        cl.video_file_path,
        cl.text_content,
        cl.quiz_note,
        cl.pdf_course,
        cl.pdf_exercise
      FROM courses c
      INNER JOIN course_levels cl
        ON cl.course_id = c.id
        AND cl.level = ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?`;

    db.query(sql, [level, limit, offset], (err2, rows) => {
      if (err2) {
        console.error('DB fetch error:', err2);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      const courses = rows.map(row => ({
        id:          row.course_id,
        title:       row.title,
        description: row.description,
        course_type: row.course_type,
        chapter:     row.chapter,
        image_path:  row.image_path,
        level:       row.level,
        content: {
          // ✅ File paths only — no video_url
          video_file_path: row.video_file_path || null,
          text_content:    row.text_content    || null,
          quiz_note:       row.quiz_note       || null,
          pdf_course:      row.pdf_course      || null,
          pdf_exercise:    row.pdf_exercise    || null,
        },
      }));

      res.status(200).json({
        success: true,
        level,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext,
          hasPrev,
        },
        courses,
      });
    });
  });
});

module.exports = router;