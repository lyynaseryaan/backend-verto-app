// ============================================================
//  studentCourse.js  –  Verto LMS
//  Student-side course routes (read-only)
//  Base path: /api/student/courses
//
//  Routes:
//    GET /api/student/courses          → all courses (filtered by level)
//    GET /api/student/courses/:id      → single course detail
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  JWT MIDDLEWARE — any logged-in user (student or teacher)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/courses
//  Returns all courses with content filtered by student level.
//
//  Query params:
//    level  – "Beginner" | "Intermediate" | "Advanced"  (required)
//    page   – page number, default 1
//    limit  – items per page, default 20 (max 50)
//    search – optional search term (filters by course title)
//    type   – optional filter by course_type (e.g. "Science")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/', auth, (req, res) => {
  const level = req.query.level;

  if (!level || !VALID_LEVELS.includes(level)) {
    return res.status(400).json({
      success: false,
      message: 'Query param "level" is required: Beginner | Intermediate | Advanced',
    });
  }

  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const search = req.query.search ? `%${req.query.search}%` : null;
  const type   = req.query.type   || null;

  // ── Build WHERE clause dynamically ──────────────────────
  const conditions = [];
  const countParams = [];
  const mainParams  = [];

  if (search) {
    conditions.push('c.title LIKE ?');
    countParams.push(search);
    mainParams.push(search);
  }
  if (type) {
    conditions.push('c.course_type = ?');
    countParams.push(type);
    mainParams.push(type);
  }

  const where = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // ── Count total for pagination meta ─────────────────────
  const countSql = `SELECT COUNT(DISTINCT c.id) AS total FROM courses c ${where}`;

  db.query(countSql, countParams, (countErr, countRows) => {
    if (countErr) {
      console.error('[studentCourse] count error:', countErr);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    const total = countRows[0].total;

    // ── Main query ───────────────────────────────────────
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

    // level comes first (for the JOIN), then search/type filters, then pagination
    const params = [level, ...mainParams, limit, offset];

    db.query(sql, params, (err, rows) => {
      if (err) {
        console.error('[studentCourse] fetch error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      const courses = rows.map(row => _shapeCourse(row));

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/courses/:id
//  Returns a single course with content for the given level.
//
//  Query params:
//    level  – required (same as above)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:id', auth, (req, res) => {
  const level    = req.query.level;
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

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    return res.status(200).json({
      success: true,
      level,
      course: _shapeCourse(rows[0]),
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HELPER — shapes a DB row into the API response format
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function _shapeCourse(row) {
  const hasLevelContent = row.level_id !== null;

  const lesson = hasLevelContent
    ? {
        level:           row.level,
        video_url:       row.video_url        || null,
        video_file_path: row.video_file_path  || null,
        text_content:    row.text_content     || null,
        quiz_note:       row.quiz_note        || null,
        pdf_course:      row.pdf_course       || null,
        pdf_exercice:    row.pdf_exercice     || null,
      }
    : null;

  return {
    id:          row.id,
    title:       row.title,
    description: row.description  || null,
    course_type: row.course_type  || null,
    image_path:  row.image_path   || null,
    created_at:  row.created_at,
    has_content: hasLevelContent,   // ← Flutter يستخدمها لإظهار lock icon
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