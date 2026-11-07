const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const UserJobAction = require('../models/userJobAction');
const jobs = require('./jobService');
const FIELDS = ['saved', 'applied', 'hidden'];
const failure = (status, message) => Object.assign(new Error(message), { status });
function owner(userId) {
  if (!mongoose.isObjectIdOrHexString(userId)) throw failure(401, 'Authentication required.');
  return userId;
}
function jobKey(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\x00-\x20]/.test(id))
    throw failure(400, 'Invalid job id.');
  return id;
}
async function update(userId, id, patch) {
  owner(userId);
  jobKey(id);
  if (
    !patch ||
    Array.isArray(patch) ||
    !Object.keys(patch).length ||
    Object.keys(patch).some((key) => !FIELDS.includes(key) || typeof patch[key] !== 'boolean')
  )
    throw failure(400, 'Use boolean saved, applied or hidden fields.');
  const _id = createHash('sha256').update(`${userId}:${id}`).digest('hex');
  const filter = { _id, userId, jobId: id };
  const existing = await UserJobAction.findOne(filter).maxTimeMS(1500).lean();
  // Resolve aliases to the canonical public ID; never persist another user's input
  // as a job snapshot or trust a body-supplied owner.
  if (!existing) {
    const job = await jobs.findCachedJobById(id);
    if (!job) throw failure(404, 'Job no longer available.');
    if (job.id !== id) return update(userId, job.id, patch);
  }
  try {
    return await UserJobAction.findOneAndUpdate(
      filter,
      { $set: patch, $setOnInsert: { _id, userId, jobId: id } },
      { upsert: true, returnDocument: 'after', runValidators: true, maxTimeMS: 1500 }
    ).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    return UserJobAction.findOneAndUpdate(
      filter,
      { $set: patch },
      { returnDocument: 'after', runValidators: true, maxTimeMS: 1500 }
    ).lean();
  }
}
async function forJobs(userId, ids) {
  owner(userId);
  return UserJobAction.find({ userId, jobId: { $in: ids.slice(0, 1000) } })
    .select('jobId saved applied hidden')
    .limit(1000)
    .maxTimeMS(1500)
    .lean();
}
async function list(userId, query = {}) {
  owner(userId);
  const filter = { userId };
  if (query.state !== undefined) {
    if (!FIELDS.includes(query.state)) throw failure(400, 'Invalid action state.');
    filter[query.state] = true;
  }
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const page = Math.min(1000, Math.max(1, Number.parseInt(query.page, 10) || 1));
  const actions = await UserJobAction.find(filter)
    .sort({ updatedAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit + 1)
    .maxTimeMS(1500)
    .lean();
  return { actions: actions.slice(0, limit), page, hasMore: actions.length > limit };
}
module.exports = { update, list, forJobs, jobKey };
