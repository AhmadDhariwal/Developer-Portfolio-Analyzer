const mongoose = require('mongoose');
const admission = require('../../services/aiProviderAdmissionService');
(async () => {
  await mongoose.connect(process.env.AI_TEST_MONGO_URI, { dbName: process.env.AI_TEST_DATABASE });
  let lease;
  try {
    lease = await admission.enter('global', Date.now() + 2000, 5000);
    await new Promise((resolve) => setTimeout(resolve, 250));
    process.send({ admitted: true });
  } catch (error) {
    process.send({ admitted: false, reason: error.aiReason });
  } finally {
    await admission.release(lease);
    await mongoose.disconnect();
  }
})().catch(() => {
  process.exitCode = 1;
});
