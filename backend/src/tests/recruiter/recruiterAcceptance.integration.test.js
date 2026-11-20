const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { existsSync } = require('node:fs');
const { once } = require('node:events');
const net = require('node:net');
const test = require('node:test');
const express = require('express');
const mongoose = require('mongoose');

const { startMongo } = require('../fixtures/disposableRequestMongo');
const User = require('../../modules/auth/models/user');
const Organization = require('../../modules/admin/models/organization');
const Team = require('../../modules/admin/models/team');
const Membership = require('../../modules/admin/models/membership');
const PlatformSettings = require('../../modules/super-admin/models/platformSettings');
const { updateSettings } = require('../../modules/super-admin/services/platformSettingsService');
const Analysis = require('../../modules/skill-gap/models/analysis');
const ResumeAnalysis = require('../../modules/resume/models/resumeAnalysis');
const PublicProfile = require('../../modules/public-portfolio/models/publicProfile');
const CareerSprint = require('../../modules/career-sprint/models/careerSprint');
const WeeklyReport = require('../../modules/weekly-reports/models/weeklyReport');
const Notification = require('../../modules/notifications/models/notification');
const AuditLog = require('../../modules/admin/models/auditLog');
const Candidate = require('../../modules/recruiter/models/Candidate');
const Job = require('../../modules/recruiter/models/Job');
const RecruiterMatch = require('../../modules/recruiter/models/RecruiterMatch');
const RecruiterShortlist = require('../../modules/recruiter/models/RecruiterShortlist');
const { auditLogMiddleware } = require('../../core/middleware/auditLogMiddleware');
const { sign } = require('../../modules/auth/utils/authSessionToken');
const { acceptInvite } = require('../../modules/auth/authcontroller');
const hub = require('../../modules/recruiter/routes/hub/recruiterHubRoutes');
const legacy = require('../../modules/recruiter/routes/recruiter.routes');
const notificationRoutes = require('../../modules/notifications/notification.routes');
const redisCache = require('../../core/cache/redisCacheService');
const {
  ensureRecruiterIndexes,
  explainRecruiterQueryPlans
} = require('../../scripts/ensureRecruiterIndexes');
const {
  repairRecruiterLegacyRecords
} = require('../../scripts/repairRecruiterLegacyRecords');

const binary =
  process.env.INTEGRATION_TEST_MONGOD ||
  'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(auditLogMiddleware);
  app.use('/api/recruiter-hub', hub);
  app.use('/api/recruiter', legacy);
  app.use('/api/notifications', notificationRoutes);
  app.post('/api/auth/accept-invite', acceptInvite);
  return app;
};

const apiCall = async (base, path, { method = 'GET', token = '', body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
};

test(
  'Recruiter production acceptance suite',
  {
    skip: !existsSync(binary) && 'A local mongod binary is required',
    timeout: 240000
  },
  async (parent) => {
    await parent.test(
      'multi-org, membership, notifications, 32 routes, 520-candidate pool, indexes, explain plans & legacy repair',
      async (t) => {
    const mongo = await startMongo({
      replicaSet: 'recruiter-accept',
      temporaryRoot: process.env.TEMP || undefined
    });
    const prevSecret = process.env.JWT_SECRET;
    const prevCacheTtl = process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS;
    const prevPoolCap = process.env.RECRUITER_CANDIDATE_POOL_CAP;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    delete process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS;
    process.env.RECRUITER_CANDIDATE_POOL_CAP = '1000';

    t.after(async () => {
      await mongoose.disconnect();
      await mongo.stop();
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
      if (prevCacheTtl === undefined) delete process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS;
      else process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS = prevCacheTtl;
      if (prevPoolCap === undefined) delete process.env.RECRUITER_CANDIDATE_POOL_CAP;
      else process.env.RECRUITER_CANDIDATE_POOL_CAP = prevPoolCap;
    });

    await mongoose.connect(mongo.uri);

    const appA = buildApp();
    const appB = buildApp();
    const serverA = appA.listen(0, '127.0.0.1');
    const serverB = appB.listen(0, '127.0.0.1');
    await Promise.all([once(serverA, 'listening'), once(serverB, 'listening')]);
    t.after(async () => {
      await Promise.all([
        new Promise((resolve) => serverA.close(resolve)),
        new Promise((resolve) => serverB.close(resolve))
      ]);
    });
    const baseA = `http://127.0.0.1:${serverA.address().port}`;
    const baseB = `http://127.0.0.1:${serverB.address().port}`;

    // 1. Seed organizations, teams, memberships, recruiters, and realistic 520-dev pool
    const superAdmin = await User.create({
      name: 'Platform Super',
      email: 'super-accept@example.test',
      role: 'super_admin',
      isVerified: true,
      providers: ['github']
    });

    const [orgAlpha, orgBeta] = await Organization.create([
      { name: 'Alpha Corp', slug: 'alpha-corp', ownerId: superAdmin._id, createdBy: superAdmin._id },
      { name: 'Beta Corp', slug: 'beta-corp', ownerId: superAdmin._id, createdBy: superAdmin._id }
    ]);

    const [teamPlatform, teamAi] = await Team.create([
      {
        organizationId: orgAlpha._id,
        name: 'Platform Hiring',
        slug: 'platform-hiring',
        createdBy: superAdmin._id
      },
      {
        organizationId: orgAlpha._id,
        name: 'AI Hiring',
        slug: 'ai-hiring',
        createdBy: superAdmin._id
      }
    ]);

    const [recruiterA, peerA, recruiterB] = await User.create([
      {
        name: 'Recruiter Alpha',
        email: 'recruiter-a@example.test',
        role: 'recruiter',
        organizationId: orgAlpha._id,
        isVerified: true,
        providers: ['github'],
        sessionRevision: 1
      },
      {
        name: 'Peer Alpha',
        email: 'peer-a@example.test',
        role: 'recruiter',
        organizationId: orgAlpha._id,
        isVerified: true,
        providers: ['github'],
        sessionRevision: 1
      },
      {
        name: 'Recruiter Beta',
        email: 'recruiter-b@example.test',
        role: 'recruiter',
        organizationId: orgBeta._id,
        isVerified: true,
        providers: ['github'],
        sessionRevision: 1
      }
    ]);

    const membershipA = await Membership.create({
      organizationId: orgAlpha._id,
      teamId: teamPlatform._id,
      userId: recruiterA._id,
      role: 'member',
      status: 'active'
    });
    await Membership.create({
      organizationId: orgAlpha._id,
      teamId: teamAi._id,
      userId: peerA._id,
      role: 'member',
      status: 'active'
    });
    await Membership.create({
      organizationId: orgBeta._id,
      teamId: null,
      userId: recruiterB._id,
      role: 'member',
      status: 'active'
    });

    const tokenA = () => sign({ _id: recruiterA._id, sessionRevision: recruiterA.sessionRevision });
    const tokenPeerA = () => sign({ _id: peerA._id, sessionRevision: peerA.sessionRevision });
    const tokenB = () => sign({ _id: recruiterB._id, sessionRevision: recruiterB.sessionRevision });

    // Ensure platform settings allow recruiter access and public visibility
    await updateSettings({
      recruiter: { enableRecruiterAccess: true, candidateVisibility: 'public' }
    });

    // Seed 520 realistic developers with linked Analysis, ResumeAnalysis, PublicProfile, CareerSprint, WeeklyReport
    const totalDevs = 520;
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 86400000);
    const userDocs = [];
    for (let i = 0; i < totalDevs; i += 1) {
      userDocs.push({
        name: `Candidate ${String(i).padStart(3, '0')}`,
        email: `cand-${i}@example.test`,
        role: 'developer',
        isPublic: true,
        isActive: true,
        isVerified: true,
        providers: ['github'],
        stack: i % 3 === 0 ? 'Backend' : i % 3 === 1 ? 'Full Stack' : 'Frontend',
        experienceLevel: i % 4 === 0 ? '3-5 years' : '1-2 years',
        location: i % 2 === 0 ? 'Remote' : 'Lahore',
        githubUsername: `dev_${i}`,
        lastActiveAt: new Date(now.getTime() - i * 60000)
      });
    }
    const insertedDevs = await User.insertMany(userDocs);

    await Promise.all([
      Analysis.insertMany(
        insertedDevs.map((dev, i) => ({
          userId: dev._id,
          githubScore: 60 + (i % 38),
          skillScore: 58 + (i % 35),
          readinessScore: 62 + (i % 36),
          githubStats: { repos: 8 + (i % 15), stars: 20 + i, forks: 2, followers: 5 }
        }))
      ),
      ResumeAnalysis.insertMany(
        insertedDevs.map((dev, i) => ({
          userId: dev._id,
          fileId: new mongoose.Types.ObjectId(),
          fileName: `resume-${i}.pdf`,
          fileSize: 120000,
          atsScore: 70 + (i % 25),
          keywordDensity: 75,
          formatScore: 80,
          contentQuality: 78,
          skills: {
            backend: i % 3 === 2 ? ['React', 'TypeScript'] : ['Node.js', 'MongoDB', 'TypeScript']
          }
        }))
      ),
      PublicProfile.insertMany(
        insertedDevs.map((dev, i) => ({
          userId: dev._id,
          slug: `cand-slug-${i}-${String(dev._id).slice(-6)}`,
          isPublic: true,
          skills: [{ name: i % 3 === 2 ? 'Angular' : 'Redis', score: 85 }],
          projects: [
            {
              title: `Portfolio Project ${i}`,
              description: 'Production workload',
              tech: ['TypeScript', 'MongoDB'],
              status: 'completed'
            }
          ]
        }))
      ),
      CareerSprint.insertMany(
        insertedDevs.map((dev) => ({
          userId: dev._id,
          weekStartDate: weekStart,
          weekEndDate: now,
          currentStreak: 5,
          tasks: [{ title: 'Ship API', isCompleted: true }]
        }))
      ),
      WeeklyReport.insertMany(
        insertedDevs.map((dev) => ({
          userId: dev._id,
          weekStartDate: weekStart,
          weekEndDate: now,
          score: 82,
          progressSummary: 'Consistent weekly progress',
          reportText: 'Consistent weekly progress across sprints and portfolio.',
          meta: {
            comparisons: { readinessDelta: 6, coverageDelta: 5 },
            sprint: { completionRate: 85, streak: 5 },
            activity: { weeklyCommitSignal: 20 }
          }
        }))
      )
    ]);

    // 2. Ensure Recruiter compound indexes idempotently & inspect MongoDB explain plans
    const indexDryRun = await ensureRecruiterIndexes({ dryRun: true });
    assert.ok(indexDryRun.totalRequired >= 10);

    const indexApplied = await ensureRecruiterIndexes({ dryRun: false });
    assert.equal(indexApplied.presentCount + indexApplied.createdCount, indexApplied.totalRequired);

    const indexIdempotent = await ensureRecruiterIndexes({ dryRun: true });
    assert.equal(indexIdempotent.pendingCount, 0);

    // 3. Test realistic 520-candidate pool pagination past 320 + performance
    const tPoolStart = Date.now();
    const page35 = await apiCall(baseA, '/api/recruiter-hub/candidates?page=35&limit=12', {
      token: tokenA()
    });
    const poolElapsedMs = Date.now() - tPoolStart;
    assert.equal(page35.status, 200);
    assert.equal(page35.json.meta.total, 520);
    assert.equal(page35.json.meta.page, 35);
    assert.equal(page35.json.meta.totalPages, 44);
    assert.equal(page35.json.candidates.length, 12);
    assert.ok(poolElapsedMs < 10000, `Pool query took unexpectedly long: ${poolElapsedMs}ms`);

    const primaryCandId = String(insertedDevs[0]._id);
    const secondCandId = String(insertedDevs[1]._id);

    // 4. Exercise ALL 23 Hub routes & ALL 9 legacy routes across appA and appB
    // Hub 1: Create Job with empty description (regression check)
    const hubCreateJob = await apiCall(baseA, '/api/recruiter-hub/jobs', {
      method: 'POST',
      token: tokenA(),
      body: {
        title: 'Senior Node Architect',
        role: 'Backend Architect',
        stack: 'Backend',
        requiredSkills: ['Node.js', 'MongoDB'],
        preferredSkills: ['Redis'],
        minExperienceYears: 2,
        location: 'Remote',
        employmentType: 'full-time',
        description: ''
      }
    });
    assert.equal(hubCreateJob.status, 201);
    const hubJobId = String(hubCreateJob.json.job._id);

    // Hub 2-6: List, Get, Patch, Archive, and separate Delete
    assert.equal(
      (await apiCall(baseB, '/api/recruiter-hub/jobs', { token: tokenA() })).status,
      200
    );
    assert.equal(
      (await apiCall(baseB, `/api/recruiter-hub/jobs/${hubJobId}`, { token: tokenA() })).status,
      200
    );
    assert.equal(
      (
        await apiCall(baseA, `/api/recruiter-hub/jobs/${hubJobId}`, {
          method: 'PATCH',
          token: tokenA(),
          body: { location: 'Lahore / Remote' }
        })
      ).status,
      200
    );
    const tempJobRes = await apiCall(baseA, '/api/recruiter-hub/jobs', {
      method: 'POST',
      token: tokenA(),
      body: {
        title: 'Temp Role',
        role: 'Backend Engineer',
        stack: 'Backend',
        location: 'Remote',
        employmentType: 'full-time',
        minExperienceYears: 1,
        requiredSkills: ['Node.js']
      }
    });
    assert.equal(tempJobRes.status, 201);
    const tempJobId = String(tempJobRes.json.job._id);
    assert.equal(
      (
        await apiCall(baseB, `/api/recruiter-hub/jobs/${tempJobId}/archive`, {
          method: 'POST',
          token: tokenA()
        })
      ).status,
      200
    );
    assert.equal(
      (
        await apiCall(baseA, `/api/recruiter-hub/jobs/${tempJobId}`, {
          method: 'DELETE',
          token: tokenA()
        })
      ).status,
      200
    );

    // Hub 7-9: Candidate details & AI analyze
    assert.equal(
      (await apiCall(baseB, `/api/recruiter-hub/candidates/${primaryCandId}`, { token: tokenA() }))
        .status,
      200
    );
    assert.equal(
      (
        await apiCall(baseA, `/api/recruiter-hub/candidates/${primaryCandId}/analyze`, {
          method: 'POST',
          token: tokenA()
        })
      ).status,
      200
    );

    // Hub 10-13: Matches generate, list, get details, patch status (plus match performance timing)
    const subsetIds = insertedDevs.slice(0, 60).map((d) => String(d._id));
    const tMatchStart = Date.now();
    const genMatchesRes = await apiCall(baseA, '/api/recruiter-hub/matches/generate', {
      method: 'POST',
      token: tokenA(),
      body: { jobId: hubJobId, candidateIds: subsetIds }
    });
    const matchElapsedMs = Date.now() - tMatchStart;
    assert.equal(genMatchesRes.status, 200);
    assert.equal(genMatchesRes.json.matches.length, 60);
    assert.ok(matchElapsedMs < 8000, `Match generation took too long: ${matchElapsedMs}ms`);

    const listMatchesRes = await apiCall(
      baseB,
      `/api/recruiter-hub/matches?jobId=${hubJobId}`,
      { token: tokenA() }
    );
    assert.equal(listMatchesRes.status, 200);
    const firstMatchId = String(listMatchesRes.json.matches[0]._id);

    assert.equal(
      (await apiCall(baseA, `/api/recruiter-hub/matches/${firstMatchId}`, { token: tokenA() }))
        .status,
      200
    );
    assert.equal(
      (
        await apiCall(baseB, `/api/recruiter-hub/matches/${firstMatchId}/status`, {
          method: 'PATCH',
          token: tokenA(),
          body: { status: 'shortlisted' }
        })
      ).status,
      200
    );

    // Hub 14-17: Shortlist create, list, patch, delete
    const slCreate = await apiCall(baseA, '/api/recruiter-hub/shortlists', {
      method: 'POST',
      token: tokenA(),
      body: { candidateId: primaryCandId, jobId: hubJobId, notes: 'Strong system design' }
    });
    assert.ok([200, 201].includes(slCreate.status));
    const shortlistId = String(slCreate.json.shortlist._id);

    const slList = await apiCall(baseB, '/api/recruiter-hub/shortlists', { token: tokenA() });
    assert.equal(slList.status, 200);
    assert.ok(slList.json.shortlists.length >= 1);

    assert.equal(
      (
        await apiCall(baseA, `/api/recruiter-hub/shortlists/${shortlistId}`, {
          method: 'PATCH',
          token: tokenA(),
          body: { status: 'reviewing', notes: 'Moved to tech screen' }
        })
      ).status,
      200
    );
    const slTemp = await apiCall(baseA, '/api/recruiter-hub/shortlists', {
      method: 'POST',
      token: tokenA(),
      body: { candidateId: secondCandId, jobId: hubJobId, notes: 'Backup' }
    });
    assert.equal(
      (
        await apiCall(baseB, `/api/recruiter-hub/shortlists/${slTemp.json.shortlist._id}`, {
          method: 'DELETE',
          token: tokenA()
        })
      ).status,
      200
    );

    // Hub 18-23: Comparison, Dashboard, Analytics, Activity, Profile GET + PATCH
    assert.equal(
      (
        await apiCall(baseA, '/api/recruiter-hub/comparison', {
          method: 'POST',
          token: tokenA(),
          body: { candidateIds: [primaryCandId, secondCandId], jobId: hubJobId }
        })
      ).status,
      200
    );
    const dashBefore = await apiCall(baseB, '/api/recruiter-hub/analytics/dashboard', {
      token: tokenA()
    });
    assert.equal(dashBefore.status, 200);
    assert.equal(
      (await apiCall(baseA, '/api/recruiter-hub/analytics', { token: tokenA() })).status,
      200
    );
    assert.equal(
      (await apiCall(baseB, '/api/recruiter-hub/activity?limit=10', { token: tokenA() })).status,
      200
    );
    assert.equal(
      (await apiCall(baseA, '/api/recruiter-hub/profile', { token: tokenA() })).status,
      200
    );
    assert.equal(
      (
        await apiCall(baseB, '/api/recruiter-hub/profile', {
          method: 'PATCH',
          token: tokenA(),
          body: { location: 'Karachi', githubUsername: 'recruiter-alpha' }
        })
      ).status,
      200
    );

    // Legacy 9 routes (/api/recruiter/*)
    assert.equal(
      (await apiCall(baseA, '/api/recruiter/dashboard', { token: tokenA() })).status,
      200
    );
    assert.equal(
      (await apiCall(baseB, '/api/recruiter/candidates', { token: tokenA() })).status,
      200
    );
    assert.equal(
      (await apiCall(baseA, `/api/recruiter/candidate/${primaryCandId}`, { token: tokenA() })).status,
      200
    );
    const legCreate = await apiCall(baseB, '/api/recruiter/job', {
      method: 'POST',
      token: tokenA(),
      body: {
        title: 'Legacy API Role',
        description: 'Legacy role maintaining APIs.',
        role: 'Backend Engineer',
        stack: 'Backend',
        location: 'Remote',
        employmentType: 'full-time',
        minExperienceYears: 2,
        requiredSkills: ['Node.js']
      }
    });
    assert.equal(legCreate.status, 201);
    const legJobId = String(legCreate.json.job._id);
    assert.equal((await apiCall(baseA, '/api/recruiter/jobs', { token: tokenA() })).status, 200);
    assert.equal(
      (
        await apiCall(baseB, `/api/recruiter/job/${legJobId}`, {
          method: 'PUT',
          token: tokenA(),
          body: { location: 'Islamabad' }
        })
      ).status,
      200
    );
    assert.equal(
      (
        await apiCall(baseA, '/api/recruiter/match', {
          method: 'POST',
          token: tokenA(),
          body: { jobId: legJobId, candidateIds: [primaryCandId, secondCandId] }
        })
      ).status,
      200
    );
    assert.equal(
      (
        await apiCall(baseB, '/api/recruiter/ai-rank', {
          method: 'POST',
          token: tokenA(),
          body: { jobId: legJobId, candidateIds: [primaryCandId, secondCandId] }
        })
      ).status,
      200
    );
    assert.equal(
      (
        await apiCall(baseA, `/api/recruiter/job/${legJobId}`, {
          method: 'DELETE',
          token: tokenA()
        })
      ).status,
      200
    );

    // 5. Explain plans verify IXSCAN (no COLLSCAN) on all 5 hot queries
    const plans = await explainRecruiterQueryPlans({
      organizationId: orgAlpha._id,
      recruiterId: recruiterA._id
    });
    for (const [name, summary] of Object.entries(plans)) {
      assert.equal(summary.usesIxScan, true, `Expected IXSCAN for ${name}, got ${JSON.stringify(summary)}`);
      assert.equal(summary.usesCollScan, false, `Unexpected COLLSCAN for ${name}`);
    }
    console.log(
      'ACCEPTANCE_METRICS:',
      JSON.stringify({
        poolElapsedMs,
        matchElapsedMs,
        plans: Object.fromEntries(
          Object.entries(plans).map(([k, v]) => [
            k,
            {
              usesIxScan: v.usesIxScan,
              usesCollScan: v.usesCollScan,
              indexNames: v.indexNames,
              nReturned: v.nReturned,
              totalDocsExamined: v.totalDocsExamined,
              executionTimeMillis: v.executionTimeMillis
            }
          ])
        )
      })
    );

    // 6. Cross-organization ownership & team membership changes + revocation + Super Admin kill-switch
    assert.equal(
      (await apiCall(baseB, `/api/recruiter-hub/jobs/${hubJobId}`, { token: tokenB() })).status,
      404
    );
    assert.equal(
      (await apiCall(baseB, `/api/recruiter-hub/jobs/${hubJobId}`, { token: tokenPeerA() })).status,
      404
    );
    assert.equal(
      (await apiCall(baseA, `/api/recruiter-hub/matches/${firstMatchId}`, { token: tokenB() }))
        .status,
      404
    );
    assert.equal(
      (
        await apiCall(baseA, `/api/recruiter-hub/shortlists/${shortlistId}`, {
          method: 'PATCH',
          token: tokenB(),
          body: { status: 'rejected' }
        })
      ).status,
      404
    );

    // Team membership change reflected on dashboard widgets.assignedTeams
    const teamBefore = await apiCall(baseA, '/api/recruiter-hub/analytics/dashboard', {
      token: tokenA()
    });
    assert.equal(teamBefore.json.widgets.assignedTeams.length, 1);
    await Membership.create({
      organizationId: orgAlpha._id,
      teamId: teamAi._id,
      userId: recruiterA._id,
      role: 'member',
      status: 'active'
    });
    const teamAdded = await apiCall(baseB, '/api/recruiter-hub/analytics/dashboard', {
      token: tokenA()
    });
    assert.equal(teamAdded.json.widgets.assignedTeams.length, 2);
    await Membership.deleteOne({ _id: membershipA._id });
    const teamRemoved = await apiCall(baseA, '/api/recruiter-hub/analytics/dashboard', {
      token: tokenA()
    });
    assert.equal(teamRemoved.json.widgets.assignedTeams.length, 1);

    // Super Admin kill-switch blocks both Hub and Legacy then re-enabling restores access
    await updateSettings({ recruiter: { enableRecruiterAccess: false } });
    assert.equal(
      (await apiCall(baseA, '/api/recruiter-hub/jobs', { token: tokenA() })).status,
      403
    );
    assert.equal(
      (await apiCall(baseB, '/api/recruiter/dashboard', { token: tokenA() })).status,
      403
    );
    await updateSettings({ recruiter: { enableRecruiterAccess: true } });
    assert.equal(
      (await apiCall(baseA, '/api/recruiter-hub/jobs', { token: tokenA() })).status,
      200
    );

    // Notifications lifecycle for Recruiter
    const [notif1, notif2, notif3] = await Notification.create([
      { userId: recruiterA._id, type: 'info', title: 'New Match', message: 'Match ready' },
      { userId: recruiterA._id, type: 'success', title: 'Shortlist', message: 'Saved' },
      { userId: recruiterA._id, type: 'system', title: 'Audit', message: 'Org synced' }
    ]);
    const listNotif = await apiCall(baseA, '/api/notifications', { token: tokenA() });
    assert.equal(listNotif.status, 200);
    assert.equal(listNotif.json.notifications.length, 3);
    assert.equal(
      (
        await apiCall(baseB, `/api/notifications/${notif1._id}/read`, {
          method: 'PUT',
          token: tokenA()
        })
      ).status,
      200
    );
    assert.equal(
      (
        await apiCall(baseA, '/api/notifications/bulk-delete', {
          method: 'POST',
          token: tokenA(),
          body: { ids: [String(notif2._id)] }
        })
      ).status,
      200
    );
    assert.equal(
      (
        await apiCall(baseB, '/api/notifications/read-all', {
          method: 'PUT',
          token: tokenA()
        })
      ).status,
      200
    );
    assert.equal(
      (
        await apiCall(baseA, '/api/notifications/clear-all', {
          method: 'POST',
          token: tokenA()
        })
      ).status,
      200
    );
    const listNotifAfter = await apiCall(baseB, '/api/notifications', { token: tokenA() });
    assert.equal(listNotifAfter.json.notifications.length, 0);

    // Revoking recruiter session/membership blocks token immediately
    const oldTokenA = tokenA();
    await User.updateOne(
      { _id: recruiterA._id },
      { $set: { isActive: false }, $inc: { sessionRevision: 1 } }
    );
    assert.equal(
      (await apiCall(baseA, '/api/recruiter-hub/jobs', { token: oldTokenA })).status,
      401
    );
    await User.updateOne({ _id: recruiterA._id }, { $set: { isActive: true } });

    // 7. Historical legacy Candidate._id compatibility & non-destructive repair
    const legacyCandThree = await Candidate.create({
      userId: insertedDevs[2]._id,
      fullName: 'Candidate 002',
      email: insertedDevs[2].email,
      stack: 'Frontend',
      isActive: true
    });
    const legacyCandFourConflict = await Candidate.create({
      userId: insertedDevs[3]._id,
      fullName: 'Candidate 003',
      email: insertedDevs[3].email,
      stack: 'Backend',
      isActive: true
    });

    // Insert legacy-keyed shortlist + match for dev[2] (clean migration),
    // and conflict pair for dev[3] (must skip without deletion), plus stale match for dev[0]
    const peerJob = await Job.create({
      recruiterId: peerA._id,
      organizationId: orgAlpha._id,
      teamId: teamAi._id,
      title: 'Peer Frontend Role',
      stack: 'Frontend',
      requiredSkills: ['TypeScript', 'Angular']
    });
    const legacyShortlist = await RecruiterShortlist.create({
      recruiterId: peerA._id,
      organizationId: orgAlpha._id,
      candidateId: legacyCandThree._id,
      jobId: peerJob._id,
      status: 'shortlisted'
    });
    const legacyMatchForSync = await RecruiterMatch.create({
      recruiterId: peerA._id,
      organizationId: orgAlpha._id,
      jobId: peerJob._id,
      candidateId: legacyCandThree._id,
      matchScore: 1,
      skillMatchPercent: 0,
      readinessScore: 1,
      confidenceScore: 1,
      breakdown: {},
      status: 'generated'
    });
    // Verify shortlist syncMatchStatus updates legacy Candidate._id match docs
    const peerSyncRes = await apiCall(baseA, `/api/recruiter-hub/shortlists/${legacyShortlist._id}`, {
      method: 'PATCH',
      token: tokenPeerA(),
      body: { status: 'rejected' }
    });
    assert.equal(peerSyncRes.status, 200);
    const syncedLegacyMatch = await RecruiterMatch.findById(legacyMatchForSync._id).lean();
    assert.equal(syncedLegacyMatch.status, 'rejected');

    // Conflict scenario for dev[3]: both legacy and canonical matches exist on recruiterB's job
    const jobBeta = await Job.create({
      recruiterId: recruiterB._id,
      organizationId: orgBeta._id,
      title: 'Beta Engineer',
      stack: 'Backend',
      requiredSkills: ['Node.js']
    });
    await RecruiterMatch.create([
      {
        recruiterId: recruiterB._id,
        organizationId: orgBeta._id,
        jobId: jobBeta._id,
        candidateId: insertedDevs[3]._id,
        matchScore: 10,
        breakdown: {},
        status: 'shortlisted'
      },
      {
        recruiterId: recruiterB._id,
        organizationId: orgBeta._id,
        jobId: jobBeta._id,
        candidateId: legacyCandFourConflict._id,
        matchScore: 10,
        breakdown: {},
        status: 'generated'
      }
    ]);

    const repairDry = await repairRecruiterLegacyRecords({ apply: false });
    assert.equal(repairDry.apply, false);
    assert.ok(repairDry.shortlistAliasesFound >= 1);
    assert.ok(repairDry.matchAliasesFound >= 2);
    assert.ok(repairDry.staleMatchesFound >= 2);
    assert.equal(repairDry.matchConflictsSkipped.length, 1);

    const repairApplied = await repairRecruiterLegacyRecords({ apply: true });
    assert.equal(repairApplied.apply, true);
    assert.equal(repairApplied.shortlistAliasesRepaired, 1);
    assert.equal(repairApplied.matchAliasesRepaired, 1);
    assert.equal(repairApplied.matchConflictsSkipped.length, 1);
    assert.ok(repairApplied.staleMatchesRepaired >= 2);

    const repairedShortlist = await RecruiterShortlist.findById(legacyShortlist._id).lean();
    assert.equal(String(repairedShortlist.candidateId), String(insertedDevs[2]._id));
    const repairedLegacyMatch = await RecruiterMatch.findById(legacyMatchForSync._id).lean();
    assert.equal(String(repairedLegacyMatch.candidateId), String(insertedDevs[2]._id));
    assert.equal(repairedLegacyMatch.status, 'rejected');
    assert.ok(repairedLegacyMatch.matchScore > 1);
    assert.ok(Object.keys(repairedLegacyMatch.breakdown || {}).length > 0);
    // Conflict record was preserved non-destructively
    assert.equal(
      await RecruiterMatch.countDocuments({ jobId: jobBeta._id }),
      2
    );

    const repairSecondRun = await repairRecruiterLegacyRecords({ apply: true });
    assert.equal(repairSecondRun.shortlistAliasesRepaired, 0);
    assert.equal(repairSecondRun.matchAliasesRepaired, 0);
    assert.equal(repairSecondRun.staleMatchesRepaired, 0);

    // Ensure AuditLog captured activity entries
    assert.ok((await AuditLog.countDocuments({ organizationId: orgAlpha._id })) >= 3);
      }
    );

    await parent.test(
      'Redis enabled invalidation & mid-flight outage fallback + recovery',
      {
        skip:
          !process.env.RECRUITER_TEST_REDIS_URL &&
          'Requires RECRUITER_TEST_REDIS_URL pointing to disposable Redis'
      },
      async (t) => {
    const mongo = await startMongo({
      replicaSet: 'recruiter-redis-outage',
      temporaryRoot: process.env.TEMP || undefined
    });
    const targetUrl = new URL(process.env.RECRUITER_TEST_REDIS_URL);
    const activeSockets = new Set();
    const proxy = net.createServer((clientSocket) => {
      const upstream = net.connect(Number(targetUrl.port || 6379), targetUrl.hostname || '127.0.0.1');
      activeSockets.add(clientSocket);
      activeSockets.add(upstream);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
      const cleanup = () => {
        activeSockets.delete(clientSocket);
        activeSockets.delete(upstream);
        clientSocket.destroy();
        upstream.destroy();
      };
      clientSocket.on('error', cleanup);
      upstream.on('error', cleanup);
      clientSocket.on('close', cleanup);
      upstream.on('close', cleanup);
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const proxyPort = proxy.address().port;

    const prevRedisUrl = process.env.REDIS_URL;
    const prevSecret = process.env.JWT_SECRET;
    const prevTtl = process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS;
    process.env.REDIS_URL = `redis://127.0.0.1:${proxyPort}`;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS = '60';

    t.after(async () => {
      await redisCache.closeRedisCache();
      for (const s of activeSockets) s.destroy();
      await new Promise((resolve) => proxy.close(resolve));
      await mongoose.disconnect();
      await mongo.stop();
      if (prevRedisUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = prevRedisUrl;
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
      if (prevTtl === undefined) delete process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS;
      else process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS = prevTtl;
    });

    await mongoose.connect(mongo.uri);
    const connected = await redisCache.initRedisCache({ silent: true, probeOnly: true });
    assert.ok(connected);

    const org = await Organization.create({
      name: 'Gamma Org',
      slug: 'gamma-org',
      ownerId: new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId()
    });
    const rec = await User.create({
      name: 'Gamma Recruiter',
      email: 'gamma-rec@example.test',
      role: 'recruiter',
      organizationId: org._id,
      isVerified: true,
      providers: ['github'],
      sessionRevision: 1
    });
    const token = sign({ _id: rec._id, sessionRevision: rec.sessionRevision });

    const app = buildApp();
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;

    // Warm Redis cache with 0 jobs
    const dash0 = await apiCall(base, '/api/recruiter-hub/analytics/dashboard', { token });
    assert.equal(dash0.status, 200);
    assert.equal(dash0.json.metrics.openJobs, 0);

    // Creating a job updates revision digest -> cache invalidates -> returns 1 job
    const job1Res = await apiCall(base, '/api/recruiter-hub/jobs', {
      method: 'POST',
      token,
      body: {
        title: 'Platform SRE',
        role: 'Site Reliability Engineer',
        stack: 'Backend',
        location: 'Remote',
        employmentType: 'full-time',
        minExperienceYears: 2,
        requiredSkills: ['Linux']
      }
    });
    assert.equal(job1Res.status, 201);
    const dash1 = await apiCall(base, '/api/recruiter-hub/analytics/dashboard', { token });
    assert.equal(dash1.status, 200);
    assert.equal(dash1.json.metrics.openJobs, 1);

    // Simulate Redis outage by closing proxy & destroying active sockets
    for (const s of activeSockets) s.destroy();
    await new Promise((resolve) => proxy.close(resolve));

    // Create second job during outage -> endpoint falls back cleanly without failing
    const job2Res = await apiCall(base, '/api/recruiter-hub/jobs', {
      method: 'POST',
      token,
      body: {
        title: 'Staff Security',
        role: 'Security Engineer',
        stack: 'Backend',
        location: 'Remote',
        employmentType: 'full-time',
        minExperienceYears: 3,
        requiredSkills: ['IAM']
      }
    });
    assert.equal(job2Res.status, 201);
    const dashOutage = await apiCall(base, '/api/recruiter-hub/analytics/dashboard', { token });
    assert.equal(dashOutage.status, 200);
    assert.equal(dashOutage.json.metrics.openJobs, 2);

    // Recover proxy directly on same port & verify cache reconnect works cleanly
    await new Promise((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve));
    await redisCache.closeRedisCache();
    const reconnected = await redisCache.initRedisCache({ silent: true, probeOnly: true });
    assert.ok(reconnected);

    const dashRecovered = await apiCall(base, '/api/recruiter-hub/analytics/dashboard', { token });
    assert.equal(dashRecovered.status, 200);
    assert.equal(dashRecovered.json.metrics.openJobs, 2);
      }
    );
  }
);
