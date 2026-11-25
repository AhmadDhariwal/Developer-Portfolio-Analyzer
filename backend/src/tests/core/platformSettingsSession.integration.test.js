const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const settings = require('../../modules/super-admin/services/platformSettingsService');
const { sign } = require('../../modules/auth/utils/authSessionToken');
const {
  requireRecruiterAccessEnabled
} = require('../../core/middleware/platformSettingsMiddleware');

test(
  'settings test sessions warm stored policy and retain fail-closed expiry',
  { timeout: 60000 },
  async (t) => {
    const mongo = await startMongo({
      replicaSet: 'settings-session',
      temporaryRoot: path.resolve(__dirname, '../../../verification')
    });
    const priorSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'disposable-settings-session-regression-key';
    t.after(async () => {
      t.mock.timers.reset();
      settings.stopSettingsSynchronization();
      await mongoose.disconnect();
      await mongo.stop();
      if (priorSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = priorSecret;
    });
    await mongoose.connect(mongo.uri);
    await require('../../modules/super-admin/models/platformSettings').create({
      scope: 'global',
      recruiter: { enableRecruiterAccess: false },
      security: { jwtExpiresIn: '5m' }
    });
    await settings.startSettingsSynchronization();
    assert.equal(settings.getSettingsSnapshotSync().recruiter.enableRecruiterAccess, false);
    const user = { _id: new mongoose.Types.ObjectId(), sessionRevision: 2 };
    const token = jwt.verify(sign(user), process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'devinsight-api',
      audience: 'devinsight-web'
    });
    assert.equal(token.exp - token.iat, 300);
    assert.equal(token.sessionRevision, 2);
    // Reproduce the acceptance fixture's missing synchronization/refresh without a slow sleep.
    settings.stopSettingsSynchronization();
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    t.mock.timers.tick(31000);
    assert.throws(
      () => sign(user),
      (error) => error.statusCode === 503 || error.status === 503
    );
    let error;
    requireRecruiterAccessEnabled({}, {}, (failure) => {
      error = failure;
    });
    assert.equal(error?.statusCode || error?.status, 503);
    // Production request warmup restores the stored restrictive policy, never defaults.
    await settings.getSettings();
    let status;
    requireRecruiterAccessEnabled(
      {},
      {
        status(value) {
          status = value;
          return this;
        },
        json() {}
      },
      (failure) => {
        if (failure) throw failure;
      }
    );
    assert.equal(status, 403);
    assert.equal(jwt.decode(sign(user)).exp - jwt.decode(sign(user)).iat, 300);
  }
);
