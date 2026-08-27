const { Router } = require('express');
const ctrl = require('../controllers/player.controller');
const asyncHandler = require('../utils/asyncHandler');
const auth = require('../middleware/auth.middleware');

const router = Router();
router.use(auth);

router.get('/state', asyncHandler(ctrl.getState));
router.patch('/state', asyncHandler(ctrl.updateState));

module.exports = router;
