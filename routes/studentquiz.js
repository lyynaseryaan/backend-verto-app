// ============================================================
//  routes/studentQuiz.js  –  Verto LMS
//
//  Register in app.js:
//    app.use('/api/student/quizzes', require('./routes/studentQuiz'));
//
//  Endpoints:
//    GET  /api/student/quizzes/:courseId?level=Beginner   → questions (NO correct answers)
//    POST /api/student/quizzes/submit                     → evaluate + save attempt
//    GET  /api/student/quizzes/:courseId/history?level=.. → student's past attempts
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ── Auth middleware ─────────────────────────────────────────
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/quizzes/:courseId?level=Beginner
//
//  Returns:
//    { success, quizId, courseTitle, questions: [{ id, text, options[] }] }
//  ✅ correct_answer_index is NEVER included in the response
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:courseId', auth, (req, res) => {
  const courseId = parseInt(req.params.courseId);
  const level    = (req.query.level || '').trim();

  if (isNaN(courseId))
    return res.status(400).json({ success: false, message: 'Invalid course ID' });

  if (!level || !VALID_LEVELS.includes(level))
    return res.status(400).json({
      success: false,
      message: 'Query param "level" is required: Beginner | Intermediate | Advanced',
    });

  // Find the course_level row
  const levelSql = `
    SELECT cl.id AS courseLevelId, c.title AS courseTitle
    FROM course_levels cl
    JOIN courses c ON c.id = cl.course_id
    WHERE cl.course_id = ? AND cl.level = ?
    LIMIT 1`;

  db.query(levelSql, [courseId, level], (err, levelRows) => {
    if (err) {
      console.error('[studentQuiz] level fetch error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (!levelRows.length)
      return res.status(404).json({
        success: false,
        message: 'No content found for this course and level',
      });

    const { courseLevelId, courseTitle } = levelRows[0];

    // Fetch questions — DO NOT select correct_answer_index
    const qSql = `
      SELECT id, question_text, options
      FROM quizes_questions
      WHERE course_level_id = ?
      ORDER BY id ASC`;

    db.query(qSql, [courseLevelId], (err2, qRows) => {
      if (err2) {
        console.error('[studentQuiz] questions fetch error:', err2);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (!qRows.length)
        return res.status(200).json({
          success:     true,
          quizId:      courseLevelId,
          courseTitle,
          questions:   [],
          message:     'No quiz questions available for your level.',
        });

      const questions = qRows.map(q => {
        let options = [];
        try {
          options = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
        } catch (_) {
          options = [];
        }
        return { id: q.id, text: q.question_text, options };
      });

      return res.status(200).json({
        success: true,
        quizId:  courseLevelId,
        courseTitle,
        questions,
      });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/student/quizzes/submit
//
//  Body: { quizId: number, answers: [{ questionId, selectedOption }] }
//
//  1. Fetches correct answers from DB (server-side only)
//  2. Evaluates each answer
//  3. Saves attempt summary  → quiz_attempts
//  4. Saves per-answer detail → quiz_attempt_answers
//  5. Returns { success, attemptId, correct, wrong, score }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/submit', auth, (req, res) => {
  const { quizId, answers } = req.body;

  if (!quizId || !Array.isArray(answers) || !answers.length)
    return res.status(400).json({
      success: false,
      message: 'quizId and answers[] are required',
    });

  for (const a of answers) {
    if (typeof a.questionId !== 'number' || typeof a.selectedOption !== 'number')
      return res.status(400).json({
        success: false,
        message: 'Each answer must be { questionId: number, selectedOption: number }',
      });
  }

  const questionIds = answers.map(a => a.questionId);

  // Step 1: fetch correct answers — never exposed to client
  const sql = `
    SELECT id, correct_answer_index
    FROM quizes_questions
    WHERE course_level_id = ? AND id IN (?)`;

  db.query(sql, [quizId, questionIds], (err, rows) => {
    if (err) {
      console.error('[studentQuiz] submit fetch error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (!rows.length)
      return res.status(404).json({
        success: false,
        message: 'No questions found for this quiz',
      });

    // Step 2: evaluate
    const correctMap = {};
    rows.forEach(r => { correctMap[r.id] = r.correct_answer_index; });

    let correct       = 0;
    let wrong         = 0;
    const answerRows  = [];

    for (const answer of answers) {
      const rightIdx = correctMap[answer.questionId];
      if (rightIdx === undefined) continue;
      const isCorrect = answer.selectedOption === rightIdx ? 1 : 0;
      if (isCorrect) correct++; else wrong++;
      answerRows.push([answer.questionId, answer.selectedOption, isCorrect]);
    }

    const total = correct + wrong;
    const score = total > 0 ? Math.round((correct / total) * 100) : 0;

    // Step 3: save attempt summary
    const attemptSql = `
      INSERT INTO quiz_attempts
        (student_id, course_level_id, score, correct, wrong, total_questions)
      VALUES (?, ?, ?, ?, ?, ?)`;

    db.query(attemptSql, [req.userId, quizId, score, correct, wrong, total], (err2, result) => {
      if (err2) {
        console.error('[studentQuiz] attempt save error:', err2);
        // Return score even if DB save failed
        return res.status(200).json({
          success: true, attemptId: null, correct, wrong, score,
        });
      }

      const attemptId = result.insertId;

      if (!answerRows.length) {
        return res.status(200).json({ success: true, attemptId, correct, wrong, score });
      }

      // Step 4: save per-answer detail
      const detailRows = answerRows.map(r => [attemptId, ...r]);

      db.query(
        `INSERT INTO quiz_attempt_answers
           (attempt_id, question_id, selected_option, is_correct)
         VALUES ?`,
        [detailRows],
        (err3) => {
          if (err3) {
            console.error('[studentQuiz] answer detail save error:', err3);
            // Attempt is saved — still return success
          }
          return res.status(200).json({ success: true, attemptId, correct, wrong, score });
        }
      );
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/student/quizzes/:courseId/history?level=Beginner
//
//  Returns all past attempts for this student on this course+level.
//  Newest first, max 20.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:courseId/history', auth, (req, res) => {
  const courseId = parseInt(req.params.courseId);
  const level    = (req.query.level || '').trim();

  if (isNaN(courseId))
    return res.status(400).json({ success: false, message: 'Invalid course ID' });

  if (!level || !VALID_LEVELS.includes(level))
    return res.status(400).json({ success: false, message: 'level param required' });

  const sql = `
    SELECT
      qa.id              AS attemptId,
      qa.score,
      qa.correct,
      qa.wrong,
      qa.total_questions AS total,
      qa.attempted_at
    FROM quiz_attempts qa
    JOIN course_levels cl ON cl.id = qa.course_level_id
    WHERE qa.student_id = ?
      AND cl.course_id  = ?
      AND cl.level      = ?
    ORDER BY qa.attempted_at DESC
    LIMIT 20`;

  db.query(sql, [req.userId, courseId, level], (err, rows) => {
    if (err) {
      console.error('[studentQuiz] history fetch error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    return res.status(200).json({ success: true, history: rows });
  });
});

module.exports = router;