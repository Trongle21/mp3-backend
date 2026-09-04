const UserPresence = require('../models/UserPresence');
const sseManager = require('../utils/sseManager');

/**
 * GET /api/users/presence?userIds=id1,id2,id3
 * Batch query presence for multiple users
 */
exports.getPresence = async (req, res) => {
  const userIdsRaw = req.query.userIds;
  if (!userIdsRaw) {
    return res.status(400).json({ success: false, message: 'userIds query parameter is required' });
  }

  const userIds = userIdsRaw.split(',').map((id) => id.trim()).filter(Boolean);
  const docs = await UserPresence.find({ user: { $in: userIds } }).lean();

  const map = {};
  for (const doc of docs) {
    const uid = doc.user.toString();
    // In-memory SSE status takes precedence for real-time accuracy
    const isActuallyOnline = sseManager.isUserOnline(uid) || doc.isOnline;
    map[uid] = {
      isOnline: isActuallyOnline,
      lastSeen: doc.lastSeen,
    };
  }

  // Fallback for user IDs not yet in presence table
  for (const uid of userIds) {
    if (!map[uid]) {
      const isOnline = sseManager.isUserOnline(uid);
      map[uid] = {
        isOnline,
        lastSeen: null,
      };
    }
  }

  return res.json({ success: true, data: map });
};

/**
 * POST /api/users/presence/heartbeat
 * Client updates its active presence
 */
exports.heartbeat = async (req, res) => {
  const userId = req.userId;
  const now = new Date();

  const doc = await UserPresence.findOneAndUpdate(
    { user: userId },
    { isOnline: true, lastSeen: now },
    { upsert: true, new: true }
  ).lean();

  return res.json({ success: true, data: { isOnline: true, lastSeen: doc.lastSeen } });
};
