// ============================================================
//  routes/studentCourse.js  –  Verto LMS
//  ✅ كل content logic محفوظ كما هو
//  ✅ أضفنا quiz لكل lesson بدون مس باقي الكود
//  🤖 AI: يشرح الأخطاء بعد كل كويز درس via Groq
//
//  🔧 PROGRESS FIXES (3 routes فقط — باقي الكود لم يُمس):
//  ✅ GET /:id/progress    → يرجع 0–1 بدل 0–100 (تماشي مع السارفيس)
//  ✅ PUT /:id/progress    → يقبل 0–1 مع normalization آمن + fallback صحيح
//  ✅ quiz/submit          → progress يُحسب بشكل صحيح بدون double counting
//  ✅ pdf_exercise_page    → عمود جديد لحفظ تقدم PDF التمارين منفصل
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ━━━ AUTH ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

// ━━━ HELPERS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

// ━━━ GROQ AI ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';

async function getAIExplanation(level, correct, total, wrongQuestions) {
  if (wrongQuestions.length === 0) {
    return {
      explanations:    [],
      nextStep:        'proceed',
      nextStepMessage: 'ممتاز! أجبت على كل الأسئلة بشكل صحيح ',
      coachMessage:    'أداؤك رائع، أنت جاهز للدرس التالي! ',
    };
  }

  const accuracy = correct / total;
  let nextStep = 'proceed';
  if (accuracy < 0.4)      nextStep = 'redo';
  else if (accuracy < 0.7) nextStep = 'review';

  const levelDesc = {
    Beginner:     'مبتدئ - استخدم أمثلة من الحياة اليومية وشرح بسيط جداً',
    Intermediate: 'متوسط - شرح واضح مع بعض التفاصيل التقنية',
    Advanced:     'متقدم - شرح تقني ومعمّق',
  };

  const wrongText = wrongQuestions
    .map((q, i) => `السؤال ${i + 1}: ${q.question}\nالإجابة الصحيحة: ${q.correctAnswer}\nإجابة الطالب: ${q.studentAnswer}`)
    .join('\n\n');

  const prompt = `أنت مساعد تعليمي ذكي في تطبيق Verto LMS.
مستوى الطالب: ${level} (${levelDesc[level] || levelDesc['Beginner']})
النتيجة: ${correct} من ${total} (${Math.round(accuracy * 100)}%)

الطالب أخطأ في الأسئلة التالية:
${wrongText}

المطلوب:
1. اشرح كل سؤال أخطأ فيه بأسلوب يناسب مستواه
2. اكتب رسالة تشجيعية للخطوة التالية
3. اكتب رسالة من "Learning Coach" تحفّزه

أجب بـ JSON فقط بدون أي نص خارجه:
{
  "explanations": [{ "question": "نص السؤال", "explanation": "الشرح بالعربي" }],
  "nextStepMessage": "رسالة الخطوة التالية",
  "coachMessage": "رسالة المدرب التشجيعية"
}`;

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY2}`,
    },
    body: JSON.stringify({ model: GROQ_MODEL, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
  });

  if (!response.ok) throw new Error(`Groq error: ${await response.text()}`);

  const data   = await response.json();
  const raw    = data.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

  return {
    explanations:    parsed.explanations    || [],
    nextStep,
    nextStepMessage: parsed.nextStepMessage || '',
    coachMessage:    parsed.coachMessage    || '',
  };
}

// ━━━ shapeCourse ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function shapeCourse(row, req, quiz) {
  const hasLevelContent = row.level_id !== null;
  const youtubeUrl      = row.video_url       || null;
  const localVideoUrl   = row.video_file_path ? buildFullUrl(req, row.video_file_path) : null;

  const lesson = hasLevelContent ? {
    level:           row.level,
    video_url:       youtubeUrl,
    video_type_url:  videoType(youtubeUrl),
    video_file_path: localVideoUrl,
    video_type_file: localVideoUrl ? 'local' : null,
    text_content:    row.text_content || null,
    quiz_note:       row.quiz_note    || null,
    pdf_course:      buildFullUrl(req, row.pdf_course)   || null,
    pdf_exercise:    buildFullUrl(req, row.pdf_exercise) || null,
    quiz:            quiz || null,
  } : null;

  return {
    id:          row.id,
    title:       row.title,
    description: row.description  || null,
    course_type: row.course_type  || null,
    image_path:  buildFullUrl(req, row.image_path) || null,
    created_at:  row.created_at,
    has_content: row.level_id !== null,
    chapters:    row.chapter && row.level_id
      ? [{ chapter_name: row.chapter, lessons: lesson ? [lesson] : [] }]
      : [],
  };
}

// ━━━ attachQuizAndRespond ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function attachQuizAndRespond(res, rows, req, pagination) {
  if (!rows.length)
    return res.status(200).json({ success: true, level: (req.query.level || '').trim(), pagination, courses: [] });

  const levelIds = rows.filter(r => r.level_id !== null).map(r => r.level_id);

  if (!levelIds.length)
    return res.status(200).json({
      success: true, level: (req.query.level || '').trim(), pagination,
      courses: rows.map(r => shapeCourse(r, req, null)),
    });

  const quizSql = `
    SELECT qz.id AS quiz_id, qz.level_course_id, qz.title AS quiz_title,
           qq.id AS question_id, qq.question_text,
           qo.id AS option_id, qo.option_text, qo.is_correct
    FROM quizzes qz
    LEFT JOIN quiz_questions qq ON qq.quiz_id     = qz.id
    LEFT JOIN quiz_options   qo ON qo.question_id = qq.id
    WHERE qz.level_course_id IN (?)
    ORDER BY qz.level_course_id, qq.id, qo.id`;

  db.query(quizSql, [levelIds], (qErr, quizRows) => {
    const quizMap = {};
    if (!qErr && quizRows && quizRows.length) {
      quizRows.forEach(row => {
        const lid = row.level_course_id;
        if (!quizMap[lid]) quizMap[lid] = { id: row.quiz_id, title: row.quiz_title, questions: [] };
        if (!row.question_id) return;
        let q = quizMap[lid].questions.find(x => x.id === row.question_id);
        if (!q) { q = { id: row.question_id, question_text: row.question_text, options: [] }; quizMap[lid].questions.push(q); }
        if (row.option_id) q.options.push({ id: row.option_id, option_text: row.option_text, is_correct: row.is_correct === 1 });
      });
    }
    return res.status(200).json({
      success: true, level: (req.query.level || '').trim(), pagination,
      courses: rows.map(row => shapeCourse(row, req, row.level_id ? (quizMap[row.level_id] || null) : null)),
    });
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/courses
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/', auth, (req, res) => {
  const level = (req.query.level || '').trim();
  if (!level || !VALID_LEVELS.includes(level))
    return res.status(400).json({ success: false, message: 'Query param "level" is required: Beginner | Intermediate | Advanced' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const search = req.query.search ? `%${req.query.search.trim()}%` : null;
  const type   = req.query.type   ? req.query.type.trim()          : null;
  const conditions = []; const filterParams = [];

  if (search) { conditions.push('c.title LIKE ?');    filterParams.push(search); }
  if (type)   { conditions.push('c.course_type = ?'); filterParams.push(type);   }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  db.query(`SELECT COUNT(DISTINCT c.id) AS total FROM courses c ${where}`, filterParams, (countErr, countRows) => {
    if (countErr) return res.status(500).json({ success: false, message: 'Database error' });
    const total = countRows[0].total;
    const sql = `
      SELECT c.id, c.title, c.description, c.course_type, c.chapter,
             c.image_path, c.created_at,
             cl.id AS level_id, cl.level, cl.video_url, cl.video_file_path,
             cl.text_content, cl.quiz_note, cl.pdf_course, cl.pdf_exercise
      FROM courses c
      LEFT JOIN course_levels cl ON cl.course_id = c.id AND cl.level = ?
      ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
    db.query(sql, [level, ...filterParams, limit, offset], (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      attachQuizAndRespond(res, rows, req, { page, limit, total, totalPages: Math.ceil(total / limit) });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/courses/enrolled
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/enrolled', auth, (req, res) => {
  db.query(
    `SELECT c.id, c.title, c.description, c.course_type, c.image_path, c.created_at,
            e.progress, e.video_progress, e.pdf_opened, e.quiz_completed, e.enrolled_at
     FROM enrollments e INNER JOIN courses c ON c.id = e.course_id
     WHERE e.student_id = ? ORDER BY e.enrolled_at DESC`,
    [req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      return res.status(200).json({
        success: true,
        courses: rows.map(row => ({
          id: row.id, title: row.title, description: row.description || null,
          course_type: row.course_type || null, image_path: buildFullUrl(req, row.image_path) || null,
          created_at: row.created_at, enrolled_at: row.enrolled_at,
          progress:       parseFloat((row.progress       || 0).toFixed(2)),
          video_progress: parseFloat((row.video_progress || 0).toFixed(2)),
          pdf_opened:     row.pdf_opened     === 1,
          quiz_completed: row.quiz_completed === 1,
        })),
      });
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/courses/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:id', auth, (req, res) => {
  const level = (req.query.level || '').trim();
  const courseId = parseInt(req.params.id);
  if (!level || !VALID_LEVELS.includes(level))
    return res.status(400).json({ success: false, message: 'Query param "level" is required' });
  if (isNaN(courseId))
    return res.status(400).json({ success: false, message: 'Invalid course id' });

  db.query(
    `SELECT c.id, c.title, c.description, c.course_type, c.chapter, c.image_path, c.created_at,
            cl.id AS level_id, cl.level, cl.video_url, cl.video_file_path,
            cl.text_content, cl.quiz_note, cl.pdf_course, cl.pdf_exercise
     FROM courses c LEFT JOIN course_levels cl ON cl.course_id = c.id AND cl.level = ?
     WHERE c.id = ? LIMIT 1`,
    [level, courseId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      if (!rows.length) return res.status(404).json({ success: false, message: 'Course not found' });
      const row = rows[0];
      if (!row.level_id) return res.status(200).json({ success: true, level, course: shapeCourse(row, req, null) });

      db.query(
        `SELECT qz.id AS quiz_id, qz.level_course_id, qz.title AS quiz_title,
                qq.id AS question_id, qq.question_text,
                qo.id AS option_id, qo.option_text, qo.is_correct
         FROM quizzes qz
         LEFT JOIN quiz_questions qq ON qq.quiz_id     = qz.id
         LEFT JOIN quiz_options   qo ON qo.question_id = qq.id
         WHERE qz.level_course_id = ? ORDER BY qq.id, qo.id`,
        [row.level_id],
        (qErr, quizRows) => {
          let quiz = null;
          if (!qErr && quizRows && quizRows.length && quizRows[0].quiz_id) {
            quiz = { id: quizRows[0].quiz_id, title: quizRows[0].quiz_title, questions: [] };
            const qMap = {};
            quizRows.forEach(qRow => {
              if (!qRow.question_id) return;
              if (!qMap[qRow.question_id]) { qMap[qRow.question_id] = { id: qRow.question_id, question_text: qRow.question_text, options: [] }; quiz.questions.push(qMap[qRow.question_id]); }
              if (qRow.option_id) qMap[qRow.question_id].options.push({ id: qRow.option_id, option_text: qRow.option_text, is_correct: qRow.is_correct === 1 });
            });
          }
          return res.status(200).json({ success: true, level, course: shapeCourse(row, req, quiz) });
        }
      );
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/courses/:id/enrollment
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:id/enrollment', auth, (req, res) => {
  const courseId = parseInt(req.params.id);
  if (isNaN(courseId)) return res.status(400).json({ success: false, message: 'Invalid course id' });
  db.query('SELECT id FROM enrollments WHERE student_id = ? AND course_id = ?', [req.userId, courseId], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    return res.status(200).json({ success: true, isEnrolled: rows.length > 0 });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/student/courses/:id/enroll
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:id/enroll', auth, (req, res) => {
  const courseId = parseInt(req.params.id);
  if (isNaN(courseId)) return res.status(400).json({ success: false, message: 'Invalid course id' });
  db.query('SELECT id FROM courses WHERE id = ?', [courseId], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    if (!rows.length) return res.status(404).json({ success: false, message: 'Course not found' });
    db.query('INSERT IGNORE INTO enrollments (student_id, course_id) VALUES (?, ?)', [req.userId, courseId], (err2) => {
      if (err2) return res.status(500).json({ success: false, message: 'Database error' });
      return res.status(200).json({ success: true, isEnrolled: true, message: 'Enrolled successfully' });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUT /api/student/courses/:id/progress
//  🔧 FIX 1: يقبل video_progress كـ 0–1 من السارفيس مباشرة
//  🔧 FIX 2: fallback من DB يُحوّل بشكل صحيح (tinyint → int)
//  🔧 FIX 3: pdf_page و pdf_exercise_page منفصلين (يحافظ على كل واحد)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.put('/:id/progress', auth, (req, res) => {
  const courseId = parseInt(req.params.id);
  if (isNaN(courseId)) return res.status(400).json({ success: false, message: 'Invalid course id' });

  // ✅ FIX: أضفنا pdf_exercise_page في الـ SELECT
  db.query(
    `SELECT video_progress, pdf_opened, quiz_completed, video_position, pdf_page, pdf_exercise_page
     FROM enrollments WHERE student_id = ? AND course_id = ?`,
    [req.userId, courseId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      if (!rows.length) return res.status(404).json({ success: false, message: 'Not enrolled in this course' });

      const cur = rows[0];

      // 🔧 FIX 1: السارفيس ترسل 0–1 — نقبلها مباشرة
      let videoProgress;
      if (req.body.video_progress !== undefined) {
        let raw = parseFloat(req.body.video_progress);
        if (isNaN(raw)) raw = 0;
        if (raw > 1) raw = raw / 100; // normalization من الكود القديم
        videoProgress = Math.min(1, Math.max(0, raw));
      } else {
        videoProgress = parseFloat(cur.video_progress) || 0;
      }

      // 🔧 FIX 2: tinyint → تحويل صريح
      const pdfOpened = req.body.pdf_opened !== undefined
        ? (req.body.pdf_opened ? 1 : 0)
        : (cur.pdf_opened ? 1 : 0);

      const quizCompleted = req.body.quiz_completed !== undefined
        ? (req.body.quiz_completed ? 1 : 0)
        : (cur.quiz_completed ? 1 : 0);

      const videoPosition = req.body.video_position !== undefined
        ? Math.max(0, parseInt(req.body.video_position) || 0)
        : (parseInt(cur.video_position) || 0);

      // ✅ FIX 3: pdf_page = PDF الدرس — يحافظ على القديم إذا لم يُرسل
      const pdfPage = req.body.pdf_page !== undefined
        ? Math.max(1, parseInt(req.body.pdf_page) || 1)
        : (parseInt(cur.pdf_page) || 1);

      // ✅ FIX 3: pdf_exercise_page = PDF التمارين — منفصل تماماً
      const pdfExercisePage = req.body.pdf_exercise_page !== undefined
        ? Math.max(1, parseInt(req.body.pdf_exercise_page) || 1)
        : (parseInt(cur.pdf_exercise_page) || 1);

      // حساب progress النهائي
      const totalProgress = (videoProgress * 0.6) + (pdfOpened * 0.2) + (quizCompleted * 0.2);

      // ✅ FIX: أضفنا pdf_exercise_page في الـ UPDATE
      db.query(
        `UPDATE enrollments 
         SET video_progress=?, pdf_opened=?, quiz_completed=?, progress=?, 
             video_position=?, pdf_page=?, pdf_exercise_page=?
         WHERE student_id=? AND course_id=?`,
        [
          videoProgress, pdfOpened, quizCompleted, parseFloat(totalProgress.toFixed(4)),
          videoPosition, pdfPage, pdfExercisePage,
          req.userId, courseId
        ],
        (err2) => {
          if (err2) return res.status(500).json({ success: false, message: 'Database error' });
          return res.status(200).json({
            success:           true,
            progress:          parseFloat(totalProgress.toFixed(4)),
            video_progress:    videoProgress,
            pdf_opened:        pdfOpened === 1,
            quiz_completed:    quizCompleted === 1,
            video_position:    videoPosition,
            pdf_page:          pdfPage,           // ✅ PDF الدرس
            pdf_exercise_page: pdfExercisePage,   // ✅ PDF التمارين
          });
        }
      );
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/courses/:courseId/quiz
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:courseId/quiz', auth, (req, res) => {
  const courseId = parseInt(req.params.courseId);
  const level    = (req.query.level || '').trim();
  if (isNaN(courseId)) return res.status(400).json({ success: false, message: 'Invalid course id' });
  if (!level || !VALID_LEVELS.includes(level))
    return res.status(400).json({ success: false, message: 'Query param "level" is required: Beginner | Intermediate | Advanced' });

  db.query('SELECT id FROM course_levels WHERE course_id = ? AND level = ? LIMIT 1', [courseId, level], (err, levelRows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    if (!levelRows.length) return res.status(404).json({ success: false, message: 'No content found for your level in this course' });
    const courseLevelId = levelRows[0].id;
    db.query(
      `SELECT id, question_text, options FROM quiz_questions WHERE course_level_id = ? ORDER BY id`,
      [courseLevelId],
      (err2, questions) => {
        if (err2) return res.status(500).json({ success: false, message: 'Database error' });
        if (!questions.length) return res.status(404).json({ success: false, message: 'No quiz questions found for this course level' });
        const formatted = questions.map(q => ({
          id: q.id, question_text: q.question_text,
          options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
        }));
        return res.status(200).json({ success: true, quiz_title: 'Mid-course Quiz', course_level_id: courseLevelId, total: formatted.length, questions: formatted });
      }
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/student/courses/:courseId/quiz/submit
//  🤖 AI explanation after grading
//  🔧 FIX 3: progress يُحسب بشكل صحيح — لا double counting
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:courseId/quiz/submit', auth, (req, res) => {
  const courseId       = parseInt(req.params.courseId);
  const { level, answers } = req.body;

  if (isNaN(courseId))    return res.status(400).json({ success: false, message: 'Invalid course id' });
  if (!level || !VALID_LEVELS.includes(level)) return res.status(400).json({ success: false, message: 'level is required' });
  if (!Array.isArray(answers) || !answers.length) return res.status(400).json({ success: false, message: 'answers array is required' });

  db.query('SELECT id FROM course_levels WHERE course_id = ? AND level = ? LIMIT 1', [courseId, level], (err, levelRows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    if (!levelRows.length) return res.status(404).json({ success: false, message: 'Course level not found' });

    const courseLevelId = levelRows[0].id;
    const questionIds   = answers.map(a => a.question_id);

    db.query(
      `SELECT id, question_text, correct_answer_index, options FROM quiz_questions WHERE course_level_id = ? AND id IN (?)`,
      [courseLevelId, questionIds],
      async (err2, correctRows) => {
        if (err2) return res.status(500).json({ success: false, message: 'Database error' });
        if (!correctRows.length) return res.status(404).json({ success: false, message: 'Questions not found' });

        const correctMap = {};
        correctRows.forEach(r => {
          correctMap[r.id] = {
            correctIndex: r.correct_answer_index,
            questionText: r.question_text,
            options: typeof r.options === 'string' ? JSON.parse(r.options) : (r.options || []),
          };
        });

        let correctCount = 0;
        const details        = [];
        const wrongQuestions = [];

        answers.forEach(a => {
          const q = correctMap[a.question_id];
          if (!q) return;
          const isCorrect = a.selected_index === q.correctIndex;
          if (isCorrect) correctCount++;
          details.push({ question_id: a.question_id, selected_index: a.selected_index, correct_index: q.correctIndex, is_correct: isCorrect });
          if (!isCorrect && a.selected_index >= 0) {
            wrongQuestions.push({
              question:      q.questionText,
              correctAnswer: q.options[q.correctIndex]   || '',
              studentAnswer: q.options[a.selected_index] || '',
            });
          }
        });

        const total      = correctRows.length;
        const wrong      = total - correctCount;
        const percentage = Math.round((correctCount / total) * 100);
        const passed     = percentage >= 60;

        db.query(
          `INSERT INTO quiz_attempts (student_id, course_id, course_level_id, level, total_questions, correct_answers, wrong_answers, score_percentage, passed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.userId, courseId, courseLevelId, level, total, correctCount, wrong, percentage, passed ? 1 : 0],
          async (err3, insertResult) => {
            const attemptId = insertResult?.insertId || null;

            if (!err3 && attemptId) {
              const answerRows = details.map(d => [attemptId, d.question_id, d.selected_index, d.is_correct ? 1 : 0]);
              db.query(`INSERT INTO quiz_answers (attempt_id, question_id, selected_index, is_correct) VALUES ?`, [answerRows],
                (err4) => { if (err4) console.warn('[quiz/submit] answers warning:', err4.message); }
              );

              // 🔧 FIX 3: حساب progress صحيح بدون double counting
              if (passed) {
                db.query(
                  `SELECT video_progress, pdf_opened, quiz_completed FROM enrollments WHERE student_id = ? AND course_id = ?`,
                  [req.userId, courseId],
                  (errFetch, fetchRows) => {
                    if (errFetch || !fetchRows.length) return;
                    // لو quiz_completed موجود مسبقاً — لا نعيد الحساب (يمنع double counting)
                    if (fetchRows[0].quiz_completed) return;
                    const vp  = parseFloat(fetchRows[0].video_progress) || 0;
                    const pdf = fetchRows[0].pdf_opened ? 1 : 0;
                    const newProgress = Math.min(1, parseFloat(((vp * 0.6) + (pdf * 0.2) + 0.2).toFixed(4)));
                    db.query(
                      `UPDATE enrollments SET quiz_completed = 1, progress = ? WHERE student_id = ? AND course_id = ?`,
                      [newProgress, req.userId, courseId],
                      (errUpd) => { if (errUpd) console.warn('[quiz/submit] progress update warning:', errUpd.message); }
                    );
                  }
                );
              }
            }

            let ai = { explanations: [], nextStep: 'proceed', nextStepMessage: '', coachMessage: '' };
            try {
              ai = await getAIExplanation(level, correctCount, total, wrongQuestions);
            } catch (aiErr) {
              console.error('[quiz/submit] AI error (non-blocking):', aiErr.message);
            }

            return res.status(200).json({
              success: true, attempt_id: attemptId,
              total, correct: correctCount, wrong,
              score_percentage: percentage, passed, details, ai,
            });
          }
        );
      }
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/courses/:courseId/quiz/history
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:courseId/quiz/history', auth, (req, res) => {
  const courseId = parseInt(req.params.courseId);
  if (isNaN(courseId)) return res.status(400).json({ success: false, message: 'Invalid course id' });
  db.query(
    `SELECT id, level, total_questions, correct_answers, wrong_answers, score_percentage, passed, attempted_at
     FROM quiz_attempts WHERE student_id = ? AND course_id = ? ORDER BY attempted_at DESC LIMIT 20`,
    [req.userId, courseId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      return res.status(200).json({ success: true, attempts: rows.map(r => ({ ...r, passed: r.passed === 1 })) });
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/courses/:id/progress
//  🔧 FIX: يرجع 0–1 بدل 0–100 + pdf_exercise_page منفصل
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:id/progress', auth, (req, res) => {
  const courseId = parseInt(req.params.id);
  if (isNaN(courseId)) return res.status(400).json({ success: false, message: 'Invalid course id' });

  // ✅ FIX: أضفنا pdf_exercise_page في الـ SELECT
  db.query(
    `SELECT video_progress, pdf_opened, quiz_completed, progress, video_position, pdf_page, pdf_exercise_page
     FROM enrollments WHERE student_id = ? AND course_id = ?`,
    [req.userId, courseId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });

      if (!rows.length) {
        return res.status(200).json({
          success:           true,
          video_progress:    0,
          pdf_opened:        false,
          quiz_completed:    false,
          progress:          0,
          video_position:    0,
          pdf_page:          1,    // PDF الدرس
          pdf_exercise_page: 1,    // ✅ PDF التمارين
        });
      }

      const r = rows[0];
      return res.status(200).json({
        success:           true,
        video_progress:    parseFloat((r.video_progress || 0).toFixed(4)),
        pdf_opened:        r.pdf_opened     ? true : false,
        quiz_completed:    r.quiz_completed ? true : false,
        progress:          parseFloat((r.progress || 0).toFixed(4)),
        video_position:    r.video_position || 0,
        pdf_page:          r.pdf_page          || 1,    // ✅ PDF الدرس
        pdf_exercise_page: r.pdf_exercise_page || 1,    // ✅ PDF التمارين
      });
    }
  );
});

module.exports = router;