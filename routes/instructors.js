// ============================================================
//  routes/instructors.js  –  Verto LMS
//  ✅ FIX 1: require('../db') صحيح — الملف في routes/ مباشرة
//  ✅ FIX 2: router.post('/') مرة واحدة فقط — حذفنا المكررة
//  ✅ FIX 3: فاصلة ناقصة في SQL بين i.id وi.subject
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');        // ✅ FIX 1: كان ../../db — صح الآن
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');

// ━━━ Admin-only middleware ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function adminAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header)
    return res.status(401).json({ success: false, message: 'No token provided' });

  const token = header.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    if (decoded.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Admin access required' });
    req.adminId = decoded.id;
    next();
  });
}

// ━━━ POST /api/instructors ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ✅ FIX 2: route واحدة فقط — دمجنا الـ subject مع التحقق الأول
router.post('/', adminAuth, async (req, res) => {
  const { name, email, password, subject } = req.body;

  // ── Validate ──────────────────────────────────────────
  if (!name || !name.trim())
    return res.status(400).json({ success: false, message: 'Name is required' });
  if (!email || !email.trim())
    return res.status(400).json({ success: false, message: 'Email is required' });
  if (!password || password.length < 6)
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  if (!subject || !subject.trim())
    return res.status(400).json({ success: false, message: 'Subject is required' });

  try {
    // ── Check email duplicate ─────────────────────────
    const existing = await queryAsync(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email.trim()]
    );
    if (existing.length > 0)
      return res.status(409).json({ success: false, message: 'Email already in use' });

    // ── Hash password ─────────────────────────────────
    const hashed = await bcrypt.hash(password, 10);

    // ── Insert into users ─────────────────────────────
    const userResult = await queryAsync(
      `INSERT INTO users (name, email, password, language, role)
       VALUES (?, ?, ?, 'ar', 'instructor')`,
      [name.trim(), email.trim(), hashed]
    );
    const userId = userResult.insertId;

    // ── Insert into instructors ───────────────────────
    await queryAsync(
      'INSERT INTO instructors (user_id, subject) VALUES (?, ?)',
      [userId, subject.trim()]
    );

    return res.status(201).json({
      success:    true,
      message:    'Instructor created successfully',
      instructor: {
        id:      userId,
        name:    name.trim(),
        email:   email.trim(),
        subject: subject.trim(),
      },
    });

  } catch (err) {
    console.error('[instructors] create error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━ GET /api/instructors ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/', adminAuth, async (req, res) => {
  try {
    const rows = await queryAsync(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.created_at,
         i.id      AS instructor_id,
         i.subject
       FROM instructors i
       INNER JOIN users u ON u.id = i.user_id
       ORDER BY u.created_at DESC`
      // ✅ FIX 3: أضفنا الفاصلة بين i.id AS instructor_id وi.subject
    );

    return res.status(200).json({
      success:     true,
      count:       rows.length,
      instructors: rows,
    });

  } catch (err) {
    console.error('[instructors] list error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━ DELETE /api/instructors/:id ━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/:id', adminAuth, async (req, res) => {
  const userId = parseInt(req.params.id);
  if (isNaN(userId))
    return res.status(400).json({ success: false, message: 'Invalid instructor id' });

  try {
    const rows = await queryAsync(
      'SELECT id FROM users WHERE id = ? AND role = ? LIMIT 1',
      [userId, 'instructor']
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: 'Instructor not found' });

    await queryAsync('DELETE FROM users WHERE id = ?', [userId]);

    return res.status(200).json({
      success: true,
      message: 'Instructor deleted successfully',
    });

  } catch (err) {
    console.error('[instructors] delete error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━ Helper ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function queryAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = router;