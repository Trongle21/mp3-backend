/**
 * Middleware kiểm tra quyền admin.
 * Đặt SAU auth middleware.
 *
 * req.isAdmin === 'normal' || req.isAdmin === 'master' → next()
 * req.isAdmin === null → 403 Forbidden
 */
module.exports = function requireAdmin(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: admin access required',
    });
  }
  next();
};