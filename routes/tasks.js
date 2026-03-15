const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');


// ================= ADD TASK =================
router.post('/add', (req, res) => {

    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        return res.status(401).json({
            success: false,
            message: "No token provided"
        });
    }

    const token = authHeader.split(" ")[1];

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {

        if (err) {
            return res.status(403).json({
                success: false,
                message: "Invalid token"
            });
        }

        const userId = decoded.id;
        const { title, duration } = req.body;

        // check max 5 tasks
        const checkSql = 
        "SELECT COUNT(*) as total  FROM tasks  WHERE user_id = ? AND status != 'completed'";
        

        db.query(checkSql, [userId], (err, result) => {

            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Database error"
                });
            }

            if (result[0].total >= 5) {
                return res.status(400).json({
                    success: false,
                    message: "Maximum 5 tasks allowed"
                });
            }

            const insertSql = 
           " INSERT INTO tasks (user_id, title, duration) VALUES (?, ?, ?)";
            

            db.query(insertSql, [userId, title, duration], (err, result) => {

                if (err) {
                    return res.status(500).json({
                        success: false,
                        message: "Database error"
                    });
                }

                res.status(201).json({
                    success: true,
                    message: "Task added successfully"
                });

            });

        });

    });

});
// ================= START TASK =================
router.post('/start/:id', (req, res) => {

  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: "No token provided"
    });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {

    if (err) {
      return res.status(403).json({
        success: false,
        message: "Invalid token"
      });
    }

    const userId = decoded.id;
    const taskId = req.params.id;

    const sql = 
     " UPDATE tasks SET  start_time = NOW(), end_time = DATE_ADD(NOW(), INTERVAL duration MINUTE), status = 'running' WHERE id = ? AND user_id = ?";
    

    db.query(sql, [taskId, userId], (err, result) => {

      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database error"
        });
      }

      res.json({
        success: true,
        message: "Task started successfully"
      });

    });

  });

});

module.exports = router;