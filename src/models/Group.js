const mongoose = require('mongoose');

const trackItemSchema = new mongoose.Schema(
  {
    track: { type: mongoose.Schema.Types.ObjectId, ref: 'Track', required: true },
    position: { type: Number, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Key của ảnh thumbnail trong R2 (nếu có), vd: group-thumbnails/{userId}/{uuid}.jpg
    thumbnailKey: { type: String, default: '' },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tracks: { type: [trackItemSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Group', groupSchema);
