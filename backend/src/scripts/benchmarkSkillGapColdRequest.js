const path = require('node:path');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const User = require('../models/user');

const PORT = Number.parseInt(process.env.SKILL_GAP_BENCH_PORT || '5056', 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.SKILL_GAP_BENCH_TIMEOUT_MS || '180000', 10);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseArgs = () => {
  const args = new Set(process.argv.slice(2));
  return {
    forceRefresh: !args.has('--no-force-refresh')
  };
};

const waitForServer = async (child, getLogs) => {
  for (let i = 0; i < 90; i += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early with code ${child.exitCode}:\n${getLogs()}`);
    }
    const logs = getLogs();
    if (/server started/i.test(logs)) return;
    if (/EADDRINUSE|Environment validation failed/i.test(logs)) throw new Error(logs);
    await sleep(500);
  }
  throw new Error(`Backend did not become ready:\n${getLogs()}`);
};

const findBenchmarkUser = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const preferredUsername = process.env.SKILL_GAP_BENCH_USERNAME || 'ahmaddhariwal';
  let user = await User.findOne({
    $or: [
      { activeGithubUsername: new RegExp(`^${preferredUsername}$`, 'i') },
      { githubUsername: new RegExp(`^${preferredUsername}$`, 'i') }
    ]
  })
    .select('_id activeGithubUsername githubUsername activeCareerStack careerStack activeExperienceLevel experienceLevel')
    .lean();
  if (!user) {
    user = await User.findOne({ role: 'developer' })
      .select('_id activeGithubUsername githubUsername activeCareerStack careerStack activeExperienceLevel experienceLevel')
      .lean();
  }
  await mongoose.disconnect();
  if (!user) throw new Error('No benchmark user found');
  return user;
};

const makeToken = (userId) => jwt.sign({ id: String(userId) }, process.env.JWT_SECRET, {
  algorithm: 'HS256',
  issuer: process.env.JWT_ISSUER || 'devinsight-api',
  audience: process.env.JWT_AUDIENCE || 'devinsight-web',
  expiresIn: '15m'
});

const parsePipelineEvents = (logs) => logs
  .split(/\r?\n/)
  .filter((line) => line.includes('[SkillGapPipeline]'))
  .map((line) => {
    const match = line.match(/\[SkillGapPipeline\]\s+(\{.*\})/);
    if (!match) return { raw: line };
    try {
      return JSON.parse(match[1]);
    } catch (_) {
      return { raw: line };
    }
  });

const flattenWinningPlan = (plan) => {
  if (!plan || typeof plan !== 'object') return null;
  if (plan.indexName) return { stage: plan.stage, indexName: plan.indexName, keyPattern: plan.keyPattern };
  return flattenWinningPlan(plan.inputStage) || flattenWinningPlan(plan.inputStages?.[0]) || null;
};

const explainCacheLookup = async ({ userId, username, careerStack, experienceLevel }) => {
  const AnalysisCache = require('../models/analysisCache');
  await mongoose.connect(process.env.MONGODB_URI);
  await AnalysisCache.syncIndexes();
  const query = {
    userId,
    githubUsername: username,
    careerStack,
    experienceLevel,
    analysisVersion: 'v6-skill-intelligence',
    resumeHash: 'benchmark',
    resumeAnalysisId: 'benchmark',
    signalHash: 'benchmark'
  };
  const plan = await AnalysisCache.findOne(query).lean().explain('queryPlanner');
  await mongoose.disconnect();
  return flattenWinningPlan(plan.queryPlanner?.winningPlan);
};

const run = async () => {
  const options = parseArgs();
  const backendDir = path.resolve(__dirname, '../..');
  let logs = '';
  const child = spawn(process.execPath, ['index.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      LOG_REQUESTS: 'false',
      SKILL_GAP_AI_RETRIES: process.env.SKILL_GAP_AI_RETRIES || '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

  try {
    await waitForServer(child, () => logs);
    const user = await findBenchmarkUser();
    const username = user.activeGithubUsername || user.githubUsername || process.env.SKILL_GAP_BENCH_USERNAME || 'ahmaddhariwal';
    const token = makeToken(user._id);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    let headersAt = startedAt;
    let bodyParsedAt = startedAt;
    let responseStatus = 0;
    let responseBody = {};

    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/skillgap/skill-gap`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, forceRefresh: options.forceRefresh }),
        signal: controller.signal
      });
      headersAt = Date.now();
      responseStatus = response.status;
      responseBody = await response.json().catch(() => ({}));
      bodyParsedAt = Date.now();
    } finally {
      clearTimeout(timeout);
    }

    const logCaptureWaitMs = 750;
    await sleep(logCaptureWaitMs);
    const elapsedMs = bodyParsedAt - startedAt;
    const events = parsePipelineEvents(logs);
    const complete = events.filter((event) => event.event === 'request_complete').at(-1) || null;
    const explain = await explainCacheLookup({
      userId: user._id,
      username,
      careerStack: user.activeCareerStack || user.careerStack || 'Full Stack',
      experienceLevel: user.activeExperienceLevel || user.experienceLevel || 'Student'
    }).catch((error) => ({ error: error.message }));

    console.log(JSON.stringify({
      ok: responseStatus >= 200 && responseStatus < 300,
      responseStatus,
      elapsedMs,
      clientTimings: {
        timeToHeadersMs: headersAt - startedAt,
        bodyParseMs: bodyParsedAt - headersAt,
        httpRoundTripMs: bodyParsedAt - startedAt,
        postResponseLogCaptureMs: logCaptureWaitMs
      },
      username,
      forceRefresh: options.forceRefresh,
      responseSummary: {
        aiUsed: responseBody.aiUsed,
        skipAI: responseBody.skipAI,
        deterministicConfidence: responseBody.deterministicConfidence,
        fromCache: responseBody.fromCache,
        coverage: responseBody.coverage,
        error: responseBody.error || responseBody.message
      },
      pipelineEvents: events,
      requestComplete: complete,
      cacheLookupPlan: explain
    }, null, 2));
  } finally {
    child.kill('SIGTERM');
    await sleep(500);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
};

run().catch(async (error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  try { await mongoose.disconnect(); } catch (_) {}
  process.exitCode = 1;
});
