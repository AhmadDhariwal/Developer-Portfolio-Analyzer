'use strict';
// Full HTTP/controller worker with synthetic upstream observations and a real
// disposable Mongo connection. No .env, provider credentials, or external calls.
const mongoose = require('mongoose');
const express = require('express');
const path = require('node:path');
const mock = (relative, exports) => {
  const filename = require.resolve(path.join(__dirname, '../..', relative));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const at = '2026-11-02T00:00:00.000Z';
const github = {
  repoCount: 1,
  repositories: [
    { name: 'fixture-original', language: 'TypeScript', topics: ['nodejs'], pushedAt: at }
  ],
  languageDistribution: [{ language: 'TypeScript' }],
  dataAvailability: { repositories: 'complete', repositorySignals: 'complete' },
  cache: { cachedAt: at, expiresAt: '2026-11-03T00:00:00.000Z', source: 'fixture' }
};
mock('services/githubservice.js', {
  parseGitHubUsername(raw) {
    if (typeof raw !== 'string' || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(raw))
      throw Object.assign(Error('Invalid username'), { status: 400 });
    return raw;
  },
  getCachedGitHubAnalysis: async () => ({ status: 'fresh', data: github, ageMs: 0 }),
  refreshGitHubAnalysisInBackground: () => ({ queued: false, running: false })
});
const shared = new Map();
mock('services/aiservice.js', {
  getSharedCache: async (key, namespace) => shared.get(namespace + key) || null,
  setSharedCache: async (key, value, _ttl, namespace) => {
    shared.set(namespace + key, value);
  },
  getDeterministicSummary: async () => null,
  setDeterministicSummary: async () => {},
  recordDeterministicSkip() {},
  runAIAnalysis: async (_prompt, fallback) => {
    await mongoose.connection.db
      .collection('integrationgovernancestates')
      .updateOne(
        { _id: 'test:skillgap:ai-calls' },
        { $inc: { count: 1 }, $set: { expiresAt: new Date(Date.now() + 3600000) } },
        { upsert: true }
      );
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { ok: false, value: fallback };
  }
});
const emptySignals = {
  integrationSignal: { present: false, detectedSkills: [] },
  careerSprintSignal: { completedSkillSignals: [], repeatedIncompleteSkills: [] },
  weeklyReportSignal: { repeatedWeakAreas: [] },
  portfolioSignal: { portfolioSkills: [] },
  jobsDemandSignal: { present: false, sampledJobs: 0, topSkills: [] }
};
mock('services/developerSignalService.js', {
  getDeveloperSignals: async () => emptySignals,
  getPublicJobMarketSignal: async () => emptySignals.jobsDemandSignal,
  buildSignalHash: () => 'fixture',
  buildSignalsUsedSummary: () => ({ jobsDemand: { sampledJobs: 0, topSkills: [] } }),
  buildResumeAnalysisSignals: (value, level) => ({
    analyzed: Boolean(value),
    analysisId: String(value?._id || ''),
    skills: value?.resumeSignals?.skills || [],
    technicalSkills: value?.resumeSignals?.skills || [],
    atsScore: null,
    experienceLevel: level,
    statusMessage: value ? 'Recorded synthetic resume' : 'No resume'
  }),
  buildResumeCacheIdentity: ({ resumeAnalysis: value }) => ({
    resumeHash: value ? String(value.resumeHash || value._id) : 'no-resume',
    resumeAnalysisId: String(value?._id || 'no-resume')
  }),
  buildAnalysisBasedOn: (input) => input
});
(async () => {
  await mongoose.connect(process.env.SKILL_GAP_TEST_MONGO, {
    autoIndex: false,
    serverSelectionTimeoutMS: 2000
  });
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/skillgap', require('../../routes/skillgap.routes'));
  const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  process.on('message', async (message) => {
    if (message === 'stop') {
      await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
      process.exit(0);
    }
  });
})().catch((error) => {
  process.send?.({ error: error.name });
  process.exit(1);
});
