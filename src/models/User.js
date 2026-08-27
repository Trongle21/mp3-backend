const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    name: { type: String, trim: true, default: '' },

    // Phân quyền admin: 'master' (cao nhất, không bị xóa), 'normal' (admin thường), null (user thường)
    isAdmin: {
      type: String,
      enum: ['normal', 'master'],
      default: null,
      index: true,
    },

    // Thông tin cá nhân
    avatarKey: { type: String, default: '' }, // key trong R2
    birthdate: { type: Date, default: null },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', null],
      default: null,
    },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } }
);

// Mặc định ẩn passwordHash + avatarKey ra ngoài response.
// avatarUrl được tính từ avatarKey.
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    // avatarKey phải capture TRƯỚC khi delete vì toJSON transform chạy đồng thời
    const key = ret.avatarKey;
    delete ret.avatarKey;
    if (key) {
      const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
      const normalized = key.startsWith('/') ? key.slice(1) : key;
      ret.avatarUrl = normalized ? `${base}/${normalized}` : null;
    } else {
      ret.avatarUrl = null;
    }
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);