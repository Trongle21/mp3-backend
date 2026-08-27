const { Router } = require('express');
const { body, param } = require('express-validator');
const ctrl = require('../controllers/group.controller');
const asyncHandler = require('../utils/asyncHandler');
const auth = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const { runValidation } = require('../middleware/error.middleware');

const router = Router();
router.use(auth);

router.post(
  '/',
  [body('name').isString().trim().isLength({ min: 1, max: 200 })],
  runValidation,
  asyncHandler(ctrl.create)
);

router.get('/', asyncHandler(ctrl.list));

router.get('/:id', [param('id').isMongoId()], runValidation, asyncHandler(ctrl.getOne));

router.patch(
  '/:id',
  [param('id').isMongoId(), body('name').isString().trim().isLength({ min: 1, max: 200 })],
  runValidation,
  asyncHandler(ctrl.rename)
);

router.delete('/:id', [param('id').isMongoId()], runValidation, asyncHandler(ctrl.remove));

router.post(
  '/:id/tracks',
  [param('id').isMongoId(), body('trackId').isMongoId()],
  runValidation,
  asyncHandler(ctrl.addTrack)
);

router.delete(
  '/:id/tracks/:trackId',
  [param('id').isMongoId(), param('trackId').isMongoId()],
  runValidation,
  asyncHandler(ctrl.removeTrack)
);

router.patch(
  '/:id/reorder',
  [param('id').isMongoId(), body('trackIds').isArray({ min: 1 })],
  runValidation,
  asyncHandler(ctrl.reorder)
);

// Thumbnail: upload, fetch (stream), remove.
router.post(
  '/:id/thumbnail',
  [param('id').isMongoId()],
  runValidation,
  upload.uploadImage.single('file'),
  asyncHandler(ctrl.uploadThumbnail)
);
router.get(
  '/:id/thumbnail',
  [param('id').isMongoId()],
  runValidation,
  asyncHandler(ctrl.getThumbnail)
);
router.delete(
  '/:id/thumbnail',
  [param('id').isMongoId()],
  runValidation,
  asyncHandler(ctrl.removeThumbnail)
);

module.exports = router;
