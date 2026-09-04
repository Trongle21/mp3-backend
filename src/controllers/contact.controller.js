const Contact = require('../models/Contact');
const User = require('../models/User');
const sseManager = require('../utils/sseManager');
const { buildPublicUrl } = require('../utils/mediaUrl');

function attachAvatar(user) {
  if (!user) return user;
  user.avatarUrl = buildPublicUrl(user.avatarKey);
  return user;
}

/**
 * GET /api/users/contacts
 * Query: status ('accepted' | 'pending' | 'all')
 */
exports.list = async (req, res) => {
  const userId = req.userId;
  const status = req.query.status || 'accepted';

  if (status === 'pending') {
    const [incoming, outgoing] = await Promise.all([
      Contact.find({ recipient: userId, status: 'pending' })
        .populate('requester', '_id name email avatarKey')
        .lean(),
      Contact.find({ requester: userId, status: 'pending' })
        .populate('recipient', '_id name email avatarKey')
        .lean(),
    ]);

    for (const item of incoming) attachAvatar(item.requester);
    for (const item of outgoing) attachAvatar(item.recipient);

    return res.json({
      success: true,
      data: { incoming, outgoing },
    });
  }

  // Accepted contacts: user is either requester or recipient
  const contacts = await Contact.find({
    $or: [{ requester: userId }, { recipient: userId }],
    status: 'accepted',
  })
    .populate('requester', '_id name email avatarKey')
    .populate('recipient', '_id name email avatarKey')
    .lean();

  // Extract the "other" user for each contact entry
  const friends = contacts.map((c) => {
    const isRequester = c.requester._id.toString() === userId.toString();
    const friend = isRequester ? c.recipient : c.requester;
    attachAvatar(friend);
    return {
      contactId: c._id,
      user: friend,
      createdAt: c.createdAt,
    };
  });

  return res.json({ success: true, data: friends });
};

/**
 * POST /api/users/contacts
 * Body: { recipientId }
 */
exports.sendRequest = async (req, res) => {
  const { recipientId, email } = req.body;
  const requesterId = req.userId;

  let recipient;

  if (recipientId) {
    recipient = await User.findById(recipientId).select('_id name email avatarKey');
  } else if (email) {
    recipient = await User.findOne({ email: email.toLowerCase().trim() }).select('_id name email avatarKey');
  } else {
    return res.status(400).json({ success: false, message: 'recipientId or email is required' });
  }

  if (!recipient) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (recipient._id.toString() === requesterId.toString()) {
    return res.status(400).json({ success: false, message: 'Cannot add yourself as a contact' });
  }

  // Check if relationship already exists
  const existing = await Contact.findOne({
    $or: [
      { requester: requesterId, recipient: recipient._id },
      { requester: recipient._id, recipient: requesterId },
    ],
  });

  if (existing) {
    if (existing.status === 'accepted') {
      return res.status(400).json({ success: false, message: 'Already contacts' });
    }
    if (existing.status === 'pending') {
      return res.status(400).json({ success: false, message: 'A contact request is already pending' });
    }
    if (existing.status === 'blocked') {
      return res.status(403).json({ success: false, message: 'Contact is blocked' });
    }
  }

  const contact = await Contact.create({
    requester: requesterId,
    recipient: recipient._id,
    status: 'pending',
  });

  const requester = await User.findById(requesterId).select('_id name email avatarKey').lean();
  attachAvatar(requester);

  // SSE notify recipient
  sseManager.sendToUser(recipient._id, 'contact:request', {
    contactId: contact._id,
    from: requester,
  });

  return res.status(201).json({ success: true, data: contact });
};

/**
 * PATCH /api/users/contacts/:id
 * Body: { action: 'accept' | 'decline' | 'block' }
 */
exports.respondRequest = async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;
  const userId = req.userId;

  if (!['accept', 'decline', 'block'].includes(action)) {
    return res.status(400).json({ success: false, message: 'action must be accept, decline, or block' });
  }

  const contact = await Contact.findById(id);
  if (!contact) {
    return res.status(404).json({ success: false, message: 'Contact request not found' });
  }

  if (contact.recipient.toString() !== userId.toString()) {
    return res.status(403).json({ success: false, message: 'Only the recipient can respond to this request' });
  }

  if (action === 'decline') {
    await contact.deleteOne();
    sseManager.sendToUser(contact.requester, 'contact:declined', { contactId: id });
    return res.json({ success: true, message: 'Request declined' });
  }

  if (action === 'accept') {
    contact.status = 'accepted';
    await contact.save();
    sseManager.sendToUser(contact.requester, 'contact:accepted', { contactId: id, byUserId: userId });
    return res.json({ success: true, data: contact });
  }

  if (action === 'block') {
    contact.status = 'blocked';
    await contact.save();
    return res.json({ success: true, data: contact });
  }
};

/**
 * DELETE /api/users/contacts/:id
 * Remove contact
 */
exports.removeContact = async (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  const contact = await Contact.findOne({
    _id: id,
    $or: [{ requester: userId }, { recipient: userId }],
  });

  if (!contact) {
    return res.status(404).json({ success: false, message: 'Contact not found' });
  }

  const otherId = contact.requester.toString() === userId.toString() ? contact.recipient : contact.requester;
  await contact.deleteOne();

  sseManager.sendToUser(otherId, 'contact:removed', { contactId: id, removedBy: userId });

  return res.json({ success: true, data: { id } });
};
