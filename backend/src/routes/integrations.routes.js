const express = require('express');
const router = express.Router();
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
const { actionLimit } = require('../services/integrationGovernanceService');
const { protect } = require('../middleware/authmiddleware');
const {
  getMarketplace,
  startOAuth,
  oauthCallback,
  githubOauthCallback,
  manualConnectProvider,
  ingestProviderData,
  syncNow,
  getSyncTrends,
  githubWebhook,
  getConnections,
  getIntegrationInsights,
  disconnectProvider
} = require('../controllers/integrationscontroller');

router.get('/marketplace', protect, getMarketplace);
router.get('/connections', protect, getConnections);
router.get('/insights', protect, getIntegrationInsights);
router.get('/sync-trends', protect, getSyncTrends);
router.get('/github/callback', actionLimit('callback', false), githubOauthCallback);
router.post('/oauth/start', protect, actionLimit('mutate'), startOAuth);
router.post('/oauth/callback', protect, actionLimit('mutate'), oauthCallback);
router.post('/manual/connect', protect, actionLimit('mutate'), manualConnectProvider);
router.post('/ingest', protect, actionLimit('mutate'), ingestProviderData);
router.post('/sync-now', protect, actionLimit('mutate'), syncNow);
router.post('/webhooks/github', actionLimit('webhook', false), githubWebhook);
router.delete('/connections/:provider', protect, disconnectProvider);

module.exports = router;
