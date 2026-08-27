const mongoose = require('mongoose');

const trackSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    artist: { type: String, trim: true, default: '', index: true },
    album: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Album',
      default: null,
      index: true,
    },
    durationSec: { type: Number, default: 0 },
    // Key của file audio trong R2, vd: tracks/{userId}/{uuid}.mp3
    fileKey: { type: String, required: true },
    // Key của ảnh cover trong R2 (nếu có), vd: covers/{userId}/{uuid}.jpg
    coverKey: { type: String, default: '' },
    mimeType: { type: String, default: 'audio/mpeg' },
    sizeBytes: { type: Number, default: 0 },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } }
);

trackSchema.index({ owner: 1, createdAt: -1 });

module.exports = mongoose.model('Track', trackSchema);
