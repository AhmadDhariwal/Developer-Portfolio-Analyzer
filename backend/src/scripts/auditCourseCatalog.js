'use strict';

const mongoose = require('mongoose');
const fs = require('node:fs');
const maintenance = require('../services/courseCatalogMaintenanceService');

(async () => {
  const uri = process.env.MONGO_URI;
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/integration_live_acceptance\?/.test(uri || ''))
    throw Error('Use verifyLearningIsolated.js audit with disposable loopback Mongo.');
  await mongoose.connect(uri);
  try {
    // Nine bounded batches cover the current 35-entry curated inventory.
    for (let batch = 0; batch < 9; batch++) await maintenance.maintain();
    const report = await maintenance.coverageReport();
    fs.writeFileSync(process.env.COURSES_AUDIT_OUTPUT, JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify({
        providers: report.providers,
        audited: Object.keys(report.urlAudits).length,
      }),
    );
  } finally {
    await mongoose.disconnect();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
