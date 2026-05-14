// ============================================================
//  routes/courses.js  –  Verto LMS Backend  (FIXED)
//
//  ✅ FIX 1: POST / uses field name 'thumbnailFile' (matches Flutter multer config)
//  ✅ FIX 2: PUT /:id uses field name 'thumbnailFile'
//  ✅ FIX 3: POST /:id/levels uses per-level field names matching Flutter:
//            videoFile_Beginner, pdfCourseFile_Beginner, pdfExerciseFile_Beginner
//  ✅ FIX 4: levels JSON keys match Flutter LevelPayload.toJson():
//            videoUrl, textContent, quizNote  (camelCase)
//  ✅ FIX 5: quiz_questions save wrapped in try/catch — DB error won't crash the whole request
//  ✅ FIX 6: GET /api/courses returns camelCase aliases so Flutter CourseModel works
//  ✅ FIX 7: GET /api/courses/:id returns camelCase aliases so Flutter CourseDetailModel works
//  ✅ FIX 8: POST / and PUT /:id accept both courseType and course_type from Flutter
//  ✅ FIX 9: GET /api/courses/all — All courses (no teacher filter), accessible by admin & teacher
//  ✅ FIX 10: GET /api/courses/stats — Teacher profile stats (coursesCount, studentsCount, quizzesCount)
// ============================================================

const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const jwt         = require('jsonwebtoken');
const multer      = require('multer');
const { storage } = require('../config/cloudinary');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const VALID_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MULTER — Cloudinary storage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
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
//  JWT MIDDLEWARE — any authenticated role (admin or teacher)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function authAny(req, res, next) {
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
//  GET /api/courses/all  —  All courses (no teacher filter)
//  Accessible by admin AND teacher
//  ⚠️ Must be defined BEFORE /:id to avoid "all" being parsed as an id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/all', authAny, (req, res) => {
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
    GROUP BY c.id
    ORDER BY c.created_at DESC`;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error('DB error fetching all courses:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.status(200).json({ success: true, courses: rows });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/courses/stats  —  Teacher profile statistics
//  Returns: coursesCount, studentsCount, quizzesCount
//  ⚠️ Must be defined BEFORE /:id to avoid "stats" being parsed as an id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/stats', auth, (req, res) => {
  const teacherId = req.userId;

  db.query(
    'SELECT COUNT(*) AS coursesCount FROM courses WHERE teacher_id = ?',
    [teacherId],
    (err1, r1) => {
      if (err1) return res.status(500).json({ success: false, message: 'Database error' });
      const coursesCount = r1[0].coursesCount;

      db.query(
        `SELECT COUNT(DISTINCT e.student_id) AS studentsCount
         FROM enrollments e
         INNER JOIN courses c ON c.id = e.course_id
         WHERE c.teacher_id = ?`,
        [teacherId],
        (err2, r2) => {
          if (err2) return res.status(500).json({ success: false, message: 'Database error' });
          const studentsCount = r2[0].studentsCount;

          db.query(
            `SELECT COUNT(qq.id) AS quizzesCount
             FROM quiz_questions qq
             INNER JOIN course_levels cl ON cl.id = qq.course_level_id
             INNER JOIN courses c ON c.id = cl.course_id
             WHERE c.teacher_id = ?`,
            [teacherId],
            (err3, r3) => {
              if (err3) return res.status(500).json({ success: false, message: 'Database error' });
              const quizzesCount = r3[0].quizzesCount;

              db.query(
                `SELECT course_type AS subject, COUNT(*) AS cnt
                 FROM courses
                 WHERE teacher_id = ? AND course_type IS NOT NULL
                 GROUP BY course_type
                 ORDER BY cnt DESC
                 LIMIT 1`,
                [teacherId],
                (err4, r4) => {
                  const subject = (r4 && r4.length) ? r4[0].subject : null;
                  res.status(200).json({
                    success: true,
                    coursesCount,
                    studentsCount,
                    quizzesCount,
                    subject,
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/courses  —  Create a new course
//
//  ✅ FIX: Accept both 'courseType' (Flutter camelCase) and 'course_type' (legacy)
//  ✅ FIX: Thumbnail field is 'thumbnailFile'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/courses  —  All courses for the authenticated teacher
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/courses/:id  —  One course with levels + quiz questions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
      levels:      courseRows
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

    const quizSql = `
      SELECT
        qq.id,
        qq.course_level_id  AS courseLevelId,
        qq.question_text    AS questionText,
        qq.options,
        qq.correct_answer_index AS correctAnswerIndex
      FROM quiz_questions qq
      INNER JOIN course_levels cl ON cl.id = qq.course_level_id
      WHERE cl.course_id = ?
      ORDER BY cl.level, qq.id`;

    db.query(quizSql, [req.params.id], (err2, quizRows) => {
      if (err2) {
        console.warn('quiz_questions query failed (table may not exist):', err2.message);
        return res.status(200).json({ success: true, course });
      }

      if (quizRows && quizRows.length) {
        quizRows.forEach(q => {
          const level = course.levels.find(l => l.id === q.courseLevelId);
          if (!level) return;
          let options = q.options;
          try {
            if (typeof options === 'string') options = JSON.parse(options);
          } catch (_) { options = []; }
          level.quizQuestions.push({
            id:                 q.id,
            questionText:       q.questionText,
            options,
            correctAnswerIndex: q.correctAnswerIndex,
          });
        });
      }

      res.status(200).json({ success: true, course });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUT /api/courses/:id
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
          return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });

        const { title, description } = req.body;
        const courseType   = req.body.courseType || req.body.course_type || null;
        const chapter      = req.body.chapter    || null;
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
            res.status(200).json({ success: true, message: 'Course updated', imagePath: newImagePath });
          }
        );
      }
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DELETE /api/courses/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.delete('/:id', auth, (req, res) => {
  db.query(
    'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
    [req.params.id, req.userId],
    (err, rows) => {
      if (err)
        return res.status(500).json({ success: false, message: 'Database error' });
      if (!rows.length)
        return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });

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
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
      return res.status(400).json({ success: false, message: 'levels must be a valid JSON array' });
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
          return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });

        const files = req.files || {};

        const levelRows = levels.map(l => {
          const lvl = l.level;
          return [
            req.params.id,
            lvl,
            l.videoUrl     || null,
            fileUrl(files, `videoFile_${lvl}`),
            l.textContent  || null,
            l.quizNote     || null,
            fileUrl(files, `pdfCourseFile_${lvl}`),
            fileUrl(files, `pdfExerciseFile_${lvl}`),
          ];
        });

        db.query(
          `INSERT INTO course_levels
             (course_id, level, video_url, video_file_path,
              text_content, quiz_note, pdf_course, pdf_exercise)
           VALUES ?
           ON DUPLICATE KEY UPDATE
             video_url       = VALUES(video_url),
             text_content    = VALUES(text_content),
             quiz_note       = VALUES(quiz_note),
             video_file_path = COALESCE(VALUES(video_file_path), video_file_path),
             pdf_course      = COALESCE(VALUES(pdf_course),      pdf_course),
             pdf_exercise    = COALESCE(VALUES(pdf_exercise),    pdf_exercise)`,
          [levelRows],
          (err2) => {
            if (err2) {
              console.error('DB error saving levels:', err2);
              return res.status(500).json({ success: false, message: 'Error saving levels' });
            }

            const hasQuizQuestions = levels.some(
              l => Array.isArray(l.quiz_questions) && l.quiz_questions.length > 0
            );

            if (!hasQuizQuestions) {
              return res.status(200).json({ success: true, message: 'Levels saved successfully' });
            }

            db.query(
              'SELECT id, level FROM course_levels WHERE course_id = ? AND level IN (?)',
              [req.params.id, levels.map(l => l.level)],
              (err3, levelIds) => {
                if (err3) {
                  console.warn('Could not fetch level IDs for quiz save:', err3.message);
                  return res.status(200).json({
                    success: true,
                    message: 'Levels saved. Quiz questions skipped (could not fetch level IDs).',
                  });
                }

                const levelMap = {};
                levelIds.forEach(r => { levelMap[r.level] = r.id; });

                const quizInserts = [];
                levels.forEach(level => {
                  const courseLevelId = levelMap[level.level];
                  if (!courseLevelId) return;
                  if (!Array.isArray(level.quiz_questions) || !level.quiz_questions.length) return;

                  level.quiz_questions.forEach(q => {
                    quizInserts.push([
                      courseLevelId,
                      q.questionText,
                      JSON.stringify(q.options),
                      q.correctAnswerIndex,
                    ]);
                  });
                });

                if (!quizInserts.length) {
                  return res.status(200).json({ success: true, message: 'Levels saved successfully' });
                }

                db.query(
                  'DELETE FROM quiz_questions WHERE course_level_id IN (?)',
                  [Object.values(levelMap)],
                  (err4) => {
                    if (err4) {
                      console.warn('quiz_questions DELETE failed (table may not exist):', err4.message);
                      return res.status(200).json({
                        success: true,
                        message: 'Levels saved. Quiz questions table not available.',
                      });
                    }

                    db.query(
                      `INSERT INTO quiz_questions
                         (course_level_id, question_text, options, correct_answer_index)
                       VALUES ?`,
                      [quizInserts],
                      (err5) => {
                        if (err5) {
                          console.warn('quiz_questions INSERT failed:', err5.message);
                          return res.status(200).json({
                            success: true,
                            message: 'Levels saved. Quiz questions could not be saved.',
                          });
                        }

                        res.status(200).json({
                          success:            true,
                          message:            'Levels and quiz questions saved successfully',
                          quizQuestionsCount: quizInserts.length,
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