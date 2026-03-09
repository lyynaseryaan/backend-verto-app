const express = require("express");
const router = express.Router();
const db = require("../db");

// GET QUESTION
router.get("/question/:id", (req,res)=>{
  const id = req.params.id;
  db.query(
    "SELECT id,question,option1,option2,option3,option4 FROM questions WHERE id=?",
    [id],
    (err,result)=>{
      if(err) return res.status(500).json({error: err.message});
      if(result.length===0) return res.status(404).json({error:"Question not found"});
      res.json(result[0]);
    }
  );
});

// CHECK ANSWER
router.post("/check", (req,res)=>{
  const {questionId,selectedOption} = req.body;
  db.query(
    "SELECT correct_option FROM questions WHERE id=?",
    [questionId],
    (err,result)=>{
      if(err) return res.status(500).json({error: err.message});
      if(result.length===0) return res.status(404).json({error:"Question not found"});
      const correct = result[0].correct_option;
      res.json({
        correct: selectedOption===correct,
        correctOption: correct
      });
    }
  );
});

module.exports = router;