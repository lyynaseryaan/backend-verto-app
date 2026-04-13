// ============================================================
//  routes/quizRoute.js  –  Verto LMS
//  Quiz CRUD — teacher side + student fetch
//  ✅ لا يمس content logic أبداً
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ━━━ AUTH MIDDLEWARE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function authTeacher(req, res, next) {
  const header = req.headers['authorization'];
  if (!header)
    return res.status(401).json({ success: false, message: 'No token provided' });

  const token = header.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(403).json({ success: false, message: 'Invalid token' });
    if (decoded.role !== 'teacher')
      return res.status(403).json({ success: false, message: 'Teachers only' });
    req.userId = decoded.id;
    next();
  });
}

function authAny(req, res, next) {
  const header = req.headers['authorization'];
  if (!header)
    return res.status(401).json({ success: false, message: 'No token provided' });

  const token = header.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(403).json({ success: false, message: 'Invalid token' });
    req.userId   = decoded.id;
    req.userRole = decoded.role;
    next();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/quiz/levels/:levelCourseId
//  Teacher creates or replaces quiz for a course level
//
//  Body:
//  {
//    "title": "Protein Synthesis Quiz",   // optional
//    "questions": [
//      {
//        "question_text": "Where does synthesis happen?",
//        "options": [
//          { "option_text": "Nucleus",   "is_correct": false },
//          { "option_text": "Ribosome",  "is_correct": true  },
//          { "option_text": "Golgi",     "is_correct": false },
//          { "option_text": "Lysosome",  "is_correct": false }
//        ]
//      }
//    ]
//  }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/levels/:levelCourseId', authTeacher, (req, res) => {
  const levelCourseId = parseInt(req.params.levelCourseId);
  if (isNaN(levelCourseId))
    return res.status(400).json({ success: false, message: 'Invalid level id' });

  const { title = 'Quiz', questions } = req.body;

  if (!questions || !Array.isArray(questions) || !questions.length)
    return res.status(400).json({ success: false, message: 'questions array is required' });

  // Verify the course_level belongs to this teacher
  db.query(
    `SELECT cl.id FROM course_levels cl
     INNER JOIN courses c ON c.id = cl.course_id
     WHERE cl.id = ? AND c.teacher_id = ?`,
    [levelCourseId, req.userId],
    (err, rows) => {
      if (err)
        return res.status(500).json({ success: false, message: 'Database error' });
      if (!rows.length)
        return res.status(404).json({ success: false, message: 'Level not found or unauthorized' });

      // Delete existing quiz for this level (cascade deletes questions + options)
      db.query(
        'DELETE FROM quizzes WHERE level_course_id = ?',
        [levelCourseId],
        (err2) => {
          if (err2)
            return res.status(500).json({ success: false, message: 'Error resetting quiz' });

          // Insert new quiz
          db.query(
            'INSERT INTO quizzes (level_course_id, title) VALUES (?, ?)',
            [levelCourseId, title],
            (err3, result) => {
              if (err3)
                return res.status(500).json({ success: false, message: 'Error creating quiz' });

              const quizId = result.insertId;

              // Insert questions one by one (with options)
              let remaining = questions.length;
              let hasError  = false;

              questions.forEach((q) => {
                if (hasError) return;

                db.query(
                  'INSERT INTO quiz_questions (quiz_id, question_text) VALUES (?, ?)',
                  [quizId, q.question_text],
                  (err4, qResult) => {
                    if (err4 || hasError) {
                      hasError = true;
                      return res.status(500).json({ success: false, message: 'Error saving question' });
                    }

                    const questionId = qResult.insertId;
                    const options    = q.options || [];

                    if (!options.length) {
                      remaining--;
                      if (remaining === 0 && !hasError) {
                        res.status(201).json({ success: true, message: 'Quiz saved', quizId });
                      }
                      return;
                    }

                    const optRows = options.map(o => [
                      questionId,
                      o.option_text,
                      o.is_correct ? 1 : 0,
                    ]);

                    db.query(
                      'INSERT INTO quiz_options (question_id, option_text, is_correct) VALUES ?',
                      [optRows],
                      (err5) => {
                        if (err5 && !hasError) {
                          hasError = true;
                          return res.status(500).json({ success: false, message: 'Error saving options' });
                        }
                        remaining--;
                        if (remaining === 0 && !hasError) {
                          res.status(201).json({ success: true, message: 'Quiz saved', quizId });
                        }
                      }
                    );
                  }
                );
              });
            }
          );
        }
      );
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/quiz/levels/:levelCourseId
//  Returns the quiz for a course level (teacher or student)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/levels/:levelCourseId', authAny, (req, res) => {
  const levelCourseId = parseInt(req.params.levelCourseId);
  if (isNaN(levelCourseId))
    return res.status(400).json({ success: false, message: 'Invalid level id' });

  const sql = `
    SELECT
      qz.id          AS quiz_id,
      qz.title       AS quiz_title,
      qq.id          AS question_id,
      qq.question_text,
      qo.id          AS option_id,
      qo.option_text,
      qo.is_correct
    FROM quizzes qz
    LEFT JOIN quiz_questions qq ON qq.quiz_id    = qz.id
    LEFT JOIN quiz_options   qo ON qo.question_id = qq.id
    WHERE qz.level_course_id = ?
    ORDER BY qq.id, qo.id`;

  db.query(sql, [levelCourseId], (err, rows) => {
    if (err)
      return res.status(500).json({ success: false, message: 'Database error' });
    if (!rows.length)
      return res.status(200).json({ success: true, quiz: null });

    // Shape flat rows into nested quiz object
    const quiz = _shapeQuiz(rows);
    res.status(200).json({ success: true, quiz });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DELETE /api/quiz/levels/:levelCourseId
//  Teacher deletes the quiz for a course level
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/levels/:levelCourseId', authTeacher, (req, res) => {
  const levelCourseId = parseInt(req.params.levelCourseId);
  if (isNaN(levelCourseId))
    return res.status(400).json({ success: false, message: 'Invalid level id' });

  db.query(
    'DELETE FROM quizzes WHERE level_course_id = ?',
    [levelCourseId],
    (err) => {
      if (err)
        return res.status(500).json({ success: false, message: 'Database error' });
      res.status(200).json({ success: true, message: 'Quiz deleted' });
    }
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HELPER — shapes flat DB rows into nested quiz object
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function _shapeQuiz(rows) {
  const quiz = {
    id:        rows[0].quiz_id,
    title:     rows[0].quiz_title,
    questions: [],
  };

  const questionMap = {};

  rows.forEach(row => {
    if (!row.question_id) return;

    if (!questionMap[row.question_id]) {
      questionMap[row.question_id] = {
        id:            row.question_id,
        question_text: row.question_text,
        options:       [],
      };
      quiz.questions.push(questionMap[row.question_id]);
    }

    if (row.option_id) {
      questionMap[row.question_id].options.push({
        id:          row.option_id,
        option_text: row.option_text,
        is_correct:  row.is_correct === 1,
      });
    }
  });

  return quiz;
}

module.exports = router;