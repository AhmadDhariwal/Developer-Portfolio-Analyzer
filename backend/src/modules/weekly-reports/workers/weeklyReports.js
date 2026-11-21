// Run exactly one dedicated instance; Mongo leases also fence accidental replicas.
require('dotenv').config();
const mongoose = require('mongoose');
const {
  runWeeklyReportBatch,
  startWeeklyReportScheduler,
  stopWeeklyReportScheduler,
} = require('../services/weeklyReportService');
const delivery = require('../services/weeklyReportDeliveryService');
let timer;
let activeTick;
let shutdownPromise;

const stop = () => {
  if (shutdownPromise) return shutdownPromise;
  clearInterval(timer);
  const deadline = setTimeout(() => process.exit(1), 15000);
  deadline.unref();
  shutdownPromise = (async () => {
    await Promise.allSettled([stopWeeklyReportScheduler(), activeTick]);
    await mongoose.disconnect();
    clearTimeout(deadline);
  })();
  return shutdownPromise;
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

async function start() {
  if (
    !['true', '1', 'yes', 'on'].includes(
      String(process.env.WEEKLY_REPORT_SCHEDULER_ENABLED).toLowerCase(),
    )
  )
    throw Error('Enable WEEKLY_REPORT_SCHEDULER_ENABLED explicitly for the dedicated worker.');
  await mongoose.connect(process.env.MONGODB_URI);
  if (shutdownPromise) return mongoose.disconnect();
  await require('../models/weeklyReportCoordination').init();
  await require('../models/weeklyReportRevision').init();
  activeTick = runWeeklyReportBatch(); // Restart catchup uses the same report identity and smart-skip rules.
  await activeTick;
  activeTick = null;
  if (shutdownPromise) return mongoose.disconnect();
  startWeeklyReportScheduler();
  timer = setInterval(() => {
    if (activeTick) return;
    activeTick = Promise.allSettled([delivery.processDue(), runWeeklyReportBatch()])
      .then((results) => {
        for (const result of results)
          if (result.status === 'rejected') console.error(result.reason.message);
      })
      .finally(() => {
        activeTick = null;
      });
  }, 60000);
}
start().catch((error) => {
  console.error(error.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
