const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// REGISTER
router.post('/register', async (req, res) => {
    const { full_name, email, password } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    db.query(
        "INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)",
        [full_name, email, hashedPassword],
        (err, result) => {
            if (err) return res.status(400).json({ error: err.message });

            res.json({ message: "User registered successfully" });
        }
    );
});

// LOGIN
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  const sql = "SELECT * FROM users WHERE email = ?";

  db.query(sql, [email], (err, result) => {
    if (err) return res.status(500).json({ success: false });

    if (result.length === 0) {
      return res.json({ success: false });
    }

    if (result[0].password !== password) {
      return res.json({ success: false });
    }

    res.json({ success: true });
  });
});

module.exports = router;
