const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAdapter, configuration } = require('../services/b2ObjectStorageService');
const { env, fixture, textPDF } = require('./fixtures/b2Fixture');
const { load } = require('./fixtures/publicPortfolioFixture');
const owner = '0123456789abcdef01234567';
function descriptor(kind = 'avatars', bytes = Buffer.from('fixture')) {
  const extension = kind === 'resumes' ? 'pdf' : 'png';
  return {
    ownerId: owner,
    kind,
    bucketAlias: kind === 'resumes' ? 'resumes' : 'images',
    bucket: kind === 'resumes' ? env.B2_RESUMES_BUCKET : env.B2_IMAGES_BUCKET,
    key: `v1/${kind}/${owner}/${crypto.randomUUID()}.${extension}`,
    size: bytes.length,
    mimeType: kind === 'resumes' ? 'application/pdf' : 'image/png',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  };
}
test('configuration defaults to filesystem and rejects partial/unsafe/shared B2 credentials', () => {
  assert.equal(configuration({}).driver, 'filesystem');
  assert.equal(configuration(env).buckets.images.bucket, 'fixture-images');
  for (const override of [
    { B2_IMAGES_KEY_ID: '' },
    { B2_IMAGES_ENDPOINT: 'http://127.0.0.1' },
    { B2_RESUMES_BUCKET: env.B2_IMAGES_BUCKET },
    { B2_RESUMES_KEY_ID: env.B2_IMAGES_KEY_ID },
    { STORAGE_DRIVER: 'unknown' }
  ])
    assert.throws(() => configuration({ ...env, ...override }));
  assert.ok(
    configuration({ ...env, STORAGE_DRIVER: 'filesystem' }).buckets,
    'rollback retains B2 readers'
  );
});
test('S3 operations isolate credentials/buckets and retain versions, integrity and bounded settings', async (t) => {
  const fake = fixture();
  const clients = [];
  t.after(() => clients.forEach((client) => client.destroy()));
  const adapter = createAdapter({
    env,
    clientFactory: (options, alias) => {
      const client = new (require('@aws-sdk/client-s3').S3Client)(options);
      assert.equal(typeof client.config.requestHandler.handle, 'function');
      client.send = fake.clientFactory(options, alias).send;
      clients.push(client);
      return client;
    }
  });
  for (const kind of ['avatars', 'resumes']) {
    const bytes = Buffer.from('fixture');
    const asset = descriptor(kind, bytes);
    Object.assign(asset, await adapter.put(asset, bytes));
    assert.deepEqual(await adapter.read(asset), bytes);
    assert.equal(await adapter.remove(asset), 1);
  }
  assert.equal(fake.configs.length, 2);
  assert.notEqual(
    fake.configs[0].options.credentials.accessKeyId,
    fake.configs[1].options.credentials.accessKeyId
  );
  assert.ok(
    fake.configs.every(
      ({ options }) =>
        options.maxAttempts === 1 && options.requestChecksumCalculation === 'WHEN_REQUIRED'
    )
  );
  assert.ok(
    fake.calls
      .filter((call) => call.op === 'PutObjectCommand')
      .every(
        (call) =>
          call.ServerSideEncryption === 'AES256' && call.ContentMD5 && call.ContentLength === 7
      )
  );
  assert.ok(
    fake.calls.filter((call) => call.op === 'DeleteObjectCommand').every((call) => call.VersionId)
  );
});
test('reads reject corrupt/oversized bytes and configuration drift without leaking provider failures', async () => {
  const fake = fixture();
  const adapter = createAdapter({ env, clientFactory: fake.clientFactory });
  const bytes = Buffer.from('fixture');
  const asset = descriptor('avatars', bytes);
  Object.assign(asset, await adapter.put(asset, bytes));
  fake.corrupt(true);
  await assert.rejects(adapter.read(asset), {
    message: 'Object storage unavailable.',
    status: 503
  });
  fake.corrupt(false);
  await assert.rejects(adapter.read({ ...asset, size: 2097153 }), { status: 503 });
  await assert.rejects(adapter.read({ ...asset, bucket: 'changed-bucket' }), { status: 503 });
  await assert.rejects(adapter.read({ ...asset, key: '../another-owner' }), { status: 503 });
  fake.fail('GetObjectCommand');
  await assert.rejects(adapter.read(asset), { message: 'Object storage unavailable.' });
});
test('unknown PUT outcomes delete only exact-key versions, including hidden versions, never prefix neighbors', async () => {
  const fake = fixture();
  const adapter = createAdapter({ env, clientFactory: fake.clientFactory });
  const bytes = Buffer.from('fixture');
  const asset = descriptor('avatars', bytes);
  await adapter.put(asset, bytes);
  await adapter.put(asset, bytes);
  fake.objects.set(asset.bucket + '/' + asset.key + '-neighbor', [
    { VersionId: 'neighbor', body: bytes }
  ]);
  assert.equal(await adapter.remove(asset), 2);
  assert.equal(fake.objects.get(asset.bucket + '/' + asset.key + '-neighbor').length, 1);
  assert.equal(await adapter.remove(asset), 0, 'repeated exact-version deletion is idempotent');
});
test('operation deadline and process admission bound stalled storage calls', async () => {
  const adapter = createAdapter({
    env,
    timeoutMs: 30,
    clientFactory: () => ({ send: () => new Promise(() => {}) })
  });
  const bytes = Buffer.from('fixture');
  const asset = descriptor('avatars', bytes);
  const pending = Array.from({ length: 8 }, () => adapter.put(asset, bytes));
  await assert.rejects(adapter.put(asset, bytes), { status: 503 });
  const settled = await Promise.allSettled(pending);
  assert.ok(
    settled.every((result) => result.status === 'rejected' && result.reason.status === 503)
  );
});

test(
  'disposable Mongo + fixture S3: existing upload APIs, privacy, replacement, cleanup, restart and legacy reads',
  { skip: !process.env.B2_ACCEPTANCE_MONGO, timeout: 90000 },
  async (t) => {
    const mongoose = require('mongoose');
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const os = require('node:os');
    const uri = process.env.B2_ACCEPTANCE_MONGO;
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:27140\//);
    const dbName = 'b2_storage_test_' + crypto.randomBytes(8).toString('hex');
    const local = await fs.mkdtemp(path.join(os.tmpdir(), 'b2-storage-fixture-'));
    const priorDriver = process.env.STORAGE_DRIVER;
    const priorRoot = process.env.PUBLIC_IMAGE_STORAGE_ROOT;
    process.env.STORAGE_DRIVER = 'b2';
    process.env.PUBLIC_IMAGE_STORAGE_ROOT = local;
    process.env.JWT_SECRET = 'disposable-storage-test-signing-key';
    const servers = [];
    const ownFiles = [];
    t.after(async () => {
      for (const server of servers) await new Promise((resolve) => server.close(resolve));
      assert.equal(mongoose.connection.name, dbName);
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
      for (const file of ownFiles) await fs.unlink(file).catch(() => {});
      for (const kind of ['avatars', 'portfolio-images']) {
        const dir = path.join(local, kind);
        for (const name of await fs.readdir(dir).catch(() => []))
          await fs.unlink(path.join(dir, name));
        await fs.rmdir(dir).catch(() => {});
      }
      await fs.rmdir(local);
      if (priorDriver === undefined) delete process.env.STORAGE_DRIVER;
      else process.env.STORAGE_DRIVER = priorDriver;
      if (priorRoot === undefined) delete process.env.PUBLIC_IMAGE_STORAGE_ROOT;
      else process.env.PUBLIC_IMAGE_STORAGE_ROOT = priorRoot;
    });
    await mongoose.connect(uri, { dbName, autoIndex: false, serverSelectionTimeoutMS: 5000 });
    const User = require('../models/user');
    const Profile = require('../models/publicProfile');
    const Resume = require('../models/resumeFile');
    const Asset = require('../models/storedAsset');
    const deletion = require('../services/accountDeletionService');
    for (const name of new Set([
      ...deletion.ownedModels,
      'storedAsset',
      'user',
      'organization',
      'publicProfile',
      'publicProfileView',
      'publicPortfolioVisit',
      'publicProfileCache',
      'Candidate',
      'repository',
      'sprintPreference',
      'sprintSchedule',
      'RecruiterMatch',
      'RecruiterShortlist',
      'Job',
      'integrationConnection',
      'integrationInsight',
      'integrationSyncLog',
      'integrationLinkedProfile',
      'accountDeletionCleanup'
    ]))
      await require('../models/' + name).createCollection();
    await Asset.createIndexes();
    await Profile.createIndexes();
    const user = await User.create({
      name: 'Storage Owner',
      email: 'storage-owner@example.test',
      providers: ['google']
    });
    const other = await User.create({
      name: 'Other Owner',
      email: 'storage-other@example.test',
      providers: ['google']
    });
    const fake = fixture();
    let adapter = createAdapter({ env, clientFactory: fake.clientFactory });
    t.mock.method(require('../services/b2ObjectStorageService'), 'getAdapter', () => adapter);
    const assets = require('../services/storedAssetService');
    const notifications = { createNotification: async () => null };
    const profileController = load('controllers/profilecontroller.js', {
      '../services/notificationService': notifications,
      '../services/newsService': { invalidateNewsSignalCache: () => {} },
      './dashboardcontroller': { invalidateDashboardSummaryCache: () => {} },
      '../services/platformSettingsService': { getDeveloperSettingsSync: () => ({}) }
    });
    const resumeController = load('controllers/resumecontoller.js', {
      '../services/notificationService': notifications,
      './dashboardcontroller': { invalidateDashboardSummaryCache: () => {} }
    });
    const allow = (_req, _res, next) => next();
    const app = express();
    app.use(express.json());
    app.use(
      '/api/profile',
      load('routes/profile.routes.js', {
        '../controllers/profilecontroller': profileController,
        '../middleware/publicPortfolioRateLimit': { uploadLimit: allow }
      })
    );
    app.use(
      '/api/resume',
      load('routes/resume.routes.js', {
        '../controllers/resumecontoller': resumeController,
        '../middleware/publicPortfolioRateLimit': { uploadLimit: allow }
      })
    );
    app.use(
      '/api/public-profiles',
      load('routes/publicProfile.routes.js', {
        '../middleware/publicPortfolioRateLimit': Object.fromEntries(
          [
            'publicViewLimit',
            'resumeLimit',
            'analyticsLimit',
            'mutationLimit',
            'uploadLimit',
            'contactLimit',
            'contactRecipientLimit'
          ].map((key) => [key, allow])
        )
      })
    );
    app.use(
      '/uploads',
      require('../middleware/storedImageMiddleware').storedImage,
      require('../middleware/publicUploadAccess'),
      express.static(local)
    );
    const start = async () => {
      const server = await new Promise((resolve) => {
        const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
      });
      servers.push(server);
      return `http://127.0.0.1:${server.address().port}`;
    };
    let base = await start();
    const token = (id) =>
      jwt.sign({ id: String(id) }, process.env.JWT_SECRET, {
        issuer: 'devinsight-api',
        audience: 'devinsight-web',
        expiresIn: '10m'
      });
    async function request(
      route,
      { method = 'GET', body, as = user._id, cookie, anonymous = false } = {}
    ) {
      const headers = {};
      if (!anonymous) headers.Authorization = 'Bearer ' + token(as);
      if (cookie) headers.Cookie = cookie;
      if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
      return fetch(base + route, {
        method,
        headers,
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
      });
    }
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhbcAAAAASUVORK5CYII=',
      'base64'
    );
    const form = (field, bytes, filename, type) => {
      const data = new FormData();
      data.append(field, new Blob([bytes], { type }), filename);
      return data;
    };
    const first = await request('/api/profile/avatar', {
      method: 'POST',
      body: form('avatar', png, 'not-trusted.html', 'image/png')
    });
    assert.equal(first.status, 200);
    const avatar = (await first.json()).avatar;
    assert.deepEqual(
      Buffer.from(await (await request(avatar, { anonymous: true })).arrayBuffer()),
      png
    );
    fake.fail('DeleteObjectCommand');
    const second = await request('/api/profile/avatar', {
      method: 'POST',
      body: form('avatar', png, 'photo.png', 'image/png')
    });
    assert.equal(second.status, 200);
    const avatar2 = (await second.json()).avatar;
    assert.notEqual(avatar, avatar2);
    assert.equal((await Asset.findOne({ reference: avatar })).state, 'deleting');
    await assert.rejects(assets.retryCleanup(), { status: 503 });
    fake.fail('');
    await Asset.updateMany({}, { $set: { retryAfter: new Date(0) } });
    await assets.retryCleanup();
    assert.equal(await Asset.exists({ reference: avatar }), null);
    assert.equal((await request(avatar, { anonymous: true })).status, 404);
    fake.fail('PutObjectCommand');
    const failed = await request('/api/profile/avatar', {
      method: 'POST',
      body: form('avatar', png, 'photo.png', 'image/png')
    });
    assert.equal(failed.status, 503);
    assert.equal((await User.findById(user._id)).avatar, avatar2);
    fake.fail('');
    const unknown = await Asset.findOne({ state: 'deleting', versionId: '' }).lean();
    assert.ok(unknown);
    await assert.rejects(assets.retryCleanup(), { status: 503 });
    assert.ok(await Asset.exists({ _id: unknown._id }), 'uncertain empty listing retains receipt');
    // Simulate a delayed provider commit after the caller/process already failed.
    fake.objects.set(unknown.bucket + '/' + unknown.key, [
      { VersionId: 'late-version', body: png }
    ]);
    adapter = createAdapter({ env, clientFactory: fake.clientFactory });
    await Asset.updateMany({}, { $set: { retryAfter: new Date(0) } });
    await assets.retryCleanup();
    assert.equal(await Asset.exists({ _id: unknown._id }), null);
    const imageResponse = await request('/api/public-profiles/me/project-image', {
      method: 'POST',
      body: form('image', png, 'project.png', 'image/png')
    });
    assert.equal(imageResponse.status, 201);
    const image = (await imageResponse.json()).imageUrl;
    const cookie = imageResponse.headers.get('set-cookie').split(';')[0];
    assert.equal((await request(image, { anonymous: true })).status, 404);
    assert.equal((await request(image, { anonymous: true, cookie })).status, 200);
    assert.equal(
      (await request(image, { anonymous: true, cookie: 'devinsight_media=' + token(user._id) }))
        .status,
      404,
      'API JWT cannot be used as a media credential'
    );
    await User.updateOne({ _id: user._id }, { $set: { sessionRevision: 1 } });
    assert.equal(
      (await request(image, { anonymous: true, cookie })).status,
      404,
      'credential changes revoke owner media cookies'
    );
    await User.updateOne({ _id: user._id }, { $set: { sessionRevision: 0 } });

    await User.updateOne(
      { _id: user._id },
      { $set: { password: await require('bcryptjs').hash('Storage-password-1!', 4) } }
    );
    const changedPassword = await request('/api/profile/password', {
      method: 'PUT',
      body: { currentPassword: 'Storage-password-1!', newPassword: 'Storage-password-2!' }
    });
    assert.equal(changedPassword.status, 200);
    const renewedCookie = changedPassword.headers.get('set-cookie').split(';')[0];
    assert.equal(
      (await request(image, { anonymous: true, cookie: renewedCookie })).status,
      200,
      'password change renews the current media credential'
    );
    assert.equal((await request(image, { anonymous: true, cookie })).status, 404);
    // Restore the disposable fixture's revision so later independent cases retain their initial token.
    await User.updateOne({ _id: user._id }, { $set: { sessionRevision: 0 } });
    const otherSession = await request('/api/profile/me', { as: other._id });
    const otherCookie = otherSession.headers.get('set-cookie').split(';')[0];
    assert.equal((await request(image, { anonymous: true, cookie: otherCookie })).status, 404);
    const publicService = require('../services/publicProfileService');
    await assert.rejects(
      publicService.updatePublicProfile(other._id, {
        projects: [{ title: 'Foreign', imageUrl: image }]
      }),
      { status: 400 }
    );
    let profile = await publicService.getOrCreatePublicProfile(user._id);
    await publicService.updatePublicProfile(user._id, {
      isPublic: true,
      projects: [{ title: 'Owned project', imageUrl: image }]
    });
    let publicImage = await request(image, { anonymous: true });
    assert.equal(publicImage.status, 200);
    assert.equal(publicImage.headers.get('cache-control'), 'private, no-store');
    await publicService.updatePublicProfile(user._id, {
      sections: { visibility: { projects: false } }
    });
    assert.equal(
      (await request(image, { anonymous: true })).status,
      404,
      'hidden sections cannot serve media by URL'
    );
    await publicService.updatePublicProfile(user._id, {
      sections: { visibility: { projects: true } }
    });
    await publicService.updatePublicProfile(user._id, { isPublic: false });
    assert.equal((await request(image, { anonymous: true })).status, 404);
    assert.equal((await request(image, { anonymous: true, cookie })).status, 200);
    const pdf = textPDF(
      'Alex Developer. Software engineer building accessible web applications with JavaScript TypeScript Node MongoDB and React. Experience delivering production applications, collaborating with teams and improving performance. Education Bachelor of Computer Science. Skills JavaScript TypeScript React SQL MongoDB Docker Git. Projects include a tested full stack application with documented APIs.'
    );
    const uploaded = await request('/api/resume/upload', {
      method: 'POST',
      body: form('file', pdf, 'resume.pdf', 'application/pdf')
    });
    assert.equal(uploaded.status, 200, JSON.stringify(await uploaded.clone().json()));
    const uploadedBody = await uploaded.json();
    assert.deepEqual(
      Object.keys(uploadedBody).sort(),
      ['contentQualityState', 'fileId', 'fileName', 'fileSize', 'message'].sort()
    );
    const resume = await Resume.findById(uploadedBody.fileId);
    assert.match(resume.fileUrl, /^b2:\/\/resumes\//);
    assert.equal(String((await User.findById(user._id)).activeResumeFileId), String(resume._id));
    assert.deepEqual(
      await require('../services/resumeStorageService').read(resume.fileUrl, user._id),
      pdf
    );
    const beforeForeign = fake.calls.length;
    assert.equal(
      (
        await request('/api/resume/analyze', {
          method: 'POST',
          as: other._id,
          body: { fileId: String(resume._id) }
        })
      ).status,
      403
    );
    assert.equal(
      fake.calls.length,
      beforeForeign,
      'foreign analysis is rejected before object retrieval'
    );

    await assert.rejects(
      require('../services/resumeStorageService').read(resume.fileUrl, other._id),
      { status: 404 }
    );
    assert.match(
      await require('../services/resumeservice').extractTextFromPDF(resume.fileUrl, user._id),
      /Alex Developer/
    );
    await User.updateOne({ _id: user._id }, { $set: { defaultResumeFileId: resume._id } });
    assert.equal(
      (await request(`/api/public-profiles/${profile.slug}/resume`, { anonymous: true })).status,
      404
    );
    fake.fail('GetObjectCommand');
    assert.equal((await request('/api/public-profiles/me/resume')).status, 503);
    fake.fail('');
    const ownPDF = await request('/api/public-profiles/me/resume');
    assert.equal(ownPDF.status, 200);
    assert.deepEqual(Buffer.from(await ownPDF.arrayBuffer()), pdf);
    await publicService.updatePublicProfile(user._id, { isPublic: true });
    assert.equal(
      (await request(`/api/public-profiles/${profile.slug}/resume`, { anonymous: true })).status,
      200
    );
    await publicService.updatePublicProfile(user._id, { isPublic: false });
    assert.equal(
      (await request(`/api/public-profiles/${profile.slug}/resume`, { anonymous: true })).status,
      404
    );
    // Restart adapter and HTTP listener: Mongo references and provider data remain authoritative.
    await new Promise((resolve) => servers[0].close(resolve));
    servers.shift();
    adapter = createAdapter({ env, clientFactory: fake.clientFactory });
    base = await start();
    assert.equal((await request(avatar2, { anonymous: true })).status, 200);
    assert.equal(
      (
        await request('/api/profile/avatar', {
          method: 'POST',
          body: form('avatar', Buffer.from('<svg/>'), 'bad.png', 'image/png')
        })
      ).status,
      400
    );
    const legacyDir = path.resolve(__dirname, '../../uploads');
    await fs.mkdir(legacyDir, { recursive: true });
    const legacy = path.join(legacyDir, `${user._id}-${crypto.randomUUID()}.pdf`);
    await fs.writeFile(legacy, pdf);
    ownFiles.push(legacy);
    await Resume.create({
      userId: user._id,
      fileName: 'legacy.pdf',
      fileUrl: legacy,
      fileSize: pdf.length
    });
    assert.deepEqual(await require('../services/resumeStorageService').read(legacy, user._id), pdf);
    await assert.rejects(require('../services/resumeStorageService').read(legacy, other._id), {
      status: 404
    });
    await assert.rejects(
      require('../services/resumeStorageService').read(path.join(local, 'outside.pdf'), user._id),
      { status: 404 }
    );
    const legacyImage = `/uploads/avatars/${user._id}-legacy.png`;
    await fs.mkdir(path.join(local, 'avatars'), { recursive: true });
    await fs.writeFile(path.join(local, 'avatars', `${user._id}-legacy.png`), png);
    assert.equal((await request(legacyImage, { anonymous: true })).status, 200);
    await require('../services/publicImageStorageService').remove(legacyImage);
    assert.ok(
      await fs.stat(path.join(local, 'avatars', `${user._id}-legacy.png`)),
      'B2 replacement never deletes legacy files'
    );
    const beforeRejected = fake.calls.length;
    assert.equal(
      (
        await request('/api/profile/avatar', {
          method: 'POST',
          body: form('avatar', Buffer.alloc(2097153), 'large.png', 'image/png')
        })
      ).status,
      413
    );
    assert.equal(fake.calls.length, beforeRejected, 'oversized input never reaches S3');
    process.env.STORAGE_DRIVER = 'filesystem';
    const fsImage = await require('../services/publicImageStorageService').put(
      'avatars',
      other._id,
      png,
      'png'
    );
    assert.ok(!assets.parse(fsImage));
    assert.equal((await request(fsImage, { anonymous: true })).status, 200);
    process.env.STORAGE_DRIVER = 'b2';
    const strictRouter = load('routes/resume.routes.js', {
      '../controllers/resumecontoller': resumeController
    });
    app.use('/strict-resume', strictRouter);
    const beforeAdmission = fake.calls.length;
    const admissionOutage = t.mock.method(
      require('../services/integrationMongoGovernanceService'),
      'requestWindow',
      async () => {
        throw Error('Disposable authoritative admission outage');
      }
    );
    assert.equal(
      (
        await request('/strict-resume/upload', {
          method: 'POST',
          body: form('file', pdf, 'resume.pdf', 'application/pdf')
        })
      ).status,
      503
    );
    assert.equal(
      fake.calls.length,
      beforeAdmission,
      'unavailable Mongo admission rejects before B2'
    );
    admissionOutage.mock.restore();
    const worker = require('node:child_process').fork(
      path.join(__dirname, 'fixtures/b2StorageWorker.js'),
      [],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
    );
    const workerResult = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.kill();
        reject(Error('Fixture restart timed out'));
      }, 15000);
      worker.once('message', (message) => {
        clearTimeout(timer);
        message.error ? reject(Error(message.error)) : resolve(message);
      });
      worker.send({
        uri,
        dbName,
        reference: resume.fileUrl,
        owner: String(user._id),
        objects: [...fake.objects].map(([key, versions]) => [
          key,
          versions.map((version) => ({
            VersionId: version.VersionId,
            body: version.body.toString('base64')
          }))
        ])
      });
    });
    assert.equal(
      workerResult.digest,
      crypto.createHash('sha256').update(pdf).digest('hex'),
      'fresh process reads persisted reference/version'
    );
    // A provider commit after account deletion must remain discoverable by its receipt.
    const racing = await User.create({
      name: 'Upload race',
      email: 'race-storage@example.test',
      providers: ['google']
    });
    const originalPut = adapter.put;
    let announce;
    let release;
    const entered = new Promise((resolve) => (announce = resolve));
    const waiting = new Promise((resolve) => (release = resolve));
    adapter.put = async (...args) => {
      announce();
      await waiting;
      return originalPut(...args);
    };
    const pending = assets.put('avatars', racing._id, png, 'png');
    await entered;
    await deletion.deleteAccount(racing._id);
    release();
    await assert.rejects(pending, { status: 503 });
    adapter.put = originalPut;
    assert.ok(
      await Asset.exists({ ownerId: racing._id }),
      'unknown provider result remains durable'
    );
    await Asset.updateMany({}, { $set: { retryAfter: new Date(0) } });
    await deletion.processCleanup(racing._id);
    assert.equal(await Asset.countDocuments({ ownerId: racing._id }), 0);
    process.env.STORAGE_DRIVER = 'filesystem';
    const rollbackResponse = await request('/api/profile/avatar', {
      method: 'POST',
      body: form('avatar', png, 'rollback.png', 'image/png')
    });
    assert.equal(rollbackResponse.status, 200);
    const rollbackAvatar = (await rollbackResponse.json()).avatar;
    assert.ok(!assets.parse(rollbackAvatar));
    await Asset.updateMany({}, { $set: { retryAfter: new Date(0) } });
    await assets.retryCleanup();
    assert.equal(
      await Asset.exists({ reference: avatar2 }),
      null,
      'filesystem rollback atomically retires an old B2 avatar'
    );
    process.env.STORAGE_DRIVER = 'b2';
    fake.fail('DeleteObjectCommand');
    await Promise.allSettled([assets.remove(image), deletion.deleteAccount(user._id)]);
    assert.equal(await User.exists({ _id: user._id }), null);
    assert.ok(
      (await Asset.find({ ownerId: user._id }).lean()).every((asset) => asset.state === 'deleting')
    );
    assert.ok(await require('../models/accountDeletionCleanup').exists({ _id: user._id }));
    assert.equal((await request(rollbackAvatar, { anonymous: true })).status, 404);
    fake.fail('');
    adapter = createAdapter({ env, clientFactory: fake.clientFactory });
    await Asset.updateMany({}, { $set: { retryAfter: new Date(0) } });
    await deletion.processCleanup(user._id);
    assert.equal(await Asset.countDocuments({ ownerId: user._id }), 0);
    assert.equal(await require('../models/accountDeletionCleanup').exists({ _id: user._id }), null);
    assert.ok(await User.exists({ _id: other._id }));
  }
);
