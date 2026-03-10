const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");

// 🔒 Middleware للتحقق من الـ token
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ success: false, error: "No token provided" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ success: false, error: "Invalid token" });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, error: "Invalid token" });
    req.userId = decoded.id;
    next();
  });
}

// GET QUESTION (محمي)
router.get("/quiz/question/:id", verifyToken, (req, res) => {
  const id = req.params.id;
  db.query(
    "SELECT id, question, option1, option2, option3, option4 FROM questions WHERE id=?",
    [id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.length === 0) return res.status(404).json({ error: "Question not found" });
      res.json(result[0]);
    }
  );
});

// CHECK ANSWER (محمي)
router.post("/quiz/check", verifyToken, (req, res) => {
  const { questionId, selectedOption } = req.body;
  db.query(
    "SELECT correct_option FROM questions WHERE id=?",
    [questionId],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.length === 0) return res.status(404).json({ error: "Question not found" });

      const correct = result[0].correct_option;
      res.json({
        correct: selectedOption === correct,
        correctOption: correct
      });
    }
  );
});

module.exports = router;