const { Router } = require('express');
const { body, param, query } = require('express-validator');
const convCtrl = require('../controllers/conversation.controller');
const msgCtrl = require('../controllers/message.controller');
const asyncHandler = require('../utils/asyncHandler');
const auth = require('../middleware/auth.middleware');
const { requireMember, requireConvOwner } = require('../middleware/conversation.middleware');
const upload = require('../middleware/upload.middleware');
const { runValidation } = require('../middleware/error.middleware');

const router = Router();
router.use(auth);

// ─── CONVERSATIONS ──────────────────────────────────────────────────────────

router.post(
  '/',
  [
    body('type').optional().isIn(['direct', 'group']),
    body('name').optional().isString().trim(),
    body('recipientId').optional().isMongoId(),
    body('memberIds').optional().isArray(),
  ],
  runValidation,
  asyncHandler(convCtrl.create)
);

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  runValidation,
  asyncHandler(convCtrl.list)
);

router.get(
  '/:id',
  [param('id').isMongoId()],
  runValidation,
  requireMember,
  asyncHandler(convCtrl.getOne)
);

router.patch(
  '/:id',
  [param('id').isMongoId(), body('name').optional().isString().trim()],
  runValidation,
  requireMember,
  requireConvOwner,
  asyncHandler(convCtrl.update)
);

router.post(
  '/:id/avatar',
  [param('id').isMongoId()],
  runValidation,
  requireMember,
  requireConvOwner,
  upload.uploadImage.single('file'),
  asyncHandler(convCtrl.uploadAvatar)
);

router.delete(
  '/:id/avatar',
  [param('id').isMongoId()],
  runValidation,
  requireMember,
  requireConvOwner,
  asyncHandler(convCtrl.removeAvatar)
);

router.post(
  '/:id/members',
  [param('id').isMongoId(), body('userId').isMongoId()],
  runValidation,
  requireMember,
  requireConvOwner,
  asyncHandler(convCtrl.addMember)
);

router.delete(
  '/:id/members/:userId',
  [param('id').isMongoId(), param('userId').isMongoId()],
  runValidation,
  requireMember,
  asyncHandler(convCtrl.removeMember)
);

router.post(
  '/:id/upload-url',
  [
    param('id').isMongoId(),
    body('filename').isString().notEmpty(),
    body('mimeType').optional().isString(),
    body('sizeBytes').optional().isInt({ min: 1 }),
  ],
  runValidation,
  requireMember,
  asyncHandler(convCtrl.getMediaUploadUrl)
);

// ─── MESSAGES ───────────────────────────────────────────────────────────────

router.post(
  '/:id/messages',
  [
    param('id').isMongoId(),
    body('content').optional({ nullable: true }).isString(),
    body('type').optional().isIn(['text', 'image', 'sticker', 'gif', 'audio']),
    body('replyTo').optional({ nullable: true }).isMongoId(),
  ],
  runValidation,
  requireMember,
  asyncHandler(msgCtrl.send)
);

router.get(
  '/:id/messages',
  [
    param('id').isMongoId(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('before').optional().isMongoId(),
  ],
  runValidation,
  requireMember,
  asyncHandler(msgCtrl.list)
);

router.post(
  '/:id/messages/read',
  [param('id').isMongoId()],
  runValidation,
  requireMember,
  asyncHandler(msgCtrl.markRead)
);

router.patch(
  '/:id/messages/:msgId',
  [
    param('id').isMongoId(),
    param('msgId').isMongoId(),
    body('content').isString().notEmpty(),
  ],
  runValidation,
  requireMember,
  asyncHandler(msgCtrl.edit)
);

router.delete(
  '/:id/messages/:msgId',
  [param('id').isMongoId(), param('msgId').isMongoId()],
  runValidation,
  requireMember,
  asyncHandler(msgCtrl.remove)
);

router.post(
  '/:id/messages/:msgId/react',
  [
    param('id').isMongoId(),
    param('msgId').isMongoId(),
    body('emoji').isString().notEmpty(),
  ],
  runValidation,
  requireMember,
  asyncHandler(msgCtrl.react)
);

module.exports = router;
