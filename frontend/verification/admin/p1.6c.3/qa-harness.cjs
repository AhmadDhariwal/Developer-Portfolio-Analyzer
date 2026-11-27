'use strict';

/**
 * Independent P1.6C.3 Real-Stack QA Harness
 * Runs ONLY compiled Angular + real Express routes + isolated disposable MongoDB replica set.
 * Zero target API mocks, zero production DB touches, zero external delivery.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { randomBytes, createHash } = require('node:crypto');

const root = path.resolve(__dirname, '../../../..');
const backendRequire = createRequire(path.join(root, 'backend/package.json'));

// Block .env leakage and isolate runtime before importing any backend module.
const dotenv = backendRequire('dotenv');
dotenv.config = () => ({ parsed: {} });
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_ISSUER = 'devinsight-api';
process.env.JWT_AUDIENCE = 'devinsight-web';
for (const key of [
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'ANTHROPIC_API_KEY',
  'XAI_API_KEY',
  'SENDGRID_API_KEY',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
]) {
  process.env[key] = '';
}

const express = backendRequire('express');
const mongoose = backendRequire('mongoose');
const helmet = backendRequire('helmet');
const bcrypt = backendRequire('bcryptjs');
const { startMongo } = require(
  path.join(root, 'backend/src/tests/fixtures/disposableRequestMongo')
);

const distDir = path.join(root, 'frontend/dist/frontend/browser');
const outputDir = __dirname;
const screenshotsDir = path.join(outputDir, 'screenshots');

const POLICY_KEYS = [
  'recruiterJobCreation',
  'recruiterJobPublication',
  'teamSharedJobs',
  'sharedPublicEvaluations',
  'teamManagerEvaluationManagement',
  'candidateMatching',
  'invitationCreation',
  'managerTeamAdministration',
];

const QA_BRANDING_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4f46e5"/><circle cx="32" cy="32" r="16" fill="#ffffff"/></svg>',
  'utf8'
);

function loadPlaywright() {
  const candidates = [];
  const npxCache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache/_npx');
  if (fs.existsSync(npxCache)) {
    for (const entry of fs.readdirSync(npxCache)) {
      candidates.push(path.join(npxCache, entry, 'node_modules/playwright'));
      candidates.push(path.join(npxCache, entry, 'node_modules/playwright-core'));
    }
  }
  candidates.push('playwright', 'playwright-core');
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try next candidate
    }
  }
  throw new Error('Playwright or playwright-core runtime not found.');
}

async function startRealStackHarness() {
  assert.ok(
    fs.existsSync(path.join(distDir, 'index.html')),
    `Compiled Angular app required at ${distDir}`
  );
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const mongoTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-qa-p16c3-'));
  const mongo = await startMongo({
    replicaSet: 'qa-p16c3',
    temporaryRoot: mongoTmpRoot,
    readinessAttempts: 240,
  });

  let server;
  let browser;
  const pendingAudits = new Set();
  const auditWriteErrors = [];
  const emailAttemptLog = [];
  const cspViolations = [];
  let maxConcurrentStreams = 0;
  let activeStreams = 0;
  const requestLog = [];

  const settingsService = require(
    path.join(root, 'backend/src/modules/super-admin/services/platformSettingsService')
  );
  const notificationStreams = require(
    path.join(root, 'backend/src/modules/notifications/services/notificationStreamService')
  );

  let cleaned = false;
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try {
      if (browser) {
        await browser.close().catch(() => {});
        browser = null;
      }
      notificationStreams.closeAll?.();
      if (server) {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
        server = null;
      }
      await Promise.allSettled([...pendingAudits]);
    } finally {
      settingsService.stopSettingsSynchronization();
      await mongoose.disconnect().catch(() => {});
      await mongo.stop().catch(() => {});
      fs.rmSync(mongoTmpRoot, { recursive: true, force: true });
    }
  }

  try {
    await mongoose.connect(mongo.uri);

    const User = require(path.join(root, 'backend/src/modules/auth/models/user'));
    const Organization = require(path.join(root, 'backend/src/modules/admin/models/organization'));
    const Membership = require(path.join(root, 'backend/src/modules/admin/models/membership'));
    const Team = require(path.join(root, 'backend/src/modules/admin/models/team'));
    const Invitation = require(path.join(root, 'backend/src/modules/admin/models/invitation'));
    const AuditLog = require(path.join(root, 'backend/src/modules/admin/models/auditLog'));
    const Job = require(path.join(root, 'backend/src/modules/recruiter/models/Job'));
    const Match = require(path.join(root, 'backend/src/modules/recruiter/models/RecruiterMatch'));
    const Shortlist = require(
      path.join(root, 'backend/src/modules/recruiter/models/RecruiterShortlist')
    );
    const JobApplication = require(path.join(root, 'backend/src/modules/jobs/models/jobApplication'));
    const PublicProfile = require(
      path.join(root, 'backend/src/modules/public-portfolio/models/publicProfile')
    );
    const Notification = require(
      path.join(root, 'backend/src/modules/notifications/models/notification')
    );
    const PlatformSettings = require(
      path.join(root, 'backend/src/modules/super-admin/models/platformSettings')
    );
    const { sign } = require(path.join(root, 'backend/src/modules/auth/utils/authSessionToken'));

    // Track async middleware audit writes cleanly
    const origAuditCreate = AuditLog.create;
    AuditLog.create = function (...args) {
      const p = origAuditCreate.apply(this, args);
      pendingAudits.add(p);
      p.then(
        () => pendingAudits.delete(p),
        (err) => {
          pendingAudits.delete(p);
          auditWriteErrors.push(err?.message || String(err));
        }
      );
      return p;
    };

    // Mandatory: block external email delivery while recording every send attempt
    const emailService = require(path.join(root, 'backend/src/core/messaging/emailService'));
    const invitationEmailService = require(
      path.join(root, 'backend/src/core/messaging/invitationEmailService')
    );
    emailService.sendRecruiterInvitationEmail = async (payload) => {
      emailAttemptLog.push({
        transport: 'sendRecruiterInvitationEmail',
        to: payload?.to || payload?.email || '',
      });
      return { sent: false, reason: 'QA isolated email transport' };
    };
    invitationEmailService.sendInvitationEmail = async (payload) => {
      emailAttemptLog.push({
        transport: 'sendInvitationEmail',
        to: payload?.to || payload?.email || '',
      });
      return { sent: false, reason: 'QA isolated email transport' };
    };

    const app = express();
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            fontSrc: ["'self'", 'https:', 'data:'],
            formAction: ["'self'"],
            frameAncestors: ["'self'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            objectSrc: ["'none'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
            connectSrc: ["'self'", 'https:'],
            upgradeInsecureRequests: null,
          },
        },
        crossOriginEmbedderPolicy: false,
      })
    );
    app.use(express.json({ limit: '2mb' }));

    // Request telemetry + SSE stream concurrency monitor
    app.use((req, res, next) => {
      const reqPath = req.path;
      if (reqPath.startsWith('/api/')) {
        res.once('finish', () => {
          requestLog.push({
            method: req.method,
            path: reqPath.replace(/\/accept\/[a-f0-9]{24,128}/g, '/accept/[token]'),
            status: res.statusCode,
            ts: Date.now(),
          });
        });
      }
      if (reqPath === '/api/notifications/stream') {
        activeStreams += 1;
        maxConcurrentStreams = Math.max(maxConcurrentStreams, activeStreams);
        res.once('close', () => {
          activeStreams = Math.max(0, activeStreams - 1);
        });
      }
      next();
    });

    const { auditLogMiddleware } = require(
      path.join(root, 'backend/src/core/middleware/auditLogMiddleware')
    );
    app.use(auditLogMiddleware);

    // Mount all real Express API routes matching backend/index.js
    const routeMounts = [
      ['/api/auth', 'backend/src/modules/auth/auth.routes'],
      ['/api/github', 'backend/src/modules/github/github.routes'],
      ['/api/resume', 'backend/src/modules/resume/resume.routes'],
      ['/api/analysis', 'backend/src/modules/workflows/analysis.routes'],
      ['/api/dashboard', 'backend/src/modules/dashboard/dashboard.routes'],
      ['/api/super-admin', 'backend/src/modules/super-admin/routes/super-admin.routes'],
      ['/api/skillgap', 'backend/src/modules/skill-gap/skillgap.routes'],
      ['/api/recommendations', 'backend/src/modules/recommendations/recommendations.routes'],
      ['/api/profile', 'backend/src/modules/profile/profile.routes'],
      ['/api/courses', 'backend/src/modules/courses/courseRoutes'],
      ['/api/jobs', 'backend/src/modules/jobs/jobRoutes'],
      ['/api/notifications', 'backend/src/modules/notifications/notification.routes'],
      ['/api/audit-logs', 'backend/src/modules/admin/routes/audit.routes'],
      ['/api/workflows', 'backend/src/modules/workflows/workflow.routes'],
      ['/api/ai-versions', 'backend/src/modules/super-admin/routes/aiversions.routes'],
      ['/api/tenant', 'backend/src/modules/admin/routes/tenant.routes'],
      ['/api/skill-graph', 'backend/src/modules/skill-gap/skillgraph.routes'],
      ['/api/integrations', 'backend/src/modules/integrations/integrations.routes'],
      ['/api/simulator', 'backend/src/modules/scenario-simulator/scenarioSimulator.routes'],
      ['/api/public-profiles', 'backend/src/modules/public-portfolio/publicProfile.routes'],
      ['/api/recruiter', 'backend/src/modules/recruiter/routes/recruiter.routes'],
      ['/api/recruiter-hub', 'backend/src/modules/recruiter/routes/hub/recruiterHubRoutes'],
      ['/api/admin', 'backend/src/modules/admin/routes/admin.routes'],
      ['/api/admin-console', 'backend/src/modules/admin/routes/adminConsole.routes'],
      ['/api/weekly-reports', 'backend/src/modules/weekly-reports/weeklyReport.routes'],
      ['/api/interview-prep', 'backend/src/modules/interview-prep/interviewPrep.routes'],
      ['/api/career-sprints', 'backend/src/modules/career-sprint/careerSprint.routes'],
      ['/api/news', 'backend/src/modules/news/newsRoutes'],
      ['/api/support', 'backend/src/modules/support/support.routes'],
      ['/api/preview', 'backend/src/modules/workflows/preview.routes'],
    ];
    for (const [mountPath, relModule] of routeMounts) {
      app.use(mountPath, require(path.join(root, relModule)));
    }

    // Serve real compiled Angular static assets + SPA HTML fallback
    app.use(express.static(distDir));
    app.use((req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ message: 'Unknown QA API route.' });
      }
      return res.sendFile(path.join(distDir, 'index.html'));
    });

    for (const model of Object.values(mongoose.models)) {
      await model.createCollection();
      await model.createIndexes();
    }

    await settingsService.startSettingsSynchronization();
    await settingsService.updateSettings({
      organization: { recruiterLimitPerOrg: 5, maxTeamsPerOrganization: 4 },
      recruiter: { enableRecruiterAccess: true, candidateVisibility: 'public' },
    });

    const passwordHash = await bcrypt.hash('QaTest!Pass123', 6);
    let userSerial = 0;
    const createAccount = (name, role, extra = {}) =>
      User.create({
        name,
        email: `qa-${++userSerial}-${role}@fictional.qa.test`,
        password: passwordHash,
        role,
        isActive: true,
        isVerified: true,
        emailVerified: true,
        providers: ['local'],
        ...extra,
      });

    // Primary admins and organizations
    const adminOwnerA = await createAccount('Alpha Owner Admin', 'admin');
    const secondAdminA = await createAccount('Alpha Secondary Admin', 'admin');
    const foreignAdminB = await createAccount('Beta Owner Admin', 'admin');
    const adminSuspended = await createAccount('Gamma Suspended Admin', 'admin');

    const orgA = await Organization.create({
      name: 'Alpha Governance Control Org',
      slug: 'alpha-governance-control-org',
      description: 'Independent QA organization alpha',
      industry: 'Enterprise Software',
      website: 'https://alpha.qa.example.test',
      timezone: 'America/New_York',
      branding: { logoUrl: 'https://assets.qa.example.test/valid-logo.png' },
      ownerId: adminOwnerA._id,
      createdBy: adminOwnerA._id,
    });
    const orgB = await Organization.create({
      name: 'Beta Isolated Org',
      slug: 'beta-isolated-org',
      ownerId: foreignAdminB._id,
      createdBy: foreignAdminB._id,
    });
    const orgSuspended = await Organization.create({
      name: 'Gamma Suspended Org',
      slug: 'gamma-suspended-org',
      ownerId: adminSuspended._id,
      createdBy: adminSuspended._id,
      isSuspended: true,
    });

    adminOwnerA.organizationId = orgA._id;
    secondAdminA.organizationId = orgA._id;
    foreignAdminB.organizationId = orgB._id;
    adminSuspended.organizationId = orgSuspended._id;
    await Promise.all([
      adminOwnerA.save(),
      secondAdminA.save(),
      foreignAdminB.save(),
      adminSuspended.save(),
    ]);

    const affiliationAdminA = await createAccount('Affiliated Only Admin', 'admin', {
      organizationId: orgA._id,
    });
    const revokedDirectAdminA = await createAccount('Revoked Direct Admin', 'admin', {
      organizationId: orgA._id,
    });
    const orgManagerA = await createAccount('Org Direct Manager', 'developer', {
      organizationId: orgA._id,
      isPublic: false,
    });
    const recOwnerA = await createAccount('Recruiter Job Owner', 'recruiter', {
      organizationId: orgA._id,
    });
    const recTeamMgrA = await createAccount('Recruiter Team Manager', 'recruiter', {
      organizationId: orgA._id,
    });
    const recTeamAdminA = await createAccount('Recruiter Team AdminRole', 'recruiter', {
      organizationId: orgA._id,
    });
    const recTeamMemberA = await createAccount('Recruiter Team Member', 'recruiter', {
      organizationId: orgA._id,
    });
    const inactiveRecruiterA = await createAccount('Inactive Recruiter', 'recruiter', {
      organizationId: orgA._id,
      isActive: false,
    });
    const foreignRecruiterB = await createAccount('Beta Foreign Recruiter', 'recruiter', {
      organizationId: orgB._id,
    });
    const publicDev = await createAccount('Public Showcase Developer', 'developer', {
      isPublic: true,
      githubUsername: 'qa-public-dev',
      activeGithubUsername: 'qa-public-dev',
      careerStack: 'Full Stack',
      skills: ['TypeScript', 'Node.js', 'Angular'],
      readinessScore: 84,
    });
    const publicDev2 = await createAccount('Second Public Showcase Dev', 'developer', {
      isPublic: true,
      githubUsername: 'qa-public-dev-2',
      activeGithubUsername: 'qa-public-dev-2',
      careerStack: 'Backend',
      skills: ['Node.js', 'TypeScript', 'MongoDB'],
      readinessScore: 79,
    });
    const privateApplicant = await createAccount('Private Direct Applicant', 'developer', {
      isPublic: false,
    });
    const inviteRecipient = await createAccount('Pending Invite Candidate', 'developer', {
      isPublic: false,
    });
    const superAdminUser = await createAccount('Platform Super Admin', 'super_admin', {
      organizationId: orgA._id,
    });

    await PublicProfile.create({
      userId: publicDev._id,
      slug: 'qa-public-dev',
      headline: 'Full Stack Engineer',
      summary: 'Public showcase developer for P1.6C.3 QA',
      skills: [
        { name: 'TypeScript', score: 92 },
        { name: 'Node.js', score: 88 },
        { name: 'Angular', score: 85 },
      ],
      isPublic: true,
      socialLinks: { github: 'https://github.com/qa-public-dev' },
    });
    await PublicProfile.create({
      userId: publicDev2._id,
      slug: 'qa-public-dev-2',
      headline: 'Backend Engineer',
      summary: 'Second public showcase developer for P1.6C.3 comparison QA',
      skills: [
        { name: 'Node.js', score: 90 },
        { name: 'TypeScript', score: 84 },
      ],
      isPublic: true,
      socialLinks: { github: 'https://github.com/qa-public-dev-2' },
    });

    // Teams in Org A (2 active + 1 inactive) and Org B
    const teamA1 = await Team.create({
      organizationId: orgA._id,
      name: 'Platform Engineering & Responsible Hiring Team',
      slug: 'platform-eng-hiring',
      createdBy: adminOwnerA._id,
      isActive: true,
    });
    const teamA2 = await Team.create({
      organizationId: orgA._id,
      name: 'Security Architecture Guild',
      slug: 'security-guild',
      createdBy: adminOwnerA._id,
      isActive: true,
    });
    const teamA3Inactive = await Team.create({
      organizationId: orgA._id,
      name: 'Legacy Archived Hiring Cell',
      slug: 'legacy-archived-cell',
      createdBy: adminOwnerA._id,
      isActive: false,
    });
    const teamB1 = await Team.create({
      organizationId: orgB._id,
      name: 'Beta Hiring Team',
      slug: 'beta-hiring',
      createdBy: foreignAdminB._id,
      isActive: true,
    });

    await Membership.create([
      { organizationId: orgA._id, userId: adminOwnerA._id, role: 'admin', status: 'active' },
      { organizationId: orgA._id, userId: secondAdminA._id, role: 'admin', status: 'active' },
      { organizationId: orgA._id, userId: revokedDirectAdminA._id, role: 'admin', status: 'disabled' },
      { organizationId: orgA._id, userId: orgManagerA._id, role: 'manager', status: 'active' },
      { organizationId: orgB._id, userId: foreignAdminB._id, role: 'admin', status: 'active' },
      { organizationId: orgSuspended._id, userId: adminSuspended._id, role: 'admin', status: 'active' },
      { organizationId: orgB._id, userId: foreignRecruiterB._id, role: 'member', status: 'active' },
      {
        organizationId: orgB._id,
        userId: foreignRecruiterB._id,
        teamId: teamB1._id,
        role: 'member',
        status: 'active',
      },

      // Org A Recruiters direct + team memberships (recTeamMgrA spans TWO teams for deduplication check)
      { organizationId: orgA._id, userId: recOwnerA._id, role: 'member', status: 'active' },
      {
        organizationId: orgA._id,
        userId: recOwnerA._id,
        teamId: teamA1._id,
        role: 'member',
        status: 'active',
      },
      { organizationId: orgA._id, userId: recTeamMgrA._id, role: 'member', status: 'active' },
      {
        organizationId: orgA._id,
        userId: recTeamMgrA._id,
        teamId: teamA1._id,
        role: 'manager',
        status: 'active',
      },
      {
        organizationId: orgA._id,
        userId: recTeamMgrA._id,
        teamId: teamA2._id,
        role: 'member',
        status: 'active',
      },
      { organizationId: orgA._id, userId: recTeamAdminA._id, role: 'member', status: 'active' },
      {
        organizationId: orgA._id,
        userId: recTeamAdminA._id,
        teamId: teamA1._id,
        role: 'admin',
        status: 'active',
      },
      { organizationId: orgA._id, userId: recTeamMemberA._id, role: 'member', status: 'active' },
      {
        organizationId: orgA._id,
        userId: recTeamMemberA._id,
        teamId: teamA1._id,
        role: 'member',
        status: 'active',
      },
      {
        organizationId: orgA._id,
        userId: recTeamMemberA._id,
        teamId: teamA2._id,
        role: 'member',
        status: 'active',
      },
      { organizationId: orgA._id, userId: inactiveRecruiterA._id, role: 'member', status: 'disabled' },
    ]);

    // Scale internal directory >200 members (excluded from public developers, tests cap + paging + filters)
    const scaleUsers = Array.from({ length: 205 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      name: `Directory Member ${String(i).padStart(3, '0')}`,
      email: `dir-member-${String(i).padStart(3, '0')}@fictional.qa.test`,
      role: 'developer',
      isActive: i % 10 !== 0,
      isPublic: false,
      isVerified: true,
      organizationId: orgA._id,
    }));
    await User.collection.insertMany(scaleUsers);
    await Membership.insertMany(
      scaleUsers.map((u, i) => ({
        userId: u._id,
        organizationId: orgA._id,
        teamId: i % 5 === 0 ? teamA2._id : null,
        role: 'member',
        status: u.isActive ? 'active' : 'disabled',
      }))
    );

    // Jobs, Match, Shortlist, Private Direct Application
    const jobSharedA = await Job.create({
      organizationId: orgA._id,
      recruiterId: recOwnerA._id,
      teamId: teamA1._id,
      title: 'Shared Principal Systems Engineer',
      role: 'Systems Engineer',
      description: 'Build distributed services cleanly.',
      location: 'Remote',
      requiredSkills: ['TypeScript', 'Node.js'],
      status: 'open',
      published: true,
      teamShared: true,
      evaluationShared: true,
    });
    const jobPubA = await Job.create({
      organizationId: orgA._id,
      recruiterId: recOwnerA._id,
      title: 'Published Application Backend Role',
      role: 'Backend Engineer',
      description: 'Maintain API correctness and safety.',
      location: 'Remote',
      requiredSkills: ['Node.js'],
      status: 'open',
      published: true,
    });
    const jobB = await Job.create({
      organizationId: orgB._id,
      recruiterId: foreignRecruiterB._id,
      teamId: teamB1._id,
      title: 'Beta Confidential Engineer',
      role: 'Engineer',
      location: 'Remote',
      requiredSkills: ['Go'],
      status: 'open',
      published: true,
      teamShared: true,
      evaluationShared: true,
    });

    const matchA = await Match.create({
      organizationId: orgA._id,
      recruiterId: recOwnerA._id,
      teamId: teamA1._id,
      jobId: jobSharedA._id,
      candidateId: publicDev._id,
      matchScore: 81,
      status: 'generated',
    });

    const shortlistPublicA = await Shortlist.create({
      organizationId: orgA._id,
      recruiterId: recOwnerA._id,
      teamId: teamA1._id,
      jobId: jobSharedA._id,
      candidateId: publicDev._id,
      notes: 'Shared evaluation note on public developer',
      status: 'shortlisted',
    });

    const appBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const submittedAt = new Date('2026-10-01T12:00:00Z');
    const applicationId = createHash('sha256')
      .update(`${jobPubA._id}:${privateApplicant._id}`)
      .digest('hex');
    await JobApplication.collection.insertOne({
      _id: applicationId,
      organizationId: orgA._id,
      organizationName: orgA.name,
      recruiterId: recOwnerA._id,
      jobId: jobPubA._id,
      applicantId: privateApplicant._id,
      applicantName: privateApplicant.name,
      jobTitle: jobPubA.title,
      resume: {
        fileName: 'private-qa-resume.pdf',
        sha256: createHash('sha256').update(appBytes).digest('hex'),
      },
      resumeBytes: appBytes,
      portfolio: {
        headline: 'PRIVATE APPLICANT PORTFOLIO DO NOT LEAK',
        skills: ['TypeScript'],
        projects: [],
      },
      consent: { version: 'direct-apply-v1', submittedAt, sharePortfolio: true },
      status: 'submitted',
      history: [{ from: '', to: 'submitted', actorId: privateApplicant._id, at: submittedAt }],
      createdAt: submittedAt,
      updatedAt: submittedAt,
      __v: 0,
    });
    const shortlistPrivateAppA = await Shortlist.create({
      organizationId: orgA._id,
      recruiterId: recOwnerA._id,
      jobId: jobPubA._id,
      candidateId: privateApplicant._id,
      applicationId,
      notes: 'Private owner-only application evaluation note',
      status: 'shortlisted',
    });

    // Invitations spanning lifecycle states (+ revoked inviter regression invite)
    const tokenPendingValid = randomBytes(24).toString('hex');
    const tokenRevokedInviter = randomBytes(24).toString('hex');
    const tokenExpiredStillPending = randomBytes(24).toString('hex');
    const tokenAccepted = randomBytes(24).toString('hex');
    const tokenRevoked = randomBytes(24).toString('hex');

    const invitePendingValid = await Invitation.create({
      name: 'Valid Pending Invitee',
      organizationId: orgA._id,
      teamId: teamA1._id,
      email: 'pending-valid@fictional.qa.test',
      role: 'recruiter',
      token: tokenPendingValid,
      status: 'pending',
      invitedBy: adminOwnerA._id,
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    });
    const inviteByRevokedAdmin = await Invitation.create({
      name: 'Revoked Admin Invite',
      organizationId: orgA._id,
      email: 'revoked-admin-target@fictional.qa.test',
      role: 'recruiter',
      token: tokenRevokedInviter,
      status: 'pending',
      invitedBy: revokedDirectAdminA._id,
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    });
    const inviteExpiredByDate = await Invitation.create({
      name: 'Expired Pending Row',
      organizationId: orgA._id,
      email: 'expired-date@fictional.qa.test',
      role: 'recruiter',
      token: tokenExpiredStillPending,
      status: 'pending',
      invitedBy: adminOwnerA._id,
      expiresAt: new Date(Date.now() - 3600 * 1000),
    });
    await Invitation.create([
      {
        name: 'Already Accepted Invite',
        organizationId: orgA._id,
        email: 'accepted@fictional.qa.test',
        role: 'recruiter',
        token: tokenAccepted,
        status: 'accepted',
        invitedBy: adminOwnerA._id,
        acceptedBy: recTeamMemberA._id,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
      {
        name: 'Manually Revoked Invite',
        organizationId: orgA._id,
        email: 'revoked@fictional.qa.test',
        role: 'recruiter',
        token: tokenRevoked,
        status: 'revoked',
        invitedBy: adminOwnerA._id,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    ]);

    // Seed Notifications for navigation verification
    await Notification.create([
      {
        userId: adminOwnerA._id,
        organizationId: orgA._id,
        type: 'system',
        title: 'Console Preferences Notice',
        message: 'Check dashboard preferences via legacy console target.',
        meta: { target: '/app/admin/console?tab=preferences' },
      },
      {
        userId: adminOwnerA._id,
        organizationId: orgA._id,
        type: 'info',
        title: 'Organization Canonical Notice',
        message: 'Direct target to /app/admin/organization.',
        meta: { target: '/app/admin/organization' },
      },
    ]);

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;

    const chromeExe = [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ].find((p) => fs.existsSync(p));
    browser = await loadPlaywright().chromium.launch({
      headless: true,
      ...(chromeExe ? { executablePath: chromeExe } : {}),
    });

    async function api(route, { actor = adminOwnerA, method, body, headers = {} } = {}) {
      const m = method || (body === undefined ? 'GET' : 'POST');
      const res = await fetch(origin + route, {
        method: m,
        headers: {
          'Content-Type': 'application/json',
          ...(actor ? { Authorization: `Bearer ${sign(actor)}` } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(25000),
      });
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json')
        ? await res.json().catch(() => null)
        : Buffer.from(await res.arrayBuffer());
      return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
    }

    async function openSession(
      actor,
      org = orgA,
      {
        width = 1440,
        height = 900,
        theme = 'light',
        scheme = 'light',
        reducedMotion = 'reduce',
        expectedFault = false,
      } = {}
    ) {
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: scheme,
        reducedMotion,
      });
      await context.addInitScript(
        ({ token, userPayload, organization, selectedTheme }) => {
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(userPayload));
          localStorage.setItem('loginExpiry', String(Date.now() + 7200000));
          if (organization) {
            localStorage.setItem(
              'devinsight_tenant_context',
              JSON.stringify({
                organizationId: organization.id,
                organizationName: organization.name,
                myRole:
                  userPayload.role === 'admin'
                    ? 'admin'
                    : userPayload.role === 'recruiter'
                      ? 'member'
                      : '',
                teamId: '',
                teamName: '',
              })
            );
          } else {
            localStorage.removeItem('devinsight_tenant_context');
          }
          localStorage.setItem('devinsight_theme', selectedTheme);
          localStorage.setItem('devinsight_resume_prompt_permanent_dismiss', 'true');
        },
        {
          token: sign(actor),
          userPayload: {
            _id: String(actor._id),
            name: actor.name,
            email: actor.email,
            role: actor.role,
            organizationId: org ? String(org._id) : null,
            organizationName: org ? org.name : '',
            isVerified: true,
          },
          organization: org ? { id: String(org._id), name: org.name } : null,
          selectedTheme: theme,
        }
      );

      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const telemetry = {
        consoleErrors: [],
        runtimeErrors: [],
        httpErrors: [],
        apiCalls: [],
        expectedFault,
      };

      // Serve fake external branding images offline + prevent external CDN stalls; NEVER mock own-origin API.
      await page.route('**/*', (route) => {
        const reqUrl = new URL(route.request().url());
        if (reqUrl.origin === origin) return route.continue();
        assert.ok(
          !reqUrl.pathname.startsWith('/api/'),
          `QA rule violation: attempted non-origin /api interception for ${reqUrl.href}`
        );
        if (reqUrl.href === 'https://assets.qa.example.test/valid-logo.png') {
          return route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: QA_BRANDING_SVG,
          });
        }
        if (reqUrl.href === 'https://assets.qa.example.test/broken-logo.png') {
          return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' });
        }
        return route.fulfill({
          status: 200,
          contentType:
            route.request().resourceType() === 'stylesheet' ? 'text/css' : 'text/plain',
          body: '',
        });
      });

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (text.includes('Content Security Policy')) cspViolations.push(text);
          if (!telemetry.expectedFault) telemetry.consoleErrors.push(text);
        }
      });
      page.on('pageerror', (err) => telemetry.runtimeErrors.push(err.message));
      page.on('response', (res) => {
        const url = res.url();
        if (url.startsWith(origin + '/api/')) {
          const entry = {
            path: new URL(url).pathname,
            status: res.status(),
            method: res.request().method(),
          };
          telemetry.apiCalls.push(entry);
          if (res.status() >= 400 && !telemetry.expectedFault) {
            telemetry.httpErrors.push(entry);
          }
        }
      });

      return { context, page, telemetry };
    }

    async function waitSettled(page) {
      await page.waitForFunction(() => {
        const hasShellOrHeading = Boolean(
          document.querySelector('main h1, aside#application-navigation a[href], form input')
        );
        if (!hasShellOrHeading) return false;
        if (document.querySelector('[aria-busy="true"]')) return false;
        if (document.querySelector('app-recruiter-loader')) return false;
        const text = document.body?.innerText || '';
        if (
          text.includes('Checking organization permissions') ||
          text.includes('Loading organization information') ||
          text.includes('Refreshing…') ||
          text.includes('Loading policies') ||
          text.includes('Loading members') ||
          text.includes('Loading invitations')
        ) {
          return false;
        }
        return true;
      });
      await page.waitForTimeout(220);
    }

    async function flushAudits() {
      await Promise.allSettled([...pendingAudits]);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    return {
      root,
      origin,
      screenshotsDir,
      outputDir,
      browser,
      settingsService,
      notificationStreams,
      POLICY_KEYS,
      models: {
        User,
        Organization,
        Membership,
        Team,
        Invitation,
        AuditLog,
        Job,
        Match,
        Shortlist,
        JobApplication,
        PublicProfile,
        Notification,
        PlatformSettings,
      },
      actors: {
        adminOwnerA,
        secondAdminA,
        foreignAdminB,
        adminSuspended,
        affiliationAdminA,
        revokedDirectAdminA,
        orgManagerA,
        recOwnerA,
        recTeamMgrA,
        recTeamAdminA,
        recTeamMemberA,
        inactiveRecruiterA,
        foreignRecruiterB,
        publicDev,
        publicDev2,
        privateApplicant,
        inviteRecipient,
        superAdminUser,
      },
      orgs: { orgA, orgB, orgSuspended },
      teams: { teamA1, teamA2, teamA3Inactive, teamB1 },
      fixtures: {
        jobSharedA,
        jobPubA,
        jobB,
        matchA,
        shortlistPublicA,
        shortlistPrivateAppA,
        applicationId,
        invitePendingValid,
        inviteByRevokedAdmin,
        inviteExpiredByDate,
        tokens: {
          tokenPendingValid,
          tokenRevokedInviter,
          tokenExpiredStillPending,
          tokenAccepted,
          tokenRevoked,
        },
      },
      sign,
      api,
      openSession,
      waitSettled,
      flushAudits,
      getTelemetry: () => ({
        emailAttemptCount: emailAttemptLog.length,
        emailAttemptLog,
        auditWriteErrors,
        cspViolations,
        maxConcurrentStreams,
        requestCount: requestLog.length,
        requestLog,
      }),
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

module.exports = { startRealStackHarness };
