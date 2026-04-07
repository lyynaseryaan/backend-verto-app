// ============================================================
//  course.js  –  Verto LMS Backend (Fixed Version)
//  ✅ FIXED: Each level receives its own files (videoFile_Beginner, etc.)
//  ✅ FIXED: ON DUPLICATE KEY UPDATE no longer uses COALESCE on text fields
//  ✅ FIXED: Old files cleaned up correctly per level
//  ✅ Compatible with Flutter frontend fix (field names with level suffix)
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MULTER — File Upload Configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

const UPLOAD_DIRS = [
  'uploads/courses/images',
  'uploads/courses/videos',
  'uploads/courses/pdfs',
];

UPLOAD_DIRS.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'thumbnailFile') {
      cb(null, 'uploads/courses/images');
    } else if (file.fieldname.startsWith('videoFile_')) {
      cb(null, 'uploads/courses/videos');
    } else if (
      file.fieldname.startsWith('pdfCourseFile_') ||
      file.fieldname.startsWith('pdfExerciseFile_')
    ) {
      cb(null, 'uploads/courses/pdfs');
    } else {
      cb(null, 'uploads/courses/pdfs');
    }
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}_${file.originalname.replace(/\s/g, '_')}`;
    cb(null, unique);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (file.fieldname === 'thumbnailFile') {
    if (/\.(jpeg|jpg|png|webp)$/.test(ext)) cb(null, true);
    else cb(new Error('Only image files (JPEG, PNG, WEBP) are allowed for thumbnail'));

  } else if (file.fieldname.startsWith('videoFile_')) {
    if (/\.(mp4|mov|avi|mkv|webm)$/.test(ext)) cb(null, true);
    else cb(new Error('Only video files (MP4, MOV, AVI, MKV, WEBM) are allowed'));

  } else if (
    file.fieldname.startsWith('pdfCourseFile_') ||
    file.fieldname.startsWith('pdfExerciseFile_')
  ) {
    if (ext === '.pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));

  } else {
    cb(null, true);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max
});

const uploadCourseImage = upload.single('thumbnailFile');

// ✅ FIX: Each level has its own file fields — videoFile_Beginner, etc.
const levelFileFields = [];
for (const level of LEVELS) {
  levelFileFields.push({ name: `videoFile_${level}`,       maxCount: 1 });
  levelFileFields.push({ name: `pdfCourseFile_${level}`,   maxCount: 1 });
  levelFileFields.push({ name: `pdfExerciseFile_${level}`, maxCount: 1 });
}
const uploadLevelFiles = upload.fields(levelFileFields);

function deleteOldFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`Deleted old file: ${filePath}`);
    } catch (err) {
      console.error('Error deleting file:', err);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  JWT MIDDLEWARE — Teacher only
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
//  POST /api/courses  —  Create course
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/', auth, (req, res) => {
  uploadCourseImage(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }

    const { title, description, courseType, chapter } = req.body;

    if (!title || title.trim() === '') {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    const imagePath = req.file ? req.file.path.replace(/\\/g, '/') : null;

    const sql = `
      INSERT INTO courses (teacher_id, title, description, course_type, chapter, image_path)
      VALUES (?, ?, ?, ?, ?, ?)`;

    db.query(
      sql,
      [req.userId, title.trim(), description || null, courseType || null, chapter || null, imagePath],
      (err, result) => {
        if (err) {
          console.error('DB error creating course:', err);
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.status(201).json({
          success: true,
          message: 'Course created',
          courseId: result.insertId,
          imagePath,
        });
      }
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/courses  —  All courses for the teacher
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/', auth, (req, res) => {
  const sql = `
    SELECT
      c.id,
      c.title,
      c.description,
      c.course_type  AS courseType,
      c.chapter,
      c.image_path   AS imagePath,
      c.created_at   AS createdAt,
      c.updated_at   AS updatedAt,
      COUNT(cl.id)   AS levelsCount
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
//  GET /api/courses/:id  —  One course with all its levels
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:id', auth, (req, res) => {
  const sql = `
    SELECT
      c.id,
      c.teacher_id   AS teacherId,
      c.title,
      c.description,
      c.course_type  AS courseType,
      c.chapter,
      c.image_path   AS imagePath,
      c.created_at   AS createdAt,
      c.updated_at   AS updatedAt,
      cl.id          AS levelId,
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

  db.query(sql, [req.params.id, req.userId], (err, rows) => {
    if (err) {
      console.error('DB error fetching course:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const course = {
      id:          rows[0].id,
      teacherId:   rows[0].teacherId,
      title:       rows[0].title,
      description: rows[0].description,
      courseType:  rows[0].courseType,
      chapter:     rows[0].chapter,
      imagePath:   rows[0].imagePath,
      createdAt:   rows[0].createdAt,
      updatedAt:   rows[0].updatedAt,
      levels: rows
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
        })),
    };

    res.status(200).json({ success: true, course });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUT /api/courses/:id  —  Update basic info + thumbnail
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
          return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });
        }

        const { title, description, courseType, chapter } = req.body;

        if (req.file && rows[0].image_path) {
          deleteOldFile(rows[0].image_path);
        }

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
          [title || null, description || null, courseType || null,
           chapter || null, newImagePath, req.params.id, req.userId],
          (err2) => {
            if (err2) {
              console.error('DB error updating course:', err2);
              return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.status(200).json({
              success: true,
              message: 'Course updated',
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
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/:id', auth, (req, res) => {
  db.query(
    'SELECT image_path FROM courses WHERE id = ? AND teacher_id = ?',
    [req.params.id, req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });
      }

      db.query(
        'SELECT video_file_path, pdf_course, pdf_exercise FROM course_levels WHERE course_id = ?',
        [req.params.id],
        (err2, levelRows) => {
          if (!err2 && levelRows) {
            levelRows.forEach(row => {
              deleteOldFile(row.video_file_path);
              deleteOldFile(row.pdf_course);
              deleteOldFile(row.pdf_exercise);
            });
          }

          if (rows[0].image_path) deleteOldFile(rows[0].image_path);

          db.query('DELETE FROM courses WHERE id = ?', [req.params.id], (err3) => {
            if (err3) {
              console.error('DB error deleting course:', err3);
              return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.status(200).json({ success: true, message: 'Course deleted' });
          });
        }
      );
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/courses/:id/levels
//
//  ✅ FIX 1: Each level uploads its own files with a level suffix:
//            videoFile_Beginner, pdfCourseFile_Intermediate, etc.
//
//  ✅ FIX 2: ON DUPLICATE KEY UPDATE no longer uses COALESCE on text
//            fields — the new value always wins. COALESCE is kept only
//            for file paths so existing files are not lost when no new
//            file is uploaded for that level.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:id/levels', auth, (req, res) => {
  uploadLevelFiles(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }

    // Parse levels array from body
    let levels;
    try {
      levels = typeof req.body.levels === 'string'
        ? JSON.parse(req.body.levels)
        : req.body.levels;
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid levels format' });
    }

    if (!levels || !Array.isArray(levels) || levels.length === 0) {
      return res.status(400).json({ success: false, message: 'Levels array is required' });
    }

    // Verify course ownership
    const ownerCheck = await new Promise((resolve) => {
      db.query(
        'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
        [req.params.id, req.userId],
        (err, rows) => resolve(err ? null : rows)
      );
    });

    if (!ownerCheck || ownerCheck.length === 0) {
      return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });
    }

    const files = req.files || {};

    try {
      for (const level of levels) {
        const { level: levelName, videoUrl, textContent, quizNote } = level;

        // ✅ FIX 1: Each level reads its OWN files by using the level name as suffix
        const videoPath      = files[`videoFile_${levelName}`]?.[0]?.path.replace(/\\/g, '/') ?? null;
        const pdfCoursePath  = files[`pdfCourseFile_${levelName}`]?.[0]?.path.replace(/\\/g, '/') ?? null;
        const pdfExercisePath = files[`pdfExerciseFile_${levelName}`]?.[0]?.path.replace(/\\/g, '/') ?? null;

        // Clean up old files only when a new file is provided for this level
        if (videoPath || pdfCoursePath || pdfExercisePath) {
          const oldFiles = await new Promise((resolve) => {
            db.query(
              'SELECT video_file_path, pdf_course, pdf_exercise FROM course_levels WHERE course_id = ? AND level = ?',
              [req.params.id, levelName],
              (err, result) => resolve(err || !result?.length ? null : result[0])
            );
          });

          if (oldFiles) {
            if (videoPath      && oldFiles.video_file_path) deleteOldFile(oldFiles.video_file_path);
            if (pdfCoursePath  && oldFiles.pdf_course)      deleteOldFile(oldFiles.pdf_course);
            if (pdfExercisePath && oldFiles.pdf_exercise)   deleteOldFile(oldFiles.pdf_exercise);
          }
        }

        // ✅ FIX 2: Text fields (video_url, text_content, quiz_note) always
        //    overwrite — no COALESCE — so clearing a field actually clears it
        //    in the DB.  File paths keep COALESCE so an existing upload is
        //    preserved when no new file is sent for that level.
        const sql = `
          INSERT INTO course_levels
            (course_id, level, video_url, video_file_path, text_content, quiz_note, pdf_course, pdf_exercise)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            video_url       = VALUES(video_url),
            text_content    = VALUES(text_content),
            quiz_note       = VALUES(quiz_note),
            video_file_path = COALESCE(VALUES(video_file_path), video_file_path),
            pdf_course      = COALESCE(VALUES(pdf_course),      pdf_course),
            pdf_exercise    = COALESCE(VALUES(pdf_exercise),    pdf_exercise)`;

        await new Promise((resolve, reject) => {
          db.query(
            sql,
            [
              req.params.id,
              levelName,
              videoUrl      || null,
              videoPath,
              textContent   || null,
              quizNote      || null,
              pdfCoursePath,
              pdfExercisePath,
            ],
            (err2) => { if (err2) reject(err2); else resolve(); }
          );
        });
      }

      res.status(200).json({ success: true, message: 'Levels saved successfully' });

    } catch (dbErr) {
      console.error('DB error saving levels:', dbErr);
      res.status(500).json({ success: false, message: 'Database error while saving levels' });
    }
  });
});

module.exports = router;

