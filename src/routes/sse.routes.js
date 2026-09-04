const { Router } = require('express');
const auth = require('../middleware/auth.middleware');
const sseManager = require('../utils/sseManager');

const router = Router();

/**
 * GET /api/sse/events
 * Real-time event stream via Server-Sent Events
 */
router.get('/events', auth, (req, res) => {
  sseManager.addConnection(req.userId, res);
});

module.exports = router;
