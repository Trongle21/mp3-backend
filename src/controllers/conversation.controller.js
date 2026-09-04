const crypto = require("crypto");
const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { client: s3, BUCKET } = require("../config/r2");
const Conversation = require("../models/Conversation");
const User = require("../models/User");
const sseManager = require("../utils/sseManager");
const {
  attachConversationAvatarUrl,
  attachConversationAvatarUrls,
} = require("../utils/mediaUrl");

function extFromFilename(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "jpg";
}

function mimeFromImageExt(ext) {
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };
  return map[ext] || "image/jpeg";
}

/**
 * POST /api/conversations
 * Body: { type: 'direct' | 'group', recipientId?: string, memberIds?: string[], name?: string }
 */
exports.create = async (req, res) => {
  const { type = "direct", recipientId, memberIds = [], name } = req.body;
  const currentUserId = req.userId;

  if (type === "direct") {
    const targetId = recipientId || memberIds[0];
    if (!targetId) {
      return res
        .status(400)
        .json({
          success: false,
          message: "recipientId or memberIds is required for direct chat",
        });
    }
    if (targetId.toString() === currentUserId.toString()) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Cannot create direct conversation with yourself",
        });
    }

    const recipient = await User.findById(targetId).select(
      "_id name email avatarKey",
    );
    if (!recipient) {
      return res
        .status(404)
        .json({ success: false, message: "Recipient not found" });
    }

    // Check if direct conversation already exists between the two users
    let existing = await Conversation.findOne({
      type: "direct",
      isDeleted: false,
      members: { $all: [currentUserId, targetId], $size: 2 },
    })
      .populate("members", "_id name email avatarKey")
      .lean();

    if (existing) {
      return res.json({
        success: true,
        data: attachConversationAvatarUrl(existing),
      });
    }

    const conv = await Conversation.create({
      type: "direct",
      members: [currentUserId, targetId],
      lastActivity: new Date(),
    });

    const populated = await Conversation.findById(conv._id)
      .populate("members", "_id name email avatarKey")
      .lean();

    const result = attachConversationAvatarUrl(populated);
    sseManager.sendToUsers(
      [currentUserId, targetId],
      "conversation:created",
      result,
    );

    return res.status(201).json({ success: true, data: result });
  }

  // Group chat
  if (!name || typeof name !== "string" || !name.trim()) {
    return res
      .status(400)
      .json({ success: false, message: "name is required for group chat" });
  }

  // Deduplicate members and ensure current user is included
  const rawMembers = Array.isArray(memberIds) ? memberIds : [];
  const uniqueMemberSet = new Set(rawMembers.map((id) => id.toString()));
  uniqueMemberSet.add(currentUserId.toString());
  const members = Array.from(uniqueMemberSet);

  const conv = await Conversation.create({
    type: "group",
    name: name.trim(),
    owner: currentUserId,
    members,
    lastActivity: new Date(),
  });

  const populated = await Conversation.findById(conv._id)
    .populate("members", "_id name email avatarKey")
    .populate("owner", "_id name email avatarKey")
    .lean();

  const result = attachConversationAvatarUrl(populated);
  sseManager.sendToUsers(members, "conversation:created", result);

  return res.status(201).json({ success: true, data: result });
};

/**
 * GET /api/conversations
 * Query: page, limit
 */
exports.list = async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const skip = (page - 1) * limit;

  const filter = {
    members: req.userId,
    isDeleted: false,
  };

  const [items, total] = await Promise.all([
    Conversation.find(filter)
      .sort({ lastActivity: -1 })
      .skip(skip)
      .limit(limit)
      .populate("members", "_id name email avatarKey")
      .populate("owner", "_id name email avatarKey")
      .lean(),
    Conversation.countDocuments(filter),
  ]);

  attachConversationAvatarUrls(items);

  return res.json({
    success: true,
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

/**
 * GET /api/conversations/:id
 */
exports.getOne = async (req, res) => {
  const conv = await Conversation.findOne({
    _id: req.params.id,
    isDeleted: false,
  })
    .populate("members", "_id name email avatarKey")
    .populate("owner", "_id name email avatarKey")
    .lean();

  if (!conv) {
    return res
      .status(404)
      .json({ success: false, message: "Conversation not found" });
  }

  return res.json({ success: true, data: attachConversationAvatarUrl(conv) });
};

/**
 * PATCH /api/conversations/:id
 * Body: { name }
 */
exports.update = async (req, res) => {
  const conv = req.conversation;
  if (conv.type !== "group") {
    return res
      .status(400)
      .json({
        success: false,
        message: "Only group conversations can be updated",
      });
  }

  if (req.body.name !== undefined) {
    if (typeof req.body.name !== "string" || !req.body.name.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "name cannot be empty" });
    }
    conv.name = req.body.name.trim();
  }

  await conv.save();

  const populated = await Conversation.findById(conv._id)
    .populate("members", "_id name email avatarKey")
    .populate("owner", "_id name email avatarKey")
    .lean();

  const result = attachConversationAvatarUrl(populated);
  sseManager.sendToUsers(conv.members, "conversation:updated", result);

  return res.json({ success: true, data: result });
};

/**
 * POST /api/conversations/:id/avatar
 * Upload group avatar
 */
exports.uploadAvatar = async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ success: false, message: "No file uploaded" });
  }
  if (!BUCKET) {
    return res
      .status(500)
      .json({ success: false, message: "R2 bucket not configured" });
  }

  const conv = req.conversation;
  if (conv.type !== "group") {
    return res
      .status(400)
      .json({
        success: false,
        message: "Only group conversations can have an avatar",
      });
  }

  const ext = extFromFilename(req.file.originalname) || "jpg";
  const mime =
    req.file.mimetype && req.file.mimetype !== "application/octet-stream"
      ? req.file.mimetype
      : mimeFromImageExt(ext);
  const uuid = crypto.randomUUID();
  const avatarKey = `conversation-avatars/${conv._id}/${uuid}.${ext}`;

  if (conv.avatarKey) {
    try {
      await s3.send(
        new DeleteObjectCommand({ Bucket: BUCKET, Key: conv.avatarKey }),
      );
    } catch (err) {
      console.warn(
        "[conversation.uploadAvatar] delete old avatar failed:",
        err.message,
      );
    }
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: avatarKey,
      Body: req.file.buffer,
      ContentType: mime,
      ContentLength: req.file.size,
    }),
  );

  conv.avatarKey = avatarKey;
  await conv.save();

  const populated = await Conversation.findById(conv._id)
    .populate("members", "_id name email avatarKey")
    .populate("owner", "_id name email avatarKey")
    .lean();

  const result = attachConversationAvatarUrl(populated);
  sseManager.sendToUsers(conv.members, "conversation:updated", result);

  return res.json({ success: true, data: result });
};

/**
 * DELETE /api/conversations/:id/avatar
 */
exports.removeAvatar = async (req, res) => {
  const conv = req.conversation;
  if (!conv.avatarKey) {
    return res.json({
      success: true,
      data: attachConversationAvatarUrl(conv.toObject()),
    });
  }

  const oldKey = conv.avatarKey;
  conv.avatarKey = "";
  await conv.save();

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: oldKey }));
  } catch (err) {
    console.warn(
      "[conversation.removeAvatar] delete old avatar failed:",
      err.message,
    );
  }

  const populated = await Conversation.findById(conv._id)
    .populate("members", "_id name email avatarKey")
    .populate("owner", "_id name email avatarKey")
    .lean();

  const result = attachConversationAvatarUrl(populated);
  sseManager.sendToUsers(conv.members, "conversation:updated", result);

  return res.json({ success: true, data: result });
};

/**
 * POST /api/conversations/:id/members
 * Body: { userId }
 */
exports.addMember = async (req, res) => {
  const conv = req.conversation;
  if (conv.type !== "group") {
    return res
      .status(400)
      .json({
        success: false,
        message: "Cannot add members to direct conversation",
      });
  }

  const { userId } = req.body;
  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: "userId is required" });
  }

  const targetUser = await User.findById(userId).select(
    "_id name email avatarKey",
  );
  if (!targetUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const exists = conv.members.some((m) => m.toString() === userId.toString());
  if (exists) {
    return res
      .status(400)
      .json({ success: false, message: "User is already a member" });
  }

  conv.members.push(userId);
  await conv.save();

  const populated = await Conversation.findById(conv._id)
    .populate("members", "_id name email avatarKey")
    .populate("owner", "_id name email avatarKey")
    .lean();

  const result = attachConversationAvatarUrl(populated);
  sseManager.sendToUsers(conv.members, "conversation:member_added", {
    conversationId: conv._id,
    addedUser: targetUser,
    conversation: result,
  });

  return res.json({ success: true, data: result });
};

/**
 * DELETE /api/conversations/:id/members/:userId
 * Leave group or kick member
 */
exports.removeMember = async (req, res) => {
  const conv = req.conversation;
  if (conv.type !== "group") {
    return res
      .status(400)
      .json({
        success: false,
        message: "Cannot remove members from direct conversation",
      });
  }

  const targetUserId = req.params.userId;
  const isLeaving = targetUserId.toString() === req.userId.toString();
  const isOwner = conv.owner && conv.owner.toString() === req.userId.toString();

  // If kicking someone else, must be group owner or master
  if (!isLeaving && !isOwner && req.isAdmin !== "master") {
    return res
      .status(403)
      .json({ success: false, message: "Only group owner can kick members" });
  }

  conv.members = conv.members.filter(
    (m) => m.toString() !== targetUserId.toString(),
  );

  // If owner is leaving, transfer ownership or soft delete if no members left
  if (isOwner) {
    if (conv.members.length > 0) {
      conv.owner = conv.members[0];
    } else {
      conv.isDeleted = true;
    }
  }

  await conv.save();

  const populated = await Conversation.findById(conv._id)
    .populate("members", "_id name email avatarKey")
    .populate("owner", "_id name email avatarKey")
    .lean();

  const result = attachConversationAvatarUrl(populated);

  // Notify remaining members and the removed member
  const allNotified = [...conv.members, targetUserId];
  sseManager.sendToUsers(allNotified, "conversation:member_removed", {
    conversationId: conv._id,
    removedUserId: targetUserId,
    isLeaving,
    conversation: result,
  });

  return res.json({ success: true, data: result });
};

/**
 * POST /api/conversations/:id/upload-url
 * Body: { filename, mimeType?, sizeBytes? }
 * Get presigned URL to upload image/gif/audio for chat
 */
exports.getMediaUploadUrl = async (req, res) => {
  const { filename, mimeType, sizeBytes } = req.body;

  if (!filename || typeof filename !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "filename is required" });
  }

  if (!BUCKET) {
    return res
      .status(500)
      .json({ success: false, message: "R2 bucket not configured" });
  }

  const ext = extFromFilename(filename.toLowerCase());
  const fileUuid = crypto.randomUUID();
  const fileKey = `chat-media/${req.params.id}/${req.userId}/${fileUuid}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: fileKey,
    ContentType: mimeType || "application/octet-stream",
    ...(sizeBytes ? { ContentLength: sizeBytes } : {}),
  });

  const expiresIn = 15 * 60; // 15 minutes
  let uploadUrl;
  try {
    uploadUrl = await getSignedUrl(s3, command, { expiresIn });
  } catch (err) {
    console.error("[conversation.getMediaUploadUrl] sign failed:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to generate upload URL" });
  }

  return res.json({
    success: true,
    data: {
      uploadUrl,
      fileKey,
      expiresIn,
    },
  });
};
