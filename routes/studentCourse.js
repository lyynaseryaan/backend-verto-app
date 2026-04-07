// ============================================================
//  routes/studentCourse.js  –  Verto LMS
//  Fixes:
//    ✅ Full URLs for video_file_path, pdf_course, pdf_exercise, image_path
//    ✅ YouTube URLs returned as-is (open externally in Flutter)
//    ✅ Local video files get full URL (play inside app with Chewie)
//    ✅ All courses returned (old + new) — no content filtering at course level
//    ✅ video_type field added: "youtube" | "local" | null
// ============================================================
//fi khatr lyynnaaa
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  AUTH MIDDLEWARE
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
//  HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Builds a full URL from a relative path stored in DB
// e.g. "uploads/courses/videos/file.mp4"
//   → "https://backend-verto-app.onrender.com/uploads/courses/videos/file.mp4"
function buildFullUrl(req, filePath) {
  if (!filePath) return null;

  // Already a full URL (YouTube, external CDN, etc.) — return as-is
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }

  // Normalize backslashes (Windows paths) and strip leading slashes
  const clean = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${req.protocol}://${req.get('host')}/${clean}`;
}

// Detects whether a video path is a YouTube link or a local file
// Returns: "youtube" | "local" | null
function videoType(url) {
  if (!url) return null;
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  return 'local';
}

// Shapes one DB row into the course response object
function shapeCourse(row, req) {
  const hasLevelContent = row.level_id !== null;

  // ── Video logic ──────────────────────────────────────────
  // video_url   → YouTube or any external URL  (open externally)
  // video_file_path → local MP4 upload         (play inside app)
  const youtubeUrl   = row.video_url        || null;   // external
  const localVideoUrl = row.video_file_path             // local — needs full URL
    ? buildFullUrl(req, row.video_file_path)
    : null;

  const lesson = hasLevelContent
    ? {
        level:            row.level,

        // ── Video ──
        video_url:        youtubeUrl,          // YouTube / external → open in browser
        video_type_url:   videoType(youtubeUrl),  // "youtube" | "local" | null

        video_file_path:  localVideoUrl,          // local MP4 → play with Chewie
        video_type_file:  localVideoUrl ? 'local' : null,

        // ── Text ──
        text_content:     row.text_content    || null,
        quiz_note:        row.quiz_note       || null,

        // ── PDFs — always full URLs ──
        pdf_course:       buildFullUrl(req, row.pdf_course)   || null,
        pdf_exercise:     buildFullUrl(req, row.pdf_exercise) || null,
      }
    : null;

 // Inside routes/studentCourse.js - Change the return in shapeCourse:

return {
    id:          row.id,
    title:       row.title,
    description: row.description  || null,
    course_type: row.course_type  || null,
    image_path:  buildFullUrl(req, row.image_path) || null,
    created_at:  row.created_at,
    
    // CRITICAL: Ensure this is true if ANY content exists for this level
    has_content: row.level_id !== null, 

    chapters: row.chapter && row.level_id ? [{
          chapter_name: row.chapter,
          lessons: lesson ? [lesson] : [],
        }] : [],
};
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/courses
//  Returns ALL courses, with content filtered by student level.
//  Courses that have no content for that level are still returned
//  (has_content: false, lessons: []) so the student can see them.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/', auth, (req, res) => {
  const level = (req.query.level || '').trim();

  if (!level || !VALID_LEVELS.includes(level)) {
    return res.status(400).json({
      success: false,
      message: 'Query param "level" is required: Beginner | Intermediate | Advanced',
    });
  }

  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  // Optional filters
  const search = req.query.search ? `%${req.query.search.trim()}%` : null;
  const type   = req.query.type   ? req.query.type.trim()          : null;

  // Build WHERE conditions for courses table only
  const conditions  = [];
  const filterParams = [];

  if (search) { conditions.push('c.title LIKE ?');    filterParams.push(search); }
  if (type)   { conditions.push('c.course_type = ?'); filterParams.push(type);   }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  // Count total courses (ignoring level — we want ALL courses)
  const countSql = `SELECT COUNT(DISTINCT c.id) AS total FROM courses c ${where}`;

  db.query(countSql, filterParams, (countErr, countRows) => {
    if (countErr) {
      console.error('[studentCourse] count error:', countErr);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    const total = countRows[0].total;

    // ── Main query ───────────────────────────────────────────
    // LEFT JOIN on BOTH course_id AND level
    // → every course row is returned
    // → cl columns are NULL when no content exists for that level
    const sql = `
      SELECT
        c.id,
        c.title,
        c.description,
        c.course_type,
        c.chapter,
        c.image_path,
        c.created_at,
        cl.id               AS level_id,
        cl.level,
        cl.video_url,
        cl.video_file_path,
        cl.text_content,
        cl.quiz_note,
        cl.pdf_course,
        cl.pdf_exercise
      FROM courses c
      LEFT JOIN course_levels cl
        ON cl.course_id = c.id
        AND cl.level = ?
      ${where}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?`;

    // Order of params: level (for JOIN), filter params, pagination
    const params = [level, ...filterParams, limit, offset];

    db.query(sql, params, (err, rows) => {
      if (err) {
        console.error('[studentCourse] fetch error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      return res.status(200).json({
        success: true,
        level,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        courses: rows.map(row => shapeCourse(row, req)),
      });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/courses/:id
//  Returns a single course with content for the given level.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:id', auth, (req, res) => {
  const level    = (req.query.level || '').trim();
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
      cl.id               AS level_id,
      cl.level,
      cl.video_url,
      cl.video_file_path,
      cl.text_content,
      cl.quiz_note,
      cl.pdf_course,
      cl.pdf_exercise
    FROM courses c
    LEFT JOIN course_levels cl
      ON cl.course_id = c.id
      AND cl.level = ?
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
      course: shapeCourse(rows[0], req),
    });
  });
});

module.exports = router;