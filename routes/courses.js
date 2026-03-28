// ============================================================
//  course.js  –  Verto LMS Backend
//  Node.js + Express + MySQL
//  Handles: courses + course_levels with file uploads
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
// تخزين صورة الكورس
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/courses/images/'); // وين راح تتحط الصور
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // اسم الملف + الامتداد
  }
});

// تخزين فيديوهات الكورس
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/courses/videos/'); 
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

// تخزين PDF (course + exercises)
const pdfStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/courses/pdfs/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});



// Ensure upload directories exist
const UPLOAD_DIRS = [
  'uploads/courses/images',
  'uploads/courses/videos',
  'uploads/courses/pdfs',
];
UPLOAD_DIRS.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Dynamic storage: routes files to the correct sub-folder
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
    // Format: fieldname_timestamp_originalname
    const unique = `${file.fieldname}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, unique);
  },
});

// File type filter
const fileFilter = (req, file, cb) => {
  const imageTypes = /jpeg|jpg|png|webp/;
  const videoTypes = /mp4|mov|avi|mkv|webm/;
  const pdfTypes   = /pdf/;
  const ext        = path.extname(file.originalname).toLowerCase().replace('.', '');

  if (file.fieldname === 'image' && imageTypes.test(ext)) return cb(null, true);
  if (file.fieldname === 'video_file' && videoTypes.test(ext)) return cb(null, true);
  if (['pdf_course', 'pdf_exercise'].includes(file.fieldname) && pdfTypes.test(ext)) {
    return cb(null, true);
  }
  cb(new Error(`Invalid file type for field "${file.fieldname}"`));
};

// Upload limits
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB max per file
});

// Fields accepted on POST /api/courses (Step 1 — basic info + optional image)
const uploadCourseImage = upload.single('image');

// Fields accepted on POST /api/courses/:id/levels (Step 2 — per-level files)
// Each level can have: video_file, pdf_course, pdf_exercise
// fieldname format: video_file_Beginner, pdf_course_Intermediate, etc.
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

// Helper: extract uploaded file path or null
function filePath(files, fieldname) {
  if (!files || !files[fieldname] || !files[fieldname][0]) return null;
  return files[fieldname][0].path.replace(/\\/g, '/'); // normalize Windows paths
}

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
    // teacher_id is taken directly from the JWT — never from the request body
    req.userId = decoded.id;
    next();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/courses
//  Creates a new course. Accepts an optional image upload.
//  Body (multipart/form-data):
//    title*, description, course_type, chapter
//    image (file, optional)
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

    // Path of uploaded image (null if not provided)
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
      COUNT(cl.id) AS levels_count
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
//  Returns one course with all its levels and file paths.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:id', auth, (req, res) => {
  const sql = `
    SELECT
      c.id, c.teacher_id, c.title, c.description,
      c.course_type, c.chapter, c.image_path,
      c.created_at, c.updated_at,
      cl.id           AS level_id,
      cl.level,
      cl.video_url,
      cl.video_file_path,
      cl.text_content,
      cl.quiz_note,
      cl.pdf_course,
      cl.pdf_exercise
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
      teacher_id:  rows[0].teacher_id,
      title:       rows[0].title,
      description: rows[0].description,
      course_type: rows[0].course_type,
      chapter:     rows[0].chapter,
      image_path:  rows[0].image_path,
      created_at:  rows[0].created_at,
      updated_at:  rows[0].updated_at,
      levels: rows
        .filter(r => r.level_id !== null)
        .map(r => ({
          id:              r.level_id,
          level:           r.level,
          video_url:       r.video_url,
          video_file_path: r.video_file_path,
          text_content:    r.text_content,
          quiz_note:       r.quiz_note,
          pdf_course:      r.pdf_course,
          pdf_exercise:    r.pdf_exercise,
        })),
    };

    res.status(200).json({ success: true, course });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUT /api/courses/:id
//  Updates basic course info and/or the main image.
//  Body (multipart/form-data):
//    title, description, course_type, chapter (all optional)
//    image (file, optional — replaces existing)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.put('/:id', auth, (req, res) => {
  uploadCourseImage(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }

    // Verify ownership
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

        // If a new image was uploaded, use it; otherwise keep existing
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
//  Deletes the course. course_levels are removed by CASCADE.
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
//  Adds or updates levels for a course.
//  Accepts multipart/form-data with per-level files:
//
//  Text fields (JSON string in body.levels):
//    levels: JSON array → [{ level, video_url, text_content, quiz_note }, ...]
//
//  File fields (one per level):
//    video_file_Beginner, video_file_Intermediate, video_file_Advanced
//    pdf_course_Beginner, pdf_course_Intermediate, pdf_course_Advanced
//    pdf_exercise_Beginner, pdf_exercise_Intermediate, pdf_exercise_Advanced
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:id/levels', auth, (req, res) => {
  uploadLevelFiles(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }

    // levels can be sent as JSON string or parsed object
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

    // Validate level names
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

        // Build rows for bulk INSERT … ON DUPLICATE KEY UPDATE
        const levelRows = levels.map(l => {
          const lvl = l.level; // 'Beginner' | 'Intermediate' | 'Advanced'

          // Resolve uploaded file paths (null if not uploaded)
          const videoFilePath = filePath(files, `video_file_${lvl}`);
          const pdfCourse     = filePath(files, `pdf_course_${lvl}`);
          const pdfExercise   = filePath(files, `pdf_exercise_${lvl}`);

          return [
            req.params.id,          // course_id
            lvl,                    // level
            l.video_url    || null, // video_url (external link)
            videoFilePath,          // video_file_path (uploaded)
            l.text_content || null, // text_content
            l.quiz_note    || null, // quiz_note
            pdfCourse,              // pdf_course
            pdfExercise,            // pdf_exercise
          ];
        });

        const sql = `
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

        db.query(sql, [levelRows], (err2) => {
          if (err2) {
            console.error('DB error saving levels:', err2);
            return res.status(500).json({ success: false, message: 'Error saving levels' });
          }

          res.status(200).json({
            success: true,
            message: 'Levels saved successfully',
            // Return which files were stored so Flutter can update local state
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
        });
      }
    );
  });
});

module.exports = router;