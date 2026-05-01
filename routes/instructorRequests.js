// ============================================================
//  routes/instructorRequests.js  –  Verto LMS
//  Handles instructor applications (submit, admin review)
// ============================================================

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

// ━━━ Multer setup (CV uploads) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const uploadDir = path.join(__dirname, '../uploads/cvs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `cv-${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

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

// ━━━ Helper ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function queryAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUBLIC: POST /api/instructor-requests
//  Submit an instructor application (no auth required)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/', upload.single('cv_file'), async (req, res) => {
  const {
    full_name,
    email,
    password,
    subject,
    experience,
    bio,
    qualifications,
    years_experience,
  } = req.body;

  // ── Validation ─────────────────────────────────────────
  if (!full_name || !full_name.trim())
    return res.status(400).json({ success: false, message: 'Full name is required' });
  if (!email || !email.trim())
    return res.status(400).json({ success: false, message: 'Email is required' });
  if (!password || password.length < 6)
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  if (!subject || !subject.trim())
    return res.status(400).json({ success: false, message: 'Subject is required' });
  if (!experience || !experience.trim())
    return res.status(400).json({ success: false, message: 'Experience is required' });
  if (!bio || !bio.trim())
    return res.status(400).json({ success: false, message: 'Bio is required' });

  try {
    // ── Check duplicate email in users AND pending requests ─
    const existingUser = await queryAsync(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email.trim()]
    );
    if (existingUser.length > 0)
      return res.status(409).json({ success: false, message: 'This email is already registered' });

    const existingRequest = await queryAsync(
      "SELECT id FROM instructor_requests WHERE email = ? AND status = 'pending' LIMIT 1",
      [email.trim()]
    );
    if (existingRequest.length > 0)
      return res.status(409).json({ success: false, message: 'A pending application already exists for this email' });

    // ── Hash password ──────────────────────────────────────
    const hashed = await bcrypt.hash(password, 10);

    const cvFile = req.file ? req.file.filename : null;

    // ── Insert application ─────────────────────────────────
    await queryAsync(
      `INSERT INTO instructor_requests
         (full_name, email, password, subject, experience, bio, qualifications, years_experience, cv_file, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        full_name.trim(),
        email.trim(),
        hashed,
        subject.trim(),
        experience.trim(),
        bio.trim(),
        qualifications ? qualifications.trim() : null,
        years_experience ? parseInt(years_experience) : null,
        cvFile,
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Your application has been submitted successfully. The admin will review it shortly.',
    });
  } catch (err) {
    console.error('[instructor-requests] submit error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ADMIN: GET /api/admin/instructor-requests
//  List all applications (optionally filter by status)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/admin', adminAuth, async (req, res) => {
  const { status } = req.query; // optional: pending | approved | rejected

  try {
    let sql = `
      SELECT id, full_name, email, subject, experience,
             years_experience, status, created_at
      FROM instructor_requests
    `;
    const params = [];

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      sql += ' WHERE status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = await queryAsync(sql, params);

    return res.status(200).json({
      success:  true,
      count:    rows.length,
      requests: rows,
    });
  } catch (err) {
    console.error('[instructor-requests] list error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ADMIN: GET /api/admin/instructor-requests/:id
//  Full detail of one application (includes CV filename)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/admin/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id))
    return res.status(400).json({ success: false, message: 'Invalid id' });

  try {
    const rows = await queryAsync(
      `SELECT id, full_name, email, subject, experience, bio,
              qualifications, years_experience, cv_file, status, created_at
       FROM instructor_requests WHERE id = ? LIMIT 1`,
      [id]
    );

    if (!rows.length)
      return res.status(404).json({ success: false, message: 'Application not found' });

    const request = rows[0];

    // Build CV URL if file exists
    if (request.cv_file) {
      request.cv_url = `${process.env.BASE_URL || ''}/uploads/cvs/${request.cv_file}`;
    }

    return res.status(200).json({ success: true, request });
  } catch (err) {
    console.error('[instructor-requests] detail error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ADMIN: PUT /api/admin/instructor-requests/:id/approve
//  Approve → create user + instructor record
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.put('/admin/:id/approve', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id))
    return res.status(400).json({ success: false, message: 'Invalid id' });

  try {
    // ── Fetch application ──────────────────────────────────
    const rows = await queryAsync(
      "SELECT * FROM instructor_requests WHERE id = ? AND status = 'pending' LIMIT 1",
      [id]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: 'Pending application not found' });

    const app = rows[0];

    // ── Guard: email must not exist in users ───────────────
    const existing = await queryAsync(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [app.email]
    );
    if (existing.length > 0)
      return res.status(409).json({ success: false, message: 'Email already exists in users' });

    // ── Insert into users ──────────────────────────────────
    const userResult = await queryAsync(
      `INSERT INTO users (name, email, password, language, role)
       VALUES (?, ?, ?, 'ar', 'teacher')`,
      [app.full_name, app.email, app.password]
    );
    const userId = userResult.insertId;

    // ── Insert into instructors ────────────────────────────
    await queryAsync(
      'INSERT INTO instructors (user_id, subject) VALUES (?, ?)',
      [userId, app.subject]
    );

    // ── Mark application as approved ──────────────────────
    await queryAsync(
      "UPDATE instructor_requests SET status = 'approved' WHERE id = ?",
      [id]
    );

    return res.status(200).json({
      success: true,
      message: `${app.full_name} has been approved as an instructor`,
      instructor: {
        id:      userId,
        name:    app.full_name,
        email:   app.email,
        subject: app.subject,
      },
    });
  } catch (err) {
    console.error('[instructor-requests] approve error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ADMIN: PUT /api/admin/instructor-requests/:id/reject
//  Reject application
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.put('/admin/:id/reject', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id))
    return res.status(400).json({ success: false, message: 'Invalid id' });

  try {
    const rows = await queryAsync(
      "SELECT id, full_name FROM instructor_requests WHERE id = ? AND status = 'pending' LIMIT 1",
      [id]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: 'Pending application not found' });

    await queryAsync(
      "UPDATE instructor_requests SET status = 'rejected' WHERE id = ?",
      [id]
    );

    return res.status(200).json({
      success: true,
      message: `Application from ${rows[0].full_name} has been rejected`,
    });
  } catch (err) {
    console.error('[instructor-requests] reject error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Serve CV files (admin only)
//  GET /api/instructor-requests/cv/:filename
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/cv/:filename', adminAuth, (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filePath = path.join(uploadDir, filename);

  if (!fs.existsSync(filePath))
    return res.status(404).json({ success: false, message: 'CV file not found' });

  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

module.exports = router;