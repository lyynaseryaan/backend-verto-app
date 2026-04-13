// ============================================================
//  routes/quizRoute.js  –  Verto LMS  (FULL DYNAMIC VERSION)
//  ✅ Teacher: create / delete quiz
//  ✅ Student: fetch questions (no correct answers exposed)
//  ✅ Student: submit answers → score saved + returned
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ━━━ AUTH HELPERS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function authTeacher(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid token' });
    if (decoded.role !== 'teacher')
      return res.status(403).json({ success: false, message: 'Teachers only' });
    req.userId = decoded.id;
    next();
  });
}

function authAny(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid token' });
    req.userId   = decoded.id;
    req.userRole = decoded.role;
    next();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DATABASE SCHEMA (run once)
//
//  -- quiz_questions already exists:
//  CREATE TABLE quiz_questions (
//    id                  INT AUTO_INCREMENT PRIMARY KEY,
//    course_level_id     INT NOT NULL,
//    question_text       VARCHAR(500) NOT NULL,
//    options             JSON NOT NULL,          -- ["A","B","C","D"]
//    correct_answer_index INT NOT NULL,
//    FOREIGN KEY (course_level_id) REFERENCES course_levels(id) ON DELETE CASCADE
//  );
//
//  -- NEW: quiz_attempts
//  CREATE TABLE quiz_attempts (
//    id              INT AUTO_INCREMENT PRIMARY KEY,
//    student_id      INT NOT NULL,
//    course_level_id INT NOT NULL,
//    score           INT NOT NULL DEFAULT 0,
//    total           INT NOT NULL DEFAULT 0,
//    percentage      DECIMAL(5,2) NOT NULL DEFAULT 0,
//    answers         JSON,          -- [{"question_id":1,"selected":2,"correct":true}, ...]
//    attempted_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
//    FOREIGN KEY (student_id)      REFERENCES users(id)          ON DELETE CASCADE,
//    FOREIGN KEY (course_level_id) REFERENCES course_levels(id)  ON DELETE CASCADE
//  );
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/quiz/levels/:levelCourseId/questions
//  Fetch questions for a course level — options exposed, correct answer HIDDEN
//  Used by Flutter to load quiz before the student starts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/levels/:levelCourseId/questions', authAny, (req, res) => {
  const levelCourseId = parseInt(req.params.levelCourseId);
  if (isNaN(levelCourseId))
    return res.status(400).json({ success: false, message: 'Invalid level id' });

  db.query(
    `SELECT id, question_text, options
     FROM quiz_questions
     WHERE course_level_id = ?
     ORDER BY id`,
    [levelCourseId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });

      const questions = rows.map(q => {
        let options = q.options;
        try { if (typeof options === 'string') options = JSON.parse(options); } catch (_) { options = []; }
        return { id: q.id, question_text: q.question_text, options };
        // ✅ correct_answer_index is intentionally NOT sent to client
      });

      return res.status(200).json({ success: true, total: questions.length, questions });
    }
  );
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/quiz/levels/:levelCourseId/submit
//  Student submits answers → backend grades them → saves attempt
//
//  Body:
//  {
//    "answers": [
//      { "question_id": 1, "selected_index": 2 },
//      { "question_id": 2, "selected_index": 0 },
//      ...
//    ]
//  }
//
//  Response:
//  {
//    "success": true,
//    "attempt_id": 7,
//    "score": 3,
//    "total": 5,
//    "percentage": 60,
//    "details": [
//      { "question_id": 1, "selected_index": 2, "correct_index": 1, "is_correct": false },
//      ...
//    ]
//  }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/levels/:levelCourseId/submit', authAny, (req, res) => {
  const levelCourseId = parseInt(req.params.levelCourseId);
  if (isNaN(levelCourseId))
    return res.status(400).json({ success: false, message: 'Invalid level id' });

  const { answers } = req.body;
  if (!answers || !Array.isArray(answers) || !answers.length)
    return res.status(400).json({ success: false, message: 'answers array is required' });

  // 1️⃣ Fetch correct answers from DB
  db.query(
    `SELECT id, correct_answer_index FROM quiz_questions WHERE course_level_id = ? ORDER BY id`,
    [levelCourseId],
    (err, questions) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      if (!questions.length)
        return res.status(404).json({ success: false, message: 'No quiz found for this level' });

      // 2️⃣ Build a map of question_id → correct_index
      const correctMap = {};
      questions.forEach(q => { correctMap[q.id] = q.correct_answer_index; });

      // 3️⃣ Grade each answer
      let score = 0;
      const details = answers.map(a => {
        const correctIndex = correctMap[a.question_id];
        const isCorrect    = correctIndex !== undefined && a.selected_index === correctIndex;
        if (isCorrect) score++;
        return {
          question_id:    a.question_id,
          selected_index: a.selected_index,
          correct_index:  correctIndex ?? null,
          is_correct:     isCorrect,
        };
      });

      const total      = questions.length;
      const percentage = parseFloat(((score / total) * 100).toFixed(2));

      // 4️⃣ Save attempt to database
      db.query(
        `INSERT INTO quiz_attempts (student_id, course_level_id, score, total, percentage, answers)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.userId, levelCourseId, score, total, percentage, JSON.stringify(details)],
        (err2, result) => {
          if (err2) {
            console.error('[quiz/submit] DB error saving attempt:', err2);
            // Still return the result even if saving failed — don't block the student
          }

          const attemptId = result?.insertId ?? null;

          // 5️⃣ Optionally mark quiz_completed in enrollment
          db.query(
            `UPDATE enrollments SET quiz_completed = 1
             WHERE student_id = ? AND course_id = (
               SELECT course_id FROM course_levels WHERE id = ? LIMIT 1
             )`,
            [req.userId, levelCourseId],
            () => {} // fire and forget
          );

          return res.status(200).json({
            success:    true,
            attempt_id: attemptId,
            score,
            total,
            percentage,
            details,
          });
        }
      );
    }
  );
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/quiz/levels/:levelCourseId/attempts
//  Returns this student's past attempts for a level
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/levels/:levelCourseId/attempts', authAny, (req, res) => {
  const levelCourseId = parseInt(req.params.levelCourseId);
  if (isNaN(levelCourseId))
    return res.status(400).json({ success: false, message: 'Invalid level id' });

  db.query(
    `SELECT id, score, total, percentage, attempted_at
     FROM quiz_attempts
     WHERE student_id = ? AND course_level_id = ?
     ORDER BY attempted_at DESC
     LIMIT 20`,
    [req.userId, levelCourseId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      return res.status(200).json({ success: true, attempts: rows });
    }
  );
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  (EXISTING — unchanged) POST /api/quiz/levels/:levelCourseId
//  Teacher creates / replaces a quiz
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/levels/:levelCourseId', authTeacher, (req, res) => {
  const levelCourseId = parseInt(req.params.levelCourseId);
  if (isNaN(levelCourseId))
    return res.status(400).json({ success: false, message: 'Invalid level id' });

  const { questions } = req.body;
  if (!questions || !Array.isArray(questions) || !questions.length)
    return res.status(400).json({ success: false, message: 'questions array is required' });

  db.query(
    `SELECT cl.id FROM course_levels cl
     INNER JOIN courses c ON c.id = cl.course_id
     WHERE cl.id = ? AND c.teacher_id = ?`,
    [levelCourseId, req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      if (!rows.length)
        return res.status(404).json({ success: false, message: 'Level not found or unauthorized' });

      // Delete old questions for this level
      db.query('DELETE FROM quiz_questions WHERE course_level_id = ?', [levelCourseId], (err2) => {
        if (err2) return res.status(500).json({ success: false, message: 'Error resetting questions' });

        const rows = questions.map(q => [
          levelCourseId,
          q.question_text,
          JSON.stringify(q.options || []),
          q.correct_answer_index ?? 0,
        ]);

        db.query(
          'INSERT INTO quiz_questions (course_level_id, question_text, options, correct_answer_index) VALUES ?',
          [rows],
          (err3, result) => {
            if (err3) return res.status(500).json({ success: false, message: 'Error saving questions' });
            return res.status(201).json({
              success: true,
              message: 'Quiz saved',
              inserted: result.affectedRows,
            });
          }
        );
      });
    }
  );
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  (EXISTING — unchanged) DELETE /api/quiz/levels/:levelCourseId
//  Teacher deletes quiz
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/levels/:levelCourseId', authTeacher, (req, res) => {
  const levelCourseId = parseInt(req.params.levelCourseId);
  if (isNaN(levelCourseId))
    return res.status(400).json({ success: false, message: 'Invalid level id' });

  db.query('DELETE FROM quiz_questions WHERE course_level_id = ?', [levelCourseId], (err) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    return res.status(200).json({ success: true, message: 'Quiz deleted' });
  });
});


module.exports = router;