const crypto = require('crypto');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { client: s3, BUCKET } = require('../config/r2');
const User = require('../models/User');

function extFromFilename(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : 'jpg';
}

function mimeFromImageExt(ext) {
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return map[ext] || 'image/jpeg';
}

/**
 * GET /api/users
 * Master: list all users (không trả về passwordHash).
 */
exports.list = async (req, res) => {
  const users = await User.find({})
    .select('_id email name isAdmin avatarUrl birthdate gender createdAt')
    .sort({ createdAt: -1 })
    .lean();
  return res.json({ success: true, data: users });
};

/**
 * PATCH /api/users/:id/role
 * Master: thay đổi isAdmin của user khác.
 * Body: { isAdmin: 'normal' | 'master' | null }
 * - null → 'normal'  ✅ (master only)
 * - 'normal' → null  ✅
 * - 'master' → 'normal' ✅
 * - 'normal' → 'master' ❌ (master không thể tự nâng ai lên master)
 * Không cho phép tự thay đổi role của chính mình.
 */
exports.updateRole = async (req, res) => {
  const { id } = req.params;

  if (id === req.userId) {
    return res.status(400).json({ success: false, message: 'Cannot change your own role' });
  }

  const target = await User.findById(id);
  if (!target) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const newRole = req.body.isAdmin;
  const valid = ['normal', 'master', null];
  if (!valid.includes(newRole)) {
    return res.status(400).json({
      success: false,
      message: 'isAdmin must be "normal", "master", or null',
    });
  }

  // Ràng buộc: master không thể promote bất kỳ ai lên master
  if (req.isAdmin === 'master' && newRole === 'master') {
    return res.status(403).json({
      success: false,
      message: 'Only a master can create another master',
    });
  }

  target.isAdmin = newRole;
  await target.save();

  return res.json({
    success: true,
    data: {
      _id: target._id,
      email: target.email,
      name: target.name,
      isAdmin: target.isAdmin,
      avatarUrl: target.avatarUrl,
      birthdate: target.birthdate,
      gender: target.gender,
      createdAt: target.createdAt,
    },
  });
};

/**
 * PATCH /api/users/:id
 * Master: sửa profile (name, birthdate, gender, avatar) của user khác.
 * KHÔNG cho phép sửa email.
 * KHÔNG cho phép tự sửa chính mình (dùng /me).
 */
exports.updateUser = async (req, res) => {
  const { id } = req.params;

  if (id === req.userId) {
    return res.status(400).json({ success: false, message: 'Cannot edit your own profile here — use /me' });
  }

  const target = await User.findById(id);
  if (!target) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const allowed = ['name', 'birthdate', 'gender'];
  const update = {};
  const errors = [];

  if (req.body.name !== undefined) {
    if (typeof req.body.name !== 'string') {
      errors.push({ field: 'name', msg: 'name must be a string' });
    } else {
      update.name = req.body.name.trim();
    }
  }

  if (req.body.birthdate !== undefined) {
    if (req.body.birthdate === null) {
      update.birthdate = null;
    } else {
      const d = new Date(req.body.birthdate);
      if (isNaN(d.getTime())) {
        errors.push({ field: 'birthdate', msg: 'Invalid date format' });
      } else {
        update.birthdate = d;
      }
    }
  }

  if (req.body.gender !== undefined) {
    const valid = ['male', 'female', 'other', null];
    if (!valid.includes(req.body.gender)) {
      errors.push({ field: 'gender', msg: 'gender must be male, female, other, or null' });
    } else {
      update.gender = req.body.gender;
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ success: false, message: 'No updatable fields supplied' });
  }

  // Không bao giờ cho sửa email
  Object.assign(target, update);
  await target.save();

  return res.json({ success: true, data: target });
};

/**
 * GET /api/users/me
 * Trả thông tin profile hiện tại kèm avatarUrl.
 */
exports.getProfile = async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  return res.json({ success: true, data: user });
};

/**
 * PATCH /api/users/me
 * Body: { name?, birthdate?, gender? }
 * Không cho phép tự thay đổi isAdmin.
 */
exports.updateProfile = async (req, res) => {
  const allowed = ['name', 'birthdate', 'gender'];
  const update = {};
  const errors = [];

  if (req.body.name !== undefined) {
    if (typeof req.body.name !== 'string') {
      errors.push({ field: 'name', msg: 'name must be a string' });
    } else {
      update.name = req.body.name.trim();
    }
  }

  if (req.body.birthdate !== undefined) {
    if (req.body.birthdate === null) {
      update.birthdate = null;
    } else {
      const d = new Date(req.body.birthdate);
      if (isNaN(d.getTime())) {
        errors.push({ field: 'birthdate', msg: 'Invalid date format' });
      } else {
        update.birthdate = d;
      }
    }
  }

  if (req.body.gender !== undefined) {
    const valid = ['male', 'female', 'other', null];
    if (!valid.includes(req.body.gender)) {
      errors.push({ field: 'gender', msg: 'gender must be male, female, other, or null' });
    } else {
      update.gender = req.body.gender;
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ success: false, message: 'No updatable fields supplied' });
  }

  const user = await User.findByIdAndUpdate(req.userId, update, { new: true });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  return res.json({ success: true, data: user });
};

/**
 * POST /api/users/me/avatar
 * multipart/form-data: file=...
 * Upload avatar mới, xóa avatar cũ trong R2.
 */
exports.updateAvatar = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  if (!BUCKET) {
    return res.status(500).json({ success: false, message: 'R2 bucket not configured' });
  }

  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const ext = extFromFilename(req.file.originalname) || 'jpg';
  const mime =
    req.file.mimetype && req.file.mimetype !== 'application/octet-stream'
      ? req.file.mimetype
      : mimeFromImageExt(ext);
  const avatarKey = `avatars/${req.userId}.${ext}`;

  // Xóa avatar cũ nếu có.
  if (user.avatarKey) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: user.avatarKey }));
    } catch (err) {
      console.warn('[user.updateAvatar] delete old avatar failed:', err.message);
    }
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: avatarKey,
      Body: req.file.buffer,
      ContentType: mime,
      ContentLength: req.file.size,
    })
  );

  user.avatarKey = avatarKey;
  await user.save();

  return res.json({ success: true, data: user });
};

/**
 * DELETE /api/users/me/avatar
 * Xóa avatar, đặt avatarKey = ''.
 */
exports.deleteAvatar = async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  if (!user.avatarKey) {
    return res.status(404).json({ success: false, message: 'No avatar to delete' });
  }

  const oldKey = user.avatarKey;
  user.avatarKey = '';
  await user.save();

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: oldKey }));
  } catch (err) {
    console.warn('[user.deleteAvatar] R2 delete failed:', err.message);
  }

  return res.json({ success: true, data: user });
};