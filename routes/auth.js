const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// =========================
// REGISTER
// =========================
router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        db.query(
            "INSERT INTO users (name, email, password, language) VALUES (?, ?, ?, ?)",
            [name, email, hashedPassword, 'ar'],
            (err, result) => {
                if (err) {
                    return res.status(400).json({
                        success: false,
                        error: err.message
                    });
                }

                const token = jwt.sign(
                    { id: result.insertId, email: email },
                    process.env.JWT_SECRET,  // ✅ استخدام secret من env
                    { expiresIn: "1d" }
                );

                return res.status(201).json({
                    success: true,
                    message: "User registered successfully",
                    token: token
                });
            }
        );
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =========================
// LOGIN
// =========================
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    const sql = "SELECT * FROM users WHERE email = ?";

    db.query(sql, [email], async (err, result) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error"
            });
        }
        if (result.length === 0) {
            return res.status(400).json({
                success: false,
                message: "User not found"
            });
        }

        const user = result[0];

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: "Wrong password"
            });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,  // ✅ استخدام secret من env
            { expiresIn: "1d" }
        );

        res.status(200).json({
            success: true,
            message: "Login successful",
            token: token
        });
    });
});

// =========================
// UPDATE LANGUAGE (Protected)
// =========================
router.post('/update-language', (req, res) => {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        return res.status(401).json({
            success: false,
            error: "No token provided"
        });
    }

    const token = authHeader.split(" ")[1];

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {  // ✅ استخدام secret من env
        if (err) {
            return res.status(403).json({
                success: false,
                error: "Invalid token"
            });
        }

        const userId = decoded.id;
        const { language } = req.body;

        const sql = "UPDATE users SET language = ? WHERE id = ?";

        db.query(sql, [language, userId], (err, result) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    error: "Database error"
                });
            }

            return res.status(200).json({
                success: true,
                message: "Language updated successfully"
            });
        });
    });
});

module.exports = router;