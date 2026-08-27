const { Router } = require('express');
const { body, param } = require('express-validator');
const ctrl = require('../controllers/group.controller');
const asyncHandler = require('../utils/asyncHandler');
const auth = require('../middleware/auth.middleware');
const requireAdmin = require('../middleware/admin.middleware');
const upload = require('../middleware/upload.middleware');
const { runValidation } = require('../middleware/error.middleware');

const router = Router();
router.use(auth);

// 🔒 Admin only — tạo group, xem list/detail
router.post(
  '/',
  requireAdmin,
  [body('name').isString().trim().isLength({ min: 1, max: 200 })],
  runValidation,
  asyncHandler(ctrl.create)
);
router.get('/', asyncHandler(ctrl.list));
router.get('/:id', [param('id').isMongoId()], runValidation, asyncHandler(ctrl.getOne));

// 🔒 Admin only — thêm track, xóa track khỏi group, reorder
router.post(
  '/:id/tracks',
  requireAdmin,
  [param('id').isMongoId(), body('trackId').isMongoId()],
  runValidation,
  asyncHandler(ctrl.addTrack)
);
router.delete(
  '/:id/tracks/:trackId',
  requireAdmin,
  [param('id').isMongoId(), param('trackId').isMongoId()],
  runValidation,
  asyncHandler(ctrl.removeTrack)
);
router.patch(
  '/:id/reorder',
  requireAdmin,
  [param('id').isMongoId(), body('trackIds').isArray({ min: 1 })],
  runValidation,
  asyncHandler(ctrl.reorder)
);

// ✅ Ai cũng được — xem thumbnail binary
router.get(
  '/:id/thumbnail',
  [param('id').isMongoId()],
  runValidation,
  asyncHandler(ctrl.getThumbnail)
);

// 🔒 Admin only — đổi tên, xóa group
router.patch(
  '/:id',
  requireAdmin,
  [param('id').isMongoId(), body('name').isString().trim().isLength({ min: 1, max: 200 })],
  runValidation,
  asyncHandler(ctrl.rename)
);
router.delete('/:id', requireAdmin, [param('id').isMongoId()], runValidation, asyncHandler(ctrl.remove));

// 🔒 Admin only — thumbnail: upload, remove
router.post(
  '/:id/thumbnail',
  requireAdmin,
  [param('id').isMongoId()],
  runValidation,
  upload.uploadImage.single('file'),
  asyncHandler(ctrl.uploadThumbnail)
);
router.delete(
  '/:id/thumbnail',
  requireAdmin,
  [param('id').isMongoId()],
  runValidation,
  asyncHandler(ctrl.removeThumbnail)
);

module.exports = router;
