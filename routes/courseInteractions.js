// ============================================================
//  routes/courseInteractions.js  –  Verto LMS
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');
const NotificationService = require('../services/notificationService');

// ━━━ AUTH ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /:courseId/interactions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:courseId/interactions', auth, (req, res) => {
  const courseId = parseInt(req.params.courseId);
  if (isNaN(courseId))
    return res.status(400).json({ success: false, message: 'Invalid course id' });

  const userId = req.userId;
  let done = 0, hasError = false;
  const data = {};

  function finish() {
    if (hasError) return;
    done++;
    if (done < 4) return;
    return res.status(200).json({
      success:        true,
      likes_count:    data.likesCount,
      is_liked:       data.isLiked,
      avg_rating:     data.avgRating,
      ratings_count:  data.ratingsCount,
      user_rating:    data.userRating,
      comments_count: data.commentsCount,
    });
  }

  db.query('SELECT COUNT(*) AS cnt FROM likes WHERE course_id = ?', [courseId],
    (err, rows) => { if (err) { hasError = true; return res.status(500).json({ success: false, message: 'DB error' }); } data.likesCount = rows[0].cnt; finish(); });

  db.query('SELECT id FROM likes WHERE course_id = ? AND student_id = ? LIMIT 1', [courseId, userId],
    (err, rows) => { if (err) { hasError = true; return res.status(500).json({ success: false, message: 'DB error' }); } data.isLiked = rows.length > 0; finish(); });

  db.query(
    'SELECT COUNT(*) AS cnt, AVG(rating_value) AS avg_val, MAX(CASE WHEN student_id = ? THEN rating_value ELSE NULL END) AS user_val FROM ratings WHERE course_id = ?',
    [userId, courseId],
    (err, rows) => {
      if (err) { hasError = true; return res.status(500).json({ success: false, message: 'DB error' }); }
      data.ratingsCount = rows[0].cnt;
      data.avgRating    = rows[0].avg_val ? parseFloat(parseFloat(rows[0].avg_val).toFixed(1)) : 0;
      data.userRating   = rows[0].user_val || 0;
      finish();
    });

  db.query('SELECT COUNT(*) AS cnt FROM comments WHERE course_id = ?', [courseId],
    (err, rows) => { if (err) { hasError = true; return res.status(500).json({ success: false, message: 'DB error' }); } data.commentsCount = rows[0].cnt; finish(); });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /:courseId/like  ✅ + notify teacher
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:courseId/like', auth, (req, res) => {
  const courseId = parseInt(req.params.courseId);
  if (isNaN(courseId))
    return res.status(400).json({ success: false, message: 'Invalid course id' });

  const userId = req.userId;

  db.query('SELECT id FROM likes WHERE course_id = ? AND student_id = ? LIMIT 1', [courseId, userId], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });

    const alreadyLiked = rows.length > 0;
    const toggleSql    = alreadyLiked
      ? 'DELETE FROM likes WHERE course_id = ? AND student_id = ?'
      : 'INSERT INTO likes (student_id, course_id) VALUES (?, ?)';
    const toggleParams = alreadyLiked ? [courseId, userId] : [userId, courseId];

    db.query(toggleSql, toggleParams, (err2) => {
      if (err2) return res.status(500).json({ success: false, message: 'Database error' });

      // ✅ Notify teacher on like (not unlike)
      if (!alreadyLiked) {
        db.query(
          'SELECT c.teacher_id, c.title, u.name AS sname FROM courses c INNER JOIN users u ON u.id = ? WHERE c.id = ?',
          [userId, courseId],
          (errN, rowsN) => {
            if (!errN && rowsN.length) {
              const { teacher_id, title, sname } = rowsN[0];
              NotificationService.create(
                teacher_id, 'course_liked',
                'New Like ❤️',
                `${sname} liked your course "${title}"`
              ).catch(() => {});
            }
          }
        );
      }

      db.query('SELECT COUNT(*) AS cnt FROM likes WHERE course_id = ?', [courseId], (err3, countRows) => {
        if (err3) return res.status(500).json({ success: false, message: 'Database error' });
        return res.status(200).json({ success: true, is_liked: !alreadyLiked, likes_count: countRows[0].cnt });
      });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /:courseId/rate  ✅ + notify teacher
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:courseId/rate', auth, (req, res) => {
  const courseId    = parseInt(req.params.courseId);
  const ratingValue = parseInt(req.body.rating_value);
  if (isNaN(courseId)) return res.status(400).json({ success: false, message: 'Invalid course id' });
  if (isNaN(ratingValue) || ratingValue < 1 || ratingValue > 5)
    return res.status(400).json({ success: false, message: 'rating_value must be 1–5' });

  const userId = req.userId;

  db.query('SELECT id FROM ratings WHERE course_id = ? AND student_id = ? LIMIT 1', [courseId, userId], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });

    const sql    = rows.length > 0
      ? 'UPDATE ratings SET rating_value = ? WHERE course_id = ? AND student_id = ?'
      : 'INSERT INTO ratings (rating_value, course_id, student_id) VALUES (?, ?, ?)';

    db.query(sql, [ratingValue, courseId, userId], (err2) => {
      if (err2) return res.status(500).json({ success: false, message: 'Database error' });

      // ✅ Notify teacher
      db.query(
        'SELECT c.teacher_id, c.title, u.name AS sname FROM courses c INNER JOIN users u ON u.id = ? WHERE c.id = ?',
        [userId, courseId],
        (errN, rowsN) => {
          if (!errN && rowsN.length) {
            const { teacher_id, title, sname } = rowsN[0];
            NotificationService.create(
              teacher_id, 'course_rated',
              `New Rating ${'⭐'.repeat(ratingValue)}`,
              `${sname} rated your course "${title}" ${ratingValue}/5`
            ).catch(() => {});
          }
        }
      );

      db.query('SELECT COUNT(*) AS cnt, AVG(rating_value) AS avg_val FROM ratings WHERE course_id = ?', [courseId], (err3, stats) => {
        if (err3) return res.status(500).json({ success: false, message: 'Database error' });
        return res.status(200).json({
          success: true,
          user_rating:   ratingValue,
          avg_rating:    parseFloat(parseFloat(stats[0].avg_val || 0).toFixed(1)),
          ratings_count: stats[0].cnt,
        });
      });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /:courseId/comments
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:courseId/comments', auth, (req, res) => {
  const courseId = parseInt(req.params.courseId);
  if (isNaN(courseId)) return res.status(400).json({ success: false, message: 'Invalid course id' });

  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  db.query(
    `SELECT c.id, c.comment_text, c.created_at, c.student_id,
            COALESCE(u.name, CONCAT('Student #', c.student_id)) AS student_name
     FROM comments c LEFT JOIN users u ON u.id = c.student_id
     WHERE c.course_id = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [courseId, limit, offset],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      db.query('SELECT COUNT(*) AS cnt FROM comments WHERE course_id = ?', [courseId], (err2, countRows) => {
        if (err2) return res.status(500).json({ success: false, message: 'Database error' });
        const total = countRows[0].cnt;
        return res.status(200).json({
          success: true, total, page,
          total_pages: Math.ceil(total / limit),
          comments: rows.map(r => ({
            id: r.id, student_id: r.student_id,
            student_name: r.student_name,
            comment_text: r.comment_text,
            created_at: r.created_at,
          })),
        });
      });
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /:courseId/comments  ✅ + notify teacher
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:courseId/comments', auth, (req, res) => {
  const courseId    = parseInt(req.params.courseId);
  const commentText = (req.body.comment_text || '').trim();
  if (isNaN(courseId)) return res.status(400).json({ success: false, message: 'Invalid course id' });
  if (!commentText || commentText.length < 2) return res.status(400).json({ success: false, message: 'comment_text required (min 2 chars)' });
  if (commentText.length > 1000) return res.status(400).json({ success: false, message: 'comment_text too long' });

  const userId = req.userId;

  db.query('INSERT INTO comments (student_id, course_id, comment_text) VALUES (?, ?, ?)', [userId, courseId, commentText], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });

    // ✅ Notify teacher
    db.query(
      'SELECT c.teacher_id, c.title, u.name AS sname FROM courses c INNER JOIN users u ON u.id = ? WHERE c.id = ?',
      [userId, courseId],
      (errN, rowsN) => {
        if (!errN && rowsN.length) {
          const { teacher_id, title, sname } = rowsN[0];
          NotificationService.create(
            teacher_id, 'new_comment',
            'New Comment 💬',
            `${sname} commented on "${title}": ${commentText.substring(0, 60)}${commentText.length > 60 ? '...' : ''}`
          ).catch(() => {});
        }
      }
    );

    db.query(
      `SELECT c.id, c.comment_text, c.created_at, c.student_id,
              COALESCE(u.name, CONCAT('Student #', c.student_id)) AS student_name
       FROM comments c LEFT JOIN users u ON u.id = c.student_id WHERE c.id = ?`,
      [result.insertId],
      (err2, rows) => {
        if (err2 || !rows.length) {
          return res.status(201).json({
            success: true,
            comment: { id: result.insertId, comment_text: commentText, created_at: new Date(), student_id: userId, student_name: 'You' }
          });
        }
        const r = rows[0];
        return res.status(201).json({
          success: true,
          comment: { id: r.id, student_id: r.student_id, student_name: r.student_name, comment_text: r.comment_text, created_at: r.created_at }
        });
      }
    );
  });
});

module.exports = router;