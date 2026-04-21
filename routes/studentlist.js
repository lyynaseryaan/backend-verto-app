const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

// =========================
// MIDDLEWARE: Admin Only
// =========================
function adminOnly(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        return res.status(401).json({ success: false, error: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ success: false, error: "Invalid token" });
        }

        if (decoded.role !== "admin") {
            return res.status(403).json({ success: false, error: "Access denied. Admins only." });
        }

        req.user = decoded;
        next();
    });
}

// =========================
// GET ALL STUDENTS
// Query param: ?name=xxx (optional search by name)
// =========================
router.get('/', adminOnly, (req, res) => {
    const { name } = req.query;

    let sql = `
        SELECT 
            s.id,
            s.user_id,
            u.name,
            u.email,
            s.current_level,
            s.created_at
        FROM students s
        JOIN users u ON s.user_id = u.id
    `;

    const params = [];

    if (name && name.trim() !== '') {
        sql += ' WHERE u.name LIKE ?';
        params.push(`%${name.trim()}%`);
    }

    sql += ' ORDER BY s.created_at DESC';

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error("Error fetching students:", err);
            return res.status(500).json({ success: false, error: "Database error" });
        }

        return res.status(200).json({
            success: true,
            count: results.length,
            students: results
        });
    });
});

// =========================
// DELETE STUDENT BY ID
// Deletes from both students and users tables
// =========================
router.delete('/:id', adminOnly, (req, res) => {
    const studentId = parseInt(req.params.id);

    if (isNaN(studentId)) {
        return res.status(400).json({ success: false, error: "Invalid student ID" });
    }

    // First get the user_id so we can delete from users table too
    db.query("SELECT user_id FROM students WHERE id = ?", [studentId], (err, result) => {
        if (err) {
            return res.status(500).json({ success: false, error: "Database error" });
        }

        if (result.length === 0) {
            return res.status(404).json({ success: false, error: "Student not found" });
        }

        const userId = result[0].user_id;

        // Delete from students first (foreign key safety)
        db.query("DELETE FROM students WHERE id = ?", [studentId], (err2) => {
            if (err2) {
                return res.status(500).json({ success: false, error: "Failed to delete student record" });
            }

            // Then delete from users
            db.query("DELETE FROM users WHERE id = ?", [userId], (err3) => {
                if (err3) {
                    console.error("Warning: student deleted but user record remains:", err3);
                }

                return res.status(200).json({
                    success: true,
                    message: "Student deleted successfully"
                });
            });
        });
    });
});

module.exports = router;