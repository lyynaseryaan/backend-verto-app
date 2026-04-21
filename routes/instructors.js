// ============================================================
//  routes/admin/instructors.js  –  Verto LMS
//  POST /api/admin/instructors       → create instructor
//  GET  /api/admin/instructors       → list all instructors
//  DELETE /api/admin/instructors/:id → delete instructor
// ============================================================

const express  = require('express');
const router   = express.Router();
const db       = require('../../db');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

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

// ━━━ POST /api/admin/instructors ━━━━━━━━━━━━━━━━━━━━━━━━━━
// Creates a user with role="instructor" + row in instructors table
router.post('/', adminAuth, async (req, res) => {
  const { name, email, password } = req.body;

  // ── Validate ──────────────────────────────────────────
  if (!name || !name.trim())
    return res.status(400).json({ success: false, message: 'Name is required' });
  if (!email || !email.trim())
    return res.status(400).json({ success: false, message: 'Email is required' });
  if (!password || password.length < 6)
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

  try {
    // ── Check email already exists ────────────────────
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
      'INSERT INTO instructors (user_id) VALUES (?)',
      [userId]
    );

    return res.status(201).json({
      success:    true,
      message:    'Instructor created successfully',
      instructor: { id: userId, name: name.trim(), email: email.trim() },
    });

  } catch (err) {
    console.error('[admin/instructors] create error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━ GET /api/admin/instructors ━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Returns all instructors (joined with users)
router.get('/', adminAuth, async (req, res) => {
  try {
    const rows = await queryAsync(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.created_at,
         i.id AS instructor_id
       FROM instructors i
       INNER JOIN users u ON u.id = i.user_id
       ORDER BY u.created_at DESC`
    );

    return res.status(200).json({
      success:     true,
      count:       rows.length,
      instructors: rows,
    });

  } catch (err) {
    console.error('[admin/instructors] list error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━ DELETE /api/admin/instructors/:id ━━━━━━━━━━━━━━━━━━━━
// Deletes the user (CASCADE removes instructors row automatically)
router.delete('/:id', adminAuth, async (req, res) => {
  const userId = parseInt(req.params.id);
  if (isNaN(userId))
    return res.status(400).json({ success: false, message: 'Invalid instructor id' });

  try {
    // Make sure the user is actually an instructor
    const rows = await queryAsync(
      'SELECT id FROM users WHERE id = ? AND role = ? LIMIT 1',
      [userId, 'instructor']
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: 'Instructor not found' });

    // Delete from users — ON DELETE CASCADE removes instructors row
    await queryAsync('DELETE FROM users WHERE id = ?', [userId]);

    return res.status(200).json({
      success: true,
      message: 'Instructor deleted successfully',
    });

  } catch (err) {
    console.error('[admin/instructors] delete error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━ Helper: promisify db.query ━━━━━━━━━━━━━━━━━━━━━━━━━━━
function queryAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = router;