const mongoose = require('mongoose');
const { env, fixture } = require('./b2Fixture');
const b2 = require('../../services/b2ObjectStorageService');
process.once('message', async ({ uri, dbName, objects, reference, owner }) => {
  try {
    if (
      !/^mongodb:\/\/127\.0\.0\.1:27140\//.test(uri) ||
      !/^b2_storage_test_[a-f0-9]{16}$/.test(dbName)
    )
      throw Error('Unsafe fixture database');
    await mongoose.connect(uri, { dbName, autoIndex: false });
    const fake = fixture();
    for (const [key, versions] of objects)
      fake.objects.set(
        key,
        versions.map((version) => ({
          VersionId: version.VersionId,
          body: Buffer.from(version.body, 'base64')
        }))
      );
    const adapter = b2.createAdapter({ env, clientFactory: fake.clientFactory });
    b2.getAdapter = () => adapter;
    const bytes = await require('../../services/storedAssetService').read(reference, owner);
    await require('../../services/storedAssetService').retryCleanup();
    await mongoose.disconnect();
    process.send({
      size: bytes.length,
      digest: require('node:crypto').createHash('sha256').update(bytes).digest('hex')
    });
    process.disconnect();
  } catch {
    await mongoose.disconnect();
    process.send({ error: 'Disposable worker failed.' });
    process.disconnect();
    process.exitCode = 1;
  }
});
