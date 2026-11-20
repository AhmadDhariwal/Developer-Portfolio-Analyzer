const Job = require('../../models/Job');
const RecruiterMatch = require('../../models/RecruiterMatch');
const RecruiterShortlist = require('../../models/RecruiterShortlist');

const deleteJobWithPipeline = async (filter) =>
  Job.db.transaction(async (session) => {
    const job = await Job.findOneAndDelete(filter, { session }).lean();
    if (!job) return false;
    const pipeline = {
      jobId: job._id,
      organizationId: job.organizationId,
      recruiterId: job.recruiterId
    };
    await RecruiterMatch.deleteMany(pipeline, { session });
    await RecruiterShortlist.deleteMany(pipeline, { session });
    return true;
  });

const lockOwnedJob = async ({ jobId, recruiterId, organizationId, session }) => {
  // Serialize pipeline inserts with job deletion in the same database.
  const locked = await Job.updateOne(
    { _id: jobId, recruiterId, organizationId },
    { $inc: { __v: 1 } },
    { session, timestamps: false }
  );
  if (!locked.matchedCount) {
    throw Object.assign(new Error('Job not found.'), { statusCode: 404 });
  }
};

module.exports = { deleteJobWithPipeline, lockOwnedJob };
