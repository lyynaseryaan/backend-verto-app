// routes/profile.js
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const jwt     = require('jsonwebtoken');

// ─────────────────────────────────────────
// MIDDLEWARE: Auth
// ─────────────────────────────────────────
function studentAuth(req, res, next) {
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
    req.user = decoded;
    next();
  });
}

// ─────────────────────────────────────────
// GET /api/profile
// Returns: user info + stats (courses, completed, quizzes)
// ─────────────────────────────────────────
router.get('/', studentAuth, (req, res) => {
  const userId = req.user.id;

  // 1. معلومات المستخدم
  db.query(
    'SELECT id, name, email, role, selected_level FROM users WHERE id = ?',
    [userId],
    (err, userRows) => {
      if (err) {
        console.error('Error fetching user:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (userRows.length === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const user = userRows[0];

      // 2. عدد الكورسات المسجلة
      db.query(
        'SELECT COUNT(*) AS total_courses FROM enrollments WHERE student_id = ?',
        [userId],
        (err2, enrolledRows) => {
          if (err2) {
            console.error('Error fetching enrollments:', err2);
            return res.status(500).json({ success: false, error: 'Database error' });
          }

          const totalCourses = parseInt(enrolledRows[0].total_courses) || 0;

          // 3. عدد الكورسات المكتملة
          db.query(
            'SELECT COUNT(*) AS completed_courses FROM enrollments WHERE student_id = ? AND progress = 1',
            [userId],
            (err3, completedRows) => {
              if (err3) {
                console.error('Error fetching completed:', err3);
                return res.status(500).json({ success: false, error: 'Database error' });
              }

              const completedCourses = parseInt(completedRows[0].completed_courses) || 0;

              // 4. عدد الكويزات
              db.query(
                'SELECT COUNT(*) AS total_quizzes FROM quiz_attempts WHERE student_id = ?',
                [userId],
                (err4, quizRows) => {
                  if (err4) {
                    console.error('Error fetching quizzes:', err4);
                    return res.status(500).json({ success: false, error: 'Database error' });
                  }

                  const totalQuizzes = parseInt(quizRows[0].total_quizzes) || 0;

                  return res.status(200).json({
                    success: true,
                    user: {
                      id:             user.id,
                      full_name:      user.name,
                      email:          user.email,
                      role:           user.role,
                      specialization: user.selected_level || 'Student',
                    },
                    stats: {
                      courses:   totalCourses,
                      completed: completedCourses,
                      quizzes:   totalQuizzes,
                    },
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

module.exports = router;