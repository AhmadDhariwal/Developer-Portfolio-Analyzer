// Test-only worker. No .env, live providers or production database are loaded.
const mongoose = require('mongoose');
mongoose.set('bufferCommands', false);
const express = require('express');
let server;

async function start() {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(process.env.NOTIFICATION_TEST_URI || ''))
    throw Error('Disposable loopback database required');
  await mongoose.connect(process.env.NOTIFICATION_TEST_URI, {
    autoIndex: false,
    serverSelectionTimeoutMS: 2000
  });
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', require('../../routes/notification.routes'));
  server = app.listen(0, '127.0.0.1', () =>
    process.send({ ready: true, port: server.address().port })
  );
}
process.on('message', async (message) => {
  try {
    if (message.action === 'create') {
      const result = await require('../../services/notificationService').createNotification(
        message.payload
      );
      process.send({ id: message.id, result: result?._id || null });
    }
    if (message.action === 'stop') {
      await require('../../services/notificationStreamService').stop();
      server?.closeAllConnections();
      server?.close();
      await mongoose.disconnect();
      process.exit(0);
    }
    if (message.action === 'disconnect') {
      await mongoose.disconnect();
      await require('../../services/notificationStreamService').reconcile();
      process.send({ id: message.id, result: true });
    }
    if (message.action === 'recover') {
      await mongoose.connect(process.env.NOTIFICATION_TEST_URI, {
        autoIndex: false,
        serverSelectionTimeoutMS: 2000
      });
      process.send({ id: message.id, result: true });
    }
    if (message.action === 'reconcile') {
      await require('../../services/notificationStreamService').reconcile();
      process.send({ id: message.id, result: true });
    }
  } catch (error) {
    process.send({ id: message.id, error: error.message });
  }
});
start().catch(() => {
  process.send({ error: 'Worker startup failed' });
  process.exit(1);
});
