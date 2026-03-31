// ============================================================
//  studentCourse.js – Verto LMS
//  Student-side course routes (read-only)
//  Base path: /api/student/courses
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ━━━ JWT Middleware ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header)
    return res.status(401).json({ success: false, message: 'No token provided' });

  const token = header.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });

    req.userId   = decoded.id;
    req.userRole = decoded.role;
    next();
  });
}

const VALID_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

// ━━━ GET ALL COURSES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/', auth, (req, res) => {
  const level = req.query.level ? req.query.level.trim() : '';
  if (!level || !VALID_LEVELS.includes(level)) {
    return res.status(400).json({
      success: false,
      message: 'Query param "level" is required: Beginner | Intermediate | Advanced',
    });
  }

  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const search = req.query.search ? `%${req.query.search.trim()}%` : null;
  const type   = req.query.type ? req.query.type.trim() : null;

  const conditions = [];
  const params     = [];

  if (search) {
    conditions.push('c.title LIKE ?');
    params.push(search);
  }
  if (type) {
    conditions.push('c.course_type = ?');
    params.push(type);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  // ── Count total courses for pagination ──
  const countSql = `SELECT COUNT(DISTINCT c.id) AS total FROM courses c ${where}`;
  db.query(countSql, params, (countErr, countRows) => {
    if (countErr) {
      console.error('[studentCourse] count error:', countErr);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    const total = countRows[0].total;

    // ── Main query ──
    const sql = `
      SELECT
        c.id,
        c.title,
        c.description,
        c.course_type,
        c.chapter,
        c.image_path,
        c.created_at,
        cl.id                AS level_id,
        cl.level,
        cl.video_url,
        cl.video_file_path,
        cl.text_content,
        cl.quiz_note,
        cl.pdf_course,
        cl.pdf_exercice
      FROM courses c
      LEFT JOIN course_levels cl
        ON cl.course_id = c.id AND cl.level = ?
      ${where}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?`;

    db.query(sql, [level, ...params, limit, offset], (err, rows) => {
      if (err) {
        console.error('[studentCourse] fetch error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      const courses = rows.map(row => shapeCourse(row));
      return res.status(200).json({
        success: true,
        level,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        courses,
      });
    });
  });
});

// ━━━ GET SINGLE COURSE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:id', auth, (req, res) => {
  const level    = req.query.level ? req.query.level.trim() : '';
  const courseId = parseInt(req.params.id);

  if (!level || !VALID_LEVELS.includes(level)) {
    return res.status(400).json({
      success: false,
      message: 'Query param "level" is required: Beginner | Intermediate | Advanced',
    });
  }

  if (isNaN(courseId)) {
    return res.status(400).json({ success: false, message: 'Invalid course id' });
  }

  const sql = `
    SELECT
      c.id,
      c.title,
      c.description,
      c.course_type,
      c.chapter,
      c.image_path,
      c.created_at,
      cl.id                AS level_id,
      cl.level,
      cl.video_url,
      cl.video_file_path,
      cl.text_content,
      cl.quiz_note,
      cl.pdf_course,
      cl.pdf_exercice
    FROM courses c
    LEFT JOIN course_levels cl
      ON cl.course_id = c.id AND cl.level = ?
    WHERE c.id = ?
    LIMIT 1`;

  db.query(sql, [level, courseId], (err, rows) => {
    if (err) {
      console.error('[studentCourse] single fetch error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    return res.status(200).json({
      success: true,
      level,
      course: shapeCourse(rows[0]),
    });
  });
});

// ━━━ HELPER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function shapeCourse(row) {
  const hasLevelContent = row.level_id !== null;

  const lesson = hasLevelContent
    ? {
        level:           row.level,
        video_url:       row.video_url || null,
        video_file_path: row.video_file_path || null,
        text_content:    row.text_content || null,
        quiz_note:       row.quiz_note || null,
        pdf_course:      row.pdf_course || null,
        pdf_exercice:    row.pdf_exercice || null,
      }
    : null;

  return {
    id:          row.id,
    title:       row.title,
    description: row.description || null,
    course_type: row.course_type || null,
    image_path:  row.image_path || null,
    created_at:  row.created_at,
    has_content: hasLevelContent,
    chapters: row.chapter
      ? [
          {
            chapter_name: row.chapter,
            lessons: lesson ? [lesson] : [],
          },
        ]
      : [],
  };
}

module.exports = router;