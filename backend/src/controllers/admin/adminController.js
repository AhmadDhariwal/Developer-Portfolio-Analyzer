const User = require('../../models/user');
const PublicProfile = require('../../models/publicProfile');
const Job = require('../../models/Job');
const Invitation = require('../../models/invitation');
const Team = require('../../models/team');
const AuditLog = require('../../models/auditLog');

const DEVELOPER_ROLE_VALUES = ['developer', 'user'];
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const ALLOWED_SORT_FIELDS = new Set([
  'createdAt',
  'name',
  'githubScore',
  'resumeScore',
  'readinessScore',
  'lastAnalyzedAt',
  'projectsCount',
  'stack',
  'experienceLevel'
]);

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeScore = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildVisibleDeveloperCountQuery = async () => {
  const publicProfileUserIds = await PublicProfile.distinct('userId', { isPublic: true });
  return {
    role: { $in: DEVELOPER_ROLE_VALUES },
    $or: [
      { isPublic: true },
      { _id: { $in: publicProfileUserIds } }
    ]
  };
};

const buildDeveloperAggregatePipeline = (options = {}) => {
  const {
    page = DEFAULT_PAGE,
    limit = DEFAULT_LIMIT,
    search = '',
    stack = '',
    experienceLevel = '',
    minScore = null,
    sortBy = 'lastAnalyzedAt',
    sortOrder = 'desc'
  } = options;

  const safeSortBy = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : 'lastAnalyzedAt';
  const safeSortOrder = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;
  const sortFieldMap = {
    createdAt: 'createdAt',
    name: 'name',
    githubScore: 'githubScore',
    resumeScore: 'resumeScore',
    readinessScore: 'readinessScore',
    lastAnalyzedAt: 'lastAnalyzedAt',
    projectsCount: 'projectsCount',
    stack: 'stack',
    experienceLevel: 'experienceLevel'
  };

  const pipeline = [
    {
      $match: {
        role: { $in: DEVELOPER_ROLE_VALUES }
      }
    },
    {
      $lookup: {
        from: 'publicprofiles',
        let: { userId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$userId', '$$userId'] },
                  { $eq: ['$isPublic', true] }
                ]
              }
            }
          },
          {
            $project: {
              slug: 1,
              headline: 1,
              summary: 1,
              skills: 1,
              projects: 1,
              socialLinks: 1,
              updatedAt: 1
            }
          }
        ],
        as: 'publicProfiles'
      }
    },
    {
      $match: {
        $or: [
          { isPublic: true },
          { 'publicProfiles.0': { $exists: true } }
        ]
      }
    },
    {
      $lookup: {
        from: 'analyses',
        let: { userId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$userId', '$$userId'] } } },
          { $sort: { updatedAt: -1, createdAt: -1, _id: -1 } },
          { $limit: 1 },
          { $project: { githubScore: 1, readinessScore: 1, updatedAt: 1, createdAt: 1 } }
        ],
        as: 'latestAnalysis'
      }
    },
    {
      $lookup: {
        from: 'resumeanalyses',
        let: { userId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$userId', '$$userId'] } } },
          { $sort: { analyzedAt: -1, createdAt: -1, _id: -1 } },
          { $limit: 1 },
          { $project: { atsScore: 1, analyzedAt: 1, skills: 1 } }
        ],
        as: 'latestResumeAnalysis'
      }
    },
    {
      $addFields: {
        publicProfile: { $first: '$publicProfiles' },
        analysis: { $first: '$latestAnalysis' },
        resumeAnalysis: { $first: '$latestResumeAnalysis' }
      }
    },
    {
      $addFields: {
        stack: { $trim: { input: { $ifNull: ['$careerStack', ''] } } },
        experienceLevel: { $trim: { input: { $ifNull: ['$experienceLevel', ''] } } },
        headline: {
          $trim: {
            input: {
              $ifNull: ['$publicProfile.headline', { $ifNull: ['$jobTitle', ''] }]
            }
          }
        },
        summary: { $trim: { input: { $ifNull: ['$publicProfile.summary', ''] } } },
        linkedinResolved: {
          $trim: {
            input: {
              $ifNull: ['$publicProfile.socialLinks.linkedin', { $ifNull: ['$linkedin', ''] }]
            }
          }
        },
        websiteResolved: {
          $trim: {
            input: {
              $ifNull: ['$publicProfile.socialLinks.website', { $ifNull: ['$website', ''] }]
            }
          }
        },
        githubScore: { $ifNull: ['$analysis.githubScore', 0] },
        readinessScore: {
          $ifNull: [
            '$analysis.readinessScore',
            { $ifNull: ['$analysis.githubScore', 0] }
          ]
        },
        resumeScore: { $ifNull: ['$resumeAnalysis.atsScore', 0] },
        lastAnalyzedAt: {
          $ifNull: [
            '$resumeAnalysis.analyzedAt',
            { $ifNull: ['$analysis.updatedAt', '$analysis.createdAt'] }
          ]
        },
        publicSkillNames: {
          $map: {
            input: { $ifNull: ['$publicProfile.skills', []] },
            as: 'skill',
            in: { $trim: { input: { $ifNull: ['$$skill.name', ''] } } }
          }
        },
        resumeSkillGroups: {
          $map: {
            input: {
              $objectToArray: {
                $ifNull: ['$resumeAnalysis.skills', {}]
              }
            },
            as: 'group',
            in: {
              $filter: {
                input: { $ifNull: ['$$group.v', []] },
                as: 'skill',
                cond: {
                  $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ['$$skill', ''] } } } }, 0]
                }
              }
            }
          }
        },
        publicProjects: { $ifNull: ['$publicProfile.projects', []] }
      }
    },
    {
      $addFields: {
        resumeSkillNames: {
          $reduce: {
            input: '$resumeSkillGroups',
            initialValue: [],
            in: { $concatArrays: ['$$value', '$$this'] }
          }
        },
        projectsCount: { $size: '$publicProjects' }
      }
    },
    {
      $addFields: {
        skills: {
          $slice: [
            {
              $setUnion: [
                '$publicSkillNames',
                '$resumeSkillNames'
              ]
            },
            16
          ]
        }
      }
    }
  ];

  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    pipeline.push({
      $match: {
        $or: [
          { name: regex },
          { email: regex },
          { githubUsername: regex },
          { jobTitle: regex },
          { location: regex },
          { careerStack: regex },
          { experienceLevel: regex },
          { headline: regex },
          { summary: regex },
          { linkedinResolved: regex },
          { websiteResolved: regex },
          { publicSkillNames: regex },
          { resumeSkillNames: regex },
          { 'publicProjects.title': regex },
          { 'publicProjects.description': regex },
          { 'publicProjects.tech': regex }
        ]
      }
    });
  }

  if (stack) {
    pipeline.push({
      $match: { careerStack: String(stack).trim() }
    });
  }

  if (experienceLevel) {
    pipeline.push({
      $match: { experienceLevel: String(experienceLevel).trim() }
    });
  }

  if (minScore !== null && Number.isFinite(minScore)) {
    pipeline.push({
      $match: {
        $expr: {
          $gte: [
            {
              $max: [
                { $ifNull: ['$readinessScore', 0] },
                { $ifNull: ['$githubScore', 0] },
                { $ifNull: ['$resumeScore', 0] }
              ]
            },
            minScore
          ]
        }
      }
    });
  }

  pipeline.push(
    {
      $project: {
        _id: 1,
        name: 1,
        email: 1,
        githubUsername: { $ifNull: ['$githubUsername', ''] },
        jobTitle: { $ifNull: ['$jobTitle', ''] },
        location: { $ifNull: ['$location', ''] },
        avatar: { $ifNull: ['$avatar', ''] },
        isPublic: {
          $or: [
            { $eq: ['$isPublic', true] },
            {
              $gt: [{ $strLenCP: { $ifNull: ['$publicProfile.slug', ''] } }, 0]
            }
          ]
        },
        publicProfileSlug: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ['$publicProfile.slug', ''] } }, 0] },
            '$publicProfile.slug',
            null
          ]
        },
        headline: 1,
        summary: 1,
        stack: 1,
        experienceLevel: 1,
        linkedin: '$linkedinResolved',
        website: '$websiteResolved',
        githubScore: 1,
        readinessScore: 1,
        resumeScore: 1,
        skills: 1,
        projects: {
          $map: {
            input: '$publicProjects',
            as: 'project',
            in: {
              title: { $trim: { input: { $ifNull: ['$$project.title', ''] } } },
              description: { $trim: { input: { $ifNull: ['$$project.description', ''] } } },
              tech: {
                $filter: {
                  input: { $ifNull: ['$$project.tech', []] },
                  as: 'tech',
                  cond: {
                    $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ['$$tech', ''] } } } }, 0]
                  }
                }
              },
              url: { $trim: { input: { $ifNull: ['$$project.url', ''] } } },
              repoUrl: { $trim: { input: { $ifNull: ['$$project.repoUrl', ''] } } }
            }
          }
        },
        projectsCount: 1,
        lastAnalyzedAt: 1,
        createdAt: 1
      }
    },
    {
      $sort: {
        [sortFieldMap[safeSortBy]]: safeSortOrder,
        name: 1,
        _id: 1
      }
    },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        developers: [
          { $skip: (page - 1) * limit },
          { $limit: limit }
        ]
      }
    }
  );

  return pipeline;
};

const getOrganizationOverview = async (req, res) => {
  try {
    const organizationId = req.organizationId;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [recruitersCount, jobsCount, globalDevelopersCount, pendingInvitationsCount, activeTeamsCount, recentActivity] = await Promise.all([
      User.countDocuments({ role: 'recruiter', organizationId }),
      Job.countDocuments({ organizationId }),
      buildVisibleDeveloperCountQuery().then((query) => User.countDocuments(query)),
      Invitation.countDocuments({
        organizationId,
        role: 'recruiter',
        status: 'pending',
        expiresAt: { $gt: new Date() }
      }),
      Team.countDocuments({ organizationId, isActive: { $ne: false } }),
      AuditLog.find({ organizationId, timestamp: { $gte: since } })
        .sort({ timestamp: -1 })
        .limit(5)
        .populate('actor', 'name email role')
        .select('action method route statusCode timestamp actor')
        .lean()
    ]);

    return res.status(200).json({
      overview: {
        organizationId,
        recruitersCount,
        jobsCount,
        globalDevelopersCount,
        pendingInvitationsCount,
        activeTeamsCount,
        recentActivityCount: recentActivity.length,
        recentActivity: recentActivity.map((entry) => ({
          _id: entry._id,
          action: entry.action,
          method: entry.method,
          route: entry.route,
          statusCode: entry.statusCode,
          timestamp: entry.timestamp,
          actorName: entry.actor?.name || entry.actor?.email || 'System'
        }))
      }
    });
  } catch (error) {
    console.error('Admin organization overview error:', error.message);
    return res.status(500).json({ message: 'Failed to load admin overview.' });
  }
};

const getDevelopers = async (req, res) => {
  try {
    const page = toPositiveInt(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(toPositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const search = String(req.query.search || '').trim();
    const stack = String(req.query.stack || '').trim();
    const experienceLevel = String(req.query.experienceLevel || '').trim();
    const minScoreRaw = String(req.query.minScore || '').trim();
    const minScore = minScoreRaw === '' ? null : Number(minScoreRaw);
    const sortBy = String(req.query.sortBy || 'lastAnalyzedAt').trim();
    const sortOrder = String(req.query.sortOrder || 'desc').trim();

    const [result] = await User.aggregate(
      buildDeveloperAggregatePipeline({
        page,
        limit,
        search,
        stack,
        experienceLevel,
        minScore: Number.isFinite(minScore) ? minScore : null,
        sortBy,
        sortOrder
      })
    );

    const developers = result?.developers || [];
    const total = result?.metadata?.[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.status(200).json({
      developers,
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages
    });
  } catch (error) {
    console.error('Admin developers error:', error.message);
    return res.status(500).json({ message: 'Failed to load public developers.' });
  }
};

module.exports = {
  getOrganizationOverview,
  getDevelopers
};
