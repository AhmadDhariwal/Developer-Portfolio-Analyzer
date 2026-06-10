const mongoose = require('mongoose');
const { refreshJobCache } = require('./jobService');

const JOB_SYNC_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  Number.parseInt(process.env.JOB_SOURCE_SYNC_INTERVAL_MS || String(4 * 60 * 60 * 1000), 10)
);

const SYNC_PROFILES = [
  { careerStack: 'Full Stack', skills: '' },
  { careerStack: 'Frontend', skills: 'frontend' },
  { careerStack: 'Backend', skills: 'backend' },
  { careerStack: 'AI/ML', skills: 'machine learning' },
  { careerStack: 'DevOps', skills: 'devops' },
  { careerStack: 'Cloud', skills: 'cloud' },
  { careerStack: 'Data Engineering', skills: 'data engineering' },
  { careerStack: 'Cyber Security', skills: 'cyber security' },
  { careerStack: 'Mobile', skills: 'mobile' },
  { careerStack: 'QA Automation', skills: 'qa automation' }
];

let timer = null;
let isRunning = false;

async function runJobSourceSync(reason = 'scheduled') {
  if (isRunning) return { skipped: true, reason: 'already_running' };
  if (mongoose.connection.readyState !== 1) return { skipped: true, reason: 'mongo_not_ready' };

  isRunning = true;
  const results = [];

  try {
    for (const profile of SYNC_PROFILES) {
      const result = await refreshJobCache({
        careerStack: profile.careerStack,
        knownSkills: [],
        resumeSkills: [],
        platform: 'All',
        location: 'All',
        skills: profile.skills,
        jobType: 'All',
        expLevel: 'All'
      });

      results.push({
        reason,
        careerStack: profile.careerStack,
        skills: profile.skills,
        jobsFetched: Number(result.liveResult?.diagnostics?.liveJobsFetched || 0),
        cacheWrite: result.cacheWrite,
        sourceFailures: result.liveResult?.diagnostics?.sourceFailures || []
      });
    }

    return { skipped: false, results };
  } catch (error) {
    console.error('[JobSourceSync] Sync failed:', error.message);
    return { skipped: false, error: error.message, results };
  } finally {
    isRunning = false;
  }
}

function startJobSourceSyncWorker() {
  if (timer) return;

  timer = setInterval(() => {
    runJobSourceSync('scheduled').catch((error) => {
      console.error('[JobSourceSync] Scheduled tick failed:', error.message);
    });
  }, JOB_SYNC_INTERVAL_MS);

  if (typeof timer.unref === 'function') timer.unref();
  console.log(`Job source sync worker started. Interval: ${JOB_SYNC_INTERVAL_MS}ms`);
}

module.exports = {
  startJobSourceSyncWorker,
  runJobSourceSync
};
