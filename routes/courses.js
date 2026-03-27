const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ─── Middleware: verify token + teacher only ───
function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ success: false, message: 'No token provided' });

  const token = header.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid token' });
    if (decoded.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teachers only' });
    }
    req.userId = decoded.id;
    next();
  });
}

// =============================================
// POST /api/courses — إنشاء كورس + levels
// =============================================
router.post('/', auth, (req, res) => {
  const { title, description, course_type, chapter, levels } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, message: 'Title is required' });
  }

  const sql = `INSERT INTO courses (teacher_id, title, description, course_type, chapter)
               VALUES (?, ?, ?, ?, ?)`;

  db.query(sql, [req.userId, title, description, course_type, chapter], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });

    const courseId = result.insertId;

    // لو ماكانش levels نرجعو مباشرة
    if (!levels || !Array.isArray(levels) || levels.length === 0) {
      return res.status(201).json({ success: true, message: 'Course created', courseId });
    }

    // نضيفو الـ levels
    const levelRows = levels.map(l => [
      courseId,
      l.level,
      l.video_url    || null,
      l.text_content || null,
      l.quiz_note    || null,
    ]);

    db.query(
      'INSERT INTO course_levels (course_id, level, video_url, text_content, quiz_note) VALUES ?',
      [levelRows],
      (err2) => {
        if (err2) return res.status(500).json({ success: false, message: 'Error adding levels' });
        res.status(201).json({ success: true, message: 'Course and levels created', courseId });
      }
    );
  });
});

// =============================================
// GET /api/courses — كل كورسات المعلم
// =============================================
router.get('/', auth, (req, res) => {
  const sql = `
    SELECT c.id, c.title, c.description, c.course_type, c.chapter,
           c.created_at, c.updated_at,
           COUNT(cl.id) AS levels_count
    FROM courses c
    LEFT JOIN course_levels cl ON cl.course_id = c.id
    WHERE c.teacher_id = ?
    GROUP BY c.id
    ORDER BY c.created_at DESC`;

  db.query(sql, [req.userId], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    res.status(200).json({ success: true, courses: rows });
  });
});

// =============================================
// GET /api/courses/:id — تفاصيل كورس واحد
// =============================================
router.get('/:id', auth, (req, res) => {
  const sql = `
    SELECT c.*,
           cl.id AS level_id, cl.level, cl.video_url, cl.text_content, cl.quiz_note
    FROM courses c
    LEFT JOIN course_levels cl ON cl.course_id = c.id
    WHERE c.id = ? AND c.teacher_id = ?`;

  db.query(sql, [req.params.id, req.userId], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const course = {
      id:          rows[0].id,
      teacher_id:  rows[0].teacher_id,
      title:       rows[0].title,
      description: rows[0].description,
      course_type: rows[0].course_type,
      chapter:     rows[0].chapter,
      created_at:  rows[0].created_at,
      updated_at:  rows[0].updated_at,
      levels:      rows
        .filter(r => r.level_id)
        .map(r => ({
          id:           r.level_id,
          level:        r.level,
          video_url:    r.video_url,
          text_content: r.text_content,
          quiz_note:    r.quiz_note,
        })),
    };

    res.status(200).json({ success: true, course });
  });
});

// =============================================
// PUT /api/courses/:id — تعديل كورس
// =============================================
router.put('/:id', auth, (req, res) => {
  const { title, description, course_type, chapter } = req.body;

  // نتحقق إنو الكورس تاعو
  db.query(
    'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
    [req.params.id, req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });
      }

      const sql = `
        UPDATE courses
        SET title       = COALESCE(?, title),
            description = COALESCE(?, description),
            course_type = COALESCE(?, course_type),
            chapter     = COALESCE(?, chapter)
        WHERE id = ? AND teacher_id = ?`;

      db.query(sql,
        [title, description, course_type, chapter, req.params.id, req.userId],
        (err2) => {
          if (err2) return res.status(500).json({ success: false, message: 'Database error' });
          res.status(200).json({ success: true, message: 'Course updated' });
        }
      );
    }
  );
});

// =============================================
// DELETE /api/courses/:id — حذف كورس
// =============================================
router.delete('/:id', auth, (req, res) => {
  db.query(
    'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
    [req.params.id, req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });
      }

      // course_levels تحذف تلقائياً بـ CASCADE
      db.query('DELETE FROM courses WHERE id = ?', [req.params.id], (err2) => {
        if (err2) return res.status(500).json({ success: false, message: 'Database error' });
        res.status(200).json({ success: true, message: 'Course deleted' });
      });
    }
  );
});

// =============================================
// POST /api/courses/:id/levels — إضافة/تحديث levels
// =============================================
router.post('/:id/levels', auth, (req, res) => {
  const { levels } = req.body;

  if (!levels || !Array.isArray(levels) || levels.length === 0) {
    return res.status(400).json({ success: false, message: 'levels array is required' });
  }

  const validLevels = ['Beginner', 'Intermediate', 'Advanced'];
  const invalid = levels.find(l => !validLevels.includes(l.level));
  if (invalid) {
    return res.status(400).json({
      success: false,
      message: 'level must be Beginner, Intermediate, or Advanced'
    });
  }

  db.query(
    'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
    [req.params.id, req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });
      }

      const levelRows = levels.map(l => [
        req.params.id,
        l.level,
        l.video_url    || null,
        l.text_content || null,
        l.quiz_note    || null,
      ]);

      const sql = `
        INSERT INTO course_levels (course_id, level, video_url, text_content, quiz_note)
        VALUES ?
        ON DUPLICATE KEY UPDATE
          video_url    = VALUES(video_url),
          text_content = VALUES(text_content),
          quiz_note    = VALUES(quiz_note)`;

      db.query(sql, [levelRows], (err2) => {
        if (err2) return res.status(500).json({ success: false, message: 'Error saving levels' });
        res.status(200).json({ success: true, message: 'Levels saved' });
      });
    }
  );
});

module.exports = router;