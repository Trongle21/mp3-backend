const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Đọc header `Authorization: Bearer <token>`, verify, gắn req.userId.
 * Nếu thất bại trả 401.
 */
module.exports = async function authMiddleware(req, res, next) {
  try {
    let token = null;
    const header = req.headers.authorization || '';
    const [scheme, bearerToken] = header.split(' ');
    if (scheme === 'Bearer' && bearerToken) {
      token = bearerToken;
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Missing or invalid Authorization header or token query parameter' });
    }

    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not configured');

    const payload = jwt.verify(token, secret);
    if (!payload || !payload.sub) {
      return res.status(401).json({ success: false, message: 'Invalid token payload' });
    }

    // Xác nhận user vẫn tồn tại + lấy isAdmin.
    const user = await User.findById(payload.sub).select('_id isAdmin').lean();
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    req.userId = user._id.toString();
    req.isAdmin = user.isAdmin || null; // null | 'normal' | 'master'
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    next(err);
  }
};
