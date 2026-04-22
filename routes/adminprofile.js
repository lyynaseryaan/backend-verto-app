// routes/adminProfile.js
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ─────────────────────────────────────────
// MIDDLEWARE: Admin only
// ─────────────────────────────────────────
function adminOnly(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'Malformed token' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    }
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied. Admins only.' });
    }
    req.user = decoded;
    next();
  });
}

// ─────────────────────────────────────────
// GET /api/admin/profile
// Returns: admin info + dynamic stats (teacher count, student count)
// ─────────────────────────────────────────
router.get('/profile', adminOnly, (req, res) => {
  const adminId = req.user.id;

  // 1. Fetch admin user info
  db.query(
    'SELECT id, name, email, language, created_at FROM users WHERE id = ? AND role = ?',
    [adminId, 'admin'],
    (err, adminRows) => {
      if (err) {
        console.error('Error fetching admin:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (adminRows.length === 0) {
        return res.status(404).json({ success: false, error: 'Admin not found' });
      }

      const admin = adminRows[0];

      // 2. Fetch dynamic stats from users table
      db.query(
        `SELECT
           SUM(role = 'teacher') AS teacherCount,
           SUM(role = 'student') AS studentCount,
           COUNT(*) AS totalUsers
         FROM users`,
        (err2, statsRows) => {
          if (err2) {
            console.error('Error fetching stats:', err2);
            return res.status(500).json({ success: false, error: 'Database error' });
          }

          const stats = statsRows[0];

          return res.status(200).json({
            success: true,
            admin: {
              id:        admin.id,
              name:      admin.name,
              email:     admin.email,
              language:  admin.language || 'en',
              createdAt: admin.created_at,
            },
            stats: {
              teachers:   parseInt(stats.teacherCount)  || 0,
              students:   parseInt(stats.studentCount)  || 0,
              totalUsers: parseInt(stats.totalUsers)    || 0,
            },
          });
        }
      );
    }
  );
});

// ─────────────────────────────────────────
// PATCH /api/admin/profile
// Body: { name?, language? }
// Updates admin name and/or language in DB
// ─────────────────────────────────────────
router.patch('/profile', adminOnly, (req, res) => {
  const adminId = req.user.id;
  const { name, language } = req.body;

  if (!name && !language) {
    return res.status(400).json({ success: false, error: 'Nothing to update' });
  }

  const fields = [];
  const params = [];

  if (name && name.trim() !== '') {
    fields.push('name = ?');
    params.push(name.trim());
  }

  if (language && language.trim() !== '') {
    fields.push('language = ?');
    params.push(language.trim());
  }

  params.push(adminId);

  db.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ? AND role = 'admin'`,
    params,
    (err, result) => {
      if (err) {
        console.error('Error updating admin profile:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, error: 'Admin not found' });
      }

      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
      });
    }
  );
});

module.exports = router;