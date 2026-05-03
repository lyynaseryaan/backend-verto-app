const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ━━━ AUTH MIDDLEWARE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ success: false, error: 'No token provided' });
  const token = header.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, error: 'Invalid token' });
    req.userId   = decoded.id;
    req.userName = decoded.name || 'Student';
    next();
  });
}

// ━━━ POST /api/update-level (الأصلي — بدون تعديل) ━━━━━━━━━
router.post('/update-level', (req, res) => {

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {

    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid token' });
    }

    const user_id = decoded.id;
    const { selected_level } = req.body;

    if (!selected_level) {
      return res.status(400).json({ success: false, error: 'Missing selected_level' });
    }

    const allowedLevels = ['beginner', 'assessment'];

    if (!allowedLevels.includes(selected_level)) {
      return res.status(400).json({ success: false, error: 'Invalid level' });
    }

    db.query(
      'UPDATE users SET selected_level = ? WHERE id = ?',
      [selected_level, user_id],
      (err, result) => {

        if (err) {
          console.error(err);
          return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }

        return res.json({ success: true });
      }
    );

  });

});

// ━━━ GET /api/upgrade-check ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// يتحقق هل الطالب مؤهل للترقي:
// - أكمل 7+ كويزات
// - معدل نتائجه > 70%
// - مستواه Beginner أو Intermediate فقط
router.get('/upgrade-check', auth, (req, res) => {

  db.query(
    'SELECT current_level FROM students WHERE user_id = ? LIMIT 1',
    [req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: 'Database error' });
      if (!rows.length) return res.status(404).json({ success: false, error: 'Student not found' });

      const currentLevel = rows[0].current_level;

      if (currentLevel === 'Advanced') {
        return res.json({ success: true, eligible: false, reason: 'Already at highest level' });
      }

      const nextLevel = currentLevel === 'Beginner' ? 'Intermediate' : 'Advanced';

      db.query(
        `SELECT score_percentage FROM quiz_attempts
         WHERE student_id = ? AND level = ?
         ORDER BY attempted_at ASC`,
        [req.userId, currentLevel],
        (err2, attempts) => {
          if (err2) return res.status(500).json({ success: false, error: 'Database error' });

          const total = attempts.length;

          if (total < 7) {
            return res.json({
              success:          true,
              eligible:         false,
              quizzesCompleted: total,
              quizzesRequired:  7,
              currentLevel,
              nextLevel,
            });
          }

          const avg = attempts.reduce((sum, a) => sum + a.score_percentage, 0) / total;

          return res.json({
            success:          true,
            eligible:         avg > 70,
            averageScore:     Math.round(avg),
            quizzesCompleted: total,
            quizzesRequired:  7,
            currentLevel,
            nextLevel,
          });
        }
      );
    }
  );
});

// ━━━ POST /api/upgrade ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// يرقّي الطالب للمستوى الأعلى في جدول students
router.post('/upgrade', auth, (req, res) => {
  db.query(
    'SELECT current_level FROM students WHERE user_id = ? LIMIT 1',
    [req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: 'Database error' });
      if (!rows.length) return res.status(404).json({ success: false, error: 'Student not found' });

      const currentLevel = rows[0].current_level;
      if (currentLevel === 'Advanced')
        return res.status(400).json({ success: false, error: 'Already at highest level' });

      const nextLevel = currentLevel === 'Beginner' ? 'Intermediate' : 'Advanced';

      db.query(
        'UPDATE students SET current_level = ? WHERE user_id = ?',
        [nextLevel, req.userId],
        (err2) => {
          if (err2) return res.status(500).json({ success: false, error: 'Database error' });
          return res.json({ success: true, newLevel: nextLevel });
        }
      );
    }
  );
});

// ━━━ POST /api/coach-message ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// يولّد رسالة تشجيعية مخصصة عبر Groq AI
router.post('/coach-message', auth, async (req, res) => {
  const { studentName, averageScore, quizzesCompleted, currentLevel, nextLevel } = req.body;

  const prompt = `You are a friendly and encouraging learning coach in an educational app called Verto LMS.

Write a short, personalized motivational message (2-3 sentences max) for a student who has unlocked a level upgrade.

Student details:
- Name: ${studentName}
- Current level: ${currentLevel}
- Next level: ${nextLevel}
- Average quiz score: ${averageScore}%
- Quizzes completed: ${quizzesCompleted}

Rules:
- Address the student by name
- Be warm, encouraging, and specific about their achievement
- Mention the transition from ${currentLevel} to ${nextLevel}
- Keep it concise and natural
- Write in English only
- Return plain text only, no JSON, no formatting`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY2}`,
      },
      body: JSON.stringify({
        model:      'llama-3.3-70b-versatile',
        max_tokens: 150,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) throw new Error('Groq error');

    const data    = await response.json();
    const message = data.choices?.[0]?.message?.content?.trim() || '';

    return res.json({ success: true, message });
  } catch (err) {
    console.error('[coach-message] AI error:', err.message);
    return res.json({
      success: true,
      message: `Great job, ${studentName}! You've averaged ${averageScore}% across ${quizzesCompleted} quizzes — you're more than ready to move from ${currentLevel} to ${nextLevel}. Keep up the excellent work!`,
    });
  }
});

module.exports = router;