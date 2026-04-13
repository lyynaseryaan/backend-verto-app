// ============================================================
//  routes/courses.js  –  Verto LMS Backend
//  ✅ Quiz يُحفظ في: quizzes + quizinstructor_question + quiz_options
//  ✅ كل باقي الكود محفوظ كما هو
// ============================================================

const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const jwt         = require('jsonwebtoken');
const multer      = require('multer');
const { storage } = require('../config/cloudinary');

const VALID_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

// ━━━ MULTER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
});

const uploadCourseImage = upload.single('thumbnailFile');

const levelFileFields = [];
for (const lvl of VALID_LEVELS) {
  levelFileFields.push({ name: `videoFile_${lvl}`,       maxCount: 1 });
  levelFileFields.push({ name: `pdfCourseFile_${lvl}`,   maxCount: 1 });
  levelFileFields.push({ name: `pdfExerciseFile_${lvl}`, maxCount: 1 });
}
const uploadLevelFiles = upload.fields(levelFileFields);

function fileUrl(files, fieldname) {
  if (!files || !files[fieldname] || !files[fieldname][0]) return null;
  return files[fieldname][0].path;
}

// ━━━ JWT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

// ━━━ POST /api/courses ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/', auth, (req, res) => {
  uploadCourseImage(req, res, (uploadErr) => {
    if (uploadErr)
      return res.status(400).json({ success: false, message: uploadErr.message });

    const { title, description } = req.body;
    const courseType = req.body.courseType || req.body.course_type || null;
    const chapter    = req.body.chapter    || null;

    if (!title || title.trim() === '')
      return res.status(400).json({ success: false, message: 'Title is required' });

    const imagePath = req.file ? req.file.path : null;

    db.query(
      `INSERT INTO courses
         (teacher_id, title, description, course_type, chapter, image_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.userId, title.trim(), description || null,
       courseType, chapter, imagePath],
      (err, result) => {
        if (err) {
          console.error('DB error creating course:', err);
          return res.status(500).json({ success: false, message: 'Database error' });
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

// ━━━ GET /api/courses ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/', auth, (req, res) => {
  const sql = `
    SELECT
      c.id,
      c.title,
      c.description,
      c.course_type   AS courseType,
      c.chapter,
      c.image_path    AS imagePath,
      c.created_at    AS createdAt,
      c.updated_at    AS updatedAt,
      COUNT(DISTINCT cl.id) AS levelsCount
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

// ━━━ GET /api/courses/:id ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:id', auth, (req, res) => {
  const courseSql = `
    SELECT
      c.id,
      c.teacher_id    AS teacherId,
      c.title,
      c.description,
      c.course_type   AS courseType,
      c.chapter,
      c.image_path    AS imagePath,
      c.created_at    AS createdAt,
      c.updated_at    AS updatedAt,
      cl.id               AS levelId,
      cl.level,
      cl.video_url        AS videoUrl,
      cl.video_file_path  AS videoFilePath,
      cl.text_content     AS textContent,
      cl.quiz_note        AS quizNote,
      cl.pdf_course       AS pdfCourse,
      cl.pdf_exercise     AS pdfExercise
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

    const base = courseRows[0];
    const course = {
      id:          base.id,
      teacherId:   base.teacherId,
      title:       base.title,
      description: base.description,
      courseType:  base.courseType,
      chapter:     base.chapter,
      imagePath:   base.imagePath,
      createdAt:   base.createdAt,
      updatedAt:   base.updatedAt,
      levels: courseRows
        .filter(r => r.levelId !== null)
        .map(r => ({
          id:            r.levelId,
          level:         r.level,
          videoUrl:      r.videoUrl      ?? '',
          videoFilePath: r.videoFilePath ?? '',
          textContent:   r.textContent   ?? '',
          quizNote:      r.quizNote      ?? '',
          pdfCourse:     r.pdfCourse     ?? '',
          pdfExercise:   r.pdfExercise   ?? '',
          quizQuestions: [],
        })),
    };

    // ✅ جيب quiz من الجداول الجديدة
    const quizSql = `
      SELECT
        qz.id              AS quizId,
        qz.level_course_id AS levelCourseId,
        qz.title           AS quizTitle,
        qq.id              AS questionId,
        qq.question_text   AS questionText,
        qo.id              AS optionId,
        qo.option_text     AS optionText,
        qo.is_correct      AS isCorrect
      FROM quizzes qz
      LEFT JOIN quizinstructor_question qq ON qq.quiz_id      = qz.id
      LEFT JOIN quiz_options            qo ON qo.question_id  = qq.id
      INNER JOIN course_levels cl ON cl.id = qz.level_course_id
      WHERE cl.course_id = ?
      ORDER BY qz.level_course_id, qq.id, qo.id`;

    db.query(quizSql, [req.params.id], (err2, quizRows) => {
      if (err2) {
        console.warn('Quiz fetch failed:', err2.message);
        return res.status(200).json({ success: true, course });
      }

      if (quizRows && quizRows.length) {
        // نبني map: levelCourseId → quiz object
        const quizMap = {};
        quizRows.forEach(row => {
          const lid = row.levelCourseId;
          if (!quizMap[lid]) {
            quizMap[lid] = {
              id:        row.quizId,
              title:     row.quizTitle,
              questions: [],
            };
          }
          if (!row.questionId) return;
          let q = quizMap[lid].questions.find(x => x.id === row.questionId);
          if (!q) {
            q = { id: row.questionId, questionText: row.questionText, options: [] };
            quizMap[lid].questions.push(q);
          }
          if (row.optionId) {
            q.options.push({
              id:          row.optionId,
              optionText:  row.optionText,
              isCorrect:   row.isCorrect === 1,
            });
          }
        });

        // ألحق الـ quiz بكل level
        course.levels.forEach(level => {
          if (quizMap[level.id]) {
            level.quiz = quizMap[level.id];
          }
        });
      }

      res.status(200).json({ success: true, course });
    });
  });
});

// ━━━ PUT /api/courses/:id ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

        const { title, description } = req.body;
        const courseType = req.body.courseType || req.body.course_type || null;
        const chapter    = req.body.chapter    || null;
        const newImagePath = req.file ? req.file.path : rows[0].image_path;

        db.query(
          `UPDATE courses
           SET title       = COALESCE(?, title),
               description = COALESCE(?, description),
               course_type = COALESCE(?, course_type),
               chapter     = COALESCE(?, chapter),
               image_path  = ?
           WHERE id = ? AND teacher_id = ?`,
          [title || null, description || null, courseType,
           chapter, newImagePath, req.params.id, req.userId],
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

// ━━━ DELETE /api/courses/:id ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

// ━━━ POST /api/courses/:id/levels ━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:id/levels', auth, (req, res) => {
  uploadLevelFiles(req, res, (uploadErr) => {
    if (uploadErr)
      return res.status(400).json({ success: false, message: uploadErr.message });

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

    const invalidLevel = levels.find(l => !VALID_LEVELS.includes(l.level));
    if (invalidLevel)
      return res.status(400).json({
        success: false,
        message: `level must be one of: ${VALID_LEVELS.join(', ')}`,
      });

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

        const levelRows = levels.map(l => {
          const lvl = l.level;
          return [
            req.params.id,
            lvl,
            l.videoUrl    || null,
            fileUrl(files, `videoFile_${lvl}`),
            l.textContent || null,
            null,                                      // ✅ quiz_note = null دائماً
            fileUrl(files, `pdfCourseFile_${lvl}`),
            fileUrl(files, `pdfExerciseFile_${lvl}`),
          ];
        });

        // ── Upsert course_levels ──────────────────────────
        db.query(
          `INSERT INTO course_levels
             (course_id, level, video_url, video_file_path,
              text_content, quiz_note, pdf_course, pdf_exercise)
           VALUES ?
           ON DUPLICATE KEY UPDATE
             video_url       = VALUES(video_url),
             text_content    = VALUES(text_content),
             quiz_note       = NULL,
             video_file_path = COALESCE(VALUES(video_file_path), video_file_path),
             pdf_course      = COALESCE(VALUES(pdf_course),      pdf_course),
             pdf_exercise    = COALESCE(VALUES(pdf_exercise),    pdf_exercise)`,
          [levelRows],
          (err2) => {
            if (err2) {
              console.error('DB error saving levels:', err2);
              return res.status(500).json({ success: false, message: 'Error saving levels' });
            }

            // ── جيب الـ level IDs ─────────────────────────
            db.query(
              'SELECT id, level FROM course_levels WHERE course_id = ? AND level IN (?)',
              [req.params.id, levels.map(l => l.level)],
              (err3, levelIds) => {
                if (err3) {
                  console.warn('Could not fetch level IDs:', err3.message);
                  return res.status(200).json({
                    success: true,
                    message: 'Levels saved. Quiz skipped.',
                  });
                }

                const levelMap = {};
                levelIds.forEach(r => { levelMap[r.level] = r.id; });

                // ── تحقق إذا في quiz_questions في الـ payload ──
                const hasQuiz = levels.some(
                  l => Array.isArray(l.quiz_questions) && l.quiz_questions.length > 0
                );

                if (!hasQuiz) {
                  return res.status(200).json({
                    success: true,
                    message: 'Levels saved successfully',
                  });
                }

                // ── احفظ Quiz في الجداول الجديدة ─────────────
                // نعالج كل level اللي عندها quiz بشكل متسلسل
                const levelsWithQuiz = levels.filter(
                  l => Array.isArray(l.quiz_questions) && l.quiz_questions.length > 0
                );

                let processed = 0;

                const saveNextLevel = (index) => {
                  if (index >= levelsWithQuiz.length) {
                    // كل الـ levels اتحفظت
                    return res.status(200).json({
                      success: true,
                      message: 'Levels and quiz saved successfully',
                    });
                  }

                  const levelData      = levelsWithQuiz[index];
                  const courseLevelId  = levelMap[levelData.level];
                  if (!courseLevelId) return saveNextLevel(index + 1);

                  const quizTitle = levelData.quizTitle || 'Quiz';

                  // 1. احذف الـ quiz القديم لهذا الـ level (cascade يحذف questions + options)
                  db.query(
                    'DELETE FROM quizzes WHERE level_course_id = ?',
                    [courseLevelId],
                    (err4) => {
                      if (err4) {
                        console.warn('Delete old quiz failed:', err4.message);
                        return saveNextLevel(index + 1);
                      }

                      // 2. أنشئ quiz جديد
                      db.query(
                        'INSERT INTO quizzes (level_course_id, title) VALUES (?, ?)',
                        [courseLevelId, quizTitle],
                        (err5, quizResult) => {
                          if (err5) {
                            console.warn('Insert quiz failed:', err5.message);
                            return saveNextLevel(index + 1);
                          }

                          const quizId    = quizResult.insertId;
                          const questions = levelData.quiz_questions;
                          let   qIndex    = 0;

                          // 3. احفظ كل سؤال مع خياراته بشكل متسلسل
                          const saveNextQuestion = (qi) => {
                            if (qi >= questions.length) {
                              return saveNextLevel(index + 1);
                            }

                            const q = questions[qi];

                            db.query(
                              'INSERT INTO quizinstructor_question (quiz_id, question_text) VALUES (?, ?)',
                              [quizId, q.questionText],
                              (err6, qResult) => {
                                if (err6) {
                                  console.warn('Insert question failed:', err6.message);
                                  return saveNextQuestion(qi + 1);
                                }

                                const questionId = qResult.insertId;
                                const options    = q.options || [];

                                if (!options.length) {
                                  return saveNextQuestion(qi + 1);
                                }

                                // 4. احفظ الخيارات دفعة واحدة
                                const optionRows = options.map(o => [
                                  questionId,
                                  o.optionText,
                                  o.isCorrect ? 1 : 0,
                                ]);

                                db.query(
                                  'INSERT INTO quiz_options (question_id, option_text, is_correct) VALUES ?',
                                  [optionRows],
                                  (err7) => {
                                    if (err7) {
                                      console.warn('Insert options failed:', err7.message);
                                    }
                                    saveNextQuestion(qi + 1);
                                  }
                                );
                              }
                            );
                          };

                          saveNextQuestion(0);
                        }
                      );
                    }
                  );
                };

                saveNextLevel(0);
              }
            );
          }
        );
      }
    );
  });
});

module.exports = router;