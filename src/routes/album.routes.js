const { Router } = require('express');
const { body, param, query } = require('express-validator');
const ctrl = require('../controllers/album.controller');
const asyncHandler = require('../utils/asyncHandler');
const auth = require('../middleware/auth.middleware');
const requireAdmin = require('../middleware/admin.middleware');
const upload = require('../middleware/upload.middleware');
const { runValidation } = require('../middleware/error.middleware');

const router = Router();
router.use(auth);

// ─── ALBUM CRUD ──────────────────────────────────────────────────────────────

// 🔒 Admin only — tạo album
router.post(
  '/',
  requireAdmin,
  [body('title').isString().trim().isLength({ min: 1, max: 200 })],
  runValidation,
  asyncHandler(ctrl.create)
);

// ✅ Ai cũng được — list / search
router.get(
  '/',
  [
    query('search').optional().isString().trim(),
    query('artist').optional().isString().trim(),
    query('genre').optional().isString().trim(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  runValidation,
  asyncHandler(ctrl.list)
);

// ✅ Ai cũng được — chi tiết album
router.get(
  '/:id',
  [param('id').isMongoId()],
  runValidation,
  asyncHandler(ctrl.getOne)
);

// 🔒 Admin only — cập nhật thông tin album
router.patch(
  '/:id',
  requireAdmin,
  [
    param('id').isMongoId(),
    body('title').optional().isString().trim().isLength({ min: 1, max: 200 }),
    body('artist').optional().isString().trim().isLength({ max: 200 }),
    body('description').optional().isString().trim().isLength({ max: 1000 }),
    body('year').optional({ nullable: true }).isInt({ min: 1900, max: 2100 }),
    body('genre').optional().isString().trim().isLength({ max: 100 }),
  ],
  runValidation,
  asyncHandler(ctrl.update)
);

// 🔒 Admin only — xóa album
router.delete(
  '/:id',
  requireAdmin,
  [param('id').isMongoId()],
  runValidation,
  asyncHandler(ctrl.remove)
);

// ─── TRACK MANAGEMENT ───────────────────────────────────────────────────────

// 🔒 Admin only — thêm track vào album
router.post(
  '/:id/tracks',
  requireAdmin,
  [param('id').isMongoId(), body('trackId').isMongoId()],
  runValidation,
  asyncHandler(ctrl.addTrack)
);

// 🔒 Admin only — xóa track khỏi album
router.delete(
  '/:id/tracks/:trackId',
  requireAdmin,
  [param('id').isMongoId(), param('trackId').isMongoId()],
  runValidation,
  asyncHandler(ctrl.removeTrack)
);

// 🔒 Admin only — reorder tracks trong album
router.patch(
  '/:id/reorder',
  requireAdmin,
  [param('id').isMongoId(), body('trackIds').isArray({ min: 1 })],
  runValidation,
  asyncHandler(ctrl.reorder)
);

// ─── THUMBNAIL ───────────────────────────────────────────────────────────────

// ✅ Ai cũng được — xem thumbnail
router.get(
  '/:id/thumbnail',
  [param('id').isMongoId()],
  runValidation,
  asyncHandler(ctrl.getThumbnail)
);

// 🔒 Admin only — upload thumbnail
router.post(
  '/:id/thumbnail',
  requireAdmin,
  [param('id').isMongoId()],
  runValidation,
  upload.uploadImage.single('file'),
  asyncHandler(ctrl.uploadThumbnail)
);

// 🔒 Admin only — xóa thumbnail
router.delete(
  '/:id/thumbnail',
  requireAdmin,
  [param('id').isMongoId()],
  runValidation,
  asyncHandler(ctrl.removeThumbnail)
);

module.exports = router;
