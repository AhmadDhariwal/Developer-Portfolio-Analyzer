const express = require('express');
const router = express.Router();
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
const { actionLimit } = require('../services/integrationGovernanceService');
const { protect } = require('../middleware/authmiddleware');
const kaggleLink = require('../controllers/integrationLinkedProfilescontroller').kaggle;
const {
  getLinkedProfile,
  saveLinkedProfile,
  removeLinkedProfile
} = require('../controllers/integrationLinkedProfilescontroller');
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
router.get('/linked-profiles/kaggle', protect, kaggleLink.get);
router.post('/linked-profiles/kaggle', protect, actionLimit('mutate'), kaggleLink.save);
router.delete('/linked-profiles/kaggle', protect, actionLimit('mutate'), kaggleLink.remove);
router.get('/linked-profiles/hackerrank', protect, getLinkedProfile);
router.post('/linked-profiles/hackerrank', protect, actionLimit('mutate'), saveLinkedProfile);
router.delete('/linked-profiles/hackerrank', protect, actionLimit('mutate'), removeLinkedProfile);
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
