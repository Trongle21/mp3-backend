const { Router } = require('express');
const { param } = require('express-validator');
const ctrl = require('../controllers/track.controller');
const asyncHandler = require('../utils/asyncHandler');
const auth = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const { runValidation } = require('../middleware/error.middleware');

const router = Router();

// Mọi route đều cần auth và luôn filter theo owner trong controller.
router.use(auth);

router.post('/upload', upload.single('file'), asyncHandler(ctrl.upload));
router.get('/', asyncHandler(ctrl.list));
router.get('/:id', [param('id').isMongoId()], runValidation, asyncHandler(ctrl.getOne));
router.patch('/:id', [param('id').isMongoId()], runValidation, asyncHandler(ctrl.update));
router.delete('/:id', [param('id').isMongoId()], runValidation, asyncHandler(ctrl.remove));

// Cover art: upload, fetch (stream), remove.
router.post(
  '/:id/cover',
  [param('id').isMongoId()],
  runValidation,
  upload.uploadImage.single('file'),
  asyncHandler(ctrl.uploadCover)
);
router.get(
  '/:id/cover',
  [param('id').isMongoId()],
  runValidation,
  asyncHandler(ctrl.getCover)
);
router.delete(
  '/:id/cover',
  [param('id').isMongoId()],
  runValidation,
  asyncHandler(ctrl.removeCover)
);

// Streaming phải đặt CUỐI cùng (route `/stream` cụ thể hơn route `/:id`).
router.get('/:id/stream', [param('id').isMongoId()], runValidation, asyncHandler(ctrl.stream));

module.exports = router;
