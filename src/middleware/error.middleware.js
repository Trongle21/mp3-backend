const { validationResult } = require('express-validator');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Express-validator result handler. Đặt sau các chain validate().
 */
function runValidation(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: errors.array().map((e) => ({ field: e.path || e.param, msg: e.msg })),
  });
}

// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, _next) {
  // Multer errors
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: 'File too large' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }

  // Multer fileFilter custom errors (cb(new Error(...))) — trả 400 thay vì 500.
  if (err && err.status === 400) {
    return res.status(400).json({ success: false, message: err.message });
  }

  // Mongoose CastError
  if (err && err.name === 'CastError') {
    return res.status(400).json({ success: false, message: `Invalid ${err.path}` });
  }

  // Mongoose duplicate key
  if (err && err.code === 11000) {
    return res.status(409).json({ success: false, message: 'Duplicate value', keyValue: err.keyValue });
  }

  const status = err.status || 500;
  const payload = {
    success: false,
    message: err.message || 'Internal server error',
  };

  if (process.env.NODE_ENV !== 'production' && status >= 500) {
    payload.stack = err.stack;
  }

  if (status >= 500) {
    console.error('[error]', err);
  }

  return res.status(status).json(payload);
}

function notFoundMiddleware(req, res) {
  return res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

module.exports = { HttpError, runValidation, errorMiddleware, notFoundMiddleware };
