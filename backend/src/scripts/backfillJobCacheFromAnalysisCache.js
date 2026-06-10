require('dotenv').config();
const mongoose = require('mongoose');
const AnalysisCache = require('../models/analysisCache');
const { syncJobsToCache } = require('../services/jobService');

const JOB_POOL_VERSION = 'jobs_pool_v3_real_sources';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const caches = await AnalysisCache.find({
    analysisVersion: JOB_POOL_VERSION,
    'analysisData.allJobs.0': { $exists: true }
  })
    .sort({ updatedAt: -1 })
    .lean();

  const jobs = caches.flatMap((cache) => Array.isArray(cache?.analysisData?.allJobs) ? cache.analysisData.allJobs : []);
  const result = await syncJobsToCache(jobs);

  console.log(JSON.stringify({
    cachesRead: caches.length,
    jobsRead: jobs.length,
    syncResult: result
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
