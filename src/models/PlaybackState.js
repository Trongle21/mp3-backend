const mongoose = require('mongoose');

const playbackStateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    currentTrack: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Track',
      default: null,
    },
    positionSec: { type: Number, default: 0 },
    isPlaying: { type: Boolean, default: false },
    queue: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Track',
      default: [],
    },
    repeatMode: {
      type: String,
      enum: ['off', 'one', 'all'],
      default: 'off',
    },
    shuffle: { type: Boolean, default: false },
  },
  { timestamps: { updatedAt: 'updatedAt', createdAt: false } }
);

module.exports = mongoose.model('PlaybackState', playbackStateSchema);
