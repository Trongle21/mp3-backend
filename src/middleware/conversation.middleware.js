const Conversation = require('../models/Conversation');

/**
 * Middleware đảm bảo conversation tồn tại và req.userId là thành viên.
 * Gắn `req.conversation` vào request object.
 */
async function requireMember(req, res, next) {
  const conversationId = req.params.id || req.params.conversationId;
  if (!conversationId) {
    return res.status(400).json({ success: false, message: 'Missing conversationId' });
  }

  const conv = await Conversation.findOne({ _id: conversationId, isDeleted: false });
  if (!conv) {
    return res.status(404).json({ success: false, message: 'Conversation not found' });
  }

  const isMember = conv.members.some((m) => m.toString() === req.userId);
  if (!isMember && req.isAdmin !== 'master') {
    return res.status(403).json({ success: false, message: 'You are not a member of this conversation' });
  }

  req.conversation = conv;
  next();
}

/**
 * Middleware kiểm tra req.userId là owner của group conversation (hoặc master).
 * Đặt SAU requireMember.
 */
function requireConvOwner(req, res, next) {
  if (!req.conversation) {
    return res.status(500).json({ success: false, message: 'requireMember must run before requireConvOwner' });
  }

  const isOwner = req.conversation.owner && req.conversation.owner.toString() === req.userId;
  if (!isOwner && req.isAdmin !== 'master') {
    return res.status(403).json({ success: false, message: 'Only the conversation owner can perform this action' });
  }

  next();
}

module.exports = {
  requireMember,
  requireConvOwner,
};
