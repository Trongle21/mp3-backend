const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['direct', 'group'],
      default: 'direct',
      required: true,
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    avatarKey: {
      type: String,
      default: '',
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    ],
    lastMessage: {
      content: { type: String, default: '' },
      senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      senderName: { type: String, default: '' },
      type: { type: String, default: 'text' },
      createdAt: { type: Date, default: null },
    },
    lastActivity: {
      type: Date,
      default: Date.now,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

conversationSchema.index({ members: 1, lastActivity: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
