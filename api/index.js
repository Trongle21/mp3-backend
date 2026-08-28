const connectDB = require('../src/config/db');

let dbReady;
async function ensureDB() {
  if (!dbReady) {
    dbReady = connectDB();
  }
  return dbReady;
}

const app = require('../src/app');

app.use(async (req, res, next) => {
  try {
    await ensureDB();
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = app;
