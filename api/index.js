const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

let dbPromise;

function ensureDB() {
  if (!dbPromise) {
    dbPromise = connectDB().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

const app = require('../src/app');

// Debug endpoint — xem env vars thật trên Vercel.
app.get('/api/debug-env', (_req, res) => {
  const uri = process.env.MONGODB_URI || '';
  res.json({
    hasUri: !!uri,
    prefix: uri.slice(0, 30),
    length: uri.length,
    startsWithSrv: uri.startsWith('mongodb+srv://'),
    startsWithMongo: uri.startsWith('mongodb://'),
    nodeEnv: process.env.NODE_ENV,
    region: process.env.VERCEL_REGION,
  });
});

app.use(async (req, res, next) => {
  try {
    await ensureDB();
    next();
  } catch (err) {
    const readyState = mongoose.connection.readyState; // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    const uriPrefix = (process.env.MONGODB_URI || '').slice(0, 20);
    console.error('[mongo] connect failed:', err.message);
    console.error('[mongo] readyState:', readyState);
    console.error('[mongo] MONGODB_URI prefix:', uriPrefix);
    res.status(500).json({
      success: false,
      message: `Database connection failed: ${err.message}`,
      debug: { readyState, uriPrefix },
    });
  }
});

module.exports = app;