const mongoose = require('mongoose');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const sseManager = require('../utils/sseManager');
const { attachMessageMediaUrl, attachMessagesMediaUrls } = require('../utils/mediaUrl');

function formatMessage(msg) {
  if (!msg) return msg;
  if (msg.deletedAt) {
    msg.content = 'Tin nhắn đã bị thu hồi';
    msg.type = 'system';
  }
  return attachMessageMediaUrl(msg);
}

/**
 * POST /api/conversations/:id/messages
 * Body: { type: 'text' | 'image' | 'sticker' | 'gif' | 'audio', content, replyTo? }
 */
exports.send = async (req, res) => {
  const { type = 'text', content, replyTo } = req.body;
  const conversation = req.conversation;
  const userId = req.userId;

  // Text messages must have non-empty content; other types (image/sticker/gif/audio) can omit it
  if (type === 'text' && (!content || typeof content !== 'string' || !content.trim())) {
    return res.status(400).json({ success: false, message: 'content cannot be empty for text messages' });
  }

  // If replying to a message, verify that replyTo exists in this conversation
  let replyToId = null;
  if (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) {
    const parent = await Message.findOne({ _id: replyTo, conversationId: conversation._id, deletedAt: null }).select('_id');
    if (parent) replyToId = parent._id;
  }

  const message = await Message.create({
    conversationId: conversation._id,
    sender: userId,
    type,
    content: content ? content.trim() : '',
    replyTo: replyToId,
    readBy: [{ userId, readAt: new Date() }],
  });

  const senderUser = await User.findById(userId).select('_id name email avatarKey').lean();

  // Preview text for lastMessage
  let preview = content ? content.trim() : '';
  if (type === 'image') preview = '[Hình ảnh]';
  else if (type === 'sticker') preview = '[Sticker]';
  else if (type === 'gif') preview = '[GIF]';
  else if (type === 'audio') preview = '[Tin nhắn thoại]';

  // Update conversation lastMessage & lastActivity
  conversation.lastMessage = {
    content: preview,
    senderId: userId,
    senderName: senderUser?.name || 'Someone',
    type,
    createdAt: message.createdAt,
  };
  conversation.lastActivity = new Date();
  await conversation.save();

  const populated = await Message.findById(message._id)
    .populate('sender', '_id name email avatarKey')
    .populate({
      path: 'replyTo',
      select: '_id sender content type deletedAt',
      populate: { path: 'sender', select: '_id name' },
    })
    .lean();

  const result = formatMessage(populated);

  // Broadcast to all conversation members via SSE
  sseManager.sendToUsers(conversation.members, 'message:new', {
    conversationId: conversation._id,
    message: result,
  });

  return res.status(201).json({ success: true, data: result });
};

/**
 * GET /api/conversations/:id/messages
 * Query: limit (default 30, max 100), before (message ObjectId for cursor pagination)
 */
exports.list = async (req, res) => {
  const conversationId = req.params.id;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const before = req.query.before;

  const filter = {
    conversationId,
  };

  if (before && mongoose.Types.ObjectId.isValid(before)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(before) };
  }

  // Fetch descending (newest first) to get the latest chunk
  const items = await Message.find(filter)
    .sort({ _id: -1 })
    .limit(limit)
    .populate('sender', '_id name email avatarKey')
    .populate({
      path: 'replyTo',
      select: '_id sender content type deletedAt',
      populate: { path: 'sender', select: '_id name' },
    })
    .lean();

  // Reverse so client gets chronological order (oldest to newest)
  items.reverse();

  for (const m of items) {
    formatMessage(m);
  }

  const nextBefore = items.length > 0 ? items[0]._id : null;
  const hasMore = items.length === limit;

  return res.json({
    success: true,
    data: items,
    pagination: {
      limit,
      hasMore,
      nextBefore,
    },
  });
};

/**
 * PATCH /api/conversations/:id/messages/:msgId
 * Body: { content }
 */
exports.edit = async (req, res) => {
  const { id, msgId } = req.params;
  const { content } = req.body;

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ success: false, message: 'content cannot be empty' });
  }

  const message = await Message.findOne({ _id: msgId, conversationId: id });
  if (!message) {
    return res.status(404).json({ success: false, message: 'Message not found' });
  }

  if (message.sender.toString() !== req.userId.toString()) {
    return res.status(403).json({ success: false, message: 'Only message author can edit this message' });
  }

  if (message.deletedAt) {
    return res.status(400).json({ success: false, message: 'Cannot edit a deleted message' });
  }

  message.content = content.trim();
  message.editedAt = new Date();
  await message.save();

  const populated = await Message.findById(message._id)
    .populate('sender', '_id name email avatarKey')
    .populate({
      path: 'replyTo',
      select: '_id sender content type deletedAt',
      populate: { path: 'sender', select: '_id name' },
    })
    .lean();

  const result = formatMessage(populated);

  sseManager.sendToUsers(req.conversation.members, 'message:edited', {
    conversationId: id,
    message: result,
  });

  return res.json({ success: true, data: result });
};

/**
 * DELETE /api/conversations/:id/messages/:msgId
 * Soft delete message
 */
exports.remove = async (req, res) => {
  const { id, msgId } = req.params;
  const conv = req.conversation;

  const message = await Message.findOne({ _id: msgId, conversationId: id });
  if (!message) {
    return res.status(404).json({ success: false, message: 'Message not found' });
  }

  const isSender = message.sender.toString() === req.userId.toString();
  const isOwner = conv.owner && conv.owner.toString() === req.userId.toString();
  const isMaster = req.isAdmin === 'master';

  if (!isSender && !isOwner && !isMaster) {
    return res.status(403).json({ success: false, message: 'Not authorized to delete this message' });
  }

  message.deletedAt = new Date();
  await message.save();

  sseManager.sendToUsers(conv.members, 'message:deleted', {
    conversationId: id,
    messageId: msgId,
  });

  return res.json({ success: true, data: { id: msgId } });
};

/**
 * POST /api/conversations/:id/messages/:msgId/react
 * Body: { emoji }
 */
exports.react = async (req, res) => {
  const { id, msgId } = req.params;
  const { emoji } = req.body;
  const userId = req.userId;

  if (!emoji || typeof emoji !== 'string') {
    return res.status(400).json({ success: false, message: 'emoji is required' });
  }

  const message = await Message.findOne({ _id: msgId, conversationId: id });
  if (!message) {
    return res.status(404).json({ success: false, message: 'Message not found' });
  }

  if (message.deletedAt) {
    return res.status(400).json({ success: false, message: 'Cannot react to deleted message' });
  }

  // Find existing reaction for this emoji
  let reactionEntry = message.reactions.find((r) => r.emoji === emoji);

  if (!reactionEntry) {
    // Add new emoji entry
    message.reactions.push({ emoji, users: [userId] });
  } else {
    // Toggle reaction
    const userIndex = reactionEntry.users.findIndex((u) => u.toString() === userId.toString());
    if (userIndex >= 0) {
      // Remove reaction
      reactionEntry.users.splice(userIndex, 1);
      // Remove emoji entry if empty
      if (reactionEntry.users.length === 0) {
        message.reactions = message.reactions.filter((r) => r.emoji !== emoji);
      }
    } else {
      // Add reaction
      reactionEntry.users.push(userId);
    }
  }

  await message.save();

  const populated = await Message.findById(message._id)
    .populate('sender', '_id name email avatarKey')
    .lean();

  const result = formatMessage(populated);

  sseManager.sendToUsers(req.conversation.members, 'message:reaction', {
    conversationId: id,
    messageId: msgId,
    reactions: result.reactions,
  });

  return res.json({ success: true, data: result });
};

/**
 * POST /api/conversations/:id/messages/read
 * Mark messages in this conversation as read for current user
 */
exports.markRead = async (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  // Add userId to readBy for messages in this conversation where not already present
  await Message.updateMany(
    { conversationId: id, 'readBy.userId': { $ne: userId } },
    { $push: { readBy: { userId, readAt: new Date() } } }
  );

  sseManager.sendToUsers(req.conversation.members, 'conversation:read', {
    conversationId: id,
    userId,
    readAt: new Date(),
  });

  return res.json({ success: true, message: 'Marked as read' });
};
