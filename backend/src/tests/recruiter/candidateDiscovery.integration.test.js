const { randomBytes } = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const settings = require('../../modules/super-admin/services/platformSettingsService');
const Settings = require('../../modules/super-admin/models/platformSettings');
const User = require('../../modules/auth/models/user');
const Organization = require('../../modules/admin/models/organization');
const Membership = require('../../modules/admin/models/membership');
const Candidate = require('../../modules/recruiter/models/Candidate');
const Analysis = require('../../modules/skill-gap/models/analysis');
const Resume = require('../../modules/resume/models/resumeAnalysis');
const Profile = require('../../modules/public-portfolio/models/publicProfile');
const Sprint = require('../../modules/career-sprint/models/careerSprint');
const Weekly = require('../../modules/weekly-reports/models/weeklyReport');
const {
  getCandidatesByIds,
  listCandidates
} = require('../../modules/recruiter/services/matching/matchingService');
const { formatCandidateCard } = require('../../modules/recruiter/utils/hub/candidateFormatter');
const {
  buildPipeline,
  fixed2,
  round
} = require('../../modules/recruiter/utils/hub/candidateDiscoveryPipeline');
const { parse } = require('../../modules/recruiter/utils/hub/candidateDiscoveryQuery');
const { sign } = require('../../modules/auth/utils/authSessionToken');

test(
  'candidate discovery: complete database filters, secure pagination and source parity',
  { timeout: 240000 },
  async (t) => {
    const mongo = await startMongo({
      replicaSet: 'candidate-discovery',
      temporaryRoot: path.resolve(__dirname, '../../../verification')
    });
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    let server;
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      settings.stopSettingsSynchronization();
      await mongoose.disconnect();
      await mongo.stop();
      if (previous === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previous;
    });
    await mongoose.connect(mongo.uri);
    await settings.startSettingsSynchronization();
    await Promise.all(
      [User, Organization, Membership, Candidate, Analysis, Resume, Profile, Sprint, Weekly].map(
        (model) => model.init()
      )
    );
    const id = () => new mongoose.Types.ObjectId();
    const org = id(),
      foreignOrg = id(),
      recruiter = id(),
      peer = id(),
      outsider = id(),
      admin = id(),
      superAdmin = id();
    await User.collection.insertMany(
      [recruiter, peer, outsider, admin, superAdmin].map((_id, index) => ({
        _id,
        name: `Actor ${index}`,
        email: `actor-${index}@fixture.test`,
        role: index === 3 ? 'admin' : index === 4 ? 'super_admin' : 'recruiter',
        organizationId: index === 2 ? foreignOrg : org,
        isActive: true,
        sessionRevision: 0
      }))
    );
    await Organization.create([
      { _id: org, name: 'Discovery Org', slug: 'discovery', ownerId: admin, createdBy: admin },
      {
        _id: foreignOrg,
        name: 'Other Org',
        slug: 'other-discovery',
        ownerId: admin,
        createdBy: admin
      }
    ]);
    const count = 2205;
    const users = Array.from({ length: count }, (_, index) => ({
      _id: new mongoose.Types.ObjectId((index + 1).toString(16).padStart(24, '0')),
      name:
        index === 2 || index === 3 ? 'Same Name' : `Developer ${String(index).padStart(4, '0')}`,
      email: `developer-${index}@fixture.test`,
      role: 'developer',
      organizationId: index % 4 === 0 ? foreignOrg : org,
      isPublic: true,
      isActive: true,
      activeCareerStack: index % 2 ? 'Backend' : 'Full Stack',
      activeExperienceLevel: '3-5 years',
      location: index % 2 ? 'Remote' : 'Lahore',
      githubUsername: `dev-${index}`,
      jobTitle: 'Engineer',
      createdAt: new Date(Date.UTC(2026, 0, 1)),
      updatedAt: new Date(Date.UTC(2026, 0, 1 + (index % 20)))
    }));
    await User.collection.insertMany(users);
    await User.collection.insertMany([
      {
        _id: id(),
        name: 'Private',
        email: 'private@fixture.test',
        role: 'developer',
        isPublic: false,
        isActive: true,
        organizationId: org
      },
      {
        _id: id(),
        name: 'Inactive',
        email: 'inactive@fixture.test',
        role: 'developer',
        isPublic: true,
        isActive: false,
        organizationId: org
      },
      {
        _id: id(),
        name: 'Public admin',
        email: 'public-admin@fixture.test',
        role: 'admin',
        isPublic: true,
        isActive: true,
        organizationId: org
      }
    ]);
    await Analysis.collection.insertMany(
      users.map((user, index) => ({
        userId: user._id,
        githubScore: index === 1 ? null : index % 101,
        githubSignals: index === 1 ? null : { analyzedAt: new Date() },
        updatedAt: new Date()
      }))
    );
    await Resume.collection.insertMany(
      users
        .filter((_, index) => index % 5 === 0 || index === count - 1)
        .map((user, index) => ({
          userId: user._id,
          analyzedAt: new Date(),
          atsScore: index % 100,
          keywordDensity: 80,
          formatScore: 71.5,
          contentQuality: 60.5,
          experienceYears: index % 9,
          skills: {
            technical:
              String(user._id) === String(users.at(-1)._id)
                ? ['BeyondPool', 'Node.js']
                : ['Node.js', 'TypeScript']
          }
        }))
    );
    await Profile.collection.insertMany(
      users
        .filter((_, index) => index % 7 === 0)
        .map((user, index) => ({
          userId: user._id,
          isPublic: true,
          slug: `public-${index}`,
          skills: [{ name: 'MongoDB', score: 65 }],
          projects: [{ title: 'Public project', tech: ['Node.js'], status: 'completed' }]
        }))
    );
    await Sprint.collection.insertMany(
      users
        .filter((_, index) => index % 11 === 0)
        .map((user) => ({
          userId: user._id,
          updatedAt: new Date(),
          currentStreak: 3,
          tasks: [{ isCompleted: true }, { isCompleted: false }]
        }))
    );
    await Weekly.collection.insertMany(
      users
        .filter((_, index) => index % 17 === 0)
        .map((user) => ({
          userId: user._id,
          weekEndDate: new Date(),
          meta: {
            sprint: { completionRate: 80, streak: 2 },
            comparisons: { coverageDelta: 4, readinessDelta: 3 },
            activity: { weeklyCommitSignal: 12 }
          }
        }))
    );
    await Candidate.collection.insertMany(
      users
        .filter((_, index) => index % 13 === 0)
        .map((user, index) => ({
          userId: user._id,
          isActive: true,
          fullName: `Alias ${String(index).padStart(4, '0')}`,
          email: 'alias@fixture.test',
          stack: 'Legacy Backend',
          yearsOfExperience: (index % 8) + 1,
          location: 'Hybrid',
          headline: 'Legacy engineer',
          githubUsername: 'public-alias',
          githubScore: 80,
          resumeScore: 70,
          consistencyScore: 90,
          growthPotentialScore: 65,
          skills: ['LegacySkill'],
          projects: [{ title: 'Legacy public project', impactScore: 55 }]
        }))
    );
    const app = express();
    app.use(express.json());
    app.use('/api/recruiter-hub', require('../../modules/recruiter/routes/hub/recruiterHubRoutes'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api/recruiter-hub/candidates`;
    const request = async (query = {}, actor = recruiter) => {
      const response = await fetch(`${base}?${new URLSearchParams(query)}`, {
        headers: actor ? { Authorization: `Bearer ${sign({ _id: actor })}` } : {}
      });
      return { status: response.status, body: await response.json(), headers: response.headers };
    };
    let oracle;
    await t.test(
      'database arithmetic preserves JavaScript midpoint and missing/zero semantics',
      async () => {
        const values = [0, 0.0049, 0.005, 1.005, 2.675, 73.325, 99.995, 100];
        for (const value of values) {
          const [row] = await User.aggregate([
            { $limit: 1 },
            { $project: { fixed: fixed2(value), rounded: round(value) } }
          ]);
          assert.equal(row.fixed, Number(value.toFixed(2)), `fixed2 ${value}`);
          assert.equal(row.rounded, Math.round(value), `round ${value}`);
        }
      }
    );
    await t.test('diagnostic query plan for indexed foreign joins', async () => {
      const pipeline = buildPipeline(
        {
          _id: { $in: users.slice(0, 20).map((user) => user._id) },
          isPublic: true,
          role: { $in: ['developer', 'user'] },
          isActive: { $ne: false }
        },
        parse({}),
        null
      );
      const plan = await User.aggregate(pipeline)
        .collation({ locale: 'en' })
        .option({ maxTimeMS: 15000 })
        .explain('executionStats');
      t.diagnostic(
        JSON.stringify(
          plan.stages?.map((stage) => ({
            kind: Object.keys(stage)[0],
            source: stage.$lookup?.from,
            examined: stage.totalDocsExamined,
            indexes: stage.indexesUsed,
            elapsedEstimateMs: stage.executionTimeMillisEstimate
          }))
        )
      );
    });
    await t.test(
      'more than 2000 eligible profiles are counted; advanced filtering reaches the tail',
      async () => {
        const start = performance.now();
        const result = await request({ limit: 12 });
        const defaultRequestMs = Math.round(performance.now() - start);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.meta.total, count);
        assert.equal(result.body.candidates.length, 12);
        assert.ok(
          result.body.candidates.every(
            (row) => !Object.hasOwn(row, 'email') && !Object.hasOwn(row, 'resumeBytes')
          )
        );
        t.diagnostic(
          JSON.stringify({
            defaultRequestMs,
            completeEligibleCount: result.body.meta.total,
            returned: result.body.candidates.length
          })
        );
        assert.match(result.headers.get('cache-control'), /no-store/);
        const tail = await request({ skills: 'BeyondPool', limit: 12 });
        assert.equal(tail.status, 200, JSON.stringify(tail.body));
        assert.equal(tail.body.meta.total, 1);
        assert.equal(tail.body.candidates[0].id, String(users.at(-1)._id));
        const unavailable = await request({ search: 'Developer 0001' });
        assert.equal(unavailable.body.candidates[0].readinessScore, null);
        assert.equal(unavailable.body.candidates[0].githubScore, null);
        assert.equal(unavailable.body.candidates[0].resumeScore, null);

        t.diagnostic(
          `Full eligible discovery ${Math.round(performance.now() - start)}ms for default and advanced requests`
        );
      }
    );
    await t.test(
      'all supported sorts and advanced combinations agree with the existing source calculations',
      async () => {
        oracle = [];
        for (let offset = 0; offset < users.length; offset += 240) {
          const rows = await getCandidatesByIds(
            users.slice(offset, offset + 240).map((user) => user._id),
            { organizationId: String(org) }
          );
          oracle.push(
            ...[...rows.values()].map((candidate) =>
              formatCandidateCard({ ...candidate, id: candidate.userId })
            )
          );
        }
        const sorts = {
          'score-desc': (a, b) => (b.readinessScore ?? 0) - (a.readinessScore ?? 0),
          'score-asc': (a, b) => (a.readinessScore ?? 0) - (b.readinessScore ?? 0),
          'experience-desc': (a, b) => b.yearsOfExperience - a.yearsOfExperience,
          'experience-asc': (a, b) => a.yearsOfExperience - b.yearsOfExperience,
          'name-asc': (a, b) => a.name.localeCompare(b.name, 'en'),
          latest: (a, b) => new Date(b.lastActive || 0) - new Date(a.lastActive || 0)
        };
        for (const [sortBy, compare] of Object.entries(sorts)) {
          // The existing details loader omits activity dates; discovery must retain the original User dates.
          if (sortBy === 'latest') continue;
          const expected = [...oracle]
            .sort((a, b) => compare(a, b) || a.userId.localeCompare(b.userId))
            .slice(0, 24);
          const actual = await request({ sortBy, limit: 24 });
          assert.equal(actual.status, 200, JSON.stringify(actual.body));
          assert.deepEqual(
            actual.body.candidates.map((row) => row.id),
            expected.map((row) => row.userId),
            sortBy
          );
          for (const row of actual.body.candidates) {
            const original = oracle.find((item) => item.userId === row.userId);
            for (const field of [
              'score',
              'readinessScore',
              'githubScore',
              'resumeScore',
              'profileCompleteness',
              'availability',
              'yearsOfExperience'
            ])
              assert.deepEqual(row[field], original[field], `${row.id} ${field}`);
          }
        }
        const filters = {
          skills: 'Node.js,TypeScript',
          location: 'remote',
          minReadiness: '15',
          profileCompleteness: '50',
          experience: '1'
        };
        const expected = oracle.filter(
          (row) =>
            row.skills.includes('Node.js') &&
            row.skills.includes('TypeScript') &&
            row.location.toLowerCase().includes('remote') &&
            row.score >= 15 &&
            row.profileCompleteness >= 50 &&
            row.yearsOfExperience >= 1
        );
        const filtered = await request(filters);
        assert.equal(filtered.body.meta.total, expected.length);
        const legacy = await request({
          search: 'Alias',
          stack: 'Legacy Backend',
          availability: 'Available',
          skills: 'LegacySkill'
        });
        const expectedLegacy = oracle.filter(
          (row) =>
            row.name.includes('Alias') &&
            row.stack === 'Legacy Backend' &&
            row.availability === 'Available' &&
            row.skills.includes('LegacySkill')
        );
        assert.equal(legacy.body.meta.total, expectedLegacy.length);
        assert.ok(expectedLegacy.length > 0);

        const latest = await request({ sortBy: 'latest', limit: 24 });
        const expectedDates = [...users]
          .sort((a, b) => b.updatedAt - a.updatedAt || String(a._id).localeCompare(String(b._id)))
          .slice(0, 24);
        assert.deepEqual(
          latest.body.candidates.map((row) => row.id),
          expectedDates.map((row) => String(row._id))
        );
      }
    );
    await t.test(
      'cursor continuation is deterministic, scoped, signed and rechecks current consent',
      async () => {
        const first = await request({ sortBy: 'name-asc', limit: 12 });
        const nextQuery = {
          sortBy: 'name-asc',
          limit: 12,
          page: 2,
          cursor: first.body.meta.nextCursor
        };
        const second = await request(nextQuery);
        assert.equal(second.status, 200, JSON.stringify(second.body));
        const numbered = await request({ sortBy: 'name-asc', limit: 12, page: 2 });
        assert.deepEqual(
          second.body.candidates.map((row) => row.id),
          numbered.body.candidates.map((row) => row.id)
        );
        assert.equal(
          new Set([...first.body.candidates, ...second.body.candidates].map((row) => row.id)).size,
          24
        );
        assert.equal((await request(nextQuery, peer)).status, 400);
        assert.equal((await request(nextQuery, outsider)).status, 400);
        assert.equal((await request({ ...nextQuery, search: 'Changed' })).status, 400);
        assert.equal((await request({ ...nextQuery, cursor: nextQuery.cursor + 'x' })).status, 400);
        const tied = await request({ search: 'Same Name', sortBy: 'name-asc', limit: 1 });
        const tiedNext = await request({
          search: 'Same Name',
          sortBy: 'name-asc',
          limit: 1,
          page: 2,
          cursor: tied.body.meta.nextCursor
        });
        assert.equal(tied.body.meta.total, 2);
        assert.equal(tied.body.candidates[0].id, String(users[2]._id));
        assert.equal(tiedNext.body.candidates[0].id, String(users[3]._id));
        const hidden = second.body.candidates[0].id;
        await User.updateOne({ _id: hidden }, { $set: { isPublic: false } });
        const refreshed = await request(nextQuery);
        assert.equal(refreshed.body.meta.total, count - 1);
        assert.ok(!refreshed.body.candidates.some((row) => row.id === hidden));
        await User.updateOne({ _id: hidden }, { $set: { isPublic: true } });
      }
    );
    await t.test(
      'invalid input and unauthorized actors never receive candidates or totals',
      async (policyTest) => {
        policyTest.after(async () => {
          await Settings.updateOne(
            { scope: 'global' },
            { $set: { 'recruiter.candidateVisibility': 'public' } }
          );
          await User.updateOne({ _id: recruiter }, { $set: { isActive: true } });
          await Organization.updateOne({ _id: org }, { $set: { isSuspended: false } });
          await Membership.updateOne(
            { userId: recruiter, organizationId: org, teamId: null },
            { $set: { status: 'active' } }
          );
        });
        for (const query of [
          { page: 0 },
          { page: '1.5' },
          { limit: 241 },
          { limit: -1 },
          { sortBy: '__proto__' },
          { minReadiness: 101 },
          { page: 999999 },
          { cursor: 'bad' }
        ])
          assert.equal((await request(query)).status, 400, JSON.stringify(query));
        for (const actor of [admin, superAdmin, users[0]._id])
          assert.equal((await request({}, actor)).status, 403);
        assert.equal((await request({}, null)).status, 401);
        await Membership.create({
          userId: recruiter,
          organizationId: org,
          teamId: null,
          role: 'member',
          status: 'disabled'
        });
        const revoked = await request();
        assert.equal(revoked.status, 403);
        assert.equal(revoked.body.meta, undefined);
        await Membership.updateOne(
          { userId: recruiter, organizationId: org, teamId: null },
          { $set: { status: 'active' } }
        );
        await User.updateOne({ _id: recruiter }, { $set: { isActive: false } });
        const inactive = await request();
        assert.ok([401, 403].includes(inactive.status));
        assert.equal(inactive.body.meta, undefined);
        await User.updateOne({ _id: recruiter }, { $set: { isActive: true } });
        assert.equal((await request({ search: '.*' })).body.meta.total, 0);
        assert.equal((await request({ skills: '$name' })).body.meta.total, 0);

        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.candidateVisibility': 'organization' } }
        );
        const scoped = await request();
        assert.equal(
          scoped.body.meta.total,
          users.filter((user) => String(user.organizationId) === String(org)).length
        );
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.candidateVisibility': 'private' } }
        );
        assert.equal((await request()).body.meta.total, 0);
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.candidateVisibility': 'public' } }
        );
        await Organization.updateOne({ _id: org }, { $set: { isSuspended: true } });
        assert.equal((await request()).status, 403);
        await Organization.updateOne({ _id: org }, { $set: { isSuspended: false } });
      }
    );
    await t.test(
      'private public-profile evidence is excluded before counts and explain uses existing indexes',
      async () => {
        const target = users[0]._id;
        await Profile.updateOne({ userId: target }, { $set: { isPublic: false } });
        assert.equal((await request()).body.meta.total, count - 1);
        await Profile.updateOne(
          { userId: target },
          { $set: { isPublic: true, 'sections.visibility.projects': false } }
        );
        assert.equal((await request()).body.meta.total, count - 1);
        await Profile.updateOne(
          { userId: target },
          { $set: { 'sections.visibility.projects': true } }
        );
        const start = performance.now();
        const legacy = await listCandidates({ organizationId: String(org), limit: 1000 });
        const baselineMs = Math.round(performance.now() - start);
        assert.equal(legacy.length, 1000);
        const pipeline = buildPipeline(
          { isPublic: true, role: { $in: ['developer', 'user'] }, isActive: { $ne: false } },
          parse({}),
          null
        );
        const plan = await User.aggregate(pipeline)
          .collation({ locale: 'en' })
          .allowDiskUse(true)
          .option({ maxTimeMS: 15000 })
          .explain('executionStats');
        const indexes = new Set();
        const joins = new Map();
        function walk(value) {
          if (!value || typeof value !== 'object') return;
          if (typeof value.indexName === 'string') indexes.add(value.indexName);
          if (Array.isArray(value.indexesUsed))
            value.indexesUsed.forEach((index) => indexes.add(index));
          if (value.stage === 'EQ_LOOKUP')
            joins.set(value.foreignCollection, {
              collection: value.foreignCollection,
              strategy: value.strategy,
              index: value.indexName
            });
          Object.values(value).forEach(walk);
        }
        walk(
          plan.stages?.[0]?.$cursor?.queryPlanner?.winningPlan || plan.queryPlanner?.winningPlan
        );
        assert.ok(indexes.size >= 2, JSON.stringify([...indexes]));
        assert.equal(joins.size, 6, 'all six source collections use equality joins');
        for (const join of joins.values()) {
          // Small foreign tables may be cheaper to hash than to probe repeatedly.
          assert.ok(['IndexedLoopJoin', 'HashJoin'].includes(join.strategy));
          if (join.strategy === 'IndexedLoopJoin') assert.ok(join.index);
        }
        t.diagnostic(
          JSON.stringify({
            eligible: count,
            baselineReturned: legacy.length,
            baselineMs,
            indexes: [...indexes],
            serverVersion: plan.serverInfo?.version,
            joins: [...joins.values()],
            cursorExecution: plan.stages?.[0]?.$cursor?.executionStats && {
              totalDocsExamined: plan.stages[0].$cursor.executionStats.totalDocsExamined,
              totalKeysExamined: plan.stages[0].$cursor.executionStats.totalKeysExamined,
              elapsedMs: plan.stages[0].$cursor.executionStats.executionTimeMillis
            },
            stages: plan.stages?.map((stage) => ({
              kind: Object.keys(stage)[0],
              examined: stage.totalDocsExamined,
              indexes: stage.indexesUsed,
              elapsedEstimateMs: stage.executionTimeMillisEstimate
            }))
          })
        );
      }
    );
  }
);
