// Disposable acceptance worker: no .env, external providers or production database.
const mongoose = require('mongoose');
const express = require('express');
let server;
(async () => {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(process.env.RESUME_TEST_URI || ''))
    throw Error('Disposable loopback URI required');
  await mongoose.connect(process.env.RESUME_TEST_URI, {
    serverSelectionTimeoutMS: 2000,
    autoIndex: false
  });
  const ai = require('../../services/aiservice');
  ai.runAIAnalysis = async (_prompt, fallback) => {
    await mongoose.connection.db
      .collection('fixture_metrics')
      .updateOne({ _id: 'ai' }, { $inc: { count: 1 } }, { upsert: true });
    await new Promise((resolve) => setTimeout(resolve, 200));
    return fallback;
  };
  const redis = require('../../services/redisCacheService');
  // An optional Redis outage must not prevent the durable operation.
  redis.getCacheJsonWithMeta = async () => {
    throw Error('fixture Redis unavailable');
  };
  redis.setCacheJson = async () => {
    throw Error('fixture Redis unavailable');
  };
  const extraction = require('../../services/resumePdfExtraction');
  const originalExtract = extraction.extract;
  extraction.extract = async (...args) => {
    await mongoose.connection.db
      .collection('fixture_metrics')
      .updateOne({ _id: 'parse' }, { $inc: { count: 1 } }, { upsert: true });
    return originalExtract(...args);
  };
  const admission = require('../../middleware/resumeAdmission');
  const controller = require('../../controllers/resumecontoller');
  const app = express();
  app.use(express.json());
  app.use(async (req, res, next) => {
    const id = req.get('x-fixture-user');
    if (!mongoose.isValidObjectId(id)) return res.sendStatus(401);
    req.user = await require('../../models/user').findById(id).lean();
    if (!req.user) return res.sendStatus(401);
    next();
  });
  app.post(
    '/analyze',
    admission.limit('analyze'),
    admission.analysisLease,
    controller.analyzeResumeFile
  );
  app.post(
    '/budget/:action',
    (req, res, next) => admission.limit(req.params.action)(req, res, next),
    (_req, res) => res.json({ ok: true })
  );
  server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
})().catch((error) => {
  process.send({ error: error.message });
  process.exit(1);
});
process.on('message', async (message) => {
  if (message === 'stop') {
    server?.closeAllConnections();
    server?.close();
    await mongoose.disconnect();
    process.exit(0);
  }
});
