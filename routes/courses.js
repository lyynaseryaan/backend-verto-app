// ============================================================
//  routes/courses.js  –  Verto LMS Backend
//  ✅ DEBUG LOGGING ADDED to trace quiz questions payload
// ============================================================

const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const jwt         = require('jsonwebtoken');
const multer      = require('multer');
const { storage } = require('../config/cloudinary');

const VALID_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

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
//  POST /api/courses
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
      [req.userId, title.trim(), description || null, courseType, chapter, imagePath],
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
//  GET /api/courses
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
//  GET /api/courses/:id
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

    const first = courseRows[0];
    const course = {
      id:          first.id,
      teacherId:   first.teacherId,
      title:       first.title,
      description: first.description,
      courseType:  first.courseType,
      chapter:     first.chapter,
      imagePath:   first.imagePath,
      createdAt:   first.createdAt,
      updatedAt:   first.updatedAt,
      levels: courseRows
        .filter(r => r.levelId !== null)
        .map(r => ({
          id:            r.levelId,
          level:         r.level,
          videoUrl:      r.videoUrl      || '',
          videoFilePath: r.videoFilePath || '',
          textContent:   r.textContent   || '',
          quizNote:      r.quizNote      || '',
          pdfCourse:     r.pdfCourse     || '',
          pdfExercise:   r.pdfExercise   || '',
        })),
    };

    // Also fetch quiz questions for each level
    db.query(
      `SELECT qq.id, qq.course_level_id, qq.question_text, qq.options, qq.correct_answer_index
       FROM quiz_questions qq
       INNER JOIN course_levels cl ON cl.id = qq.course_level_id
       WHERE cl.course_id = ?
       ORDER BY qq.id ASC`,
      [req.params.id],
      (err2, quizRows) => {
        if (err2) {
          // Non-fatal — just return course without quiz questions
          console.warn('Could not fetch quiz questions:', err2.message);
          return res.status(200).json({ success: true, course });
        }

        // Attach quiz questions to their level
        course.levels.forEach(lvl => {
          lvl.quizQuestions = quizRows
            .filter(q => q.course_level_id === lvl.id)
            .map(q => ({
              id:                 q.id,
              questionText:       q.question_text,
              options:            typeof q.options === 'string'
                ? JSON.parse(q.options) : q.options,
              correctAnswerIndex: q.correct_answer_index,
            }));
        });

        return res.status(200).json({ success: true, course });
      }
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUT /api/courses/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.put('/:id', auth, (req, res) => {
  uploadCourseImage(req, res, (uploadErr) => {
    if (uploadErr)
      return res.status(400).json({ success: false, message: uploadErr.message });

    const courseType = req.body.courseType || req.body.course_type || null;
    const updates    = [];
    const params     = [];

    if (req.body.title)       { updates.push('title = ?');       params.push(req.body.title.trim()); }
    if (req.body.description) { updates.push('description = ?'); params.push(req.body.description); }
    if (courseType)           { updates.push('course_type = ?'); params.push(courseType); }
    if (req.body.chapter)     { updates.push('chapter = ?');     params.push(req.body.chapter); }
    if (req.file)             { updates.push('image_path = ?');  params.push(req.file.path); }

    if (!updates.length)
      return res.status(400).json({ success: false, message: 'Nothing to update' });

    params.push(req.params.id, req.userId);

    db.query(
      `UPDATE courses SET ${updates.join(', ')} WHERE id = ? AND teacher_id = ?`,
      params,
      (err) => {
        if (err) {
          console.error('DB error updating course:', err);
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.status(200).json({ success: true, message: 'Course updated' });
      }
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DELETE /api/courses/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/:id', auth, (req, res) => {
  db.query(
    'DELETE FROM courses WHERE id = ? AND teacher_id = ?',
    [req.params.id, req.userId],
    (err) => {
      if (err) {
        console.error('DB error deleting course:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      res.status(200).json({ success: true, message: 'Course deleted' });
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/courses/:id/levels
//  ✅ DEBUG LOGGING ADDED
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
      return res.status(400).json({
        success: false, message: 'levels must be a valid JSON array',
      });
    }

    if (!levels || !Array.isArray(levels) || !levels.length)
      return res.status(400).json({ success: false, message: 'levels array is required' });

    // ✅ DEBUG: Log exactly what Flutter sent
    console.log('\n=== LEVELS RECEIVED FROM FLUTTER ===');
    levels.forEach((l, i) => {
      console.log(`\n[Level ${i}] ${l.level}`);
      console.log('  videoUrl:      ', l.videoUrl      || '(empty)');
      console.log('  textContent:   ', l.textContent   ? l.textContent.substring(0, 30) + '...' : '(empty)');
      console.log('  quizNote:      ', l.quizNote      || '(empty)');
      console.log('  quiz_questions:', JSON.stringify(l.quiz_questions || 'MISSING KEY'));
    });
    console.log('\n=== END FLUTTER PAYLOAD ===\n');

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
            l.quizNote    || null,
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

            // ✅ DEBUG: Check what quiz_questions look like
            const hasQuizQuestions = levels.some(
              l => Array.isArray(l.quiz_questions) && l.quiz_questions.length > 0
            );

            console.log('\n=== QUIZ QUESTIONS CHECK ===');
            console.log('hasQuizQuestions:', hasQuizQuestions);
            levels.forEach(l => {
              console.log(`  ${l.level}: quiz_questions =`, JSON.stringify(l.quiz_questions));
            });
            console.log('=== END CHECK ===\n');

            if (!hasQuizQuestions) {
              return res.status(200).json({
                success: true,
                message: 'Levels saved successfully (no quiz questions)',
              });
            }

            db.query(
              'SELECT id, level FROM course_levels WHERE course_id = ? AND level IN (?)',
              [req.params.id, levels.map(l => l.level)],
              (err3, levelIds) => {
                if (err3) {
                  console.warn('Could not fetch level IDs:', err3.message);
                  return res.status(200).json({
                    success: true,
                    message: 'Levels saved. Quiz questions skipped.',
                  });
                }

                const levelMap = {};
                levelIds.forEach(r => { levelMap[r.level] = r.id; });

                console.log('\n=== LEVEL MAP ===', levelMap, '===\n');

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

                console.log('\n=== QUIZ INSERTS ===');
                console.log('Count:', quizInserts.length);
                console.log(JSON.stringify(quizInserts));
                console.log('=== END ===\n');

                if (!quizInserts.length) {
                  return res.status(200).json({
                    success: true,
                    message: 'Levels saved successfully',
                  });
                }

                db.query(
                  'DELETE FROM quiz_questions WHERE course_level_id IN (?)',
                  [Object.values(levelMap)],
                  (err4) => {
                    if (err4) {
                      console.warn('quiz_questions DELETE failed:', err4.message);
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

                        console.log(`\n✅ Saved ${quizInserts.length} quiz questions\n`);
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