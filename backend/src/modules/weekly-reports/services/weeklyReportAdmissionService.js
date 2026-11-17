const State = require('../models/weeklyReportCoordination');
const { startOfWeek, endOfWeek } = require('./weeklyReportCalendar');
const fail = (status, message) => Object.assign(new Error(message), { status });
async function reserveRequest(userId, operation, maximum) {
  const window = Math.floor(Date.now() / 60000);
  try {
    await State.findOneAndUpdate(
      { _id: `request:${userId}:${operation}:${window}`, count: { $lt: maximum } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * 60000) } },
      { upsert: true, maxTimeMS: 2000 },
    );
  } catch (error) {
    throw error.code === 11000
      ? fail(429, 'Weekly report request limit reached.')
      : fail(503, 'Weekly report controls unavailable.');
  }
}
// Three resend reservations per owner/current reporting week, five minutes apart.
// Reservations are conservative when a process crashes; they are never refunded
// when delivery might already have happened.
async function reserveResend(userId) {
  const weekStart = startOfWeek();
  const key = `resend:${userId}:${weekStart.toISOString()}`;
  try {
    await State.updateOne(
      { _id: key },
      {
        $setOnInsert: {
          count: 0,
          lastAttemptAt: new Date(0),
          expiresAt: new Date(endOfWeek(weekStart).getTime() + 86400000),
        },
      },
      { upsert: true },
    );
    const row = await State.findOneAndUpdate(
      {
        _id: key,
        $expr: {
          $and: [
            { $lt: ['$count', 3] },
            { $lte: ['$lastAttemptAt', { $subtract: ['$$NOW', 300000] }] },
          ],
        },
      },
      [{ $set: { count: { $add: ['$count', 1] }, lastAttemptAt: '$$NOW' } }],
      { returnDocument: 'after', updatePipeline: true },
    ).lean();
    if (!row) throw fail(429, 'Resend cooldown (5 minutes) or weekly cap (3) reached.');
  } catch (error) {
    if (error.status) throw error;
    throw fail(503, 'Resend controls unavailable.');
  }
}
function admission(operation, maximum) {
  return async (req, res, next) => {
    try {
      await reserveRequest(String(req.user._id), operation, maximum);
      next();
    } catch (error) {
      if (error.status === 429) res.set('Retry-After', '60');
      res.status(error.status || 503).json({ message: error.message });
    }
  };
}
module.exports = { reserveRequest, reserveResend, admission };
