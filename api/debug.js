const app = require('../src/app');

app.get('/api/debug-env', (_req, res) => {
  const uri = process.env.MONGODB_URI || '';
  res.json({
    hasUri: !!uri,
    prefix: uri.slice(0, 25),
    length: uri.length,
    startsWithSrv: uri.startsWith('mongodb+srv://'),
    startsWithMongo: uri.startsWith('mongodb://'),
    nodeEnv: process.env.NODE_ENV,
    region: process.env.VERCEL_REGION,
  });
});

module.exports = app;