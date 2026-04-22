// ============================================================
//  resultRoute.js  –  Verto LMS
//  ✅ After calculating level → saves it to student_results
//     and updates current_level in students table
//  🤖 AI Agent: يشرح الأخطاء حسب مستوى الطالب via Groq
// ============================================================

const express = require("express");
const router  = express.Router();
const db      = require("../db");
const { verifyToken } = require("./quiz");

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL   = "llama-3.3-70b-versatile";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/result
//  Calculates quiz result, saves it, and updates student level
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/", verifyToken, (req, res) => {
  const studentId = req.userId;

  const sql = `
    SELECT q.subject, q.question, q.correct_option, sa.selected_option,
           q.option1, q.option2, q.option3, q.option4
    FROM student_answers sa
    JOIN questions q ON sa.question_id = q.id
    WHERE sa.student_id = ?
  `;

  db.query(sql, [studentId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    db.query("SELECT COUNT(*) AS total FROM questions", async (err, countResult) => {
      if (err) return res.status(500).json({ error: err.message });

      const total = countResult[0].total;
      let correct = 0;

      let subjects = {
        Mathematics: { correct: 0, total: 0 },
        Physics:     { correct: 0, total: 0 },
        Science:     { correct: 0, total: 0 },
      };

      const wrongQuestions = [];

      results.forEach(r => {
        if (subjects[r.subject]) subjects[r.subject].total++;
        if (r.selected_option == r.correct_option) {
          correct++;
          if (subjects[r.subject]) subjects[r.subject].correct++;
        } else {
          const options = [r.option1, r.option2, r.option3, r.option4];
          wrongQuestions.push({
            question:      r.question,
            subject:       r.subject,
            correctAnswer: options[r.correct_option - 1] || r.correct_option,
            studentAnswer: options[r.selected_option - 1] || r.selected_option,
          });
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
      db.query(
        "INSERT INTO student_results (student_id, correct, total, accuracy, level) VALUES (?, ?, ?, ?, ?)",
        [studentId, correct, total, accuracy, level],
        (err) => { if (err) console.error("Error saving result:", err); }
      );

      // ── Update level in students table ───────────────────
      db.query(
        "UPDATE students SET current_level = ? WHERE user_id = ?",
        [level, studentId],
        (err) => { if (err) console.error("Error updating student level:", err); }
      );

      // ── Call Groq AI ─────────────────────────────────────
      let ai = { explanations: [], nextStep: "proceed", nextStepMessage: "", coachMessage: "" };

      try {
        ai = await getAIExplanation(level, correct, total, wrongQuestions);
      } catch (aiErr) {
        console.error("AI explanation failed (non-blocking):", aiErr.message);
      }

      // ── Return result to Flutter ─────────────────────────
      res.json({ correct, total, accuracy, level, subjects: subjectResults, ai });
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  دالة Groq AI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function getAIExplanation(level, score, total, wrongQuestions) {
  if (wrongQuestions.length === 0) {
    return {
      explanations: [],
      nextStep: "proceed",
      nextStepMessage: "ممتاز! أجبت على كل الأسئلة بشكل صحيح 🎯",
      coachMessage: "أداؤك رائع، أنت جاهز للدرس التالي! 🚀",
    };
  }

  const accuracy = score / total;
  let nextStep = "proceed";
  if (accuracy < 0.4)      nextStep = "redo";
  else if (accuracy < 0.7) nextStep = "review";

  const levelDescription = {
    Beginner:     "مبتدئ - استخدم أمثلة من الحياة اليومية وشرح بسيط جداً",
    Intermediate: "متوسط - شرح واضح مع بعض التفاصيل التقنية",
    Advanced:     "متقدم - شرح تقني ومعمّق",
  };

  const wrongText = wrongQuestions
    .map((q, i) =>
      `السؤال ${i + 1}: ${q.question}\nالإجابة الصحيحة: ${q.correctAnswer}\nإجابة الطالب: ${q.studentAnswer}\nالمادة: ${q.subject}`
    )
    .join("\n\n");

  const prompt = `أنت مساعد تعليمي ذكي في تطبيق Verto LMS.
مستوى الطالب: ${level} (${levelDescription[level] || levelDescription["Beginner"]})
النتيجة: ${score} من ${total} (${Math.round(accuracy * 100)}%)

الطالب أخطأ في الأسئلة التالية:
${wrongText}

المطلوب:
1. اشرح كل سؤال أخطأ فيه بأسلوب يناسب مستواه
2. اكتب رسالة تشجيعية للخطوة التالية
3. اكتب رسالة من "Learning Coach" تحفّزه

أجب بـ JSON فقط بدون أي نص خارجه:
{
  "explanations": [
    { "question": "نص السؤال", "explanation": "الشرح بالعربي" }
  ],
  "nextStepMessage": "رسالة الخطوة التالية",
  "coachMessage": "رسالة المدرب التشجيعية"
}`;

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.GROQ_API_KEY2}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Groq API error:", err);
    throw new Error("Groq API failed");
  }

  const data    = await response.json();
  const rawText = data.choices?.[0]?.message?.content || "";
  const clean   = rawText.replace(/```json|```/g, "").trim();
  const parsed  = JSON.parse(clean);

  return {
    explanations:    parsed.explanations    || [],
    nextStep,
    nextStepMessage: parsed.nextStepMessage || "",
    coachMessage:    parsed.coachMessage    || "",
  };
}

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