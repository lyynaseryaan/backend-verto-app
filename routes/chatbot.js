const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { verifyToken } = require('../middleware/auth');
const db = require('../db');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Helper: get student profile from DB ─────────────────────────────────────
const query = (sql, params) =>
  new Promise((resolve, reject) =>
    db.query(sql, params, (err, result) => (err ? reject(err) : resolve(result)))
  );

async function getStudentProfile(userId) {
  try {
    const [user] = await query(
      'SELECT name, role FROM users WHERE id = ?',
      [userId]
    );
    const [student] = await query(
      'SELECT current_level FROM students WHERE user_id = ?',
      [userId]
    );
    const courses = await query(
      `SELECT c.title FROM student_courses sc
       JOIN courses c ON sc.course_id = c.id
       WHERE sc.user_id = ?`,
      [userId]
    );
    const quizzes = await query(
      `SELECT score FROM results WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
      [userId]
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
  const coursesText =
    profile.courses.length > 0
      ? profile.courses.join(', ')
      : 'No courses enrolled yet';

  const scoreText =
    profile.avgScore !== null
      ? `${profile.avgScore}%`
      : 'No quiz taken yet';

  return `You are a helpful educational assistant for a learning platform called Verto.

Student profile:
- Name: ${profile.name}
- Current level: ${profile.level}
- Enrolled courses: ${coursesText}
- Average quiz score: ${scoreText}

Rules:
- If level is Beginner: use simple language and analogies, avoid complex terms
- If level is Intermediate: balance simplicity with technical terms
- If level is Advanced: use technical terminology and propose challenges
- Always encourage the student and stay positive
- Keep responses under 150 words
- If asked about something unrelated to learning, politely redirect to studies
- Always respond in the same language the student uses`;
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

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: systemPrompt,
    });

    // Build chat history for context
    const chatHistory = history
      .filter((m) => m.role && m.content)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(message.trim());
    const reply = result.response.text();

    res.json({ reply });
  } catch (err) {
    console.error('[POST /chatbot/chat]', err);
    res.status(500).json({ error: 'Failed to get response from AI' });
  }
});

module.exports = router;