const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const { verifyToken } = require('../middleware/auth');
const db = require('../db');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Helper ───────────────────────────────────────────────────────────────────
const query = (sql, params) =>
  new Promise((resolve, reject) =>
    db.query(sql, params, (err, result) => (err ? reject(err) : resolve(result)))
  );

async function getStudentProfile(userId) {
  try {
    const [user] = await query('SELECT name FROM users WHERE id = ?', [userId]);
    const [student] = await query('SELECT current_level FROM students WHERE user_id = ?', [userId]);
    const courses = await query(
      `SELECT c.title FROM student_courses sc
       JOIN courses c ON sc.course_id = c.id
       WHERE sc.user_id = ?`, [userId]
    );
    const quizzes = await query(
      'SELECT score FROM results WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [userId]
    );
    const avgScore = quizzes.length
      ? Math.round(quizzes.reduce((s, r) => s + r.score, 0) / quizzes.length)
      : null;

    return {
      name: user?.name || 'Student',
      level: student?.current_level || 'Beginner',
      courses: courses.map((c) => c.title),
      avgScore,
    };
  } catch {
    return { name: 'Student', level: 'Beginner', courses: [], avgScore: null };
  }
}

function buildSystemPrompt(profile) {
  const coursesText = profile.courses.length > 0 ? profile.courses.join(', ') : 'No courses enrolled yet';
  const scoreText = profile.avgScore !== null ? `${profile.avgScore}%` : 'No quiz taken yet';

  return `You are a helpful educational assistant for a learning platform called Verto.

Student profile:
- Name: ${profile.name}
- Current level: ${profile.level}
- Enrolled courses: ${coursesText}
- Average quiz score: ${scoreText}

STRICT RULES:
- ONLY answer questions related to: Biology, Science, Math, Physics, and the student's courses
- If asked about anything else (politics, religion, entertainment...) say: "I can only help with educational topics"
- Never answer in more than 150 words
- Always encourage the student
- Respond in the same language the student uses
- If student asks about a topic not in their courses, suggest they enroll first`;
}

// ─── POST /api/chatbot/chat ───────────────────────────────────────────────────
router.post('/chat', verifyToken, async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const profile = await getStudentProfile(req.user.id);
    const systemPrompt = buildSystemPrompt(profile);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history
        .filter((m) => m.role && m.content)
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
      { role: 'user', content: message.trim() },
    ];

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages,
      max_tokens: 300,
    });

    const reply = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
    res.json({ reply });
  } catch (err) {
    console.error('[POST /chatbot/chat]', err);
    res.status(500).json({ error: 'Failed to get response from AI' });
  }
});

module.exports = router;