// Run exactly one dedicated instance; Mongo leases also fence accidental replicas.
require('dotenv').config();
const mongoose = require('mongoose');
const {
  runWeeklyReportBatch,
  startWeeklyReportScheduler,
} = require('../services/weeklyReportService');
const delivery = require('../services/weeklyReportDeliveryService');

async function start() {
  if (
    !['true', '1', 'yes', 'on'].includes(
      String(process.env.WEEKLY_REPORT_SCHEDULER_ENABLED).toLowerCase(),
    )
  )
    throw Error('Enable WEEKLY_REPORT_SCHEDULER_ENABLED explicitly for the dedicated worker.');
  await mongoose.connect(process.env.MONGODB_URI);
  await require('../models/weeklyReportCoordination').init();
  await require('../models/weeklyReportRevision').init();
  await runWeeklyReportBatch(); // Restart catchup uses the same report identity and smart-skip rules.
  startWeeklyReportScheduler();
  const timer = setInterval(() => {
    delivery.processDue().catch((error) => console.error(error.message));
    runWeeklyReportBatch().catch((error) => console.error(error.message));
  }, 60000);
  const stop = async () => {
    clearInterval(timer);
    await mongoose.disconnect();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
start().catch((error) => {
  console.error(error.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
