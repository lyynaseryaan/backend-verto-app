const db = require('../db');

// ─── Helper: promisified db.query ────────────────────────────────────────────
const query = (sql, params) =>
  new Promise((resolve, reject) =>
    db.query(sql, params, (err, result) => (err ? reject(err) : resolve(result)))
  );

// ─── Helper: safely serialize metadata ───────────────────────────────────────
const serializeMetadata = (metadata) => {
  if (metadata == null) return null;
  if (typeof metadata === 'string') return metadata; // already JSON string
  try {
    return JSON.stringify(metadata);
  } catch {
    return null;
  }
};

// ─── NotificationService ─────────────────────────────────────────────────────
const NotificationService = {
  /**
   * Core create method — all helpers delegate here.
   * @param {number} userId
   * @param {'course_update'|'quiz_result'|'progress_milestone'|'task_deadline'|'level_change'} type
   * @param {string} title
   * @param {string} message
   * @param {object|null} metadata  – arbitrary JSON (will be serialised automatically)
   * @returns {Promise<number>} insertId of the new notification row
   */
  create: async (userId, type, title, message, metadata = null) => {
    const sql =
      'INSERT INTO notifications (user_id, type, title, message, metadata) VALUES (?, ?, ?, ?, ?)';
    const result = await query(sql, [
      userId,
      type,
      title,
      message,
      serializeMetadata(metadata),
    ]);
    return result.insertId;
  },

  // ─── Convenience helpers ────────────────────────────────────────────────

  /**
   * Notify a user that a course they are enrolled in has been updated.
   * @param {number} userId
   * @param {string} courseTitle
   * @param {string} updateMsg   – short description of what changed
   * @param {object} [metadata]  – e.g. { courseId }
   */
  courseUpdate: (userId, courseTitle, updateMsg, metadata) =>
    NotificationService.create(
      userId,
      'course_update',
      `Course Update: ${courseTitle}`,
      updateMsg,
      metadata
    ),

  /**
   * Notify a user of their quiz score.
   * @param {number} userId
   * @param {string} quizTitle
   * @param {number} score       – percentage 0-100
   * @param {object} [metadata]  – e.g. { quizId, courseId }
   */
  quizResult: (userId, quizTitle, score, metadata) =>
    NotificationService.create(
      userId,
      'quiz_result',
      `Quiz Result: ${quizTitle}`,
      `You scored ${score}%`,
      metadata
    ),

  /**
   * Notify a user that they hit a progress milestone.
   * @param {number} userId
   * @param {string} milestone   – human-readable milestone label
   * @param {object} [metadata]  – e.g. { courseId, percent }
   */
  progressMilestone: (userId, milestone, metadata) =>
    NotificationService.create(
      userId,
      'progress_milestone',
      'Progress Milestone!',
      milestone,
      metadata
    ),

  /**
   * Notify a user that a task timer has expired.
   * @param {number} userId
   * @param {string} taskTitle
   * @param {object} [metadata]  – e.g. { taskId }
   */
  taskDeadline: (userId, taskTitle, metadata) =>
    NotificationService.create(
      userId,
      'task_deadline',
      'Task Deadline Reached',
      `Task "${taskTitle}" time has ended`,
      metadata
    ),

  /**
   * Notify a user that their level has changed.
   * @param {number} userId
   * @param {string} newLevel    – display name of the new level
   * @param {object} [metadata]  – e.g. { levelId, previousLevel }
   */
  levelChange: (userId, newLevel, metadata) =>
    NotificationService.create(
      userId,
      'level_change',
      'Level Changed!',
      `You have been moved to ${newLevel}`,
      metadata
    ),
};

module.exports = NotificationService;