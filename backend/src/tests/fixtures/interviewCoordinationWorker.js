const mongoose = require('mongoose');
const State = require('../../models/interviewCoordination');
const coordination = require('../../services/interviewCoordinationService');

(async () => {
  await mongoose.connect(process.env.INTERVIEW_TEST_MONGO_URI, { dbName: process.env.INTERVIEW_TEST_DATABASE });
  const result = await coordination.runAI(process.env.INTERVIEW_TEST_PROMPT, async () => {
    await State.updateOne(
      { _id: 'fixture-provider-count' },
      { $inc: { count: 1 }, $set: { expiresAt: new Date(Date.now() + 60000) } },
      { upsert: true }
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { answer: 'shared result' };
  });
  process.send(result);
})()
  .catch((error) => {
    process.send({ error: error.message });
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
