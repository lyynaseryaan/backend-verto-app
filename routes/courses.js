// ============================================================
//  routes/courses.js  –  Verto LMS Backend
//  ✅ Quiz يُخزن فقط في quiz_questions table
//     (id, course_level_id, question_text, options JSON, correct_answer_index)
//  ✅ كل باقي الكود محفوظ كما هو
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

// ━━━ MULTER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

// ✅ FIX: Flutter sends thumbnail as 'thumbnailFile'
const uploadCourseImage = upload.single('thumbnailFile');

// ✅ FIX: Flutter sends level files as 'videoFile_Beginner', 'pdfCourseFile_Beginner', etc.
const levelFileFields = [];
for (const lvl of VALID_LEVELS) {
  levelFileFields.push({ name: `videoFile_${lvl}`,       maxCount: 1 });
  levelFileFields.push({ name: `pdfCourseFile_${lvl}`,   maxCount: 1 });
  levelFileFields.push({ name: `pdfExerciseFile_${lvl}`, maxCount: 1 });
}
const uploadLevelFiles = upload.fields(levelFileFields);

// Helper: safely extract a Cloudinary URL from multer's files object
function fileUrl(files, fieldname) {
  if (!files || !files[fieldname] || !files[fieldname][0]) return null;
  return files[fieldname][0].path; // Cloudinary returns the full URL in .path
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
//
//  ✅ FIX: Accept both 'courseType' (Flutter camelCase) and 'course_type' (legacy)
//  ✅ FIX: Thumbnail field is 'thumbnailFile'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/', auth, (req, res) => {
  uploadCourseImage(req, res, (uploadErr) => {
    if (uploadErr)
      return res.status(400).json({ success: false, message: uploadErr.message });

    const { title, description } = req.body;
    // ✅ FIX: Accept both camelCase (Flutter) and snake_case (legacy)
    const courseType = req.body.courseType || req.body.course_type || null;
    const chapter    = req.body.chapter    || null;

    if (!title || title.trim() === '')
      return res.status(400).json({ success: false, message: 'Title is required' });

    const imagePath = req.file ? req.file.path : null;

    db.query(
      `INSERT INTO courses (teacher_id, title, description, course_type, chapter, image_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.userId, title.trim(), description || null, courseType, chapter, imagePath],
      (err, result) => {
        if (err) {
          console.error('DB error creating course:', err);
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.status(201).json({
          success: true, message: 'Course created',
          courseId: result.insertId, imagePath,
        });
      }
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/courses  —  All courses for the authenticated teacher
//
//  ✅ FIX: Return camelCase aliases so Flutter CourseModel.fromJson works
//          without needing fallback logic
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/', auth, (req, res) => {
  const sql = `
    SELECT c.id, c.title, c.description,
           c.course_type AS courseType, c.chapter,
           c.image_path  AS imagePath,
           c.created_at  AS createdAt, c.updated_at AS updatedAt,
           COUNT(DISTINCT cl.id) AS levelsCount
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/courses/:id  —  One course with levels + quiz questions
//
//  ✅ FIX: Return camelCase aliases so Flutter CourseDetailModel and
//          LevelModel.fromJson work without fallback logic
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/:id', auth, (req, res) => {
  const courseSql = `
    SELECT
      c.id, c.teacher_id AS teacherId, c.title, c.description,
      c.course_type AS courseType, c.chapter,
      c.image_path  AS imagePath,
      c.created_at  AS createdAt, c.updated_at AS updatedAt,
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
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    if (!courseRows.length)
      return res.status(404).json({ success: false, message: 'Course not found' });

    // Build base course object from first row
    const base = courseRows[0];
    const course = {
      id: base.id, teacherId: base.teacherId,
      title: base.title, description: base.description,
      courseType: base.courseType, chapter: base.chapter,
      imagePath: base.imagePath,
      createdAt: base.createdAt, updatedAt: base.updatedAt,
      levels: courseRows
        .filter(r => r.levelId !== null)
        .map(r => ({
          id: r.levelId, level: r.level,
          videoUrl:      r.videoUrl      ?? '',
          videoFilePath: r.videoFilePath ?? '',
          textContent:   r.textContent   ?? '',
          quizNote:      r.quizNote      ?? '',
          pdfCourse:     r.pdfCourse     ?? '',
          pdfExercise:   r.pdfExercise   ?? '',
          quizQuestions: [], // تتملى من quiz_questions ↓
        })),
    };

    // ✅ جيب quiz_questions المرتبطة بهذا الكورس
    const quizSql = `
      SELECT qq.id, qq.course_level_id, qq.question_text,
             qq.options, qq.correct_answer_index
      FROM quiz_questions qq
      INNER JOIN course_levels cl ON cl.id = qq.course_level_id
      WHERE cl.course_id = ?
      ORDER BY qq.course_level_id, qq.id`;

    db.query(quizSql, [req.params.id], (err2, quizRows) => {
      // If quiz_questions table doesn't exist yet, just skip it gracefully
      if (err2) {
        console.warn('quiz_questions fetch failed:', err2.message);
        return res.status(200).json({ success: true, course });
      }

      // Attach quiz questions to matching levels
      if (quizRows && quizRows.length) {
        quizRows.forEach(q => {
          const level = course.levels.find(l => l.id === q.course_level_id);
          if (!level) return;
          let options = q.options;
          try { if (typeof options === 'string') options = JSON.parse(options); }
          catch (_) { options = []; }
          level.quizQuestions.push({
            id:                 q.id,
            questionText:       q.question_text,
            options,
            correctAnswerIndex: q.correct_answer_index,
          });
        });
      }

      res.status(200).json({ success: true, course });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUT /api/courses/:id  —  Update basic info and/or thumbnail
//
//  ✅ FIX: Accept both 'courseType' (Flutter) and 'course_type' (legacy)
//  ✅ FIX: Thumbnail field is 'thumbnailFile'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.put('/:id', auth, (req, res) => {
  uploadCourseImage(req, res, (uploadErr) => {
    if (uploadErr)
      return res.status(400).json({ success: false, message: uploadErr.message });

    db.query(
      'SELECT id, image_path FROM courses WHERE id = ? AND teacher_id = ?',
      [req.params.id, req.userId],
      (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        if (!rows.length)
          return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });

        const { title, description } = req.body;
        const courseType   = req.body.courseType || req.body.course_type || null;
        const chapter      = req.body.chapter    || null;
        const newImagePath = req.file ? req.file.path : rows[0].image_path;

        db.query(
          `UPDATE courses
           SET title=COALESCE(?,title), description=COALESCE(?,description),
               course_type=COALESCE(?,course_type), chapter=COALESCE(?,chapter), image_path=?
           WHERE id=? AND teacher_id=?`,
          [title||null, description||null, courseType, chapter,
           newImagePath, req.params.id, req.userId],
          (err2) => {
            if (err2) return res.status(500).json({ success: false, message: 'Database error' });
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
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      if (!rows.length)
        return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });

      db.query('DELETE FROM courses WHERE id = ?', [req.params.id], (err2) => {
        if (err2) return res.status(500).json({ success: false, message: 'Database error' });
        res.status(200).json({ success: true, message: 'Course deleted' });
      });
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/courses/:id/levels
//
//  Saves content for all 3 adaptive levels.
//
//  ✅ FIX: File field names match Flutter:
//            videoFile_Beginner, pdfCourseFile_Beginner, pdfExerciseFile_Beginner
//
//  ✅ FIX: JSON level keys match Flutter LevelPayload.toJson():
//            { level, videoUrl, textContent, quizNote }   (camelCase)
//
//  ✅ FIX: quiz_questions save is wrapped safely — if the table doesn't
//          exist, levels still save successfully and we return 200.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/:id/levels', auth, (req, res) => {
  uploadLevelFiles(req, res, (uploadErr) => {
    if (uploadErr)
      return res.status(400).json({ success: false, message: uploadErr.message });

    // ── Parse levels payload ──────────────────────────────
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

    // ── Validate level names ──────────────────────────────
    const invalidLevel = levels.find(l => !VALID_LEVELS.includes(l.level));
    if (invalidLevel)
      return res.status(400).json({
        success: false, message: `level must be one of: ${VALID_LEVELS.join(', ')}`,
      });

    // ── Verify course ownership ───────────────────────────
    db.query(
      'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
      [req.params.id, req.userId],
      (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        if (!rows.length)
          return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });

        const files     = req.files || {};
        const levelRows = levels.map(l => {
          const lvl = l.level;
          return [
            req.params.id, lvl,
            l.videoUrl    || null,
            fileUrl(files, `videoFile_${lvl}`),
            l.textContent || null,
            null,                                    // quiz_note = null دائماً
            fileUrl(files, `pdfCourseFile_${lvl}`),
            fileUrl(files, `pdfExerciseFile_${lvl}`),
          ];
        });

        // ── Upsert course_levels ──────────────────────────
        // Text fields always overwrite. File paths use COALESCE to
        // preserve existing Cloudinary URLs when no new file is sent.
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

            // ── جيب IDs تاع الـ levels ────────────────────
            db.query(
              'SELECT id, level FROM course_levels WHERE course_id = ? AND level IN (?)',
              [req.params.id, levels.map(l => l.level)],
              (err3, levelIds) => {
                if (err3) {
                  console.warn('Could not fetch level IDs:', err3.message);
                  return res.status(200).json({ success: true, message: 'Levels saved. Quiz skipped.' });
                }

                const levelMap = {};
                levelIds.forEach(r => { levelMap[r.level] = r.id; });

                // Build quiz_questions INSERT rows
                const quizInserts = [];
                levels.forEach(level => {
                  const courseLevelId = levelMap[level.level];
                  if (!courseLevelId) return;
                  if (!Array.isArray(level.quiz_questions) || !level.quiz_questions.length) return;

                if (!hasQuiz) {
                  return res.status(200).json({ success: true, message: 'Levels saved successfully' });
                }

                // ── احفظ في quiz_questions ─────────────────
                // اجمع كل الأسئلة من كل الـ levels
                const quizRows = [];
                levels.forEach(l => {
                  const courseLevelId = levelMap[l.level];
                  if (!courseLevelId) return;
                  if (!Array.isArray(l.quiz_questions) || !l.quiz_questions.length) return;

                  l.quiz_questions.forEach(q => {
                    quizRows.push([
                      courseLevelId,
                      q.questionText,
                      JSON.stringify(q.options),   // ✅ options كـ JSON string
                      q.correctAnswerIndex,
                    ]);
                  });
                });

                if (!quizRows.length) {
                  return res.status(200).json({ success: true, message: 'Levels saved successfully' });
                }

                // احذف الأسئلة القديمة لهذا الـ course أولاً
                const levelIds2 = Object.values(levelMap);
                db.query(
                  'DELETE FROM quiz_questions WHERE course_level_id IN (?)',
                  [levelIds2],
                  (err4) => {
                    if (err4) {
                      console.warn('Delete old quiz_questions failed:', err4.message);
                      // ما نوقفوش — نحاولو نحفظو على حساب
                    }

                    // أدخل الأسئلة الجديدة دفعة واحدة
                    db.query(
                      `INSERT INTO quiz_questions
                         (course_level_id, question_text, options, correct_answer_index)
                       VALUES ?`,
                      [quizRows],
                      (err5) => {
                        if (err5) {
                          console.warn('Insert quiz_questions failed:', err5.message);
                          return res.status(200).json({
                            success: true,
                            message: 'Levels saved. Quiz could not be saved.',
                          });
                        }

                        res.status(200).json({
                          success:            true,
                          message:            'Levels and quiz questions saved successfully',
                          quizQuestionsCount: quizRows.length,
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