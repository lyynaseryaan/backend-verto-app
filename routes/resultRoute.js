// ============================================================
//  resultRoute.js  –  Verto LMS
//  ✅ After calculating level → saves it to students table
//     so the dashboard can read it immediately without re-login
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

      // ✅ Save level to students table so dashboard reads it directly
      // Run this SQL first if column doesn't exist:
      // ALTER TABLE students ADD COLUMN current_level VARCHAR(20) DEFAULT 'Beginner';
      db.query(
        "UPDATE students SET current_level = ? WHERE id = ?",
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
    "SELECT current_level FROM students WHERE id = ?",
    [req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.status(404).json({ error: "Student not found" });
      res.json({ level: rows[0].current_level ?? "Beginner" });
    }
  );
});

module.exports = router;