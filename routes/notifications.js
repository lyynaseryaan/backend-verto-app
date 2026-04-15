const express = require('express');
const router = express.Router();
const db = require('../db');
const NotificationService = require('../services/notificationService');
const { verifyToken } = require('../middleware/auth'); // adjust path if needed

// ─── Promisify db.query so we can use async/await throughout ───────────────
const query = (sql, params) =>
  new Promise((resolve, reject) =>
    db.query(sql, params, (err, result) => (err ? reject(err) : resolve(result)))
  );

// ─── GET /api/notifications ─────────────────────────────────────────────────
// Returns paginated notifications + total/unread counts for the current user.
router.get('/', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const limit  = Math.min(parseInt(req.query.limit)  || 20, 100); // cap at 100
  const offset = Math.max(parseInt(req.query.offset) || 0,  0);

  try {
    const [rows, counts] = await Promise.all([
      query(
        'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [userId, limit, offset]
      ),
      query(
        'SELECT COUNT(*) AS total, SUM(is_read = 0) AS unread FROM notifications WHERE user_id = ?',
        [userId]
      ),
    ]);

    res.json({
      notifications: rows,
      total:  counts[0].total,
      unread: counts[0].unread || 0,
    });
  } catch (err) {
    console.error('[GET /notifications]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── GET /api/notifications/unread-count ────────────────────────────────────
// IMPORTANT: this route MUST be declared before /:id routes so Express does
// not treat the literal string "unread-count" as an :id parameter.
router.get('/unread-count', verifyToken, async (req, res) => {
  try {
    const rows = await query(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0',
      [req.user.id]
    );
    res.json({ count: rows[0].count });
  } catch (err) {
    console.error('[GET /notifications/unread-count]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── PATCH /api/notifications/read-all ──────────────────────────────────────
// IMPORTANT: declared before /:id/read so "read-all" is not captured as :id.
router.patch('/read-all', verifyToken, async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[PATCH /notifications/read-all]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── PATCH /api/notifications/:id/read ──────────────────────────────────────
router.patch('/:id/read', verifyToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id || id < 1) return res.status(400).json({ error: 'Invalid notification id' });

  try {
    const result = await query(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[PATCH /notifications/:id/read]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── DELETE /api/notifications ───────────────────────────────────────────────
// Clear ALL notifications for the current user.
// IMPORTANT: declared before /:id so the plain DELETE / is not shadowed.
router.delete('/', verifyToken, async (req, res) => {
  try {
    await query('DELETE FROM notifications WHERE user_id = ?', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /notifications]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── DELETE /api/notifications/:id ──────────────────────────────────────────
router.delete('/:id', verifyToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id || id < 1) return res.status(400).json({ error: 'Invalid notification id' });

  try {
    const result = await query(
      'DELETE FROM notifications WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /notifications/:id]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── POST /api/notifications/test ───────────────────────────────────────────
// Dev-only endpoint to seed a test notification.
router.post('/test', verifyToken, async (req, res) => {
  const { type, title, message } = req.body;

  const validTypes = ['course_update', 'quiz_result', 'progress_milestone', 'task_deadline', 'level_change'];
  const notifType = validTypes.includes(type) ? type : 'course_update';

  try {
    const id = await NotificationService.create(
      req.user.id,
      notifType,
      title   || 'Test Notification',
      message || 'This is a test notification.'
    );
    res.status(201).json({ success: true, id });
  } catch (err) {
    console.error('[POST /notifications/test]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;