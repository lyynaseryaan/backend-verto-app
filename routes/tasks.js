const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

// ─── helper: verify token ───
function auth(req, res, next) {
  const header = req.headers["authorization"];
  if (!header) return res.status(401).json({ success: false, message: "No token provided" });
  const token = header.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, message: "Invalid token" });
    req.userId = decoded.id;
    next();
  });
}

// ================= GET ALL TASKS =================
router.get('/', auth, (req, res) => {
  const sql = `SELECT id, title, duration, status, start_time, end_time 
               FROM tasks 
               WHERE user_id = ? 
               ORDER BY created_at DESC`;

  db.query(sql, [req.userId], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });
    res.status(200).json({ success: true, tasks: results });
  });
});
// ================= ADD TASK =================
router.post('/add', auth, (req, res) => {
  const { title, duration } = req.body;

  const checkSql = "SELECT COUNT(*) as total FROM tasks WHERE user_id = ? AND status != 'completed'";
  db.query(checkSql, [req.userId], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });

    if (result[0].total >= 5) {
      return res.status(400).json({ success: false, message: "Maximum 5 tasks allowed" });
    }

    const insertSql = "INSERT INTO tasks (user_id, title, duration, status) VALUES (?, ?, ?, 'pending')";
    db.query(insertSql, [req.userId, title, duration], (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Database error" });
      res.status(201).json({
        success: true,
        message: "Task added successfully",
        taskId: result.insertId
      });
    });
  });
});

// ================= START TASK =================
router.post('/start/:id', auth, (req, res) => {
  const sql = `UPDATE tasks 
               SET start_time = NOW(), 
                   end_time = DATE_ADD(NOW(), INTERVAL duration MINUTE), 
                   status = 'running' 
               WHERE id = ? AND user_id = ?`;

  db.query(sql, [req.params.id, req.userId], (err) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });
    res.json({ success: true, message: "Task started" });
  });
});

// ================= COMPLETE TASK =================
router.post('/complete/:id', auth, (req, res) => {
  const sql = "UPDATE tasks SET status = 'completed' WHERE id = ? AND user_id = ?";
  db.query(sql, [req.params.id, req.userId], (err) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });
    res.status(200).json({ success: true, message: "Task completed" });
  });
});

// ================= DELETE TASK =================
router.delete('/delete/:id', auth, (req, res) => {
  const sql = "DELETE FROM tasks WHERE id = ? AND user_id = ?";
  db.query(sql, [req.params.id, req.userId], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "Task not found" });
    res.status(200).json({ success: true, message: "Task deleted" });
  });
});

module.exports = router;