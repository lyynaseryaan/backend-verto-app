// ============================================================
//  course.js  –  Verto LMS Backend
//  Node.js + Express + MySQL
//  Handles: courses + course_levels with file uploads + QUIZ QUESTIONS
//
//  NEW COLUMNS REQUIRED — run these SQL migrations first:
//
//  ALTER TABLE courses
//    ADD COLUMN image_path VARCHAR(500) DEFAULT NULL;
//
//  ALTER TABLE course_levels
//    ADD COLUMN video_file_path VARCHAR(500) DEFAULT NULL,
//    ADD COLUMN pdf_course      VARCHAR(500) DEFAULT NULL,
//    ADD COLUMN pdf_exercise    VARCHAR(500) DEFAULT NULL;
//
//  NEW TABLE — Quiz Questions:
//
//  CREATE TABLE quiz_questions (
//    id INT AUTO_INCREMENT PRIMARY KEY,
//    course_level_id INT NOT NULL,
//    question_text TEXT NOT NULL,
//    options JSON NOT NULL,  -- ["Option A", "Option B", "Option C", "Option D"]
//    correct_answer_index INT NOT NULL,  -- 0, 1, 2, or 3
//    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//    FOREIGN KEY (course_level_id) REFERENCES course_levels(id) ON DELETE CASCADE
//  );
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MULTER — File Upload Configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'image') {
      cb(null, 'uploads/courses/images');
    } else if (file.fieldname === 'video_file') {
      cb(null, 'uploads/courses/videos');
    } else {
      // pdf_course, pdf_exercise
      cb(null, 'uploads/courses/pdfs');
    }
  },
  filename: (req, file, cb) => {
    const unique = `${file.fieldname}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, unique);
  },
});

const fileFilter = (req, file, cb) => {
  const imageTypes = /jpeg|jpg|png|webp/;
  const videoTypes = /mp4|mov|avi|mkv|webm/;
  const pdfTypes   = /pdf/;
  const ext        = path.extname(file.originalname).toLowerCase().replace('.', '');

  if (file.fieldname === 'image' && imageTypes.test(ext)) return cb(null, true);
  if (file.fieldname.startsWith('video_file') && videoTypes.test(ext)) {
    return cb(null, true);
  }
  if ((file.fieldname.startsWith('pdf_course') || file.fieldname.startsWith('pdf_exercise')) && pdfTypes.test(ext)) {
    return cb(null, true);
  }
  cb(new Error(`Invalid file type for field "${file.fieldname}"`));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 },
});

const uploadCourseImage = upload.single('image');

const uploadLevelFiles = upload.fields([
  { name: 'video_file_Beginner',     maxCount: 1 },
  { name: 'video_file_Intermediate', maxCount: 1 },
  { name: 'video_file_Advanced',     maxCount: 1 },
  { name: 'pdf_course_Beginner',     maxCount: 1 },
  { name: 'pdf_course_Intermediate', maxCount: 1 },
  { name: 'pdf_course_Advanced',     maxCount: 1 },
  { name: 'pdf_exercise_Beginner',   maxCount: 1 },
  { name: 'pdf_exercise_Intermediate', maxCount: 1 },
  { name: 'pdf_exercise_Advanced',   maxCount: 1 },
]);

function filePath(files, fieldname) {
  if (!files || !files[fieldname] || !files[fieldname][0]) return null;
  return files[fieldname][0].path.replace(/\\/g, '/');
}

// Ensure upload directories exist
const UPLOAD_DIRS = [
  'uploads/courses/images',
  'uploads/courses/videos',
  'uploads/courses/pdfs',
];
UPLOAD_DIRS.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  JWT MIDDLEWARE — teacher only
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const token = header.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
    if (decoded.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teachers only' });
    }
    req.userId = decoded.id;
    next();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/courses
//  Creates a new course.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/', auth, (req, res) => {
  uploadCourseImage(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }

    const { title, description, course_type, chapter } = req.body;

    if (!title || title.trim() === '') {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    const imagePath = req.file ? req.file.path.replace(/\\/g, '/') : null;

    const sql = `
      INSERT INTO courses (teacher_id, title, description, course_type, chapter, image_path)
      VALUES (?, ?, ?, ?, ?, ?)`;

    db.query(
      sql,
      [req.userId, title.trim(), description || null, course_type || null, chapter || null, imagePath],
      (err, result) => {
        if (err) {
          console.error('DB error creating course:', err);
          return res.status(500).json({ success: false, message: 'Database error' });
        }

        const courseId = result.insertId;
        res.status(201).json({
          success:  true,
          message:  'Course created',
          courseId,
          imagePath,
        });
      }
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/courses
//  Returns all courses belonging to the authenticated teacher.
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
//  GET /api/courses/:id
//  Returns one course with all its levels, files, and quiz questions.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:id', auth, (req, res) => {
  const courseSql = `
    SELECT
      c.id, c.teacher_id, c.title, c.description,
      c.course_type, c.chapter, c.image_path,
      c.created_at, c.updated_at,
      cl.id           AS level_id,
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
    if (courseRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    // Fetch quiz questions for all levels
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
          .map(r => {
            const levelQuestions = quizRows
              .filter(q => q.course_level_id === r.level_id)
              .map(q => ({
                id: q.id,
                questionText: q.question_text,
                options: JSON.parse(q.options),
                correctAnswerIndex: q.correct_answer_index,
              }));

            return {
              id:              r.level_id,
              level:           r.level,
              video_url:       r.video_url,
              video_file_path: r.video_file_path,
              text_content:    r.text_content,
              pdf_course:      r.pdf_course,
              pdf_exercise:    r.pdf_exercise,
              quizQuestions:   levelQuestions,
            };
          }),
      };

      res.status(200).json({ success: true, course });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUT /api/courses/:id
//  Updates basic course info and/or the main image.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.put('/:id', auth, (req, res) => {
  uploadCourseImage(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }

    db.query(
      'SELECT id, image_path FROM courses WHERE id = ? AND teacher_id = ?',
      [req.params.id, req.userId],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        if (rows.length === 0) {
          return res.status(404).json({
            success: false, message: 'Course not found or unauthorized',
          });
        }

        const { title, description, course_type, chapter } = req.body;
        const newImagePath = req.file
          ? req.file.path.replace(/\\/g, '/')
          : rows[0].image_path;

        const sql = `
          UPDATE courses
          SET title       = COALESCE(?, title),
              description = COALESCE(?, description),
              course_type = COALESCE(?, course_type),
              chapter     = COALESCE(?, chapter),
              image_path  = ?
          WHERE id = ? AND teacher_id = ?`;

        db.query(
          sql,
          [title || null, description || null, course_type || null,
           chapter || null, newImagePath, req.params.id, req.userId],
          (err2) => {
            if (err2) {
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
//  Deletes the course and all associated data.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/:id', auth, (req, res) => {
  db.query(
    'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
    [req.params.id, req.userId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      if (rows.length === 0) {
        return res.status(404).json({
          success: false, message: 'Course not found or unauthorized',
        });
      }

      db.query('DELETE FROM courses WHERE id = ?', [req.params.id], (err2) => {
        if (err2) {
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.status(200).json({ success: true, message: 'Course deleted' });
      });
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/courses/:id/levels
//  Adds or updates levels with files and quiz questions.
//
//  Body (multipart/form-data):
//    levels: JSON array of level objects
//      [
//        {
//          "level": "Beginner",
//          "video_url": "https://...",
//          "text_content": "...",
//          "quiz_questions": [
//            {
//              "questionText": "What is...?",
//              "options": ["A", "B", "C", "D"],
//              "correctAnswerIndex": 0
//            }
//          ]
//        }
//      ]
//
//  Files:
//    video_file_Beginner, pdf_course_Beginner, etc.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:id/levels', auth, (req, res) => {
  uploadLevelFiles(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }

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

    if (!levels || !Array.isArray(levels) || levels.length === 0) {
      return res.status(400).json({
        success: false, message: 'levels array is required',
      });
    }

    const validLevels = ['Beginner', 'Intermediate', 'Advanced'];
    const invalid = levels.find(l => !validLevels.includes(l.level));
    if (invalid) {
      return res.status(400).json({
        success: false,
        message: `level must be one of: ${validLevels.join(', ')}`,
      });
    }

    // Verify course ownership
    db.query(
      'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
      [req.params.id, req.userId],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        if (rows.length === 0) {
          return res.status(404).json({
            success: false, message: 'Course not found or unauthorized',
          });
        }

        const files = req.files || {};
        const levelRows = levels.map(l => {
          const lvl = l.level;
          const videoFilePath = filePath(files, `video_file_${lvl}`);
          const pdfCourse     = filePath(files, `pdf_course_${lvl}`);
          const pdfExercise   = filePath(files, `pdf_exercise_${lvl}`);

          return [
            req.params.id,
            lvl,
            l.video_url    || null,
            videoFilePath,
            l.text_content || null,
            l.quiz_note    || null,
            pdfCourse,
            pdfExercise,
          ];
        });

        const levelSql = `
          INSERT INTO course_levels
            (course_id, level, video_url, video_file_path, text_content, quiz_note, pdf_course, pdf_exercise)
          VALUES ?
          ON DUPLICATE KEY UPDATE
            video_url       = VALUES(video_url),
            video_file_path = COALESCE(VALUES(video_file_path), video_file_path),
            text_content    = VALUES(text_content),
            quiz_note       = VALUES(quiz_note),
            pdf_course      = COALESCE(VALUES(pdf_course), pdf_course),
            pdf_exercise    = COALESCE(VALUES(pdf_exercise), pdf_exercise)`;

        db.query(levelSql, [levelRows], (err2) => {
          if (err2) {
            console.error('DB error saving levels:', err2);
            return res.status(500).json({ success: false, message: 'Error saving levels' });
          }

          // Now save quiz questions for each level
          // Fetch the course_level IDs we just created/updated
          const fetchLevelsSql = `
            SELECT id, level FROM course_levels WHERE course_id = ? AND level IN (?)`;

          db.query(fetchLevelsSql, [req.params.id, levels.map(l => l.level)], (err3, levelIds) => {
            if (err3) {
              console.error('DB error fetching level IDs:', err3);
              return res.status(500).json({ success: false, message: 'Error fetching levels' });
            }

            // Build map: level name -> course_level_id
            const levelMap = {};
            levelIds.forEach(row => {
              levelMap[row.level] = row.id;
            });

            // Collect all quiz questions to insert
            const quizInserts = [];
            levels.forEach(level => {
              const courseLevelId = levelMap[level.level];
              if (courseLevelId && level.quiz_questions && Array.isArray(level.quiz_questions)) {
                level.quiz_questions.forEach(q => {
                  quizInserts.push([
                    courseLevelId,
                    q.questionText,
                    JSON.stringify(q.options),
                    q.correctAnswerIndex,
                  ]);
                });
              }
            });

            if (quizInserts.length === 0) {
              // No quiz questions, just return success
              return res.status(200).json({
                success: true,
                message: 'Levels saved successfully (no quiz questions)',
                uploadedFiles: levels.reduce((acc, l) => {
                  const lvl = l.level;
                  acc[lvl] = {
                    video_file_path: filePath(files, `video_file_${lvl}`),
                    pdf_course:      filePath(files, `pdf_course_${lvl}`),
                    pdf_exercise:    filePath(files, `pdf_exercise_${lvl}`),
                  };
                  return acc;
                }, {}),
              });
            }

            // Delete existing quiz questions for these levels and insert new ones
            const courseLevelIds = Object.values(levelMap);
            const deleteQuizSql = 'DELETE FROM quiz_questions WHERE course_level_id IN (?)';

            db.query(deleteQuizSql, [courseLevelIds], (err4) => {
              if (err4) {
                console.error('DB error deleting old quiz questions:', err4);
                return res.status(500).json({ success: false, message: 'Error updating quiz questions' });
              }

              if (quizInserts.length === 0) {
                return res.status(200).json({
                  success: true,
                  message: 'Levels and quiz saved successfully',
                  uploadedFiles: levels.reduce((acc, l) => {
                    const lvl = l.level;
                    acc[lvl] = {
                      video_file_path: filePath(files, `video_file_${lvl}`),
                      pdf_course:      filePath(files, `pdf_course_${lvl}`),
                      pdf_exercise:    filePath(files, `pdf_exercise_${lvl}`),
                    };
                    return acc;
                  }, {}),
                });
              }

              const insertQuizSql = `
                INSERT INTO quiz_questions
                  (course_level_id, question_text, options, correct_answer_index)
                VALUES ?`;

              db.query(insertQuizSql, [quizInserts], (err5) => {
                if (err5) {
                  console.error('DB error saving quiz questions:', err5);
                  return res.status(500).json({ success: false, message: 'Error saving quiz questions' });
                }

                res.status(200).json({
                  success: true,
                  message: 'Levels and quiz questions saved successfully',
                  uploadedFiles: levels.reduce((acc, l) => {
                    const lvl = l.level;
                    acc[lvl] = {
                      video_file_path: filePath(files, `video_file_${lvl}`),
                      pdf_course:      filePath(files, `pdf_course_${lvl}`),
                      pdf_exercise:    filePath(files, `pdf_exercise_${lvl}`),
                    };
                    return acc;
                  }, {}),
                  quizQuestionsCount: quizInserts.length,
                });
              });
            });
          });
        });
      }
    );
  });
});

module.exports = router;