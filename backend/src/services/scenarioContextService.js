'use strict';

const identity = require('./developerContextService');
const { normalizeRole, normalizeLevel } = require('./scoring/scenarioPlanningLegacy');
const { digest, compare } = require('../utils/scenarioIdentity');
const VERSION = 'scenario-context-v3';
const pending = new Map();
let active = 0;
let joiners = 0;
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const labels = {
  github: 'GitHub Analyzer',
  resume: 'Resume Analyzer',
  skillGap: 'Skill Gap',
  recommendations: 'Recommendations',
  careerSprint: 'Career Sprint',
  portfolio: 'Public Portfolio',
  integrations: 'Integrations',
  jobsDemand: 'Jobs Demand',
};
const strings = (values, limit = 12) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, limit);
const read = (query, signal) => {
  if (query.model && query.model.db.readyState !== 1) throw httpError(503, 'Source database is unavailable.');
  return query.maxTimeMS(650).setOptions({ signal }).lean();
};

const deadline = async (work, milliseconds, parentSignal) => {
  const controller = new AbortController();
  let timer;
  let abort;
  try {
    return await Promise.race([
      new Promise((_, reject) => {
        abort = () => {
          reject(
            Object.assign(httpError(503, 'Source deadline exceeded.'), { code: 'SCENARIO_SOURCE_TIMEOUT' }),
          );
          controller.abort();
        };
        parentSignal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(abort, milliseconds);
        if (parentSignal?.aborted) abort();
      }),
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw httpError(503, 'Source deadline exceeded.');
        return work(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abort);
  }
};

const adaptersFor = (userId, user, now) => {
  const model = (name) => require('../models/' + name);
  const username = String(identity.resolveGithubUsername(user) || '')
    .trim()
    .toLowerCase();
  const careerStack = identity.resolveCareerStack(user);
  const experienceLevel = identity.resolveExperienceLevel(user);
  return {
    github: (signal) =>
      username
        ? read(
            model('githubAnalysisCache')
              .findOne({ normalizedUsername: username })
              .select(
                'result.languages result.technologies result.healthScore result.scoring result.githubSignals.analyzedAt result.githubSignals.scoring result.dataAvailability result.fetchedAt result.analyzedAt updatedAt expiresAt',
              )
              .slice('result.repositories', 1)
              .slice('result.githubSignals.repositories', 1)
              .sort({ updatedAt: -1 }),
            signal,
          )
        : null,
    resume: async (signal) => {
      const selected = identity.resolveSelectedResumeFileId(user);
      const file = await read(
        model('resumeFile')
          .findOne({ userId, ...(selected ? { _id: selected } : {}) })
          .select('_id')
          .sort({ uploadDate: -1, createdAt: -1, _id: -1 }),
        signal,
      );
      return file
        ? read(
            model('resumeAnalysis')
              .findOne({ userId, fileId: file._id })
              .select(
                'fileId fileName resumeHash analysisVersion scoring skills analyzedAt createdAt atsScore keywordDensity formatScore contentQuality experienceYears experienceLevel suggestions keyAchievements',
              )
              .sort({ analyzedAt: -1, createdAt: -1, _id: -1 }),
            signal,
          )
        : null;
    },
    skillGap: (signal) =>
      read(
        model('analysisCache')
          .findOne({
            userId,
            githubUsername: {
              $regex: '^' + username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
              $options: 'i',
            },
            careerStack,
            experienceLevel,
            'analysisData.ruleVersion': 'skill-evidence-coverage-v1',
          })
          .select(
            'userId githubUsername careerStack experienceLevel resumeHash resumeAnalysisId analysisData.ruleVersion analysisData.skills analysisData.sourceReferences analysisData.evidenceCompleteness.sources analysisData.cacheMetadata.temporary updatedAt createdAt',
          )
          .sort({ updatedAt: -1 }),
        signal,
      ),
    recommendations: (signal) =>
      read(
        model('recommendation')
          .find({
            userId,
            careerStack,
            experienceLevel,
            createdAt: { $gte: new Date(+now - 7 * 86400000), $lte: new Date(+now + 300000) },
          })
          .select('techStack createdAt snapshotVersion')
          .sort({ createdAt: -1, _id: -1 })
          .limit(12),
        signal,
      ),
    careerSprint: (signal) =>
      read(
        model('careerSprint')
          .findOne({ userId, sprintStartDate: { $lte: now }, sprintEndDate: { $gte: now } })
          .select('goalTechnology updatedAt tasks.title tasks.isCompleted')
          .sort({ updatedAt: -1, _id: -1 }),
        signal,
      ),
    portfolio: (signal) =>
      read(
        model('publicProfile')
          .findOne({ userId })
          .select('skills upcomingProjects updatedAt')
          .slice('upcomingProjects', 3)
          .slice('skills', 12),
        signal,
      ),
    integrations: (signal) =>
      read(
        model('integrationInsight')
          .findOne({ userId })
          .select('mergedSkills updatedAt')
          .slice('mergedSkills', 12),
        signal,
      ),
    jobsDemand: (signal) =>
      read(
        model('jobCache')
          .find({ expiresAt: { $gt: now }, freshUntil: { $gt: now } })
          .select('skills lastSynced updatedAt')
          .sort({ lastSynced: -1, updatedAt: -1 })
          .limit(250),
        signal,
      ),
  };
};

const collect = async (adapters, { now = new Date(), parentSignal, sourceTimeoutMs = 750 } = {}) => {
  const entries = Object.entries(labels);
  const sources = new Array(entries.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < entries.length) {
        const index = next++;
        const [key, label] = entries[index];
        const started = Date.now();
        try {
          const data = await deadline((signal) => adapters[key](signal), sourceTimeoutMs, parentSignal);
          const first = Array.isArray(data) ? data[0] : data;
          const timestamp =
            first?.analyzedAt || first?.lastSynced || first?.updatedAt || first?.createdAt || null;
          const age = timestamp ? +now - new Date(timestamp).getTime() : Infinity;
          const days = {
            github: 7,
            resume: 30,
            skillGap: 7,
            recommendations: 7,
            careerSprint: 7,
            portfolio: 30,
            integrations: 7,
            jobsDemand: 1,
          }[key];
          let status = !first
            ? 'missing'
            : !Number.isFinite(age) || age < -300000
              ? 'incompatible'
              : age > days * 86400000
                ? 'stale'
                : 'available';
          if (key === 'github' && first && (!first.expiresAt || new Date(first.expiresAt) <= now))
            status = 'stale';
          sources[index] = {
            key,
            label,
            status,
            completeness: 'unknown',
            contentFingerprint: digest(data),
            connected: status === 'available',
            lastUpdatedAt: timestamp,
            freshUntil: timestamp ? new Date(+new Date(timestamp) + days * 86400000).toISOString() : null,
            evidenceClass: {
              github: 'recorded-observation',
              resume: 'self-claim',
              skillGap: 'inference',
              recommendations: 'planned-intent',
              careerSprint: 'recorded-activity',
              portfolio: 'self-claim',
              integrations: 'inference',
              jobsDemand: 'market-context',
            }[key],
            references: first
              ? [
                  {
                    id: String(first._id || ''),
                    ruleVersion:
                      first.scoring?.ruleVersion ||
                      first.analysisData?.ruleVersion ||
                      first.analysisVersion ||
                      null,
                  },
                ]
              : [],
            data,
          };
        } catch (error) {
          sources[index] = {
            key,
            label,
            status:
              parentSignal?.aborted || error.code === 'SCENARIO_SOURCE_TIMEOUT' || error.name === 'AbortError'
                ? 'timeout'
                : 'error',
            connected: false,
            lastUpdatedAt: null,
            data: null,
            warnings: ['source_unavailable'],
          };
        }
        require('./scenarioTelemetryService').source(key, sources[index].status, Date.now() - started);
      }
    }),
  );
  return sources;
};

const load = async (userId, options = {}) => {
  const controller = new AbortController();
  const total = setTimeout(() => controller.abort(), 2000);
  try {
    const user =
      options.user ||
      (await deadline(
        (signal) =>
          read(
            require('../models/user')
              .findById(userId)
              .select(
                'activeGithubUsername githubUsername activeCareerStack careerStack activeExperienceLevel experienceLevel activeResumeFileId defaultResumeFileId updatedAt',
              ),
            signal,
          ),
        500,
        controller.signal,
      ));
    if (!user) throw httpError(404, 'Developer profile not found.');
    const now = options.now || new Date();
    const sources = await collect(options.adapters || adaptersFor(userId, user, now), {
      now,
      parentSignal: controller.signal,
      sourceTimeoutMs: options.sourceTimeoutMs,
    });
    const gap = sources.find((source) => source.key === 'skillGap');
    if (gap.status === 'available') {
      try {
        const github = sources.find((source) => source.key === 'github');
        const resume = sources.find((source) => source.key === 'resume');
        const { compatibleSkillGap, sourceMetadata } = require('./recommendationEngineService');
        const resumeIdentity = require('./developerSignalService').buildResumeCacheIdentity({
          resumeAnalysis: resume.status === 'available' ? resume.data : null,
        });
        const githubData =
          github.status === 'available'
            ? { ...github.data.result, cache: { stale: false } }
            : { unavailable: true };
        const metadata = sourceMetadata({
          username: identity.resolveGithubUsername(user) || '',
          githubData,
          resumeAnalysis: resume.status === 'available' ? resume.data : null,
        });
        if (
          !compatibleSkillGap(gap.data, {
            userId: String(userId),
            username: identity.resolveGithubUsername(user) || '',
            careerStack: identity.resolveCareerStack(user),
            experienceLevel: identity.resolveExperienceLevel(user),
            ...resumeIdentity,
            sources: metadata,
          })
        ) {
          gap.status = 'incompatible';
          gap.connected = false;
          gap.warnings = ['source_context_mismatch'];
        }
      } catch {
        gap.status = 'error';
        gap.connected = false;
        gap.warnings = ['source_projection_invalid'];
      }
    }
    const usable = Object.fromEntries(
      sources.filter((source) => source.status === 'available').map((source) => [source.key, source.data]),
    );
    const role = normalizeRole(identity.resolveCareerStack(user));
    const level = normalizeLevel(identity.resolveExperienceLevel(user));
    const recommendationSkills = strings(
      (usable.recommendations || []).flatMap((item) => item.techStack || []),
    );
    const missingSkills = strings(
      (usable.skillGap?.analysisData?.skills || [])
        .filter((item) => ['PARTIAL', 'CLAIMED_ONLY', 'NOT_EVIDENCED', 'UNKNOWN'].includes(item.status))
        .map((item) => item.name),
    );
    const resumeSkills = strings(Object.values(usable.resume?.skills || {}).flat());
    const integrationSkills = strings(usable.integrations?.mergedSkills);
    const observedSkills = strings([
      ...(usable.github?.result?.languages?.main || []).map((item) =>
        typeof item === 'string' ? item : item.language || item.name,
      ),
      ...(usable.github?.result?.technologies || []).map((item) =>
        typeof item === 'string' ? item : item.name || item.technology,
      ),
    ]);
    const portfolioProjects = strings((usable.portfolio?.upcomingProjects || []).map((item) => item.title));
    const demandCounts = new Map();
    for (const job of usable.jobsDemand || [])
      for (const skill of strings(job.skills, 20)) {
        const key = skill.toLowerCase();
        demandCounts.set(key, (demandCounts.get(key) || 0) + 1);
      }
    const topDemandedSkills = [...demandCounts]
      .sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))
      .slice(0, 8)
      .map(([skill]) => skill);
    const skills = strings([...missingSkills, ...recommendationSkills], 6);
    const sourceCards = sources.map(({ data, ...source }) => source);
    const profile = {
      resumeFileId: String(identity.resolveSelectedResumeFileId(user) || ''),
      careerStack: identity.resolveCareerStack(user) || 'Full Stack',
      experienceLevel: identity.resolveExperienceLevel(user) || 'Student',
      githubUsername: identity.resolveGithubUsername(user) || '',
      role,
      level,
      baselineHiringScore: 55,
      baselineJobMatch: 48,
    };
    const fingerprint = digest({
      version: VERSION,
      identity: identity.resolveIdentity(user),
      selectedResumeFileId: profile.resumeFileId,
      sources: sourceCards,
    });
    return {
      contextSchemaVersion: VERSION,
      profile,
      sources: sourceCards,
      signalHash: fingerprint,
      sourceContextSummary: {
        signalHash: fingerprint,
        connectedSources: sourceCards.filter((item) => item.connected).map((item) => item.key),
      },
      signals: {
        knownSkills: strings([...observedSkills, ...resumeSkills, ...integrationSkills]),
        observedSkills,
        demonstratedSkills: [],
        claimedSkills: resumeSkills,
        inferredSkills: integrationSkills,
        missingSkills,
        recommendationSkills,
        sprintFocus: strings([usable.careerSprint?.goalTechnology]),
        connectedProviders: [],
        portfolioProjects,
        topDemandedSkills,
      },
      suggestedInputs: {
        role,
        experienceLevel: level,
        baselineHiringScore: 55,
        baselineJobMatch: 48,
        durationWeeks: 6,
        skills,
        projects: [],
      },
      dataTrust: {
        baselineHiringScore: {
          authority: 'user-assumption',
          requiresConfirmation: true,
          label: 'Unconfirmed planning assumption',
        },
        baselineJobMatch: {
          authority: 'user-assumption',
          requiresConfirmation: true,
          label: 'Unconfirmed planning assumption',
        },
      },
      degraded: sourceCards.some((source) => ['timeout', 'error'].includes(source.status)),
      warnings: sourceCards.some((source) => ['timeout', 'error'].includes(source.status))
        ? ['Some sources are unavailable; healthy sources are retained.']
        : [],
      summary:
        'Source observations inform planning suggestions. Baselines require your confirmation; suggested learning is not demonstrated ability.',
      cache: { hit: false, version: VERSION },
    };
  } finally {
    clearTimeout(total);
    controller.abort();
  }
};

const getScenarioContext = async (userId, options = {}) => {
  const key =
    String(userId) +
    ':' +
    digest({ identity: identity.resolveIdentity(options.user), revision: options.user?.updatedAt });
  if (pending.has(key)) {
    if (joiners >= 256) throw httpError(503, 'Scenario context capacity reached. Retry shortly.');
    joiners++;
    require('./scenarioTelemetryService').event('context', 'joined', VERSION);
    try {
      return await pending.get(key);
    } finally {
      joiners--;
    }
  }
  if (active >= 32) {
    require('./scenarioTelemetryService').event('context', 'rejected', VERSION);
    throw httpError(503, 'Scenario context capacity reached. Retry shortly.');
  }
  active++;
  const request = load(userId, options);
  pending.set(key, request);
  try {
    const result = await request;
    require('./scenarioTelemetryService').event(
      'context',
      result.degraded ? 'degraded' : 'complete',
      VERSION,
    );
    return result;
  } finally {
    active--;
    if (pending.get(key) === request) pending.delete(key);
  }
};
module.exports = { getScenarioContext, collect, VERSION };
