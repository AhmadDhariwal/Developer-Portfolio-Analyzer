const mongoose = require('mongoose');
const { withLease } = require('../../services/weeklyReportCoordinationService');
mongoose
  .connect(process.env.WEEKLY_FIXTURE_URI)
  .then(() =>
    withLease('crash-test', async () => {
      process.send({ claimed: true });
      await new Promise(() => {});
    }),
  )
  .catch((error) => {
    process.send({ error: error.message });
    process.exitCode = 1;
  });
