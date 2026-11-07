const { createHash, randomUUID } = require('node:crypto');
const State = require('../models/interviewCoordination');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const boundedSetting = (name, fallback, maximum) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
};
const unavailable = () =>
  Object.assign(new Error('Interview service is temporarily busy. Please retry.'), { statusCode: 503 });
const query = (operation) => operation.setOptions({ maxTimeMS: 500, bufferCommands: false });

// Atomic fixed-window reservations. Duplicate-key means the existing counter
// failed the bound, not permission to fall back to a process-local allowance.
const reserve = async (key, limit, windowMs) => {
  const window = Math.floor(Date.now() / windowMs);
  try {
    await query(
      State.findOneAndUpdate(
        { _id: `${key}:${window}`, count: { $lt: limit } },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * windowMs) } },
        { upsert: true, returnDocument: 'after' }
      )
    );
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw unavailable();
  }
};

const acquire = async (key, token, ttlMs) => {
  try {
    return await query(
      State.findOneAndUpdate(
        { _id: key, expiresAt: { $lte: new Date() } },
        { $set: { token, expiresAt: new Date(Date.now() + ttlMs) }, $unset: { value: 1 } },
        { upsert: true, returnDocument: 'after' }
      )
    ).lean();
  } catch (error) {
    if (error.code === 11000) return null;
    throw unavailable();
  }
};
const release = (key, token) => query(State.deleteOne({ _id: key, token }));

const rateLimit = (scope, defaultLimit) => async (req, res, next) => {
  try {
    const limit = boundedSetting(`RATE_LIMIT_INTERVIEW_${scope.toUpperCase()}_MAX`, defaultLimit, 1000);
    if (!(await reserve(`rate:${scope}:${hash(String(req.user._id))}`, limit, 600000))) {
      res.set('Retry-After', String(Math.ceil((600000 - (Date.now() % 600000)) / 1000)));
      return res.status(429).json({ message: 'Too many interview requests. Please try again later.' });
    }
    next();
  } catch {
    res.status(503).json({ message: unavailable().message });
  }
};

// The identity includes the full provider prompt and content/schema version.
// Completed values are short-lived transport results, never public bank rows
// or user/session identifiers. All callers still validate before persistence.
const runAI = async (prompt, operation) => {
  const key = `ai:v1:${hash(prompt)}`;
  const deadline = Date.now() + 6300;
  const token = randomUUID();
  while (Date.now() < deadline) {
    const existing = await query(State.findOne({ _id: key, expiresAt: { $gt: new Date() } })).lean();
    if (existing?.value) {
      if (existing.value.failed) throw unavailable();
      return existing.value.result;
    }
    const lease = await acquire(key, token, 15000);
    if (!lease) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    let slot;
    try {
      const slots = boundedSetting('INTERVIEW_AI_MAX_CONCURRENCY', 4, 32);
      for (let index = 0; index < slots; index++) {
        const candidate = `ai-slot:${index}`;
        if (await acquire(candidate, token, 15000)) {
          slot = candidate;
          break;
        }
      }
      if (!slot || !(await reserve('ai-quota', boundedSetting('INTERVIEW_AI_MAX_PER_MINUTE', 60, 10000), 60000))) {
        throw unavailable();
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6200);
      let result;
      try {
        result = await Promise.race([
          operation(controller.signal),
          new Promise((_, reject) =>
            controller.signal.addEventListener('abort', () => reject(unavailable()), { once: true })
          )
        ]);
      } finally {
        clearTimeout(timeout);
      }
      const published = await query(
        State.updateOne(
          { _id: key, token, expiresAt: { $gt: new Date() } },
          { $set: { value: { result }, expiresAt: new Date(Date.now() + 60000) } }
        )
      );
      if (!published.modifiedCount) throw unavailable();
      return result;
    } catch (error) {
      await query(
        State.updateOne(
          { _id: key, token, expiresAt: { $gt: new Date() } },
          { $set: { value: { failed: true }, expiresAt: new Date(Date.now() + 3000) } }
        )
      ).catch(() => {});
      throw error;
    } finally {
      if (slot) await release(slot, token).catch(() => {});
    }
  }
  throw unavailable();
};

module.exports = { rateLimit, reserve, acquire, release, runAI, hash };
