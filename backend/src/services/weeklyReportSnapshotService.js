const mongoose = require('mongoose');
const Report = require('../models/weeklyReport');
const Revision = require('../models/weeklyReportRevision');
const fail = (status, message) => Object.assign(new Error(message), { status });
async function getOwned(userId, id, version) {
  if (!mongoose.isValidObjectId(id)) throw fail(400, 'Invalid report ID.');
  if (version !== undefined && (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version)))
    throw fail(400, 'Invalid report version.');
  const current = await Report.findOne({ _id: id, userId }).lean();
  if (!current) throw fail(404, 'Report not found.');
  if (!version || current.meta?.reportHash === version) return current;
  const revision = await Revision.findOne({ reportId: id, userId, contentHash: version }).lean();
  if (!revision) throw fail(404, 'Report version not found.');
  return revision.snapshot;
}
module.exports = { getOwned, fail };
