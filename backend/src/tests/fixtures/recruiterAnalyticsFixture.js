const mongoose = require('mongoose');
const User = require('../../modules/auth/models/user');
const Analysis = require('../../modules/skill-gap/models/analysis');
const Resume = require('../../modules/resume/models/resumeAnalysis');
const Profile = require('../../modules/public-portfolio/models/publicProfile');
const Sprint = require('../../modules/career-sprint/models/careerSprint');
const Weekly = require('../../modules/weekly-reports/models/weeklyReport');
const Candidate = require('../../modules/recruiter/models/Candidate');
const Organization = require('../../modules/admin/models/organization');
const Job = require('../../modules/recruiter/models/Job');
const {
  candidateFromSources,
  mergeCandidates,
  sanitizePublicCandidate
} = require('../../modules/recruiter/services/matching/matchingService');
const { formatCandidateCard } = require('../../modules/recruiter/utils/hub/candidateFormatter');
const sourceModels = [Analysis, Resume, Profile, Sprint, Weekly, Candidate];
const id = () => new mongoose.Types.ObjectId();
const date = (day) => new Date(Date.UTC(2026, 9, day));

async function seedAnalyticsFixture(count = 5200) {
  const org = id(),
    foreignOrg = id(),
    recruiter = id(),
    peer = id();
  await Organization.create([
    {
      _id: org,
      name: 'Analytics alpha',
      slug: 'analytics-alpha',
      ownerId: recruiter,
      createdBy: recruiter
    },
    {
      _id: foreignOrg,
      name: 'Analytics bravo',
      slug: 'analytics-bravo',
      ownerId: peer,
      createdBy: peer
    }
  ]);
  await User.collection.insertMany([
    {
      _id: recruiter,
      name: 'Recruiter',
      email: 'analytics-recruiter@fixture.test',
      role: 'recruiter',
      organizationId: org,
      isActive: true,
      sessionRevision: 0
    },
    {
      _id: peer,
      name: 'Peer',
      email: 'analytics-peer@fixture.test',
      role: 'recruiter',
      organizationId: foreignOrg,
      isActive: true,
      sessionRevision: 0
    }
  ]);
  const users = Array.from({ length: count }, (_, i) => ({
    _id: new mongoose.Types.ObjectId((i + 1).toString(16).padStart(24, '0')),
    name: `Candidate ${String(i).padStart(5, '0')}`,
    email: `analytics-${i}@fixture.test`,
    role: i % 101 === 0 ? 'user' : 'developer',
    organizationId: i % 4 === 0 ? foreignOrg : org,
    isPublic: true,
    isActive: true,
    activeCareerStack: ['Backend', 'Frontend', 'Full Stack', 'AI/ML', '\ufeffBackend\ufeff'][i % 5],
    activeExperienceLevel: ['Student', 'Intern', '1-2 years', '3-5 years', '5+ years'][i % 5],
    jobTitle: 'Engineer',
    location: 'Remote',
    githubUsername: `analytics-${i}`,
    createdAt: date(1)
  }));
  await User.collection.insertMany(users);
  const sources = sourceModels.map(() => []);
  for (const [i, user] of users.entries()) {
    if (i % 19 !== 0) {
      sources[0].push({
        _id: id(),
        userId: user._id,
        githubScore: i === 1 ? 0 : i % 101,
        githubSignals: { analyzedAt: date(2) },
        updatedAt: date(2)
      });
      if (i % 23 === 0)
        sources[0].push({
          _id: id(),
          userId: user._id,
          githubScore: 17,
          githubSignals: { analyzedAt: date(3) },
          updatedAt: date(1)
        });
      if (i !== 1) {
        const resume = {
          _id: id(),
          userId: user._id,
          analyzedAt: date(4),
          atsScore: (i * 7) % 101,
          keywordDensity: (i * 11) % 101,
          formatScore: 60.5,
          contentQuality: 71.5,
          experienceYears: [0, 0.5, 1, 2, 4.5, 5, 7.5, 8, 12][i % 9],
          skills: {
            technical: [
              '\ufeffNode.js\ufeff',
              'TypeScript',
              i % 37 === 0 ? '$literal-skill' : 'Testing'
            ],
            tools: ['MongoDB', 'TypeScript']
          }
        };
        if (i === count - 1) resume.skills.technical.push('Beyond240');
        sources[1].push(resume);
        if (i % 29 === 0)
          sources[1].push({
            ...resume,
            _id: id(),
            atsScore: 100,
            experienceYears: 20,
            skills: { wrongTie: ['WRONG_RESUME_TIE'] }
          });
      }
      if (i % 2 === 0) {
        if (i % 26 === 0)
          sources[2].push({
            _id: id(),
            userId: user._id,
            slug: `older-private-${i}`,
            isPublic: false,
            skills: [{ name: 'OLD_PRIVATE_SKILL' }],
            projects: []
          });
        sources[2].push({
          _id: id(),
          userId: user._id,
          slug: `analytics-${i}`,
          isPublic: true,
          skills: [{ name: i % 4 ? 'TypeScript' : 'typescript', score: 0 }],
          projects: [{ title: 'Public work', tech: ['Node.js'], status: 'completed' }],
          sections: { visibility: { projects: true } }
        });
      }
      if (i % 3 === 0) {
        const sprint = {
          _id: id(),
          userId: user._id,
          updatedAt: date(5),
          currentStreak: i % 15,
          tasks: Array.from({ length: 3 + (i % 6) }, (_, n) => ({ isCompleted: n % 2 === 0 }))
        };
        sources[3].push(sprint);
        if (i % 21 === 0) sources[3].push({ ...sprint, _id: id(), currentStreak: 80, tasks: [] });
      }
      if (i % 5 === 0) {
        const weekly = {
          _id: id(),
          userId: user._id,
          weekStartDate: date(1),
          weekEndDate: date(7),
          meta: {
            sprint: { completionRate: i % 101, streak: 2 },
            comparisons: { coverageDelta: (i % 9) - 4, readinessDelta: (i % 7) - 3 },
            activity: { weeklyCommitSignal: i % 50 }
          }
        };
        sources[4].push(weekly);
        if (i % 35 === 0)
          sources[4].push({
            ...weekly,
            _id: id(),
            weekEndDate: date(6),
            meta: { sprint: { completionRate: 1000 } }
          });
      }
    }
    if (i <= 1 || i % 13 === 0) {
      const alias = {
        _id: id(),
        userId: user._id,
        isActive: true,
        fullName: `Legacy ${i}`,
        email: `alias-${i}@fixture.test`,
        stack: i === 1 ? ' Zero evidence ' : 'Legacy Backend',
        yearsOfExperience: i % 10,
        headline: 'Legacy engineer',
        githubScore: 80,
        resumeScore: 70,
        consistencyScore: 90,
        growthPotentialScore: 65,
        skills: ['LegacySkill', ' TypeScript '],
        projects: []
      };
      sources[5].push(alias);
      if (i % 39 === 0) {
        sources[5].push({
          ...alias,
          _id: id(),
          fullName: '',
          headline: '',
          skills: ['AliasSecond', 'TypeScript'],
          projects: [{ title: 'Legacy project', impactScore: 55 }],
          resumeScore: 45
        });
        sources[5].push({
          ...alias,
          _id: id(),
          isActive: false,
          skills: ['INACTIVE_ALIAS_SECRET'],
          stack: 'INACTIVE_ALIAS_SECRET'
        });
      }
    }
  }
  const excluded = ['private', 'inactive', 'role', 'profile', 'projects'].map((kind) => ({
    _id: id(),
    name: `Excluded ${kind}`,
    email: `excluded-${kind}@fixture.test`,
    role: kind === 'role' ? 'admin' : 'developer',
    isPublic: kind !== 'private',
    isActive: kind !== 'inactive',
    organizationId: org,
    activeCareerStack: 'PRIVATE_STACK_SECRET',
    createdAt: date(1)
  }));
  await User.collection.insertMany(excluded);
  for (const user of excluded)
    sources[1].push({
      _id: id(),
      userId: user._id,
      analyzedAt: date(8),
      atsScore: 100,
      keywordDensity: 100,
      formatScore: 100,
      contentQuality: 100,
      skills: { technical: ['PRIVATE_SUPPLY_SECRET'] }
    });
  for (const [i, user] of excluded.entries())
    if (i >= 3) {
      sources[2].push({ _id: id(), userId: user._id, isPublic: true, slug: `excluded-older-${i}` });
      sources[2].push({
        _id: id(),
        userId: user._id,
        isPublic: i !== 3,
        slug: `excluded-selected-${i}`,
        sections: { visibility: { projects: i !== 4 } }
      });
    }
  for (const [index, model] of sourceModels.entries())
    await model.collection.insertMany(sources[index]);
  await Job.create([
    {
      recruiterId: recruiter,
      organizationId: org,
      title: 'Backend',
      requiredSkills: ['Node.js', 'TypeScript', 'Beyond240', 'PRIVATE_SUPPLY_SECRET'],
      preferredSkills: ['MongoDB', 'Node.js']
    },
    {
      recruiterId: recruiter,
      organizationId: org,
      title: 'Closed role',
      status: 'closed',
      requiredSkills: ['TypeScript', 'LegacySkill'],
      preferredSkills: ['typescript']
    },
    {
      recruiterId: peer,
      organizationId: foreignOrg,
      title: 'Foreign demand',
      requiredSkills: ['FOREIGN_DEMAND_SECRET']
    }
  ]);
  return { org, foreignOrg, recruiter, peer, users, excluded };
}

// Verification only: read complete authoritative histories and independently
// select heads in JavaScript, then reuse the authoritative JS scoring mapper.
// Runtime analytics never calls this unbounded reference calculation.
async function referenceCards({ organizationId, mode = 'public' }) {
  const users = await User.find({
    isPublic: true,
    isActive: { $ne: false },
    role: { $in: ['developer', 'user'] },
    ...(mode === 'organization' ? { organizationId } : {})
  }).lean();
  const filter = { userId: { $in: users.map((user) => user._id) } };
  const histories = await Promise.all(sourceModels.map((model) => model.find(filter).lean()));
  const maps = histories.map((rows) => {
    const map = new Map();
    for (const row of rows) {
      const key = String(row.userId);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  });
  const byId = (a, b) => String(a._id).localeCompare(String(b._id));
  const head = (rows, field) =>
    [...rows].sort((a, b) =>
      field ? +new Date(b[field] || 0) - +new Date(a[field] || 0) || byId(a, b) : -byId(a, b)
    )[0];
  const cards = [];
  for (const user of users) {
    const rows = maps.map((map) => map.get(String(user._id)) || []);
    const profile = head(rows[2]);
    if (profile && (profile.isPublic !== true || profile.sections?.visibility?.projects === false))
      continue;
    const base = candidateFromSources(user, {
      analysis: head(rows[0]),
      resume: head(rows[1], 'analyzedAt'),
      profile,
      sprint: head(rows[3], 'updatedAt'),
      weeklyReport: head(rows[4], 'weekEndDate')
    });
    const aliases = rows[5].filter((row) => row.isActive === true).sort(byId);
    const latest = (key, fallback) => aliases.reduce((value, row) => row[key] || value, fallback);
    const legacy = aliases.length
      ? [
          {
            ...aliases.at(-1),
            fullName: latest('fullName', user.name),
            headline: latest('headline', user.jobTitle),
            skills: [...new Set(aliases.flatMap((row) => row.skills || []).filter(Boolean))],
            projects: aliases.reduce(
              (value, row) => (row.projects?.length ? row.projects : value),
              []
            )
          }
        ]
      : [];
    const [merged] = mergeCandidates(legacy, [base]);
    const card = formatCandidateCard({ ...sanitizePublicCandidate(merged), id: String(user._id) });
    if (card.score >= 0 && card.yearsOfExperience >= 0 && card.profileCompleteness >= 0)
      cards.push(card);
  }
  return cards.sort(
    (a, b) => (b.readinessScore || 0) - (a.readinessScore || 0) || a.id.localeCompare(b.id)
  );
}

function referenceMetrics(cards, jobs) {
  const scores = cards.map((c) => Number(c.readinessScore || c.score || 0));
  const scoreBuckets = [
    { label: '90-100', min: 90, max: 100 },
    { label: '80-89', min: 80, max: 89.999 },
    { label: '70-79', min: 70, max: 79.999 },
    { label: '60-69', min: 60, max: 69.999 },
    { label: 'Below 60', min: -Infinity, max: 59.999 }
  ];
  const experienceBuckets = [
    { label: '0-2 Years', min: 0, max: 2 },
    { label: '2-5 Years', min: 2, max: 5 },
    { label: '5-8 Years', min: 5, max: 8 },
    { label: '8+ Years', min: 8, max: Infinity }
  ];
  const count = (items) => {
    const map = new Map();
    for (const value of items) {
      const key = String(value || '').trim();
      if (key) map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  };
  const stacks = count(cards.map((c) => c.stack));
  const supply = count(cards.flatMap((c) => c.skills || []));
  const demand = count(
    jobs.flatMap((job) => [...(job.requiredSkills || []), ...(job.preferredSkills || [])])
  );
  const labels = [...new Set([...demand.keys(), ...supply.keys()])]
    .sort((a, b) => (demand.get(b) || 0) - (demand.get(a) || 0))
    .slice(0, 6);
  return {
    total: cards.length,
    avgCandidateScore: scores.length
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0,
    scoreDistribution: scoreBuckets.map((bucket) => ({
      ...bucket,
      count: scores.filter((value) => value >= bucket.min && value <= bucket.max).length
    })),
    experienceDistribution: experienceBuckets.map((bucket) => ({
      ...bucket,
      count: cards.filter(
        (c) =>
          Number(c.yearsOfExperience || 0) >= bucket.min &&
          Number(c.yearsOfExperience || 0) < bucket.max
      ).length
    })),
    candidatesByStack: [...stacks]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({ label, count })),
    supplyVsDemand: labels.map((label) => ({
      label,
      supply: supply.get(label) || 0,
      demand: demand.get(label) || 0
    }))
  };
}

module.exports = { seedAnalyticsFixture, referenceCards, referenceMetrics, sourceModels };
