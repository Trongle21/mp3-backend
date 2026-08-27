const mongoose = require('mongoose');
const PlaybackState = require('../models/PlaybackState');

const DEFAULT_STATE = {
  currentTrack: null,
  positionSec: 0,
  isPlaying: false,
  queue: [],
  repeatMode: 'off',
  shuffle: false,
};

/**
 * GET /api/player/state
 * Nếu chưa có document → trả default, KHÔNG tạo mới.
 */
exports.getState = async (req, res) => {
  const state = await PlaybackState.findOne({ user: req.userId })
    .populate({ path: 'currentTrack', select: 'title artist album durationSec fileKey coverKey mimeType' })
    .lean();

  if (!state) {
    return res.json({ success: true, data: { ...DEFAULT_STATE, user: req.userId } });
  }

  const queueIds = state.queue || [];
  const populatedQueue = await mongoose.model('Track').find({ _id: { $in: queueIds } })
    .select('title artist album durationSec fileKey coverKey mimeType')
    .lean();
  // Giữ thứ tự queue theo DB.
  const mapById = new Map(populatedQueue.map((t) => [String(t._id), t]));
  const queue = queueIds.map((id) => mapById.get(String(id))).filter(Boolean);

  return res.json({
    success: true,
    data: {
      user: state.user,
      currentTrack: state.currentTrack,
      positionSec: state.positionSec,
      isPlaying: state.isPlaying,
      repeatMode: state.repeatMode,
      shuffle: state.shuffle,
      queue,
      updatedAt: state.updatedAt,
    },
  });
};

/**
 * PATCH /api/player/state
 * Body bất kỳ tổ hợp của: currentTrack, positionSec, isPlaying, queue, repeatMode, shuffle.
 * Chỉ update field có gửi lên (dynamic $set).
 */
const ALLOWED_FIELDS = ['currentTrack', 'positionSec', 'isPlaying', 'queue', 'repeatMode', 'shuffle'];

exports.updateState = async (req, res) => {
  const set = {};
  for (const f of ALLOWED_FIELDS) {
    if (req.body[f] !== undefined) set[f] = req.body[f];
  }

  // Validate nhẹ.
  if ('repeatMode' in set && !['off', 'one', 'all'].includes(set.repeatMode)) {
    return res.status(400).json({ success: false, message: 'repeatMode must be off|one|all' });
  }
  if ('positionSec' in set && typeof set.positionSec !== 'number') {
    return res.status(400).json({ success: false, message: 'positionSec must be a number' });
  }
  if ('isPlaying' in set && typeof set.isPlaying !== 'boolean') {
    return res.status(400).json({ success: false, message: 'isPlaying must be a boolean' });
  }
  if ('queue' in set && !Array.isArray(set.queue)) {
    return res.status(400).json({ success: false, message: 'queue must be an array' });
  }

  if (Object.keys(set).length === 0) {
    return res.status(400).json({ success: false, message: 'No updatable fields supplied' });
  }

  const state = await PlaybackState.findOneAndUpdate(
    { user: req.userId },
    { $set: set, $setOnInsert: { user: req.userId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  return res.json({ success: true, data: state });
};
