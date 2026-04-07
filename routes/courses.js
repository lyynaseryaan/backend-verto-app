// ============================================================
//  course.js  –  Verto LMS Backend  (MERGED & FIXED)
//  ✅ Cloudinary storage — files survive redeploy
//  ✅ Per-level named file fields (videoFile_Beginner, etc.)
//  ✅ Separate quiz_questions table
//  ✅ ON DUPLICATE KEY with row alias (MySQL 8.0.20+ safe)
//  ✅ Explicit GROUP BY for ONLY_FULL_GROUP_BY mode
//  ✅ Null safety on all string fields in GET /:id
//  ✅ Detailed error logging on every route
//  ✅ Anchored regex in fileFilter
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');
const multer  = require('multer');
const path    = require('path');
const { storage } = require('../config/cloudinary');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MULTER — Cloudinary storage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

// ✅ Anchored regex — prevents partial extension matches
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (file.fieldname === 'image') {
    return /^\.(jpeg|jpg|png|webp)$/.test(ext)
      ? cb(null, true)
      : cb(new Error('Only image files (JPEG, PNG, WEBP) are allowed for thumbnail'));
  }

  if (file.fieldname.startsWith('videoFile_')) {
    return /^\.(mp4|mov|avi|mkv|webm)$/.test(ext)
      ? cb(null, true)
      : cb(new Error('Only video files (MP4, MOV, AVI, MKV, WEBM) are allowed'));
  }

  if (file.fieldname.startsWith('pdfCourse_') || file.fieldname.startsWith('pdfExercise_')) {
    return ext === '.pdf'
      ? cb(null, true)
      : cb(new Error('Only PDF files are allowed'));
  }

  cb(null, true);
};

const upload = multer({
  storage,                                // multer-storage-cloudinary
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 },
});

// Thumbnail — field name: "image"
const uploadCourseImage = upload.single('image');

// ✅ Per-level files using level NAME as suffix — unambiguous, one file per level
// Flutter sends:
//   videoFile_Beginner      pdfCourse_Beginner      pdfExercise_Beginner
//   videoFile_Intermediate  pdfCourse_Intermediate  pdfExercise_Intermediate
//   videoFile_Advanced      pdfCourse_Advanced      pdfExercise_Advanced
const uploadLevelFiles = upload.fields(
  LEVELS.flatMap(lvl => [
    { name: `videoFile_${lvl}`,   maxCount: 1 },
    { name: `pdfCourse_${lvl}`,   maxCount: 1 },
    { name: `pdfExercise_${lvl}`, maxCount: 1 },
  ])
);

// Helper — safely get Cloudinary URL from multer result
// multer-storage-cloudinary stores the URL in file.path
function cloudinaryUrl(files, fieldname) {
  return files?.[fieldname]?.[0]?.path ?? null;
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
//  POST /api/courses — create course
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/', auth, (req, res) => {
  uploadCourseImage(req, res, (uploadErr) => {
    if (uploadErr)
      return res.status(400).json({ success: false, message: uploadErr.message });

    const { title, description, course_type, chapter } = req.body;

    if (!title || title.trim() === '')
      return res.status(400).json({ success: false, message: 'Title is required' });

    const imagePath = req.file ? req.file.path : null; // Cloudinary URL

    db.query(
      `INSERT INTO courses
         (teacher_id, title, description, course_type, chapter, image_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.userId, title.trim(), description || null,
       course_type || null, chapter || null, imagePath],
      (err, result) => {
        if (err) {
          console.error('DB error creating course:', err.sqlMessage || err.message);
          return res.status(500).json({
            success: false,
            message: `Database error: ${err.sqlMessage || err.message}`,
          });
        }
        res.status(201).json({
          success:  true,
          message:  'Course created',
          courseId: result.insertId,
          imagePath,
        });
      }
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/courses — list teacher's courses
//  ✅ Explicit GROUP BY for ONLY_FULL_GROUP_BY sql_mode
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
      COUNT(DISTINCT cl.id) AS levelsCount
    FROM courses c
    LEFT JOIN course_levels cl ON cl.course_id = c.id
    WHERE c.teacher_id = ?
    GROUP BY
      c.id, c.title, c.description, c.course_type,
      c.chapter, c.image_path, c.created_at, c.updated_at
    ORDER BY c.created_at DESC`;

  db.query(sql, [req.userId], (err, rows) => {
    if (err) {
      console.error('=== DB ERROR GET /api/courses ===');
      console.error('Code:', err.code, '| Message:', err.sqlMessage || err.message);
      return res.status(500).json({
        success: false,
        message: `Database error: ${err.sqlMessage || err.message}`,
      });
    }
    res.status(200).json({ success: true, courses: rows });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/courses/:id — course detail + levels + quiz
//  ✅ Null safety on all string fields
//  ✅ Quiz fetched from quiz_questions table
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
      cl.id              AS level_id,
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
      console.error('DB error fetching course detail:', err.sqlMessage || err.message);
      return res.status(500).json({
        success: false,
        message: `Database error: ${err.sqlMessage || err.message}`,
      });
    }
    if (!courseRows.length)
      return res.status(404).json({ success: false, message: 'Course not found' });

    // Fetch all quiz questions belonging to this course's levels
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
        console.error('DB error fetching quiz questions:', err2.sqlMessage || err2.message);
        return res.status(500).json({
          success: false,
          message: `Database error: ${err2.sqlMessage || err2.message}`,
        });
      }

      const first = courseRows[0];
      const course = {
        id:          first.id,
        teacher_id:  first.teacher_id,
        title:       first.title        || '',
        description: first.description  || '',
        course_type: first.course_type  || '',
        chapter:     first.chapter      || '',
        image_path:  first.image_path   || '',
        created_at:  first.created_at,
        updated_at:  first.updated_at,
        levels: courseRows
          .filter(r => r.level_id !== null)
          .map(r => ({
            id:              r.level_id,
            level:           r.level            || '',
            video_url:       r.video_url        || '',
            video_file_path: r.video_file_path  || '',
            text_content:    r.text_content     || '',
            pdf_course:      r.pdf_course       || '',
            pdf_exercise:    r.pdf_exercise     || '',
            quizQuestions: quizRows
              .filter(q => q.course_level_id === r.level_id)
              .map(q => {
                let options = q.options;
                if (typeof options === 'string') {
                  try { options = JSON.parse(options); } catch (_) { options = []; }
                }
                return {
                  id:                 q.id,
                  questionText:       q.question_text,
                  options,
                  correctAnswerIndex: q.correct_answer_index,
                };
              }),
          })),
      };

      res.status(200).json({ success: true, course });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUT /api/courses/:id — update basic info + thumbnail
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
          return res.status(500).json({
            success: false,
            message: `Database error: ${err.sqlMessage || err.message}`,
          });
        if (!rows.length)
          return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });

        const { title, description, course_type, chapter } = req.body;

        // Keep old Cloudinary URL if no new image uploaded
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
            if (err2)
              return res.status(500).json({
                success: false,
                message: `Database error: ${err2.sqlMessage || err2.message}`,
              });
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
//  Relies on ON DELETE CASCADE for course_levels + quiz_questions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/:id', auth, (req, res) => {
  db.query(
    'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
    [req.params.id, req.userId],
    (err, rows) => {
      if (err)
        return res.status(500).json({
          success: false,
          message: `Database error: ${err.sqlMessage || err.message}`,
        });
      if (!rows.length)
        return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });

      db.query('DELETE FROM courses WHERE id = ?', [req.params.id], (err2) => {
        if (err2)
          return res.status(500).json({
            success: false,
            message: `Database error: ${err2.sqlMessage || err2.message}`,
          });
        res.status(200).json({ success: true, message: 'Course deleted' });
      });
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/courses/:id/levels
//
//  Saves all 3 levels + quiz questions in a single request.
//
//  ── MULTIPART FORM FIELDS ──────────────────────────────
//  levels                 JSON string (see structure below)
//  videoFile_Beginner     videoFile_Intermediate     videoFile_Advanced
//  pdfCourse_Beginner     pdfCourse_Intermediate     pdfCourse_Advanced
//  pdfExercise_Beginner   pdfExercise_Intermediate   pdfExercise_Advanced
//
//  ── LEVELS JSON STRUCTURE ──────────────────────────────
//  [
//    {
//      "level": "Beginner",
//      "video_url": "https://youtube.com/...",
//      "text_content": "Lesson text here",
//      "quiz_questions": [
//        {
//          "questionText": "What is X?",
//          "options": ["A","B","C","D"],
//          "correctAnswerIndex": 2
//        }
//      ]
//    },
//    { "level": "Intermediate", ... },
//    { "level": "Advanced", ... }
//  ]
//
//  ── ONE-TIME DB SETUP (run once) ───────────────────────
//  ALTER TABLE course_levels
//    ADD UNIQUE KEY uq_course_level (course_id, level);
//
//  CREATE TABLE IF NOT EXISTS quiz_questions (
//    id                   INT AUTO_INCREMENT PRIMARY KEY,
//    course_level_id      INT NOT NULL,
//    question_text        TEXT NOT NULL,
//    options              JSON NOT NULL,
//    correct_answer_index TINYINT NOT NULL,
//    FOREIGN KEY (course_level_id)
//      REFERENCES course_levels(id) ON DELETE CASCADE
//  );
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:id/levels', auth, (req, res) => {
  uploadLevelFiles(req, res, (uploadErr) => {
    if (uploadErr)
      return res.status(400).json({ success: false, message: uploadErr.message });

    // Parse levels JSON
    let levels;
    try {
      levels = typeof req.body.levels === 'string'
        ? JSON.parse(req.body.levels)
        : req.body.levels;
    } catch (_) {
      return res.status(400).json({ success: false, message: 'levels must be a valid JSON array' });
    }

    if (!Array.isArray(levels) || !levels.length)
      return res.status(400).json({ success: false, message: 'levels array is required' });

    const invalidLevel = levels.find(l => !LEVELS.includes(l.level));
    if (invalidLevel)
      return res.status(400).json({
        success: false,
        message: `level must be one of: ${LEVELS.join(', ')}`,
      });

    // Verify course ownership
    db.query(
      'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
      [req.params.id, req.userId],
      (err, rows) => {
        if (err)
          return res.status(500).json({
            success: false,
            message: `Database error: ${err.sqlMessage || err.message}`,
          });
        if (!rows.length)
          return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });

        const files = req.files || {};

        // Build bulk INSERT values — each level reads its own named file fields
        const levelRows = levels.map(l => {
          const lvl = l.level;
          return [
            req.params.id,
            lvl,
            l.video_url    || null,
            cloudinaryUrl(files, `videoFile_${lvl}`),    // null if not uploaded this request
            l.text_content || null,
            null,                                         // quiz_note column unused — quiz table used instead
            cloudinaryUrl(files, `pdfCourse_${lvl}`),
            cloudinaryUrl(files, `pdfExercise_${lvl}`),
          ];
        });

        // ✅ UPSERT — row alias syntax safe for MySQL 8.0.20+
        // COALESCE keeps the existing Cloudinary URL when no new file is uploaded
        const levelSql = `
          INSERT INTO course_levels
            (course_id, level, video_url, video_file_path,
             text_content, quiz_note, pdf_course, pdf_exercise)
          VALUES ?
          AS new_row
          ON DUPLICATE KEY UPDATE
            video_url       = COALESCE(new_row.video_url,       video_url),
            video_file_path = COALESCE(new_row.video_file_path, video_file_path),
            text_content    = COALESCE(new_row.text_content,    text_content),
            pdf_course      = COALESCE(new_row.pdf_course,      pdf_course),
            pdf_exercise    = COALESCE(new_row.pdf_exercise,    pdf_exercise)`;

        db.query(levelSql, [levelRows], (err2) => {
          if (err2) {
            console.error('DB error saving levels:', err2.sqlMessage || err2.message);
            return res.status(500).json({
              success: false,
              message: `Error saving levels: ${err2.sqlMessage || err2.message}`,
            });
          }

          // Fetch row IDs for the upserted levels to link quiz questions
          db.query(
            `SELECT id, level FROM course_levels
             WHERE course_id = ? AND level IN (?)`,
            [req.params.id, levels.map(l => l.level)],
            (err3, levelIdRows) => {
              if (err3)
                return res.status(500).json({
                  success: false,
                  message: `Error fetching level IDs: ${err3.sqlMessage || err3.message}`,
                });

              // Map level name → DB row id
              const levelMap = {};
              levelIdRows.forEach(r => { levelMap[r.level] = r.id; });

              // Collect quiz question rows and track which levels have new questions
              const quizInserts      = [];
              const levelsWithQuiz   = [];

              levels.forEach(l => {
                const courseLevelId = levelMap[l.level];
                if (courseLevelId && Array.isArray(l.quiz_questions) && l.quiz_questions.length) {
                  levelsWithQuiz.push(courseLevelId);
                  l.quiz_questions.forEach(q => {
                    quizInserts.push([
                      courseLevelId,
                      q.questionText,
                      JSON.stringify(q.options),
                      q.correctAnswerIndex,
                    ]);
                  });
                }
              });

              // Summary of uploaded Cloudinary URLs to return in response
              const uploadedFiles = levels.reduce((acc, l) => {
                const lvl = l.level;
                acc[lvl] = {
                  video_file_path: cloudinaryUrl(files, `videoFile_${lvl}`),
                  pdf_course:      cloudinaryUrl(files, `pdfCourse_${lvl}`),
                  pdf_exercise:    cloudinaryUrl(files, `pdfExercise_${lvl}`),
                };
                return acc;
              }, {});

              // No quiz questions — return early
              if (!quizInserts.length) {
                return res.status(200).json({
                  success:      true,
                  message:      'Levels saved successfully',
                  uploadedFiles,
                });
              }

              // Replace quiz questions for levels that sent new ones
              db.query(
                'DELETE FROM quiz_questions WHERE course_level_id IN (?)',
                [levelsWithQuiz],
                (err4) => {
                  if (err4)
                    return res.status(500).json({
                      success: false,
                      message: `Error clearing old quiz: ${err4.sqlMessage || err4.message}`,
                    });

                  db.query(
                    `INSERT INTO quiz_questions
                       (course_level_id, question_text, options, correct_answer_index)
                     VALUES ?`,
                    [quizInserts],
                    (err5) => {
                      if (err5)
                        return res.status(500).json({
                          success: false,
                          message: `Error saving quiz questions: ${err5.sqlMessage || err5.message}`,
                        });

                      res.status(200).json({
                        success:            true,
                        message:            'Levels and quiz questions saved successfully',
                        uploadedFiles,
                        quizQuestionsCount: quizInserts.length,
                      });
                    }
                  );
                }
              );
            }
          );
        });
      }
    );
  });
});

module.exports = router;