const mongoose = require('mongoose');
const service = require('../../services/publicProfileService');
process.on('message', async (message) => {
  try {
    if (message.op === 'connect') {
      if (
        !/^mongodb:\/\/127\.0\.0\.1:27139\//.test(message.uri) ||
        !/^profile_acceptance_[a-f0-9]{16}$/.test(message.dbName)
      )
        throw Error('Unsafe fixture database');
      await mongoose.connect(message.uri, { dbName: message.dbName, autoIndex: false });
      process.send({ ready: true });
    } else if (message.op === 'read') {
      process.send({ payload: await service.getPublicProfileBySlug(message.slug) });
    } else if (message.op === 'close') {
      await mongoose.disconnect();
      process.send({ closed: true });
      process.disconnect();
    }
  } catch (error) {
    process.send({ error: error.message });
  }
});
