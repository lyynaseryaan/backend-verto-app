const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

function auth(req, res, next) {
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

const VALID_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

function buildFullUrl(req, filePath) {
  if (!filePath) return null;
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
  const clean = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${req.protocol}://${req.get('host')}/${clean}`;
}

function videoType(url) {
  if (!url) return null;
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  return 'local';
}

function fetchQuizQuestions(courseLevelId) {
  return new Promise((resolve) => {
    if (!courseLevelId) return resolve([]);
    db.query(
      `SELECT id, question_text, options FROM quiz_questions WHERE course_level_id = ? ORDER BY id ASC`,
      [courseLevelId],
      (err, rows) => {
        if (err) {
          console.warn('[studentCourse] quiz_questions fetch warning:', err.message);
          return resolve([]);
        }
        const questions = (rows || []).map(q => {
          let options = q.options;
          if (typeof options === 'string') {
            try { options = JSON.parse(options); } catch (_) { options = []; }
          }
          return { id: q.id, question_text: q.question_text, options };
        });
        resolve(questions);
      }
    );
  });
}

function shapeCourse(row, req, quizQuestions = []) {
  const hasLevelContent = row.level_id !== null;
  const youtubeUrl      = row.video_url || null;
  const localVideoUrl   = row.video_file_path ? buildFullUrl(req, row.video_file_path) : null;

  const lesson = hasLevelContent
    ? {
        level:           row.level,
        video_url:       youtubeUrl,
        video_type_url:  videoType(youtubeUrl),
        video_file_path: localVideoUrl,
        video_type_file: localVideoUrl ? 'local' : null,
        text_content:    row.text_content || null,
        quiz_note:       row.quiz_note    || null,
        pdf_course:      buildFullUrl(req, row.pdf_course)   || null,
        pdf_exercise:    buildFullUrl(req, row.pdf_exercise) || null,
        quiz_questions:  quizQuestions,
      }
    : null;

  return {
    id:          row.id,
    title:       row.title,
    description: row.description || null,
    course_type: row.course_type || null,
    image_path:  buildFullUrl(req, row.image_path) || null,
    created_at:  row.created_at,
    has_content: row.level_id !== null,
    chapters:    row.chapter && row.level_id
      ? [{ chapter_name: row.chapter, lessons: lesson ? [lesson] : [] }]
      : [],
  };
}

router.get('/', auth, (req, res) => {
  const level = (req.query.level || '').trim();
  if (!level || !VALID_LEVELS.includes(level)) {
    return res.status(400).json({
      success: false,
      message: 'Query param "level" is required: Beginner | Intermediate | Advanced',
    });
  }

  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const search = req.query.search ? `%${req.query.search.trim()}%` : null;
  const type   = req.query.type   ? req.query.type.trim()          : null;

  const conditions   = [];
  const filterParams = [];

  if (search) { conditions.push('c.title LIKE ?');    filterParams.push(search); }
  if (type)   { conditions.push('c.course_type = ?'); filterParams.push(type);   }

  const where    = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const countSql = `SELECT COUNT(DISTINCT c.id) AS total FROM courses c ${where}`;

  db.query(countSql, filterParams, (countErr, countRows) => {
    if (countErr) {
      console.error('[studentCourse] count error:', countErr);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    const total = countRows[0].total;
    const sql   = `
      SELECT
        c.id, c.title, c.description, c.course_type, c.chapter,
        c.image_path, c.created_at,
        cl.id               AS level_id,
        cl.level, cl.video_url, cl.video_file_path,
        cl.text_content, cl.quiz_note, cl.pdf_course, cl.pdf_exercise
      FROM courses c
      LEFT JOIN course_levels cl ON cl.course_id = c.id AND cl.level = ?
      ${where}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?`;

    db.query(sql, [level, ...filterParams, limit, offset], async (err, rows) => {
      if (err) {
        console.error('[studentCourse] fetch error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      const shaped = await Promise.all(rows.map(async (row) => {
        const quizQuestions = row.level_id ? await fetchQuizQuestions(row.level_id) : [];
        return shapeCourse(row, req, quizQuestions);
      }));

      return res.status(200).json({
        success: true,
        level,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        courses: shaped,
      });
    });
  });
});

router.get('/enrolled', auth, (req, res) => {
  const sql = `
    SELECT
      c.id, c.title, c.description, c.course_type,
      c.image_path, c.created_at,
      e.progress, e.video_progress, e.pdf_opened, e.quiz_completed, e.enrolled_at
    FROM enrollments e
    INNER JOIN courses c ON c.id = e.course_id
    WHERE e.student_id = ?
    ORDER BY e.enrolled_at DESC`;

  db.query(sql, [req.userId], (err, rows) => {
    if (err) {
      console.error('[enrolled] fetch error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    return res.status(200).json({
      success: true,
      courses: rows.map(row => ({
        id:             row.id,
        title:          row.title,
        description:    row.description  || null,
        course_type:    row.course_type  || null,
        image_path:     buildFullUrl(req, row.image_path) || null,
        created_at:     row.created_at,
        enrolled_at:    row.enrolled_at,
        progress:       parseFloat((row.progress       || 0).toFixed(2)),
        video_progress: parseFloat((row.video_progress || 0).toFixed(2)),
        pdf_opened:     row.pdf_opened     === 1,
        quiz_completed: row.quiz_completed === 1,
      })),
    });
  });
});

router.get('/:id', auth, async (req, res) => {
  const level    = (req.query.level || '').trim();
  const courseId = parseInt(req.params.id);

  if (!level || !VALID_LEVELS.includes(level)) {
    return res.status(400).json({
      success: false,
      message: 'Query param "level" is required: Beginner | Intermediate | Advanced',
    });
  }
  if (isNaN(courseId)) {
    return res.status(400).json({ success: false, message: 'Invalid course id' });
  }

  const sql = `
    SELECT
      c.id, c.title, c.description, c.course_type, c.chapter,
      c.image_path, c.created_at,
      cl.id               AS level_id,
      cl.level, cl.video_url, cl.video_file_path,
      cl.text_content, cl.quiz_note, cl.pdf_course, cl.pdf_exercise
    FROM courses c
    LEFT JOIN course_levels cl ON cl.course_id = c.id AND cl.level = ?
    WHERE c.id = ?
    LIMIT 1`;

  db.query(sql, [level, courseId], async (err, rows) => {
    if (err) {
      console.error('[studentCourse] single fetch error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const row           = rows[0];
    const quizQuestions = row.level_id ? await fetchQuizQuestions(row.level_id) : [];

    return res.status(200).json({
      success: true,
      level,
      course: shapeCourse(row, req, quizQuestions),
    });
  });
});

router.get('/:id/enrollment', auth, (req, res) => {
  const courseId = parseInt(req.params.id);
  if (isNaN(courseId)) {
    return res.status(400).json({ success: false, message: 'Invalid course id' });
  }

  db.query(
    'SELECT id FROM enrollments WHERE student_id = ? AND course_id = ?',
    [req.userId, courseId],
    (err, rows) => {
      if (err) {
        console.error('[enrollment] check error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      return res.status(200).json({ success: true, isEnrolled: rows.length > 0 });
    }
  );
});

router.post('/:id/enroll', auth, (req, res) => {
  const courseId = parseInt(req.params.id);
  if (isNaN(courseId)) {
    return res.status(400).json({ success: false, message: 'Invalid course id' });
  }

  db.query('SELECT id FROM courses WHERE id = ?', [courseId], (err, rows) => {
    if (err) {
      console.error('[enrollment] course lookup error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    db.query(
      'INSERT IGNORE INTO enrollments (student_id, course_id) VALUES (?, ?)',
      [req.userId, courseId],
      (err2) => {
        if (err2) {
          console.error('[enrollment] insert error:', err2);
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        return res.status(200).json({ success: true, isEnrolled: true, message: 'Enrolled successfully' });
      }
    );
  });
});

router.post('/:id/submit-quiz', auth, (req, res) => {
  const courseId          = parseInt(req.params.id);
  const { level, answers } = req.body;

  if (isNaN(courseId)) {
    return res.status(400).json({ success: false, message: 'Invalid course id' });
  }
  if (!level || !VALID_LEVELS.includes(level)) {
    return res.status(400).json({
      success: false,
      message: '"level" is required: Beginner | Intermediate | Advanced',
    });
  }
  if (!Array.isArray(answers) || !answers.length) {
    return res.status(400).json({
      success: false,
      message: '"answers" must be a non-empty array of { questionId, selectedIndex }',
    });
  }

  const questionIds = answers.map(a => a.questionId);

  const sql = `
    SELECT qq.id, qq.correct_answer_index
    FROM   quiz_questions qq
    JOIN   course_levels  cl ON cl.id = qq.course_level_id
    WHERE  cl.course_id = ?
      AND  cl.level     = ?
      AND  qq.id        IN (?)`;

  db.query(sql, [courseId, level, questionIds], (err, rows) => {
    if (err) {
      console.error('[studentCourse] submit-quiz error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'No matching quiz questions found' });
    }

    const correctMap = {};
    rows.forEach(r => { correctMap[r.id] = r.correct_answer_index; });

    let correct = 0;
    let wrong   = 0;

    answers.forEach(({ questionId, selectedIndex }) => {
      if (correctMap[questionId] === undefined) return;
      if (selectedIndex === correctMap[questionId]) correct++;
      else wrong++;
    });

    const total = correct + wrong;
    const score = total > 0 ? Math.round((correct / total) * 100) : 0;

    return res.status(200).json({ success: true, result: { correct, wrong, total, score } });
  });
});

router.put('/:id/progress', auth, (req, res) => {
  const courseId = parseInt(req.params.id);
  if (isNaN(courseId)) {
    return res.status(400).json({ success: false, message: 'Invalid course id' });
  }

  db.query(
    'SELECT video_progress, pdf_opened, quiz_completed FROM enrollments WHERE student_id = ? AND course_id = ?',
    [req.userId, courseId],
    (err, rows) => {
      if (err) {
        console.error('[progress] fetch error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      if (!rows.length) {
        return res.status(404).json({ success: false, message: 'Not enrolled in this course' });
      }

      const current = rows[0];

      const videoProgress = req.body.video_progress !== undefined
        ? Math.min(1, Math.max(0, parseFloat(req.body.video_progress)))
        : current.video_progress;

      const pdfOpened = req.body.pdf_opened !== undefined
        ? (req.body.pdf_opened ? 1 : 0)
        : current.pdf_opened;

      const quizCompleted = req.body.quiz_completed !== undefined
        ? (req.body.quiz_completed ? 1 : 0)
        : current.quiz_completed;

      const totalProgress = (videoProgress * 0.6) + (pdfOpened * 0.2) + (quizCompleted * 0.2);

      db.query(
        `UPDATE enrollments
         SET video_progress = ?, pdf_opened = ?, quiz_completed = ?, progress = ?
         WHERE student_id = ? AND course_id = ?`,
        [videoProgress, pdfOpened, quizCompleted, parseFloat(totalProgress.toFixed(4)), req.userId, courseId],
        (err2) => {
          if (err2) {
            console.error('[progress] update error:', err2);
            return res.status(500).json({ success: false, message: 'Database error' });
          }
          return res.status(200).json({
            success:        true,
            progress:       parseFloat(totalProgress.toFixed(2)),
            video_progress: videoProgress,
            pdf_opened:     pdfOpened     === 1,
            quiz_completed: quizCompleted === 1,
          });
        }
      );
    }
  );
});

module.exports = router;