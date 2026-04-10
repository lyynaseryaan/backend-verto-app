// routes/studentQuiz.js
// ✅ GET  /api/student/quiz/:courseId?level=Beginner  → questions (NO correct answers)
// ✅ POST /api/student/quiz/:courseId/submit          → evaluate & return score

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ━━━ Auth Middleware ━━━
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
//  GET /api/student/quiz/:courseId?level=Beginner
//  Returns questions + options. ❌ NO correct_answer_index sent.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:courseId', auth, (req, res) => {
  const courseId = parseInt(req.params.courseId);
  const level    = (req.query.level || '').trim();

  if (isNaN(courseId))
    return res.status(400).json({ success: false, message: 'Invalid courseId' });

  if (!level || !VALID_LEVELS.includes(level))
    return res.status(400).json({
      success: false,
      message: 'Query param "level" is required: Beginner | Intermediate | Advanced',
    });

  const sql = `
    SELECT qq.id, qq.question_text, qq.options
    FROM   quiz_questions qq
    INNER JOIN course_levels cl ON cl.id = qq.course_level_id
    WHERE  cl.course_id = ? AND cl.level = ?
    ORDER  BY qq.id ASC`;

  db.query(sql, [courseId, level], (err, rows) => {
    if (err) {
      console.error('[studentQuiz] fetch error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (!rows.length)
      return res.status(200).json({ success: true, questions: [] });

    const questions = rows.map(row => {
      let options = row.options;
      if (typeof options === 'string') {
        try { options = JSON.parse(options); } catch (_) { options = []; }
      }
      return {
        id:       row.id,
        question: row.question_text,
        options,
        // ✅ correct_answer_index intentionally omitted
      };
    });

    return res.status(200).json({ success: true, level, questions });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/student/quiz/:courseId/submit
//  Body: { level: 'Beginner', answers: [{ questionId, selectedIndex }] }
//  ✅ Evaluation done server-side only
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:courseId/submit', auth, (req, res) => {
  const courseId = parseInt(req.params.courseId);
  const { level, answers } = req.body;

  if (isNaN(courseId))
    return res.status(400).json({ success: false, message: 'Invalid courseId' });

  if (!level || !VALID_LEVELS.includes(level))
    return res.status(400).json({
      success: false,
      message: 'Body field "level" is required: Beginner | Intermediate | Advanced',
    });

  if (!Array.isArray(answers) || !answers.length)
    return res.status(400).json({
      success: false, message: '"answers" array is required',
    });

  const questionIds = answers.map(a => parseInt(a.questionId)).filter(Boolean);

  const sql = `
    SELECT qq.id, qq.correct_answer_index
    FROM   quiz_questions qq
    INNER JOIN course_levels cl ON cl.id = qq.course_level_id
    WHERE  cl.course_id = ? AND cl.level = ? AND qq.id IN (?)`;

  db.query(sql, [courseId, level, questionIds], (err, rows) => {
    if (err) {
      console.error('[studentQuiz] submit error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    if (!rows.length)
      return res.status(404).json({
        success: false, message: 'No quiz questions found',
      });

    // Build lookup: { questionId → correctIndex }
    const correctMap = {};
    rows.forEach(r => { correctMap[r.id] = r.correct_answer_index; });

    let correct = 0;
    let wrong   = 0;

    answers.forEach(a => {
      const qId = parseInt(a.questionId);
      const sel = parseInt(a.selectedIndex);
      if (!(qId in correctMap)) return;
      if (sel === correctMap[qId]) correct++;
      else                          wrong++;
    });

    const total = correct + wrong;
    const score = total > 0 ? Math.round((correct / total) * 100) : 0;

    // Fire-and-forget — log attempt if table exists
    db.query(
      `INSERT INTO student_quiz_answers
         (student_id, course_id, level, correct, wrong, score, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [req.userId, courseId, level, correct, wrong, score],
      (e) => {
        if (e) console.warn('[studentQuiz] could not save attempt:', e.message);
      }
    );

    return res.status(200).json({
      success: true,
      correct,
      wrong,
      total,
      score,
    });
  });
});

module.exports = router;