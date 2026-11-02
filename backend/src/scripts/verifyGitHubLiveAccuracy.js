'use strict';

// Real public GitHub responses + real controllers/services; persistence is disposable loopback Mongo.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');
const output = path.resolve(__dirname, '../../verification/github');
const temporaryRoot = path.join(output, 'runtime');
const observations = [];
let activeProfile = '';

const record = (response, failed = false) => {
  if (!String(response?.config?.url || '').startsWith('https://api.github.com/')) return;
  observations.push({
    profile: activeProfile,
    collectedAt: new Date().toISOString(),
    url: response.config.url,
    params: response.config.params || {},
    status: response.status,
    sourceDate: response.headers?.date || null,
    etag: response.headers?.etag || null,
    rateRemaining: response.headers?.['x-ratelimit-remaining'] ?? null,
    rateReset: response.headers?.['x-ratelimit-reset'] ?? null,
    failed,
    data: failed ? { message: response.data?.message || 'Unavailable' } : response.data
  });
};

function compare(username, result, source) {
  // Authentication rejection is followed by the service's real public retry.
  // Compare the retry's observation, while retaining both responses in raw evidence.
  source = source.filter((row) => row.status !== 401);
  const get = (suffix) => source.filter((row) => row.url.endsWith(suffix) && !row.failed);
  const user = get(`/users/${username}`)[0]?.data;
  assert.ok(user, 'Real public identity response required');
  const pages = get(`/users/${username}/repos`);
  const repos = [
    ...new Map(
      pages.flatMap((row) => row.data).map((repo) => [repo.name.toLowerCase(), repo])
    ).values()
  ];
  const checks = [];
  const equal = (field, actual, expected) => {
    assert.deepEqual(actual, expected, field);
    checks.push({ field, actual, expected, passed: true });
  };
  equal('identity', result.githubSignals.username.toLowerCase(), user.login.toLowerCase());
  equal('repoCount', result.repoCount, repos.length);
  equal('public profile repository count', result.repoCount, user.public_repos);
  equal('followers', result.followers, user.followers);
  equal(
    'totalStars',
    result.totalStars,
    repos.reduce((sum, repo) => sum + repo.stargazers_count, 0)
  );
  equal(
    'totalForks',
    result.totalForks,
    repos.reduce((sum, repo) => sum + repo.forks_count, 0)
  );
  equal(
    'repository names',
    result.repositories.map((repo) => repo.name).sort(),
    repos.map((repo) => repo.name).sort()
  );
  if (repos.length) {
    const originals = repos.filter((repo) => !repo.fork);
    equal(
      'original repository count',
      result.scoring.evidence.facts.originalRepoCount,
      originals.length
    );
    equal(
      'fork repository count',
      result.scoring.evidence.facts.forkRepoCount,
      repos.length - originals.length
    );
    equal(
      'scoring original stars',
      result.scoring.evidence.facts.totalStars,
      originals.reduce((sum, repo) => sum + repo.stargazers_count, 0)
    );
    equal(
      'scoring original forks',
      result.scoring.evidence.facts.totalForks,
      originals.reduce((sum, repo) => sum + repo.forks_count, 0)
    );
  }
  for (const actual of result.repositories) {
    const repo = repos.find((item) => item.name === actual.name);
    for (const [field, sourceField] of Object.entries({
      stars: 'stargazers_count',
      forks: 'forks_count',
      language: 'language',
      fork: 'fork',
      archived: 'archived',
      size: 'size'
    }))
      equal(
        `${repo.name}.${field}`,
        actual[field],
        field === 'language' ? repo[sourceField] || 'Unknown' : repo[sourceField]
      );
    for (const [field, sourceField] of Object.entries({
      pushedAt: 'pushed_at',
      updatedAt: 'updated_at',
      createdAt: 'created_at'
    }))
      equal(
        `${repo.name}.${field}`,
        actual[field],
        repo[sourceField] ? new Date(repo[sourceField]).toISOString() : null
      );
    const readme =
      source.find((row) => row.url.endsWith(`/repos/${username}/${repo.name}/readme`)) ||
      source.find((row) => row.url.endsWith(`/repos/${username}/${repo.name}/contents/README.md`));
    if (readme) {
      const text =
        readme.status === 200
          ? Buffer.from(readme.data.content || '', 'base64')
              .toString('utf8')
              .slice(0, 12000)
              .trim()
          : '';
      equal(
        `${repo.name}.hasReadme`,
        actual.hasReadme,
        readme.status === 200 ? !!text : readme.status === 404 ? false : null
      );
    } else equal(`${repo.name}.unsampledReadme`, actual.hasReadme, null);
  }
  const bytes = {};
  for (const row of source.filter((row) => row.url.endsWith('/languages') && !row.failed))
    for (const [language, value] of Object.entries(row.data))
      bytes[language] = (bytes[language] || 0) + value;
  if (Object.keys(bytes).length) equal('rawLanguageBytes', result.rawLanguageBytes, bytes);
  for (const activity of result.repositoryActivity) {
    const repo = repos.find((repo) => repo.name === activity.repo);
    assert.ok(!repo.fork && !repo.archived);
    const row = source.find((row) =>
      row.url.endsWith(`/repos/${username}/${repo.name}/contributors`)
    );
    const seen = new Set();
    const count =
      !row || row.failed
        ? null
        : row.status === 204
          ? 0
          : row.data.reduce((sum, contributor) => {
              const id = String(
                contributor.id || contributor.login || contributor.email || ''
              ).toLowerCase();
              if (id && seen.has(id)) return sum;
              if (id) seen.add(id);
              return sum + contributor.contributions;
            }, 0);
    equal(`${repo.name}.sampledContributorHistory`, activity.commits, count);
  }
  assert.ok(result.repositoryActivity.length <= 5);
  assert.ok(source.filter((row) => row.url.includes('/contents/README.md')).length <= 2);
  assert.ok(source.filter((row) => row.url.endsWith('/languages')).length <= 8);
  const reproduced = require('../services/scoring/githubHealthScore').calculate(
    result.scoring.evidence.inputs
  );
  equal('six-pillar score reproducibility', result.githubHealthScore, reproduced.score);
  equal('downstream score parity', result.githubSignals.scoring.score, result.githubHealthScore);
  equal('legacy activityScore parity', result.activityScore, result.githubHealthScore);
  equal('fresh source flag', result.cache.stale, false);
  return {
    username,
    sourceLogin: user.login,
    sourceProfileUpdatedAt: user.updated_at,
    sourceCollectedAt: source[0]?.collectedAt,
    sourceDate: source[0]?.sourceDate,
    fetchedAt: result.fetchedAt,
    freshness: result.cache,
    pages: pages.map((row) => ({ page: row.params.page, count: row.data.length })),
    excludedFromOriginalActivity: repos
      .filter((repo) => repo.fork || repo.archived)
      .map((repo) => ({ name: repo.name, fork: repo.fork, archived: repo.archived })),
    coverage: result.dataAvailability || {
      repositories: 'complete',
      activity: 'zero repositories'
    },
    score: result.scoring,
    checks,
    narrative: {
      summary: result.summary,
      strengths: result.strengths,
      weakAreas: result.weakAreas,
      interviewTalkingPoints: result.recruiterInsights?.interviewTalkingPoints
    },
    attribution:
      'Contributions sum up to the first 100 repository contributors, all authors and historical dates; not verified personal or lifetime commit counts.'
  };
}

(async () => {
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const mongo = await startMongo({ replicaSet: 'github-accuracy', temporaryRoot });
  let server;
  const report = {
    startedAt: new Date().toISOString(),
    mode: 'real public GitHub HTTP; real Express routes/services; disposable loopback Mongo',
    profiles: [],
    checks: [],
    productionDataUsed: false
  };
  const interceptor = axios.interceptors.response.use(
    (response) => {
      record(response);
      return response;
    },
    (error) => {
      if (error.response) record(error.response, true);
      return Promise.reject(error);
    }
  );
  try {
    require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
    process.env.MONGODB_URI = process.env.MONGO_URI = mongo.uri;
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.JWT_ISSUER = 'devinsight-api';
    process.env.JWT_AUDIENCE = 'devinsight-web';
    await mongoose.connect(mongo.uri);
    const app = express();
    app.use(express.json());
    app.use('/api/github', require('../routes/github.routes'));
    server = await new Promise((resolve) => {
      const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
    });
    const base = `http://127.0.0.1:${server.address().port}/api/github`;
    const User = require('../models/user'),
      Analysis = require('../models/analysis'),
      Repository = require('../models/repository');
    const userId = new mongoose.Types.ObjectId();
    await User.collection.insertOne({
      _id: userId,
      name: 'Disposable acceptance',
      email: 'github-acceptance@example.invalid',
      role: 'developer',
      isActive: true,
      sessionRevision: 0,
      githubUsername: 'octocat',
      activeGithubUsername: 'octocat'
    });
    const token = require('jsonwebtoken').sign({ id: String(userId) }, process.env.JWT_SECRET, {
      expiresIn: '10m',
      issuer: 'devinsight-api',
      audience: 'devinsight-web'
    });
    const headers = { Authorization: `Bearer ${token}` };
    const fetchJson = async (endpoint, body, auth = false) => {
      const response = await fetch(base + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth ? headers : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000)
      });
      return { status: response.status, data: await response.json() };
    };
    for (const username of (
      process.env.GITHUB_ACCEPTANCE_PROFILES || 'HydronChain,octocat,yyx990803'
    ).split(',')) {
      activeProfile = username;
      const start = observations.length;
      const responsePath = path.join(output, `${username}-analysis.json`);
      const sourcePath = path.join(output, `${username}-source.json`);
      const captured =
        process.env.GITHUB_ACCEPTANCE_RESUME === 'true' && fs.existsSync(responsePath)
          ? JSON.parse(fs.readFileSync(responsePath, 'utf8'))
          : null;
      const capturedSource =
        captured?.status === 200 && fs.existsSync(sourcePath)
          ? JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
          : null;
      const resume =
        captured?.status === 200 &&
        Date.now() - Date.parse(capturedSource?.find((row) => !row.failed)?.collectedAt) <
          60 * 60 * 1000;
      let source = resume ? capturedSource : null;
      if (
        resume &&
        username === 'octocat' &&
        fs.existsSync(path.join(output, 'canonical-readme-source.json'))
      )
        source.push(
          ...JSON.parse(fs.readFileSync(path.join(output, 'canonical-readme-source.json'), 'utf8'))
        );
      const get = axios.get;
      if (resume)
        axios.get = async (url, config = {}) => {
          // Replay exactly captured public source observations, never fabricate provider data.
          const row = source.find(
            (row) =>
              row.url === url &&
              row.status !== 401 &&
              JSON.stringify(row.params) === JSON.stringify(config.params || {})
          );
          assert.ok(row, `Missing captured source: ${url}`);
          const response = {
            status: row.status,
            data: row.data,
            headers: { date: row.sourceDate },
            config: { url, ...config }
          };
          if (row.failed) {
            const error = new Error('Captured public source failure');
            error.response = response;
            throw error;
          }
          return response;
        };
      let response;
      try {
        response = await fetchJson('/analyze', { username, forceRefresh: true });
      } finally {
        axios.get = get;
      }
      if (!resume) {
        source = observations.slice(start);
        fs.writeFileSync(sourcePath, JSON.stringify(source, null, 2));
      }
      if (resume && !fs.existsSync(path.join(output, `${username}-initial-analysis.json`)))
        fs.writeFileSync(
          path.join(output, `${username}-initial-analysis.json`),
          JSON.stringify(captured, null, 2)
        );
      fs.writeFileSync(responsePath, JSON.stringify(response, null, 2));
      assert.equal(response.status, 200, `${username}: analyzer must return usable fresh data`);
      const compared = compare(username, response.data, source);
      compared.responseOrigin = resume
        ? 'Real Express response using unmodified captured live public source replay (under 60 minutes old), live AI provider'
        : 'Real Express response with live public GitHub HTTP';
      report.profiles.push(compared);
      console.log(
        JSON.stringify({
          username,
          repositories: response.data.repoCount,
          score: response.data.githubHealthScore,
          checks: compared.checks.length
        })
      );
      fs.writeFileSync(
        path.join(output, 'live-accuracy-results.json'),
        JSON.stringify(report, null, 2)
      );
    }
    const originalUser = await User.findById(userId).lean();
    assert.equal(await Analysis.countDocuments({ userId }), 0);
    assert.equal(await Repository.countDocuments({ ownerId: userId }), 0);
    assert.equal(originalUser.githubUsername, 'octocat');
    const mismatch = await fetchJson('/analyze-save', { username: 'yyx990803' }, true);
    assert.equal(mismatch.status, 400);
    const saved = await fetchJson('/analyze-save', { username: 'octocat' }, true);
    assert.equal(saved.status, 200);
    const persisted = await Analysis.findOne({ userId }).lean();
    assert.equal(persisted.githubScore, saved.data.githubHealthScore);
    assert.equal(await Repository.countDocuments({ ownerId: userId }), saved.data.repoCount);
    report.checks.push(
      'Preview leaves synthetic identity, Repository and Analysis untouched',
      'Mismatched saved identity rejected',
      'Authenticated canonical save matches cached public evidence and persisted score'
    );
    report.completedAt = new Date().toISOString();
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure = String(error.message).replace(/github_pat_\w+|ghp_\w+/g, '[redacted]');
    console.error(report.failure);
    process.exitCode = 1;
  } finally {
    axios.interceptors.response.eject(interceptor);
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    report.cleanup = await mongo.stop();
    fs.writeFileSync(
      path.join(output, 'live-accuracy-results.json'),
      JSON.stringify(report, null, 2)
    );
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
