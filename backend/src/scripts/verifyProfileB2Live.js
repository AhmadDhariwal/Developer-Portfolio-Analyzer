// Explicitly invoked acceptance only. Never connects to the application's Mongo URI.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const mongoose = require('mongoose');
const {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand
} = require('@aws-sdk/client-s3');
const b2 = require('../services/b2ObjectStorageService');

async function main() {
  const uri = process.env.PROFILE_B2_LIVE_MONGO;
  assert.match(uri || '', /^mongodb:\/\/127\.0\.0\.1:27140\/\?replicaSet=acceptance27140$/);
  const output = path.resolve(process.env.PROFILE_B2_LIVE_OUTPUT || '');
  assert.ok(process.env.PROFILE_B2_LIVE_OUTPUT);
  const child = process.argv[2] === '--restart';
  // A child receives only B2 fields and disposable Mongo settings from its parent.
  const env = child
    ? process.env
    : require('dotenv').parse(await fs.readFile(path.resolve(__dirname, '../../.env')));
  const adapter = b2.createAdapter({ env });
  const dbName = child
    ? process.env.PROFILE_B2_LIVE_DB
    : `profile_b2_live_${crypto.randomBytes(12).toString('hex')}`;
  assert.match(dbName || '', /^profile_b2_live_[a-f0-9]{24}$/);
  await fs.mkdir(output, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(),
    configuredWriteDriver: env.STORAGE_DRIVER || 'filesystem',
    productionDatabaseAccessed: false,
    credentialsLogged: false,
    buckets: {},
    checks: [],
    fixtureObjects: 0
  };
  const clients = {};
  const check = (name) => report.checks.push(name);
  const adapterGetter = b2.getAdapter;
  b2.getAdapter = () => adapter;
  const assets = require('../services/storedAssetService');
  const Asset = require('../models/storedAsset');
  const User = require('../models/user');
  const Profile = require('../models/publicProfile');
  const Resume = require('../models/resumeFile');
  const created = [];
  let connected = false;
  let stage = 'configuration';
  let owner;
  try {
    if (!child) {
      for (const alias of ['images', 'resumes']) {
        stage = `${alias} permission preflight`;
        const cfg = adapter.config.buckets[alias];
        const response = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
          headers: {
            Authorization:
              'Basic ' +
              Buffer.from(
                cfg.credentials.accessKeyId + ':' + cfg.credentials.secretAccessKey
              ).toString('base64')
          },
          signal: AbortSignal.timeout(15000)
        });
        assert.equal(response.status, 200);
        const auth = await response.json();
        const api = auth.apiInfo.storageApi;
        const allowed = api.allowed;
        assert.equal(allowed.buckets.length, 1);
        assert.equal(allowed.buckets[0].name, cfg.bucket);
        assert.equal(api.s3ApiUrl, cfg.endpoint);
        for (const cap of ['readFiles', 'writeFiles', 'listFiles', 'deleteFiles'])
          assert.ok(allowed.capabilities.includes(cap));
        assert.ok(
          !allowed.namePrefix ||
            ['avatars', 'portfolio-images', 'resumes']
              .filter((k) => (k === 'resumes') === (alias === 'resumes'))
              .every((k) => `v1/${k}/`.startsWith(allowed.namePrefix))
        );
        const bucketResponse = await fetch(api.apiUrl + '/b2api/v4/b2_list_buckets', {
          method: 'POST',
          headers: {
            Authorization: auth.authorizationToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            accountId: auth.accountId,
            bucketId: allowed.buckets[0].id
          }),
          signal: AbortSignal.timeout(15000)
        });
        assert.equal(bucketResponse.status, 200);
        const bucket = (await bucketResponse.json()).buckets[0];
        assert.equal(bucket.bucketType, 'allPrivate');
        const defaultRetention = bucket.fileLockConfiguration?.value?.defaultRetention?.mode;
        assert.ok(!defaultRetention, 'Default retention prevents disposable exact-version cleanup');
        report.buckets[alias] = {
          authentication: 'PASS',
          scopedToExpectedBucketOnly: true,
          privacy: bucket.bucketType,
          requiredFileCapabilities: true,
          extraWriteCapabilities: allowed.capabilities.filter(
            (cap) => cap.startsWith('write') && cap !== 'writeFiles'
          ),
          defaultEncryption: bucket.defaultServerSideEncryption?.value?.mode || 'not visible',
          lifecycleRuleCount: bucket.lifecycleRules?.length,
          retentionReadable: !!bucket.fileLockConfiguration?.isClientAuthorizedToRead,
          defaultRetention: defaultRetention || 'none or not visible'
        };
        clients[alias] = new S3Client({
          ...cfg,
          credentials: cfg.credentials,
          forcePathStyle: true,
          maxAttempts: 1,
          requestChecksumCalculation: 'WHEN_REQUIRED',
          requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 }
        });
      }
    }
    stage = 'disposable Mongo connection';
    await mongoose.connect(uri, {
      dbName,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000
    });
    connected = true;
    if (child) {
      const rows = await Asset.find().lean();
      assert.ok(rows.length > 0);
      for (const asset of rows.filter((row) => row.state === 'ready')) {
        const bytes = await assets.read(asset.reference, asset.ownerId);
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256);
      }
      await assets.retryCleanup();
      assert.equal(await Asset.countDocuments({ state: 'deleting' }), 0);
      await fs.writeFile(
        path.join(output, 'restart-result.json'),
        JSON.stringify(
          {
            status: 'PASS',
            freshProcess: true,
            persistedHashReads: rows.filter((row) => row.state === 'ready').length,
            pendingCleanupRecovered: rows.filter((row) => row.state === 'deleting').length
          },
          null,
          2
        )
      );
      return;
    }
    for (const model of [User, Asset, Profile, Resume]) await model.createCollection();
    await Asset.createIndexes();
    owner = (
      await User.create({
        name: 'B2 acceptance disposable owner',
        email: `b2-${crypto.randomUUID()}@example.test`,
        providers: ['google']
      })
    )._id;
    const foreign = new mongoose.Types.ObjectId();
    stage = 'generated fixture PDF validation';
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
      'base64'
    );
    const pdf = require('../tests/fixtures/b2Fixture').textPDF(
      'Alex Developer. Software engineer building accessible web applications with JavaScript TypeScript Node MongoDB and React. Experience delivering production applications, collaborating with teams and improving performance. Education Bachelor of Computer Science. Skills JavaScript TypeScript React SQL MongoDB Docker Git. Projects include a tested full stack application with documented APIs.'
    );
    assert.ok(
      (await require('pdf-parse/lib/pdf-parse')(Uint8Array.from(pdf))).text.includes(
        'Alex Developer'
      )
    );
    let profile = await Profile.create({
      userId: owner,
      slug: `b2-${crypto.randomUUID()}`,
      isPublic: false
    });
    const restart = async () => {
      const childEnv = {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        PROFILE_B2_LIVE_MONGO: uri,
        PROFILE_B2_LIVE_DB: dbName,
        PROFILE_B2_LIVE_OUTPUT: output
      };
      for (const [name, value] of Object.entries(env))
        if (/^B2_(IMAGES|RESUMES)_/.test(name) || name === 'STORAGE_DRIVER') childEnv[name] = value;
      await execFile(process.execPath, [__filename, '--restart'], {
        env: childEnv,
        timeout: 90000,
        maxBuffer: 4096,
        windowsHide: true
      });
    };
    for (const kind of ['avatars', 'portfolio-images', 'resumes']) {
      stage = `${kind} live upload and replacement`;
      const bytes = kind === 'resumes' ? pdf : png;
      for (let revision = 0; revision < 2; revision++) {
        const reference = await assets.put(kind, owner, bytes, kind === 'resumes' ? 'pdf' : 'png');
        const asset = await assets.get(reference, owner);
        created.push(asset);
        report.fixtureObjects++;
        await fs.writeFile(
          path.join(output, 'live-fixture-manifest.json'),
          JSON.stringify(
            created.map(({ kind, key, versionId, bucketAlias, sha256 }) => ({
              kind,
              key,
              versionId,
              bucketAlias,
              sha256
            })),
            null,
            2
          )
        );
        assert.deepEqual(await assets.read(reference, owner), bytes);
        await assert.rejects(assets.read(reference, foreign), { status: 404 });
        if (revision === 0) {
          const cfg = adapter.config.buckets[asset.bucketAlias];
          const head = await clients[asset.bucketAlias].send(
            new HeadObjectCommand({
              Bucket: cfg.bucket,
              Key: asset.key,
              VersionId: asset.versionId
            }),
            { abortSignal: AbortSignal.timeout(15000) }
          );
          assert.equal(head.ServerSideEncryption, 'AES256');
          assert.equal(head.Metadata.sha256, asset.sha256);
          const anonymous = await fetch(cfg.endpoint + '/' + cfg.bucket + '/' + asset.key, {
            signal: AbortSignal.timeout(15000)
          });
          await anonymous.body?.cancel();
          assert.ok([401, 403].includes(anonymous.status));
          const wrongClient = clients[asset.bucketAlias === 'images' ? 'resumes' : 'images'];
          await assert.rejects(
            wrongClient.send(
              new GetObjectCommand({
                Bucket: cfg.bucket,
                Key: asset.key,
                VersionId: asset.versionId
              }),
              { abortSignal: AbortSignal.timeout(15000) }
            ),
            (error) => error.$metadata?.httpStatusCode === 403
          );
        }
        if (kind === 'avatars') await assets.commitAvatar(owner, reference);
        if (kind === 'portfolio-images') {
          const previous = assets.references(profile.toObject());
          profile.projects = [{ title: 'Disposable project', imageUrl: reference }];
          await assets.commitPortfolio(profile, previous);
        }
        if (kind === 'resumes')
          await assets.commitResume(
            new Resume({
              userId: owner,
              fileName: 'disposable.pdf',
              fileUrl: reference,
              fileSize: bytes.length,
              resumeHash: asset.sha256
            })
          );
      }
      check(
        `${kind}: upload, version-pinned hash retrieval, replacement, foreign-owner denial, SSE AES256, anonymous denial, cross-bucket credential denial`
      );
    }
    stage = 'live exact-key version coverage';
    const firstAvatar = created.find((a) => a.kind === 'avatars');
    const secondVersion = await adapter.put(firstAvatar, png);
    assert.notEqual(secondVersion.versionId, firstAvatar.versionId);
    assert.deepEqual(await adapter.read(firstAvatar), png);
    check('multiple B2 versions retain pinned original reads; exact-key cleanup deletes both');
    stage = 'durable cleanup failure and fresh-process recovery';
    const originalRemove = adapter.remove;
    adapter.remove = async () => {
      throw b2.unavailable();
    };
    await assert.rejects(assets.retryCleanup(), { status: 503 });
    const failures = await Asset.find({ state: 'deleting' }).lean();
    assert.equal(failures.length, 2);
    assert.ok(failures.every((a) => a.cleanupAttempts === 1 && a.retryAfter));
    adapter.remove = originalRemove;
    await Asset.updateMany({ state: 'deleting' }, { $set: { retryAfter: new Date(0) } });
    await restart();
    const restarted = JSON.parse(
      await fs.readFile(path.join(output, 'restart-result.json'), 'utf8')
    );
    assert.equal(restarted.persistedHashReads, 4);
    assert.equal(restarted.pendingCleanupRecovered, 2);
    check(
      'injected deletion outage persists retry metadata; fresh OS process reads four live ready objects and recovers two cleanup receipts'
    );
    stage = 'disposable reference removal';
    await User.updateOne({ _id: owner }, { $set: { avatar: '' } });
    await Profile.deleteMany({ userId: owner });
    await Resume.deleteMany({ userId: owner });
    await Asset.updateMany({ ownerId: owner }, { $set: { state: 'deleting' } });
    await assets.retryCleanup();
    assert.equal(await Asset.countDocuments(), 0);
    check(
      'all disposable managed references and receipts cleaned; historical resume stayed ready until fixture teardown'
    );
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.failedStage = stage;
    report.failure = {
      type: error.code === 'ERR_ASSERTION' ? 'assertion' : 'operation',
      httpStatus: error.$metadata?.httpStatusCode || error.status || null
    };
    process.exitCode = 1;
  } finally {
    if (!child) {
      // Only receipts generated in this isolated DB/run may be removed remotely.
      if (connected && owner) {
        const remaining = await Asset.find({ ownerId: owner }).lean();
        for (const asset of remaining)
          if (!created.some((a) => a.key === asset.key)) created.push(asset);
      }
      report.cleanup = [];
      for (const asset of created) {
        try {
          await adapter.remove(asset);
          const cfg = adapter.config.buckets[asset.bucketAlias];
          const listing = await clients[asset.bucketAlias].send(
            new ListObjectVersionsCommand({
              Bucket: cfg.bucket,
              Prefix: asset.key,
              MaxKeys: 10
            }),
            { abortSignal: AbortSignal.timeout(15000) }
          );
          assert.equal(
            [...(listing.Versions || []), ...(listing.DeleteMarkers || [])].filter(
              (v) => v.Key === asset.key
            ).length,
            0
          );
          assert.ok(!listing.IsTruncated);
          report.cleanup.push({ kind: asset.kind, exactKeyAbsent: true });
        } catch {
          report.cleanup.push({ kind: asset.kind, exactKeyAbsent: false });
          report.status = 'FAIL';
          process.exitCode = 1;
        }
      }
      if (connected) {
        assert.equal(mongoose.connection.name, dbName);
        await mongoose.connection.dropDatabase();
      }
      report.finishedAt = new Date().toISOString();
      await fs.writeFile(
        path.join(output, 'live-b2-results.json'),
        JSON.stringify(report, null, 2)
      );
      console.log(
        JSON.stringify({
          status: report.status,
          failedStage: report.failedStage,
          fixtureObjects: report.fixtureObjects,
          checks: report.checks.length,
          allFixtureVersionsRemoved: report.cleanup.every((c) => c.exactKeyAbsent)
        })
      );
    }
    b2.getAdapter = adapterGetter;
    await mongoose.disconnect();
    for (const client of Object.values(clients)) client.destroy();
  }
}
main().catch(() => {
  console.log('Live B2 acceptance failed (sanitized); inspect retained stage results.');
  process.exitCode = 1;
});
