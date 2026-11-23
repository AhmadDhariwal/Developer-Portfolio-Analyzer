const mongoose = require('mongoose');
const Analysis = require('../../../skill-gap/models/analysis');
const Resume = require('../../../resume/models/resumeAnalysis');
const Profile = require('../../../public-portfolio/models/publicProfile');
const Sprint = require('../../../career-sprint/models/careerSprint');
const Weekly = require('../../../weekly-reports/models/weeklyReport');
const Candidate = require('../../models/Candidate');
const { escapeRegex } = require('../../../../core/utils/validation');
const { SORTS } = require('./candidateDiscoveryQuery');

const decimal = (value) => mongoose.Types.Decimal128.fromString(String(value));
const n = (value) => ({ $convert: { input: value, to: 'double', onError: 0, onNull: 0 } });
const array = (value) => ({ $cond: [{ $isArray: value }, value, []] });
const size = (value) => ({ $size: array(value) });
const mul = (a, b) => ({ $multiply: [a, b] });
const sum = (values) => values.reduce((a, b) => ({ $add: [a, b] }), 0);
const clamp = (value) => ({ $max: [0, { $min: [100, value] }] });
const truthy = (value, fallback) => ({ $cond: [{ $ifNull: [value, false] }, value, fallback] });
const first = (...values) => values.reduceRight((fallback, value) => truthy(value, fallback));
// Math.round uses ties toward +infinity, unlike MongoDB's bankers rounding.
const round = (value) => ({
  $let: {
    vars: { value },
    in: {
      $add: [
        { $floor: '$$value' },
        { $cond: [{ $gte: [{ $subtract: ['$$value', { $floor: '$$value' }] }, 0.5] }, 1, 0] }
      ]
    }
  }
});
// Match Number(double.toFixed(2)) without server-side JavaScript. Retain the
// exact binary mantissa as an Int64 before Decimal128 midpoint arithmetic.
const fixed2 = (value) => ({
  $let: {
    vars: { value: clamp(value) },
    in: {
      $cond: [
        { $lt: ['$$value', 0.005] },
        0,
        {
          $let: {
            vars: {
              unit: {
                $pow: [
                  2,
                  { $subtract: [{ $floor: { $log: [{ $max: ['$$value', 0.005] }, 2] } }, 52] }
                ]
              }
            },
            in: {
              $let: {
                vars: {
                  mantissa: { $toDecimal: { $toLong: { $divide: ['$$value', '$$unit'] } } },
                  denominator: { $toDecimal: { $toLong: { $divide: [1, mul('$$unit', 4)] } } }
                },
                in: {
                  $toDouble: {
                    $divide: [
                      {
                        $floor: {
                          $add: [
                            { $divide: [mul('$$mantissa', decimal(25)), '$$denominator'] },
                            decimal('0.5')
                          ]
                        }
                      },
                      decimal(100)
                    ]
                  }
                }
              }
            }
          }
        }
      ]
    }
  }
});
const weighted = (github, resume, consistency, growth) =>
  fixed2(
    sum([mul(n(github), 0.3), mul(n(resume), 0.3), mul(n(consistency), 0.2), mul(n(growth), 0.2)])
  );
const measured = (field) => ({
  $and: [{ $isNumber: field }, { $gte: [field, 0] }, { $lte: [field, 100] }]
});
const regex = (input, value) => ({
  $regexMatch: { input: { $ifNull: [input, ''] }, regex: escapeRegex(value), options: 'i' }
});
const normalizeSkills = (value) => ({
  $filter: {
    input: {
      $setUnion: [
        {
          $map: {
            input: array(value),
            as: 'skill',
            in: {
              $trim: {
                input: { $convert: { input: '$$skill', to: 'string', onNull: '', onError: '' } }
              }
            }
          }
        },
        []
      ]
    },
    as: 'skill',
    cond: { $ne: ['$$skill', ''] }
  }
});

function projectExpression(projection, variable) {
  const result = { _id: `${variable}._id` };
  function rebase(value) {
    if (typeof value === 'string' && value.startsWith('$') && !value.startsWith('$$'))
      return variable + '.' + value.slice(1);
    if (Array.isArray(value)) return value.map(rebase);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebase(item)]));
    return value;
  }
  for (const [key, value] of Object.entries(projection)) {
    const parts = key.split('.');
    let target = result;
    for (const part of parts.slice(0, -1)) target = target[part] ||= {};
    target[parts.at(-1)] = value === 1 ? `${variable}.${key}` : rebase(value);
  }
  return result;
}

function lookup(model, alias, sort, projection) {
  return [
    {
      $lookup: { from: model.collection.name, localField: '_id', foreignField: 'userId', as: alias }
    },
    {
      $set: {
        [alias]: {
          $cond: [
            { $gt: [size(`$${alias}`), 0] },
            {
              $let: {
                vars: {
                  doc: { $arrayElemAt: [{ $sortArray: { input: `$${alias}`, sortBy: sort } }, 0] }
                },
                in: projectExpression(projection, '$$doc')
              }
            },
            null
          ]
        }
      }
    }
  ];
}

function aliasLookup(full = false) {
  const fields = {
    userId: 1,
    fullName: 1,
    stack: 1,
    yearsOfExperience: 1,
    headline: 1,
    location: 1,
    githubUsername: 1,
    githubScore: 1,
    resumeScore: 1,
    consistencyScore: 1,
    growthPotentialScore: 1,
    skills: 1,
    ...(full ? { projects: 1, githubStats: 1, skillGaps: 1, aiInsight: 1 } : {})
  };
  const latestNonEmpty = (field) => ({
    $reduce: { input: '$$docs', initialValue: '', in: truthy(`$$this.${field}`, '$$value') }
  });
  const rollup = {
    last: {
      $let: {
        vars: { doc: { $arrayElemAt: ['$$docs', -1] } },
        in: projectExpression(fields, '$$doc')
      }
    },
    skills: {
      $reduce: {
        input: '$$docs',
        initialValue: [],
        in: {
          $reduce: {
            input: array('$$this.skills'),
            initialValue: '$$value',
            in: {
              $cond: [
                { $in: ['$$this', '$$value'] },
                '$$value',
                { $concatArrays: ['$$value', ['$$this']] }
              ]
            }
          }
        }
      }
    },
    projects: {
      value: {
        $anyElementTrue: [
          { $map: { input: '$$docs', as: 'doc', in: { $gt: [size('$$doc.projects'), 0] } } }
        ]
      }
    },
    headline: { value: latestNonEmpty('headline') },
    name: { value: latestNonEmpty('fullName') },
    ...(full
      ? {
          projectPayload: {
            data: {
              $reduce: {
                input: '$$docs',
                initialValue: [],
                in: { $cond: [{ $gt: [size('$$this.projects'), 0] }, '$$this.projects', '$$value'] }
              }
            }
          }
        }
      : {})
  };
  return [
    {
      $lookup: {
        from: Candidate.collection.name,
        localField: '_id',
        foreignField: 'userId',
        as: '_aliases'
      }
    },
    {
      $set: {
        _aliases: {
          $let: {
            vars: {
              docs: {
                $sortArray: {
                  input: {
                    $filter: {
                      input: '$_aliases',
                      as: 'alias',
                      cond: { $eq: ['$$alias.isActive', true] }
                    }
                  },
                  sortBy: { _id: 1 }
                }
              }
            },
            in: { $cond: [{ $gt: [size('$$docs'), 0] }, [rollup], []] }
          }
        }
      }
    }
  ];
}

// Keep equality joins adjacent so MongoDB can execute them as indexed SBE
// EQ_LOOKUP stages, without a separately planned subquery per user/source.
function equalityJoinsFirst(stages) {
  return [
    ...stages.slice(0, 2),
    ...stages.slice(2).filter((stage) => stage.$lookup),
    ...stages.slice(2).filter((stage) => !stage.$lookup)
  ];
}

function buildPipeline(visibility, options, position) {
  const stages = [
    { $match: visibility },
    {
      $project: {
        name: 1,
        jobTitle: 1,
        githubUsername: 1,
        location: 1,
        activeCareerStack: 1,
        careerStack: 1,
        activeExperienceLevel: 1,
        experienceLevel: 1,
        createdAt: 1,
        updatedAt: 1
      }
    },
    ...lookup(
      Analysis,
      '_a',
      { _id: -1 },
      {
        githubScore: 1,
        'githubSignals.analyzedAt': 1,
        'githubSignals.acceptedResult': {
          $cond: [{ $ifNull: ['$githubSignals.acceptedResult', false] }, true, false]
        },
        githubAnalysisHistory: { $slice: [array('$githubAnalysisHistory'), 1] }
      }
    ),
    ...lookup(
      Resume,
      '_r',
      { analyzedAt: -1, _id: 1 },
      {
        atsScore: 1,
        keywordDensity: 1,
        formatScore: 1,
        contentQuality: 1,
        skills: 1,
        experienceYears: 1
      }
    ),
    ...lookup(
      Profile,
      '_p',
      { _id: -1 },
      {
        isPublic: 1,
        slug: 1,
        skills: 1,
        projectCount: size('$projects'),
        'sections.visibility.projects': 1
      }
    ),
    // Align discovery with P1.2B: withdrawn public evidence is neither returned nor counted.
    {
      $match: {
        $or: [
          { _p: null },
          { '_p.isPublic': true, '_p.sections.visibility.projects': { $ne: false } }
        ]
      }
    },
    ...lookup(
      Sprint,
      '_s',
      { updatedAt: -1, _id: 1 },
      {
        taskCount: size('$tasks'),
        completedCount: size({
          $filter: { input: array('$tasks'), as: 'task', cond: '$$task.isCompleted' }
        }),
        currentStreak: 1,
        streak: 1
      }
    ),
    ...lookup(
      Weekly,
      '_w',
      { weekEndDate: -1, _id: 1 },
      { 'meta.sprint': 1, 'meta.comparisons': 1, 'meta.activity': 1 }
    ),
    ...aliasLookup(),
    {
      $set: {
        _c: { $ifNull: [{ $arrayElemAt: ['$_aliases', 0] }, null] },
        _tasks: n('$_s.taskCount'),
        _projects: n('$_p.projectCount'),
        _resumeScore: round({
          $divide: [
            sum(
              ['atsScore', 'keywordDensity', 'formatScore', 'contentQuality'].map((key) =>
                n(`$_r.${key}`)
              )
            ),
            4
          ]
        }),
        _resumeAvailable: {
          $or: ['atsScore', 'keywordDensity', 'formatScore', 'contentQuality'].map((key) =>
            measured(`$_r.${key}`)
          )
        },
        _githubAvailable: {
          $and: [
            measured('$_a.githubScore'),
            {
              $or: [
                { $gt: [n('$_a.githubScore'), 0] },
                { $ifNull: ['$_a.githubSignals.analyzedAt', false] },
                { $ifNull: ['$_a.githubSignals.acceptedResult', false] },
                { $gt: [size('$_a.githubAnalysisHistory'), 0] }
              ]
            }
          ]
        },
        _resumeSkills: {
          $reduce: {
            input: { $objectToArray: { $ifNull: ['$_r.skills', {}] } },
            initialValue: [],
            in: { $concatArrays: ['$$value', array('$$this.v')] }
          }
        }
      }
    },
    {
      $set: {
        _taskPct: {
          $cond: [
            { $gt: ['$_tasks', 0] },
            mul({ $divide: [n('$_s.completedCount'), '$_tasks'] }, 100),
            0
          ]
        },
        _streak: n(first('$_s.currentStreak', '$_s.streak', '$_w.meta.sprint.streak', 0)),
        _userExperience: n(
          first(
            '$_r.experienceYears',
            {
              $switch: {
                branches: Object.entries({
                  Student: 0,
                  Intern: 0.5,
                  '0-1 years': 1,
                  '1-2 years': 2,
                  '2-3 years': 3,
                  '3-5 years': 5,
                  '5+ years': 7
                }).map(([label, years]) => ({
                  case: { $eq: [first('$activeExperienceLevel', '$experienceLevel', ''), label] },
                  then: years
                })),
                default: 0
              }
            },
            0
          )
        ),
        skills: normalizeSkills({
          $concatArrays: [
            '$_resumeSkills',
            { $map: { input: array('$_p.skills'), as: 'skill', in: '$$skill.name' } },
            array('$_c.skills')
          ]
        }),
        name: first('$_c.name.value', '$name', ''),
        headline: first('$_c.headline.value', '$jobTitle', ''),
        stack: {
          $cond: [
            '$_c',
            first('$_c.last.stack', 'Full Stack'),
            first('$activeCareerStack', '$careerStack', 'Full Stack')
          ]
        },
        location: {
          $cond: ['$_c', { $ifNull: ['$_c.last.location', ''] }, { $ifNull: ['$location', ''] }]
        },
        githubUsername: {
          $cond: [
            '$_c',
            { $ifNull: ['$_c.last.githubUsername', ''] },
            { $ifNull: ['$githubUsername', ''] }
          ]
        },
        lastActive: { $toLong: first('$updatedAt', '$createdAt', null) }
      }
    },
    {
      $set: {
        _consistency: clamp(
          sum([
            mul(
              {
                $cond: [{ $gt: ['$_tasks', 0] }, '$_taskPct', n('$_w.meta.sprint.completionRate')]
              },
              0.65
            ),
            mul({ $min: [mul('$_streak', 8), 100] }, 0.35)
          ])
        ),
        _growth: clamp(
          sum([
            n('$_w.meta.comparisons.coverageDelta'),
            n('$_w.meta.comparisons.readinessDelta'),
            mul(n(first('$_w.meta.sprint.completionRate', '$_taskPct', 0)), 0.4),
            mul(n('$_w.meta.activity.weeklyCommitSignal'), 0.4),
            mul({ $min: [mul('$_projects', 12), 100] }, 0.2)
          ])
        ),
        experience: { $cond: ['$_c', n('$_c.last.yearsOfExperience'), '$_userExperience'] },
        _hasProjects: {
          $or: [{ $gt: ['$_projects', 0] }, { $ifNull: ['$_c.projects.value', false] }]
        }
      }
    },
    {
      $set: {
        score: {
          $cond: [
            '$_c',
            weighted(
              '$_c.last.githubScore',
              '$_c.last.resumeScore',
              '$_c.last.consistencyScore',
              '$_c.last.growthPotentialScore'
            ),
            weighted('$_a.githubScore', '$_resumeScore', '$_consistency', '$_growth')
          ]
        },
        readiness: {
          $cond: [
            {
              $or: [
                '$_githubAvailable',
                '$_resumeAvailable',
                { $ne: ['$_s', null] },
                { $ne: ['$_w', null] },
                { $gt: ['$_projects', 0] }
              ]
            },
            weighted('$_a.githubScore', '$_resumeScore', '$_consistency', '$_growth'),
            null
          ]
        },
        completeness: round(
          mul(
            {
              $divide: [
                {
                  $size: {
                    $filter: {
                      input: [
                        '$name',
                        '$stack',
                        '$location',
                        '$githubUsername',
                        '$headline',
                        { $cond: [{ $gt: [size('$skills'), 0] }, 'skills', ''] },
                        { $ifNull: ['$_p.slug', ''] },
                        { $cond: ['$_hasProjects', 'projects', ''] }
                      ],
                      as: 'field',
                      cond: {
                        $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ['$$field', ''] } } } }, 0]
                      }
                    }
                  }
                },
                8
              ]
            },
            100
          )
        )
      }
    },
    {
      $set: {
        availability: {
          $switch: {
            branches: [
              { case: { $eq: ['$experience', 0] }, then: 'Open to entry roles' },
              { case: { $gte: ['$score', 80] }, then: 'High intent' },
              { case: { $gte: ['$score', 60] }, then: 'Available' }
            ],
            default: 'Review needed'
          }
        }
      }
    }
  ];
  const conditions = [
    { $gte: ['$score', options.minScore] },
    { $gte: ['$experience', options.experience] },
    { $gte: ['$completeness', options.profileCompleteness] }
  ];
  if (options.search)
    conditions.push(
      regex({ $concat: ['$name', ' ', '$githubUsername', ' ', '$headline'] }, options.search)
    );
  if (options.stack && options.stack.toLowerCase() !== 'all')
    conditions.push(regex('$stack', options.stack));
  if (options.location) conditions.push(regex('$location', options.location));
  if (options.availability)
    conditions.push({
      $eq: [{ $toLower: '$availability' }, { $literal: options.availability.toLowerCase() }]
    });
  if (options.skills.length)
    conditions.push({
      $setIsSubset: [
        { $literal: options.skills },
        { $map: { input: '$skills', as: 'skill', in: { $toLower: '$$skill' } } }
      ]
    });
  const [field, direction] = SORTS[options.sortBy];
  stages.push(
    { $match: { $expr: { $and: conditions } } },
    { $project: { _id: 1, stack: 1, location: 1, position: { $ifNull: [`$${field}`, 0] } } }
  );
  const data = [];
  if (position)
    data.push({
      $match: {
        $or: [
          { position: { [direction === 1 ? '$gt' : '$lt']: position.key } },
          { position: position.key, _id: { $gt: new mongoose.Types.ObjectId(position.id) } }
        ]
      }
    });
  data.push({ $sort: { position: direction, _id: 1 } });
  if (!position) data.push({ $skip: (options.page - 1) * options.limit });
  data.push({ $limit: options.limit + 1 });
  const facet = (fieldName) => [
    { $match: { [fieldName]: { $ne: '' } } },
    { $group: { _id: `$${fieldName}` } },
    { $sort: { _id: 1 } },
    { $limit: 201 }
  ];
  stages.push({
    $facet: {
      data,
      count: [{ $count: 'total' }],
      stacks: facet('stack'),
      locations: facet('location')
    }
  });
  return equalityJoinsFirst(stages);
}

function buildHydrationPipeline(ids, visibility) {
  return equalityJoinsFirst([
    { $match: { ...visibility, _id: { $in: ids } } },
    {
      $project: {
        name: 1,
        jobTitle: 1,
        githubUsername: 1,
        location: 1,
        activeCareerStack: 1,
        careerStack: 1,
        activeExperienceLevel: 1,
        experienceLevel: 1,
        createdAt: 1,
        updatedAt: 1
      }
    },
    ...lookup(
      Analysis,
      '_a',
      { _id: -1 },
      {
        githubScore: 1,
        githubStats: 1,
        missingSkills: 1,
        'githubSignals.analyzedAt': 1,
        'githubSignals.acceptedResult': {
          $cond: [{ $ifNull: ['$githubSignals.acceptedResult', false] }, true, false]
        },
        githubAnalysisHistory: { $slice: [array('$githubAnalysisHistory'), 1] }
      }
    ),
    ...lookup(
      Resume,
      '_r',
      { analyzedAt: -1, _id: 1 },
      {
        atsScore: 1,
        keywordDensity: 1,
        formatScore: 1,
        contentQuality: 1,
        skills: 1,
        experienceYears: 1,
        analyzedAt: 1
      }
    ),
    ...lookup(
      Profile,
      '_p',
      { _id: -1 },
      {
        userId: 1,
        slug: 1,
        isPublic: 1,
        skills: 1,
        projects: {
          $map: {
            input: array('$projects'),
            as: 'project',
            in: {
              title: '$$project.title',
              description: '$$project.description',
              tech: array('$$project.tech'),
              status: '$$project.status'
            }
          }
        }
      }
    ),
    ...lookup(
      Sprint,
      '_s',
      { updatedAt: -1, _id: 1 },
      {
        tasks: {
          $map: { input: array('$tasks'), as: 'task', in: { isCompleted: '$$task.isCompleted' } }
        },
        currentStreak: 1,
        streak: 1
      }
    ),
    ...lookup(
      Weekly,
      '_w',
      { weekEndDate: -1, _id: 1 },
      { 'meta.sprint': 1, 'meta.comparisons': 1, 'meta.activity': 1 }
    ),
    ...aliasLookup(true)
  ]);
}

module.exports = { buildPipeline, buildHydrationPipeline, fixed2, round };
