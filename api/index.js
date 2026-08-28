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

app.use(async (req, res, next) => {
  try {
    await ensureDB();
    next();
  } catch (err) {
    console.error('[mongo] connect failed:', err);
    res.status(500).json({
      success: false,
      message: `Database connection failed: ${err.message}`,
    });
  }
});

module.exports = app;
