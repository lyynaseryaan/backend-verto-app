// routes/profile.js
// أضيفي هذا الملف في مجلد routes الخاص بـ Verto

const express = require('express');
const router = express.Router();
const db = require('../db'); // استخدمي مسار قاعدة البيانات الموجود
const { verifyToken } = require('../middleware/auth'); // middleware الـ JWT الموجود

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/profile
// يرجع: معلومات المستخدم + الإحصائيات
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id; // من الـ JWT payload

    // ── 1. معلومات المستخدم الأساسية ──
    const [userRows] = await db.promise().query(
      `SELECT id, name, email, role, selected_level
        FROM users
        WHERE id = ?`
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userRows[0];

    // ── 2. عدد الكورسات المسجلة ──
    const [enrolledRows] = await db.promise().query(
      `SELECT COUNT(*) AS total_courses
       FROM enrollments
       WHERE student_id = ?`,
      [userId]
    );

    // ── 3. عدد الكورسات المكتملة (progress = 100%) ──
    const [completedRows] = await db.promise().query(
      `SELECT COUNT(*) AS completed_courses
       FROM enrollments
       WHERE student_id = ? AND progress = 100`,
      [userId]
    );

    // ── 4. عدد الكويزات التي أجراها ──
    const [quizRows] = await db.promise().query(
      `SELECT COUNT(*) AS total_quizzes
       FROM quiz_attempts
       WHERE student_id = ?`,
      [userId]
    );

    // ── 5. تجميع الاستجابة ──
    const profileData = {
      user: {
        id: user.id,
        full_name: user.name,
        email: user.email,
        role: user.role,
        specialization: user.selected_level || 'Student',
      },
      stats: {
        courses: enrolledRows[0].total_courses,
        completed: completedRows[0].completed_courses,
        quizzes: quizRows[0].total_quizzes,
      },
    };

    return res.status(200).json(profileData);

  } catch (error) {
    console.error('Profile fetch error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;