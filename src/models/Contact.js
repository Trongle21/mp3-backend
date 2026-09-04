const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema(
  {
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'blocked'],
      default: 'pending',
      required: true,
    },
  },
  { timestamps: true }
);

contactSchema.index({ requester: 1, recipient: 1 }, { unique: true });

module.exports = mongoose.model('Contact', contactSchema);
