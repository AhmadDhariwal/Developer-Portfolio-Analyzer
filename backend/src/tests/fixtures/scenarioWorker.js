'use strict';
const mongoose = require('mongoose');
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/scenario_acceptance$/.test(process.env.SCENARIO_TEST_URI || ''))
  throw Error('Only disposable loopback databases are allowed.');
const service = require('../../services/scenarioSimulatorService');
const { exportScenario } = require('../../services/scenarioSprintExportService');
mongoose
  .connect(process.env.SCENARIO_TEST_URI)
  .then(() => process.send({ ready: true }))
  .catch((error) => process.send({ ready: false, error: error.message }));
process.on('message', async (message) => {
  try {
    if (message.action === 'stop') {
      await mongoose.disconnect();
      process.send({ id: message.id, value: true }, () => process.exit(0));
      return;
    }
    const value =
      message.action === 'save'
        ? await service.saveScenarioForUser(message.owner, message.payload)
        : message.action === 'history'
          ? await service.getScenarioHistoryForUser(message.owner)
          : await exportScenario(message.owner, message.sprintId, message.scenario, 'active-tasks');
    process.send({
      id: message.id,
      value:
        message.action === 'save'
          ? { id: String(value._id), hash: value.scenarioHash }
          : message.action === 'history'
            ? value
            : { replayed: value.replayed, receipt: value.receipt },
    });
  } catch (error) {
    process.send({ id: message.id, error: { message: error.message, statusCode: error.statusCode } });
  }
});
