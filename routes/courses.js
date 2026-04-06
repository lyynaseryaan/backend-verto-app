// ============================================================
//  course.js  –  Verto LMS Backend
//  ✅ Fixed: level files assigned per-level, not shared
//  ✅ Fixed: ON DUPLICATE KEY uses aliases (MySQL 8.0.20+ safe)
//  ✅ Fixed: fileFilter uses anchored regex
//  ✅ Fixed: detailed error logging
//  ✅ Fixed: explicit GROUP BY for ONLY_FULL_GROUP_BY mode
//  ✅ Fixed: null safety on all string fields in GET /:id
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
    } else if (file.fieldname.startsWith('videoFile')) {
      cb(null, 'uploads/courses/videos');
    } else {
      cb(null, 'uploads/courses/pdfs');
    }
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}_${file.originalname.replace(/\s/g, '_')}`;
    cb(null, unique);
  },
});
 
// ✅ Fixed: anchored regex prevents partial matches
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
 
  if (file.fieldname === 'thumbnailFile') {
    if (/^\.(jpeg|jpg|png|webp)$/.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WEBP) are allowed for thumbnail'));
    }
  } else if (file.fieldname.startsWith('videoFile')) {
    if (/^\.(mp4|mov|avi|mkv|webm)$/.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files (MP4, MOV, AVI, MKV, WEBM) are allowed'));
    }
  } else if (
    file.fieldname.startsWith('pdfCourseFile') ||
    file.fieldname.startsWith('pdfExerciseFile')
  ) {
    if (ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  } else {
    cb(null, true);
  }
};
 
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 },
});
 
const uploadCourseImage = upload.single('thumbnailFile');
 
// ✅ Fixed: indexed field names so each level gets its OWN files
// Flutter sends: videoFile_0, pdfCourseFile_0, pdfExerciseFile_0  (Beginner)
//                videoFile_1, pdfCourseFile_1, pdfExerciseFile_1  (Intermediate)
//                videoFile_2, pdfCourseFile_2, pdfExerciseFile_2  (Advanced)
const uploadLevelFiles = upload.fields([
  { name: 'videoFile_0',       maxCount: 1 },
  { name: 'videoFile_1',       maxCount: 1 },
  { name: 'videoFile_2',       maxCount: 1 },
  { name: 'pdfCourseFile_0',   maxCount: 1 },
  { name: 'pdfCourseFile_1',   maxCount: 1 },
  { name: 'pdfCourseFile_2',   maxCount: 1 },
  { name: 'pdfExerciseFile_0', maxCount: 1 },
  { name: 'pdfExerciseFile_1', maxCount: 1 },
  { name: 'pdfExerciseFile_2', maxCount: 1 },
]);
 
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
//  POST /api/courses
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
          return res.status(500).json({
            success: false,
            message: `Database error: ${err.sqlMessage || err.message}`,
          });
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
//  GET /api/courses
//  ✅ Fixed: explicit GROUP BY for ONLY_FULL_GROUP_BY sql_mode
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
//  GET /api/courses/:id
//  ✅ Fixed: all string fields default to '' instead of null
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:id', auth, (req, res) => {
  const sql = `
    SELECT
      c.id,
      c.teacher_id       AS teacherId,
      c.title,
      c.description,
      c.course_type      AS courseType,
      c.chapter,
      c.image_path       AS imagePath,
      c.created_at       AS createdAt,
      c.updated_at       AS updatedAt,
      cl.id              AS levelId,
      cl.level,
      cl.video_url       AS videoUrl,
      cl.video_file_path AS videoFilePath,
      cl.text_content    AS textContent,
      cl.quiz_note       AS quizNote,
      cl.pdf_course      AS pdfCourse,
      cl.pdf_exercise    AS pdfExercise
    FROM courses c
    LEFT JOIN course_levels cl ON cl.course_id = c.id
    WHERE c.id = ? AND c.teacher_id = ?`;
 
  db.query(sql, [req.params.id, req.userId], (err, rows) => {
    if (err) {
      console.error('DB error fetching course detail:', err);
      return res.status(500).json({
        success: false,
        message: `Database error: ${err.sqlMessage || err.message}`,
      });
    }
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }
 
    const course = {
      id:          rows[0].id,
      teacherId:   rows[0].teacherId,
      title:       rows[0].title       || '',
      description: rows[0].description || '',
      courseType:  rows[0].courseType  || '',
      chapter:     rows[0].chapter     || '',
      imagePath:   rows[0].imagePath   || '',
      createdAt:   rows[0].createdAt,
      updatedAt:   rows[0].updatedAt,
      levels: rows
        .filter(r => r.levelId !== null)
        .map(r => ({
          id:            r.levelId,
          level:         r.level           || '',
          videoUrl:      r.videoUrl        || '',
          videoFilePath: r.videoFilePath   || '',
          textContent:   r.textContent     || '',
          quizNote:      r.quizNote        || '',
          pdfCourse:     r.pdfCourse       || '',
          pdfExercise:   r.pdfExercise     || '',
        })),
    };
 
    res.status(200).json({ success: true, course });
  });
});
 
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUT /api/courses/:id
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
          return res.status(500).json({
            success: false,
            message: `Database error: ${err.sqlMessage || err.message}`,
          });
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
          SET
            title       = COALESCE(?, title),
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
              return res.status(500).json({
                success: false,
                message: `Database error: ${err2.sqlMessage || err2.message}`,
              });
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
      if (err) {
        return res.status(500).json({
          success: false,
          message: `Database error: ${err.sqlMessage || err.message}`,
        });
      }
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
              return res.status(500).json({
                success: false,
                message: `Database error: ${err3.sqlMessage || err3.message}`,
              });
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
//  ✅ KEY FIX: Each level uses its own indexed file fields.
//
//  IMPORTANT — you must also update your Flutter CourseProvider
//  to send files with indexed names:
//    videoFile_0 / pdfCourseFile_0 / pdfExerciseFile_0  → Beginner
//    videoFile_1 / pdfCourseFile_1 / pdfExerciseFile_1  → Intermediate
//    videoFile_2 / pdfCourseFile_2 / pdfExerciseFile_2  → Advanced
//
//  IMPORTANT — run this SQL once on your database if not done:
//    ALTER TABLE course_levels
//      ADD UNIQUE KEY uq_course_level (course_id, level);
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:id/levels', auth, (req, res) => {
  uploadLevelFiles(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }
 
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
 
    db.query(
      'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
      [req.params.id, req.userId],
      async (err, rows) => {
        if (err) {
          return res.status(500).json({
            success: false,
            message: `Database error: ${err.sqlMessage || err.message}`,
          });
        }
        if (rows.length === 0) {
          return res.status(404).json({ success: false, message: 'Course not found or unauthorized' });
        }
 
        const files = req.files || {};
 
        try {
          for (let i = 0; i < levels.length; i++) {
            const { level: levelName, videoUrl, textContent, quizNote } = levels[i];
 
            // ✅ Each level gets its own file by index
            const videoFile    = files[`videoFile_${i}`]?.[0];
            const pdfCourse    = files[`pdfCourseFile_${i}`]?.[0];
            const pdfExercise  = files[`pdfExerciseFile_${i}`]?.[0];
 
            const videoPath       = videoFile   ? videoFile.path.replace(/\\/g, '/')   : null;
            const pdfCoursePath   = pdfCourse   ? pdfCourse.path.replace(/\\/g, '/')   : null;
            const pdfExercisePath = pdfExercise ? pdfExercise.path.replace(/\\/g, '/') : null;
 
            // Delete replaced files only
            if (videoPath || pdfCoursePath || pdfExercisePath) {
              const oldFiles = await new Promise((resolve) => {
                db.query(
                  'SELECT video_file_path, pdf_course, pdf_exercise FROM course_levels WHERE course_id = ? AND level = ?',
                  [req.params.id, levelName],
                  (e, result) => {
                    if (e || !result || result.length === 0) resolve(null);
                    else resolve(result[0]);
                  }
                );
              });
 
              if (oldFiles) {
                if (videoPath && oldFiles.video_file_path)    deleteOldFile(oldFiles.video_file_path);
                if (pdfCoursePath && oldFiles.pdf_course)     deleteOldFile(oldFiles.pdf_course);
                if (pdfExercisePath && oldFiles.pdf_exercise) deleteOldFile(oldFiles.pdf_exercise);
              }
            }
 
            // ✅ Fixed: row alias syntax for MySQL 8.0.20+
            const sql = `
              INSERT INTO course_levels
                (course_id, level, video_url, video_file_path, text_content, quiz_note, pdf_course, pdf_exercise)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              AS new_row
              ON DUPLICATE KEY UPDATE
                video_url       = COALESCE(new_row.video_url,       video_url),
                video_file_path = COALESCE(new_row.video_file_path, video_file_path),
                text_content    = COALESCE(new_row.text_content,    text_content),
                quiz_note       = COALESCE(new_row.quiz_note,       quiz_note),
                pdf_course      = COALESCE(new_row.pdf_course,      pdf_course),
                pdf_exercise    = COALESCE(new_row.pdf_exercise,    pdf_exercise)`;
 
            await new Promise((resolve, reject) => {
              db.query(
                sql,
                [
                  req.params.id, levelName,
                  videoUrl      || null,
                  videoPath,
                  textContent   || null,
                  quizNote      || null,
                  pdfCoursePath,
                  pdfExercisePath,
                ],
                (err2) => {
                  if (err2) {
                    console.error(`DB error saving level "${levelName}":`, err2.sqlMessage || err2.message);
                    reject(err2);
                  } else {
                    resolve();
                  }
                }
              );
            });
          }
 
          res.status(200).json({ success: true, message: 'Levels saved successfully' });
 
        } catch (loopErr) {
          console.error('Error in levels loop:', loopErr);
          res.status(500).json({
            success: false,
            message: `Failed to save levels: ${loopErr.sqlMessage || loopErr.message}`,
          });
        }
      }
    );
  });
});
 
module.exports = router;