const { invalidInput } = require('../recruiterValidation');
const Job = require('../../models/Job');
const Application = require('../../../jobs/models/jobApplication');
const mongoose = require('mongoose');
const { applicationKeyExpression } = require('./applicationKeyExpression');

function pagination(query = {}) {
  if (!query || Object.keys(query).some((key) => !['page', 'limit'].includes(key)))
    throw invalidInput('Only page and limit are supported for application evaluations.');
  const integer = (value, fallback, maximum) => {
    if (value === undefined) return fallback;
    if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)))
      throw invalidInput('Invalid application page or limit.');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > maximum)
      throw invalidInput('Invalid application page or limit.');
    return number;
  };
  return { page: integer(query.page, 1, 1000000), limit: integer(query.limit, 100, 100) };
}

// Both joins and the consent/source-tuple checks precede the facet, so inaccessible,
// orphaned or mismatched evaluations cannot change either page contents or totals.
function buildPipeline(ctx, { page, limit }) {
  const owner = {
    recruiterId: new mongoose.Types.ObjectId(ctx.recruiterId),
    organizationId: new mongoose.Types.ObjectId(ctx.organizationId)
  };
  return [
    {
      $match: {
        ...owner,
        jobId: { $type: 'objectId' },
        candidateId: { $type: 'objectId' },
        applicationId: { $type: 'string', $regex: /^[a-f0-9]{64}$/ }
      }
    },
    { $sort: { updatedAt: -1, _id: 1 } },
    {
      $lookup: {
        from: Job.collection.name,
        localField: 'jobId',
        foreignField: '_id',
        pipeline: [{ $match: owner }, { $project: { title: 1 } }],
        as: 'linkedJob'
      }
    },
    { $unwind: '$linkedJob' },
    {
      $lookup: {
        from: Application.collection.name,
        localField: 'applicationId',
        foreignField: '_id',
        let: { job: '$jobId', applicant: '$candidateId' },
        pipeline: [
          {
            $match: {
              ...owner,
              'consent.version': 'direct-apply-v1',
              'consent.sharePortfolio': { $type: 'bool' },
              'consent.submittedAt': {
                $type: 'date',
                $gte: new Date(-8640000000000000),
                $lte: new Date(8640000000000000)
              },
              status: { $in: ['submitted', 'reviewing', 'rejected', 'withdrawn'] },
              $expr: {
                $and: [{ $eq: ['$jobId', '$$job'] }, { $eq: ['$applicantId', '$$applicant'] }]
              }
            }
          },
          {
            $project: {
              applicantId: 1,
              applicantName: 1,
              jobId: 1,
              recruiterId: 1,
              organizationId: 1,
              consent: 1,
              status: 1,
              jobTitle: 1,
              createdAt: 1
            }
          }
        ],
        as: 'linkedApplication'
      }
    },
    { $unwind: '$linkedApplication' },
    {
      $match: {
        $expr: { $eq: ['$applicationId', applicationKeyExpression('$jobId', '$candidateId')] }
      }
    },
    {
      $facet: {
        rows: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        count: [{ $count: 'total' }]
      }
    }
  ];
}

module.exports = { pagination, buildPipeline };
