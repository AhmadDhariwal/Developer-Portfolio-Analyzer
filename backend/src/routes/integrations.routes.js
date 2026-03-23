const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
  getMarketplace,
  startOAuth,
  oauthCallback,
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
router.post('/oauth/start', protect, startOAuth);
router.post('/oauth/callback', protect, oauthCallback);
router.post('/manual/connect', protect, manualConnectProvider);
router.post('/ingest', protect, ingestProviderData);
router.post('/sync-now', protect, syncNow);
router.post('/webhooks/github', githubWebhook);
router.delete('/connections/:provider', protect, disconnectProvider);

module.exports = router;
