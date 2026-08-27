/**
 * Wrap một async route handler để lỗi được forward tới Express error middleware.
 * Thay vì phải try/catch ở mọi controller:
 *
 *   router.get('/foo', asyncHandler(async (req, res) => { ... }))
 */
module.exports = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
