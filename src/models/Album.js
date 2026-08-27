const mongoose = require('mongoose');

const albumSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    artist: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    year: {
      type: Number,
      default: null,
    },
    genre: {
      type: String,
      trim: true,
      default: '',
    },
    thumbnailKey: {
      type: String,
      default: '',
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tracks: [
      {
        track: { type: mongoose.Schema.Types.ObjectId, ref: 'Track', required: true },
        position: { type: Number, required: true },
        addedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

albumSchema.index({ owner: 1, createdAt: -1 });
albumSchema.index({ title: 'text', artist: 'text', description: 'text' });

module.exports = mongoose.model('Album', albumSchema);
