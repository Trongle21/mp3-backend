const { Router } = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/auth.controller');
const asyncHandler = require('../utils/asyncHandler');
const authMiddleware = require('../middleware/auth.middleware');
const { runValidation } = require('../middleware/error.middleware');

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down' },
});

router.post(
  '/register',
  authLimiter,
  [
    body('email').isEmail().withMessage('Invalid email').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name').optional().isString().isLength({ min: 0, max: 100 }),
  ],
  runValidation,
  asyncHandler(ctrl.register)
);

router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Invalid email').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  runValidation,
  asyncHandler(ctrl.login)
);

router.post(
  '/refresh',
  [body('refreshToken').isString().notEmpty()],
  runValidation,
  asyncHandler(ctrl.refresh)
);

router.get('/me', authMiddleware, asyncHandler(ctrl.me));

module.exports = router;
