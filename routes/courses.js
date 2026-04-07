// ============================================================
//  routes/courses.js  –  Verto LMS Backend  (MERGED VERSION)
//
//  ✅ Cloudinary storage — fichiers permanents (pas supprimés au redeploy)
//  ✅ Table quiz_questions séparée (version 2)
//  ✅ Chaque niveau a ses propres fichiers : video_file_Beginner, etc.
//  ✅ ON DUPLICATE KEY UPDATE sans COALESCE sur les champs texte
//  ✅ Noms de colonnes snake_case cohérents avec la DB
//  ✅ GET /:id retourne quizQuestions par niveau
//  ✅ DELETE cascade propre
//  ✅ Validation des noms de niveau
// ============================================================

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const { storage } = require('../config/cloudinary');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const VALID_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MULTER — Cloudinary storage
//  Field names use snake_case + level suffix to match Flutter provider
//  e.g.  video_file_Beginner, pdf_course_Intermediate
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

// Single image for course thumbnail
const uploadCourseImage = upload.single('image');

// Per-level file fields
const levelFileFields = [];
for (const lvl of VALID_LEVELS) {
  levelFileFields.push({ name: `video_file_${lvl}`,     maxCount: 1 });
  levelFileFields.push({ name: `pdf_course_${lvl}`,     maxCount: 1 });
  levelFileFields.push({ name: `pdf_exercise_${lvl}`,   maxCount: 1 });
}
const uploadLevelFiles = upload.fields(levelFileFields);

// Helper: safely extract Cloudinary URL from multer files object
function filePath(files, fieldname) {
  if (!files || !files[fieldname] || !files[fieldname][0]) return null;
  return files[fieldname][0].path; // Cloudinary returns full URL in .path
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  JWT MIDDLEWARE — teacher only
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header)
    return res.status(401).json({ success: false, message: 'No token provided' });

  const token = header.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    if (decoded.role !== 'teacher')
      return res.status(403).json({ success: false, message: 'Teachers only' });
    req.userId = decoded.id;
    next();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/courses  —  Create a new course
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/', auth, (req, res) => {
  uploadCourseImage(req, res, (uploadErr) => {
    if (uploadErr)
      return res.status(400).json({ success: false, message: uploadErr.message });

    const { title, description, course_type, chapter } = req.body;

    if (!title || title.trim() === '')
      return res.status(400).json({ success: false, message: 'Title is required' });

    const imagePath = req.file ? req.file.path : null;

    db.query(
      `INSERT INTO courses
         (teacher_id, title, description, course_type, chapter, image_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.userId, title.trim(), description || null,
       course_type || null, chapter || null, imagePath],
      (err, result) => {
        if (err) {
          console.error('DB error creating course:', err);
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.status(201).json({
          success:   true,
          message:   'Course created',
          courseId:  result.insertId,
          imagePath,
        });
      }
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/courses  —  All courses for the authenticated teacher
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/', auth, (req, res) => {
  const sql = `
    SELECT
      c.id,
      c.title,
      c.description,
      c.course_type,
      c.chapter,
      c.image_path,
      c.created_at,
      c.updated_at,
      COUNT(DISTINCT cl.id) AS levels_count
    FROM courses c
    LEFT JOIN course_levels cl ON cl.course_id = c.id
    WHERE c.teacher_id = ?
    GROUP BY c.id
    ORDER BY c.created_at DESC`;

  db.query(sql, [req.userId], (err, rows) => {
    if (err) {
      console.error('DB error fetching courses:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.status(200).json({ success: true, courses: rows });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/courses/:id  —  One course with levels + quiz questions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/:id', auth, (req, res) => {
  const courseSql = `
    SELECT
      c.id,
      c.teacher_id,
      c.title,
      c.description,
      c.course_type,
      c.chapter,
      c.image_path,
      c.created_at,
      c.updated_at,
      cl.id               AS level_id,
      cl.level,
      cl.video_url,
      cl.video_file_path,
      cl.text_content,
      cl.pdf_course,
      cl.pdf_exercise
    FROM courses c
    LEFT JOIN course_levels cl ON cl.course_id = c.id
    WHERE c.id = ? AND c.teacher_id = ?`;

  db.query(courseSql, [req.params.id, req.userId], (err, courseRows) => {
    if (err) {
      console.error('DB error fetching course:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    if (!courseRows.length)
      return res.status(404).json({ success: false, message: 'Course not found' });

    // Fetch quiz questions for all levels of this course
    const quizSql = `
      SELECT
        qq.id,
        qq.course_level_id,
        qq.question_text,
        qq.options,
        qq.correct_answer_index
      FROM quiz_questions qq
      INNER JOIN course_levels cl ON cl.id = qq.course_level_id
      WHERE cl.course_id = ?
      ORDER BY cl.level, qq.id`;

    db.query(quizSql, [req.params.id], (err2, quizRows) => {
      if (err2) {
        console.error('DB error fetching quiz questions:', err2);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      const course = {
        id:          courseRows[0].id,
        teacher_id:  courseRows[0].teacher_id,
        title:       courseRows[0].title,
        description: courseRows[0].description,
        course_type: courseRows[0].course_type,
        chapter:     courseRows[0].chapter,
        image_path:  courseRows[0].image_path,
        created_at:  courseRows[0].created_at,
        updated_at:  courseRows[0].updated_at,
        levels: courseRows
          .filter(r => r.level_id !== null)
          .map(r => ({
            id:              r.level_id,
            level:           r.level,
            video_url:       r.video_url       ?? '',
            video_file_path: r.video_file_path ?? '',
            text_content:    r.text_content    ?? '',
            pdf_course:      r.pdf_course      ?? '',
            pdf_exercise:    r.pdf_exercise    ?? '',
            quizQuestions: quizRows
              .filter(q => q.course_level_id === r.level_id)
              .map(q => ({
                id:                 q.id,
                questionText:       q.question_text,
                options:            (() => {
                  try {
                    return typeof q.options === 'string'
                      ? JSON.parse(q.options)
                      : q.options;
                  } catch (_) { return []; }
                })(),
                correctAnswerIndex: q.correct_answer_index,
              })),
          })),
      };

      res.status(200).json({ success: true, course });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUT /api/courses/:id  —  Update basic info + thumbnail
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.put('/:id', auth, (req, res) => {
  uploadCourseImage(req, res, (uploadErr) => {
    if (uploadErr)
      return res.status(400).json({ success: false, message: uploadErr.message });

    db.query(
      'SELECT id, image_path FROM courses WHERE id = ? AND teacher_id = ?',
      [req.params.id, req.userId],
      (err, rows) => {
        if (err)
          return res.status(500).json({ success: false, message: 'Database error' });
        if (!rows.length)
          return res.status(404).json({
            success: false, message: 'Course not found or unauthorized',
          });

        const { title, description, course_type, chapter } = req.body;

        // Keep old image if no new file uploaded (Cloudinary manages old files)
        const newImagePath = req.file ? req.file.path : rows[0].image_path;

        db.query(
          `UPDATE courses
           SET title       = COALESCE(?, title),
               description = COALESCE(?, description),
               course_type = COALESCE(?, course_type),
               chapter     = COALESCE(?, chapter),
               image_path  = ?
           WHERE id = ? AND teacher_id = ?`,
          [title || null, description || null, course_type || null,
           chapter || null, newImagePath, req.params.id, req.userId],
          (err2) => {
            if (err2) {
              console.error('DB error updating course:', err2);
              return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.status(200).json({
              success:   true,
              message:   'Course updated',
              imagePath: newImagePath,
            });
          }
        );
      }
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DELETE /api/courses/:id
//  Cloudinary files are managed by Cloudinary itself — no local unlink
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.delete('/:id', auth, (req, res) => {
  db.query(
    'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
    [req.params.id, req.userId],
    (err, rows) => {
      if (err)
        return res.status(500).json({ success: false, message: 'Database error' });
      if (!rows.length)
        return res.status(404).json({
          success: false, message: 'Course not found or unauthorized',
        });

      // quiz_questions and course_levels are deleted via DB CASCADE
      db.query('DELETE FROM courses WHERE id = ?', [req.params.id], (err2) => {
        if (err2) {
          console.error('DB error deleting course:', err2);
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.status(200).json({ success: true, message: 'Course deleted' });
      });
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/courses/:id/levels
//
//  ✅ Each level has its own file fields: video_file_Beginner, etc.
//  ✅ Text fields (video_url, text_content) always overwrite (no COALESCE)
//  ✅ File paths keep COALESCE so existing uploads are preserved
//     when no new file is sent for a level
//  ✅ Quiz questions saved to separate quiz_questions table
//     (DELETE existing + re-INSERT on each save)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/:id/levels', auth, (req, res) => {
  uploadLevelFiles(req, res, (uploadErr) => {
    if (uploadErr)
      return res.status(400).json({ success: false, message: uploadErr.message });

    // ── Parse levels payload ────────────────────────────────
    let levels;
    try {
      levels = typeof req.body.levels === 'string'
        ? JSON.parse(req.body.levels)
        : req.body.levels;
    } catch (_) {
      return res.status(400).json({
        success: false, message: 'levels must be a valid JSON array',
      });
    }

    if (!levels || !Array.isArray(levels) || !levels.length)
      return res.status(400).json({ success: false, message: 'levels array is required' });

    // ── Validate level names ────────────────────────────────
    const invalidLevel = levels.find(l => !VALID_LEVELS.includes(l.level));
    if (invalidLevel)
      return res.status(400).json({
        success: false,
        message: `level must be one of: ${VALID_LEVELS.join(', ')}`,
      });

    // ── Verify course ownership ─────────────────────────────
    db.query(
      'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
      [req.params.id, req.userId],
      (err, rows) => {
        if (err)
          return res.status(500).json({ success: false, message: 'Database error' });
        if (!rows.length)
          return res.status(404).json({
            success: false, message: 'Course not found or unauthorized',
          });

        const files = req.files || {};

        // ── Build INSERT rows for course_levels ────────────
        // Each level picks its own files by suffix
        const levelRows = levels.map(l => {
          const lvl = l.level;
          return [
            req.params.id,
            lvl,
            l.video_url    || null,
            filePath(files, `video_file_${lvl}`),
            l.text_content || null,
            filePath(files, `pdf_course_${lvl}`),
            filePath(files, `pdf_exercise_${lvl}`),
          ];
        });

        // ── Upsert course_levels ───────────────────────────
        db.query(
          `INSERT INTO course_levels
             (course_id, level, video_url, video_file_path,
              text_content, pdf_course, pdf_exercise)
           VALUES ?
           ON DUPLICATE KEY UPDATE
             video_url       = VALUES(video_url),
             text_content    = VALUES(text_content),
             video_file_path = COALESCE(VALUES(video_file_path), video_file_path),
             pdf_course      = COALESCE(VALUES(pdf_course),      pdf_course),
             pdf_exercise    = COALESCE(VALUES(pdf_exercise),    pdf_exercise)`,
          [levelRows],
          (err2) => {
            if (err2) {
              console.error('DB error saving levels:', err2);
              return res.status(500).json({ success: false, message: 'Error saving levels' });
            }

            // ── Fetch level IDs to link quiz questions ─────
            db.query(
              'SELECT id, level FROM course_levels WHERE course_id = ? AND level IN (?)',
              [req.params.id, levels.map(l => l.level)],
              (err3, levelIds) => {
                if (err3)
                  return res.status(500).json({ success: false, message: 'Error fetching level IDs' });

                // Map level name → DB id
                const levelMap = {};
                levelIds.forEach(r => { levelMap[r.level] = r.id; });

                // ── Build quiz inserts ─────────────────────
                const quizInserts = [];
                levels.forEach(level => {
                  const courseLevelId = levelMap[level.level];
                  if (!courseLevelId) return;

                  const questions = level.quiz_questions;
                  if (!Array.isArray(questions) || !questions.length) return;

                  questions.forEach(q => {
                    quizInserts.push([
                      courseLevelId,
                      q.questionText,
                      JSON.stringify(q.options),
                      q.correctAnswerIndex,
                    ]);
                  });
                });

                // Collect uploaded file URLs to return to Flutter
                const uploadedFiles = levels.reduce((acc, l) => {
                  const lvl = l.level;
                  acc[lvl] = {
                    video_file_path: filePath(files, `video_file_${lvl}`),
                    pdf_course:      filePath(files, `pdf_course_${lvl}`),
                    pdf_exercise:    filePath(files, `pdf_exercise_${lvl}`),
                  };
                  return acc;
                }, {});

                // No quiz questions to save → done
                if (!quizInserts.length) {
                  return res.status(200).json({
                    success:       true,
                    message:       'Levels saved successfully',
                    uploadedFiles,
                  });
                }

                // ── Replace quiz questions (DELETE + INSERT) ─
                db.query(
                  'DELETE FROM quiz_questions WHERE course_level_id IN (?)',
                  [Object.values(levelMap)],
                  (err4) => {
                    if (err4)
                      return res.status(500).json({ success: false, message: 'Error updating quiz' });

                    db.query(
                      `INSERT INTO quiz_questions
                         (course_level_id, question_text, options, correct_answer_index)
                       VALUES ?`,
                      [quizInserts],
                      (err5) => {
                        if (err5)
                          return res.status(500).json({ success: false, message: 'Error saving quiz' });

                        res.status(200).json({
                          success:             true,
                          message:             'Levels and quiz saved successfully',
                          uploadedFiles,
                          quizQuestionsCount:  quizInserts.length,
                        });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

module.exports = router;

