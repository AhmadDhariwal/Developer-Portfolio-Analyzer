const mongoose = require('mongoose');
const settings = require('../../modules/super-admin/services/platformSettingsService');
const redis = require('../../core/cache/redisCacheService');
const {
  validatePasswordAgainstPolicy
} = require('../../modules/auth/utils/passwordPolicy');
const tokens = require('../../modules/auth/utils/authSessionToken');
const jwt = require('jsonwebtoken');
const otp = require('../../modules/auth/services/otpService');
const {
  requireRecruiterAccessEnabled
} = require('../../core/middleware/platformSettingsMiddleware');

process.on('message', async ({ id, op, uri, payload }) => {
  try {
    let result;
    if (op === 'connect') {
      if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri))
        throw Error('Loopback fixture required');
      await mongoose.connect(uri);
      await redis.initRedisCache({ silent: true });
      if (process.env.REDIS_URL && !redis.getRedisCacheClient())
        throw Error('Disposable Redis unavailable');
      await settings.startSettingsSynchronization();
    } else if (op === 'update') result = await settings.updateSettings(payload);
    else if (op === 'read') result = settings.getSettingsSnapshotSync();
    else if (op === 'gate') {
      result = 200;
      requireRecruiterAccessEnabled(
        {},
        {
          status(code) {
            result = code;
            return this;
          },
          json() {}
        },
        (error) => {
          if (error) throw error;
        }
      );
    } else if (op === 'policies') {
      process.env.JWT_SECRET = 'disposable-settings-policy-verification-key';
      const token = jwt.decode(
        tokens.sign({ _id: new mongoose.Types.ObjectId() })
      );
      const created = await otp.createOtp({
        userId: new mongoose.Types.ObjectId(),
        type: 'email'
      });
      result = {
        passwordValid: validatePasswordAgainstPolicy('short').valid,
        jwtSeconds: token.exp - token.iat,
        otpRemainingMs: created.expiresAt.getTime() - Date.now()
      };
    } else if (op === 'mongoOff') await mongoose.disconnect();
    else if (op === 'redisOff') await redis.closeRedisCache();
    else if (op === 'redisOn') await redis.initRedisCache({ silent: true });
    else if (op === 'close') {
      settings.stopSettingsSynchronization();
      await redis.closeRedisCache();
      await mongoose.disconnect();
    }
    process.send({ id, result });
    if (op === 'close') process.disconnect();
  } catch (error) {
    process.send({ id, error: error.message });
  }
});
