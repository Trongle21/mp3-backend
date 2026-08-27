/**
 * Middleware kiểm tra quyền master.
 * Đặt SAU auth middleware.
 *
 * req.isAdmin === 'master' → next()
 * req.isAdmin === 'normal' | null → 403 Forbidden
 */
module.exports = function requireMaster(req, res, next) {
  if (req.isAdmin !== 'master') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: master access required',
    });
  }
  next();
};
