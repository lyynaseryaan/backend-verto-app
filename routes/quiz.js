const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");


// ======================
// VERIFY TOKEN
// ======================
function verifyToken(req, res, next) {

  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).json({
      message: "No token provided"
    });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {

    if (err) {
      return res.status(403).json({
        message: "Invalid token"
      });
    }

    req.userId = decoded.id;
    req.role = decoded.role;   // 👈 نجيب role

    // 👇 student فقط
    if (req.role !== "student") {
      return res.status(403).json({
        message: "Only students can access quiz"
      });
    }

    next();
  });
}


// ======================
// GET QUESTION
// ======================
router.get("/quiz/question/:id", verifyToken, (req, res) => {

  const questionId = req.params.id;

  const sql = `
  SELECT id, question, option1, option2, option3, option4
  FROM questions
  WHERE id = ?
  `;

  db.query(sql, [questionId], (err, result) => {

    if (err) {
      console.log(err);
      return res.status(500).json({ error: err.message });
    }

    if (result.length === 0) {
      return res.status(404).json({
        message: "Question not found"
      });
    }

    res.json(result[0]);
  });

});


// ======================
// CHECK ANSWER
// ======================
router.post("/quiz/check", verifyToken, (req, res) => {

  const { questionId, selectedOption } = req.body;
  const studentId = req.userId;

  if (!questionId || !selectedOption) {
    return res.status(400).json({
      message: "Missing data"
    });
  }

  const insertSql = `
  INSERT INTO student_answers
  (student_id, question_id, selected_option)
  VALUES (?, ?, ?)
  `;

  db.query(insertSql, [studentId, questionId, selectedOption], (err) => {

    if (err) {
      console.log("INSERT ERROR:", err);
      return res.status(500).json({ error: err.message });
    }

    const checkSql = `
    SELECT correct_option
    FROM questions
    WHERE id = ?
    `;

    db.query(checkSql, [questionId], (err, result) => {

      if (err) {
        return res.status(500).json({ error: err.message });
      }

      const correctOption = result[0].correct_option;

      res.json({
        correct: selectedOption == correctOption,
        correctOption: correctOption
      });

    });

  });

});

module.exports = { router, verifyToken };