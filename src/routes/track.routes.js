const { Router } = require('express');
const { query, param, body } = require('express-validator');
const ctrl = require('../controllers/track.controller');
const r2Ctrl = require('../controllers/r2.controller');
const asyncHandler = require('../utils/asyncHandler');
const auth = require('../middleware/auth.middleware');
const requireAdmin = require('../middleware/admin.middleware');
const upload = require('../middleware/upload.middleware');
const { runValidation } = require('../middleware/error.middleware');

const router = Router();

// Mọi route đều cần auth và luôn filter theo owner trong controller.
router.use(auth);

// ---- Presigned URL upload (bypass Vercel 4.5MB limit) ----------------------
// Client flow: getUploadUrl → PUT file lên R2 → finalizeUpload
// 🔒 Admin only — lấy presigned URL & finalize upload
router.post(
  '/upload-url',
  requireAdmin,
  [
    body('filename').isString().notEmpty(),
    body('mimeType').optional().isString(),
    body('sizeBytes').optional().isInt({ min: 1 }),
  ],
  runValidation,
  asyncHandler(r2Ctrl.getUploadUrl)
);
router.post(
  '/finalize',
  requireAdmin,
  [
    body('fileKey').isString().notEmpty(),
    body('title').optional().isString(),
    body('artist').optional().isString(),
    body('albumId').optional().isMongoId(),
    body('sizeBytes').optional().isInt({ min: 1 }),
  ],
  runValidation,
  asyncHandler(r2Ctrl.finalizeUpload)
);

// 🔒 Admin only — upload nhạc (multipart, qua Vercel, giới hạn 50MB)
router.post('/upload', requireAdmin, upload.single('file'), asyncHandler(ctrl.upload));
// ✅ Ai cũng được — xem danh sách / chi tiết
router.get(
  '/',
  [
    query('search').optional().isString().trim(),
    query('sort').optional().isIn(['createdAt', 'recent', 'title', 'artist']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('albumId').optional().isMongoId(),
  ],
  runValidation,
  asyncHandler(ctrl.list)
);
router.get('/:id', [param('id').isMongoId()], runValidation, asyncHandler(ctrl.getOne));
// ✅ Ai cũng được — stream & cover binary (public CDN sẽ phục vụ coverUrl)
router.get('/:id/cover', [param('id').isMongoId()], runValidation, asyncHandler(ctrl.getCover));
router.get('/:id/stream', [param('id').isMongoId()], runValidation, asyncHandler(ctrl.stream));

// 🔒 Admin only — sửa thông tin track
router.patch('/:id', requireAdmin, [param('id').isMongoId()], runValidation, asyncHandler(ctrl.update));

// 🔒 Admin only — xóa track
router.delete('/:id', requireAdmin, [param('id').isMongoId()], runValidation, asyncHandler(ctrl.remove));

// 🔒 Admin only — cover art
router.post(
  '/:id/cover',
  requireAdmin,
  [param('id').isMongoId()],
  runValidation,
  upload.uploadImage.single('file'),
  asyncHandler(ctrl.uploadCover)
);
router.delete(
  '/:id/cover',
  requireAdmin,
  [param('id').isMongoId()],
  runValidation,
  asyncHandler(ctrl.removeCover)
);

module.exports = router;
