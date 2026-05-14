// ============================================================
//  resultRoute.js  –  Verto LMS
//  ✅ After calculating level → saves it to student_results
//     and updates current_level in students table
// ============================================================

const express = require("express");
const router  = express.Router();
const db      = require("../db");
const { verifyToken } = require("./quiz");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/result
//  Calculates quiz result, saves it, and updates student level
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/", verifyToken, (req, res) => {
  const studentId = req.userId;

  const sql = `
    SELECT q.subject, q.correct_option, sa.selected_option
    FROM student_answers sa
    JOIN questions q ON sa.question_id = q.id
    WHERE sa.student_id = ?
  `;

  db.query(sql, [studentId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    db.query("SELECT COUNT(*) AS total FROM questions", (err, countResult) => {
      if (err) return res.status(500).json({ error: err.message });

      const total = countResult[0].total;
      let correct = 0;

      let subjects = {
        Mathematics: { correct: 0, total: 0 },
        Physics:     { correct: 0, total: 0 },
        Science:     { correct: 0, total: 0 },
      };

      results.forEach(r => {
        if (subjects[r.subject]) subjects[r.subject].total++;
        if (r.selected_option == r.correct_option) {
          correct++;
          if (subjects[r.subject]) subjects[r.subject].correct++;
        }
      });

      const accuracy = total ? correct / total : 0;

      let level = "Beginner";
      if (accuracy >= 0.7)      level = "Advanced";
      else if (accuracy >= 0.4) level = "Intermediate";

      const subjectResults = {
        Mathematics: subjects.Mathematics.total
          ? subjects.Mathematics.correct / subjects.Mathematics.total : 0,
        Physics: subjects.Physics.total
          ? subjects.Physics.correct / subjects.Physics.total : 0,
        Science: subjects.Science.total
          ? subjects.Science.correct / subjects.Science.total : 0,
      };

      // ── Save to student_results ──────────────────────────
      const insertResult = `
        INSERT INTO student_results (student_id, correct, total, accuracy, level)
        VALUES (?, ?, ?, ?, ?)
      `;
      db.query(insertResult, [studentId, correct, total, accuracy, level],
        (err) => { if (err) console.error("Error saving result:", err); }
      );

      // ✅ Update level in students table via user_id
      db.query(
        "UPDATE students SET current_level = ? WHERE user_id = ?",
        [level, studentId],
        (err) => { if (err) console.error("Error updating student level:", err); }
      );

      // Return result to Flutter
      res.json({ correct, total, accuracy, level, subjects: subjectResults });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/result/level
//  Dashboard calls this to get the student's current level
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/level", verifyToken, (req, res) => {
  db.query(
    "SELECT current_level FROM students WHERE user_id = ?",
    [req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.status(404).json({ error: "Student not found" });
      res.json({ level: rows[0].current_level ?? "Beginner" });
    }
  );
});

module.exports = router;
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/result/roadmap
//  Generates a personalized learning roadmap using Groq
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post("/roadmap", verifyToken, async (req, res) => {
  const { correct, total, level, subjects } = req.body;

  const mathPct    = Math.round((subjects?.Mathematics ?? 0) * 100);
  const physicsPct = Math.round((subjects?.Physics     ?? 0) * 100);
  const sciencePct = Math.round((subjects?.Science     ?? 0) * 100);

  const prompt = `You are an educational AI assistant in Verto, an adaptive learning app.
A student just completed a level assessment quiz with these results:
- Score: ${correct}/${total}
- Assigned Level: ${level}
- Mathematics: ${mathPct}%
- Physics: ${physicsPct}%
- Science: ${sciencePct}%

Suggest a personalized learning roadmap in 3-4 short numbered points:
1. Which subject to start with (weakest first)
2. Which level to focus on
3. A short motivational tip

Keep it brief, clear, and encouraging. Use numbered points only.`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY2}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    const roadmap = data.choices?.[0]?.message?.content ?? "Could not generate roadmap.";
    res.json({ success: true, roadmap });
  } catch (err) {
    console.error("Groq roadmap error:", err);
    res.status(500).json({ success: false, message: "Failed to generate roadmap" });
  }
});