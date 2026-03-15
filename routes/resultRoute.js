const express = require("express");
const router = express.Router();
const db = require("../db");
const { verifyToken } = require("./quiz"); // middleware من quizRoutes

// ======================
// GET RESULT & SAVE
// ======================
router.get("/", verifyToken, (req, res) => {
  const studentId = req.userId;

  // جلب كل الإجابات تاع الطالب
  const sql = `
    SELECT q.subject, q.correct_option, sa.selected_option
    FROM student_answers sa
    JOIN questions q ON sa.question_id = q.id
    WHERE sa.student_id = ?
  `;

  db.query(sql, [studentId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    const total = results.length;
    let correct = 0;

    let subjects = {
      Mathematics: { correct: 0, total: 0 },
      Physics: { correct: 0, total: 0 },
      Science: { correct: 0, total: 0 },
    };

    results.forEach(r => {
      subjects[r.subject].total++;
      if (r.selected_option == r.correct_option) {
        correct++;
        subjects[r.subject].correct++;
      }
    });

    const accuracy = total ? correct / total : 0;

    // تحديد المستوى
    let level = "Beginner";
    if (accuracy >= 0.7) level = "Advanced";
    else if (accuracy >= 0.4) level = "Intermediate";

    // حفظ النتيجة في student_results
    const insertResult = `
      INSERT INTO student_results
      (student_id, correct, total, accuracy, level)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(insertResult, [studentId, correct, total, accuracy, level], (err) => {
      if (err) console.log("Error saving result:", err);
    });

    // حساب نسبة النجاح لكل مادة
    const subjectResults = {
      Mathematics: subjects.Mathematics.total ? subjects.Mathematics.correct / subjects.Mathematics.total : 0,
      Physics: subjects.Physics.total ? subjects.Physics.correct / subjects.Physics.total : 0,
      Science: subjects.Science.total ? subjects.Science.correct / subjects.Science.total : 0,
    };

    // إعادة JSON jjللـ frontend
    res.json({
      correct,
      total,
      accuracy,
      level,
      subjects: subjectResults,
    });
  });
});

module.exports = router;