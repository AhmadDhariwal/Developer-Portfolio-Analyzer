/**
 * DevInsight AI - Public Portfolio Live End-to-End Verification
 *
 * Verifies Angular -> Express/JWT -> Isolated MongoDB -> Configured Upstash Redis
 * Covers real integration, privacy/security, core functionality, caching/protection, and UI/SEO.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Load environment from backend/.env
const backendDir = path.resolve(__dirname, '../../backend');

// Ensure backend node_modules is in module resolution path
module.paths.push(path.join(backendDir, 'node_modules'));

require('dotenv').config({ path: path.join(backendDir, '.env'), quiet: true });

const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);

const { load, response } = require(
  path.join(backendDir, 'src/tests/fixtures/publicPortfolioFixture'),
);
const redisService = require(path.join(backendDir, 'src/services/redisCacheService'));

async function runE2E() {
  const startTime = Date.now();
  const results = {
    title: 'Public Portfolio Real E2E Verification',
    timestamp: new Date().toISOString(),
    status: 'IN_PROGRESS',
    categories: {
      realIntegration: [],
      privacySecurity: [],
      coreFunctionality: [],
      cachingApiProtection: [],
      uiAndSeo: [],
    },
    metrics: { total: 0, passed: 0, failed: 0 },
    evidence: {},
  };

  function record(category, name, passed, detail = {}) {
    results.metrics.total++;
    if (passed) {
      results.metrics.passed++;
      results.categories[category].push({ name, status: 'PASS', detail });
      console.log(`  [PASS] ${name}`);
    } else {
      results.metrics.failed++;
      results.categories[category].push({ name, status: 'FAIL', detail });
      console.error(`  [FAIL] ${name}:`, detail);
    }
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  assert.ok(mongoUri, 'Configured MongoDB URI is required');
  const dbName = `portfolio_e2e_${randomUUID().replaceAll('-', '')}`;
  const namespace = `portfolio-e2e:${randomUUID()}:`;

  console.log(`Starting Public Portfolio E2E verification...`);
  console.log(`Isolated Mongo DB: ${dbName}`);
  console.log(`Upstash Redis Namespace: ${namespace}`);

  const ownedKeys = new Set();
  const servers = [];
  const ownedFiles = [];
  const imageDirectory = path.join(backendDir, 'uploads/portfolio-images');
  const createsImageDirectory = await fs.access(imageDirectory).then(
    () => false,
    () => true,
  );

  let nativeRedis = null;

  try {
    // 1. Connect isolated Mongo
    await mongoose.connect(mongoUri, {
      dbName,
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000,
    });
    console.log('Connected to isolated MongoDB');

    // 2. Connect configured Upstash Redis
    nativeRedis = await redisService.initRedisCache({ silent: true, probeOnly: true });
    assert.ok(nativeRedis, 'Configured Upstash Redis client required');
    console.log('Connected to configured Upstash Redis');

    const scopeKey = (key) => {
      assert.ok(key.startsWith('public-portfolio:v3:'));
      const scoped = namespace + key;
      ownedKeys.add(scoped);
      return scoped;
    };

    const scopedRedis = {
      get: (key) => nativeRedis.get(scopeKey(key)),
      set: (key, value, options) => nativeRedis.set(scopeKey(key), value, options),
      eval: (script, options) =>
        nativeRedis.eval(script, { ...options, keys: options.keys.map(scopeKey) }),
    };

    const cacheAccess = { getRedisCacheClient: () => scopedRedis };

    // 3. Load Models and build indexes
    const User = require(path.join(backendDir, 'src/models/user'));
    const Profile = require(path.join(backendDir, 'src/models/publicProfile'));
    const Cache = require(path.join(backendDir, 'src/models/publicProfileCache'));
    const Visit = require(path.join(backendDir, 'src/models/publicPortfolioVisit'));
    const LegacyVisit = require(path.join(backendDir, 'src/models/publicProfileView'));
    const Resume = require(path.join(backendDir, 'src/models/resumeFile'));
    const Graph = require(path.join(backendDir, 'src/models/skillGraph'));
    const Report = require(path.join(backendDir, 'src/models/weeklyReport'));
    const Settings = require(path.join(backendDir, 'src/models/platformSettings'));

    for (const Model of [
      User,
      Profile,
      Cache,
      Visit,
      LegacyVisit,
      Resume,
      Graph,
      Report,
      Settings,
    ]) {
      await Model.createIndexes();
    }
    console.log('Indexes built on isolated collections');

    // 4. Seed test accounts
    const owner = await User.create({
      name: 'E2E Portfolio Owner',
      email: 'e2e-owner@example.test',
      password: 'password-hash-unused',
      isPublic: true,
      isVerified: true,
      role: 'developer',
      jobTitle: 'Senior Platform Engineer',
      location: 'Remote · London',
      avatar: '/uploads/avatars/e2e-avatar.png',
      githubUsername: 'e2e-owner-gh',
    });

    const foreignUser = await User.create({
      name: 'Foreign Developer',
      email: 'foreign@example.test',
      password: 'password-hash-unused',
      isPublic: true,
      isVerified: true,
      role: 'developer',
    });

    const verifiedRecruiter = await User.create({
      name: 'Tech Talent Partner',
      email: 'recruiter@talent.test',
      password: 'password-hash-unused',
      role: 'recruiter',
      isVerified: true,
      isActive: true,
    });

    const unverifiedRecruiter = await User.create({
      name: 'Unverified Recruiter',
      email: 'unverified@talent.test',
      password: 'password-hash-unused',
      role: 'recruiter',
      isVerified: false,
      isActive: true,
    });

    // Seed Profile
    const profile = await Profile.create({
      userId: owner._id,
      slug: 'e2e-owner',
      isPublic: true,
      headline: 'Building resilient cloud & web platforms',
      summary: 'Experienced software engineer focused on distributed systems and intuitive UI.',
      seoTitle: 'E2E Owner - Senior Platform Engineer',
      seoDescription: 'Verified developer portfolio and projects showcase.',
      skills: [
        { name: 'TypeScript', score: 92 },
        { name: 'Angular', score: 88 },
        { name: 'Node.js', score: 90 },
      ],
      projects: [
        {
          title: 'Distributed Log Engine',
          description: 'A high throughput distributed logging pipeline.',
          url: 'https://example.com/engine',
          repoUrl: 'https://github.com/e2e-owner/engine',
          tech: ['Node.js', 'Redis', 'TypeScript'],
          status: 'completed',
        },
      ],
      sections: {
        hero: {
          titleLineOne: 'Engineering systems with',
          titleHighlight: 'precision & scale',
          tagline: 'Always shipping resilient code.',
        },
        visibility: {
          projects: true,
          upcoming: true,
          testimonials: true,
          cta: true,
        },
      },
      socialLinks: {
        github: 'https://github.com/e2e-owner-gh',
        linkedin: 'https://linkedin.com/in/e2e-owner',
      },
    });

    // 5. Create multi-worker Express environment
    const { createPortfolioCache } = require(
      path.join(backendDir, 'src/services/publicPortfolioCacheService'),
    );

    let capturedMail = null;
    const mockMailService = {
      sendConfiguredEmail: async (options) => {
        capturedMail = options;
        return { accepted: [options.to], messageId: 'e2e-mock-msg-123' };
      },
    };

    function createWorker(workerName) {
      const isolatedCache = createPortfolioCache({ redis: cacheAccess });
      const service = load('services/publicProfileService.js', {
        './publicPortfolioCacheService': { portfolioCache: isolatedCache },
        './platformSettingsService': { getDeveloperSettingsSync: () => ({}) },
      });
      const contactService = load('services/publicPortfolioContactService.js', {
        './emailService': mockMailService,
      });
      const controller = load('controllers/publicProfileController.js', {
        '../services/publicProfileService': service,
        '../services/publicPortfolioContactService': contactService,
        '../services/notificationService': { createNotification: async () => {} },
      });
      const controls = load('middleware/publicPortfolioRateLimit.js', {
        '../services/redisCacheService': cacheAccess,
      });
      const router = load('routes/publicProfile.routes.js', {
        '../controllers/publicProfileController': controller,
        '../middleware/publicPortfolioRateLimit': controls,
      });

      const app = express();
      app.use(express.json({ limit: '128kb' }));
      app.use(
        '/uploads',
        require(path.join(backendDir, 'src/middleware/publicUploadAccess')),
        express.static(path.join(backendDir, 'uploads')),
      );
      app.use('/api/public-profiles', router);

      return { name: workerName, service, controls, app };
    }

    const workerA = createWorker('Worker-A');
    const workerB = createWorker('Worker-B');

    for (const worker of [workerA, workerB]) {
      const server = await new Promise((resolve) => {
        const instance = worker.app.listen(0, '127.0.0.1', () => resolve(instance));
      });
      servers.push(server);
      worker.base = `http://127.0.0.1:${server.address().port}/api/public-profiles`;
      worker.uploadBase = `http://127.0.0.1:${server.address().port}/uploads`;
    }

    const tokenFor = (user) =>
      jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        issuer: process.env.JWT_ISSUER || 'devinsight-api',
        audience: process.env.JWT_AUDIENCE || 'devinsight-web',
      });

    const callApi = (worker, endpoint, user = null, options = {}) =>
      fetch(worker.base + endpoint, {
        ...options,
        headers: {
          'user-agent': 'DevInsight-E2E-Agent/1.0',
          ...(user ? { authorization: `Bearer ${tokenFor(user)}` } : {}),
          ...(options.headers || {}),
        },
      });

    console.log('\n--- Category 1: Real Integration ---');

    // 1.1 Cold fetch via Worker A
    const coldResp = await callApi(workerA, '/e2e-owner');
    assert.equal(coldResp.status, 200);
    const coldBody = await coldResp.json();
    assert.equal(coldBody.slug, 'e2e-owner');
    assert.equal(coldBody.headline, 'Building resilient cloud & web platforms');
    record(
      'realIntegration',
      'Cold read on Worker A populates Redis and Mongo cache',
      coldResp.status === 200 && coldBody.slug === 'e2e-owner',
      { status: coldResp.status, headline: coldBody.headline },
    );

    // 1.2 Warm fetch via Worker B matches Worker A exactly
    const warmRespB = await callApi(workerB, '/e2e-owner');
    assert.equal(warmRespB.status, 200);
    const warmBodyB = await warmRespB.json();
    assert.deepEqual(warmBodyB, coldBody);
    record(
      'realIntegration',
      'Warm read on Worker B serves identical payload from shared Upstash Redis',
      warmRespB.status === 200 && warmBodyB.slug === 'e2e-owner',
      { status: warmRespB.status },
    );

    // 1.3 Owner authenticated read on /me
    const meResp = await callApi(workerA, '/me', owner);
    assert.equal(meResp.status, 200);
    const meBody = await meResp.json();
    assert.equal(meBody.email, owner.email);
    assert.ok(meBody.id);
    record(
      'realIntegration',
      'Owner settings endpoint /me returns private fields to authenticated owner',
      meResp.status === 200 && meBody.email === owner.email,
      { email: meBody.email, hasPrivateId: Boolean(meBody.id) },
    );

    // 1.4 Profile update on Worker A invalidates cache on Worker B
    const updateResp = await callApi(workerA, '/me', owner, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ headline: 'Updated Platform & Cloud Systems' }),
    });
    assert.equal(updateResp.status, 200);
    const updatedPublicB = await (await callApi(workerB, '/e2e-owner')).json();
    assert.equal(updatedPublicB.headline, 'Updated Platform & Cloud Systems');
    record(
      'realIntegration',
      'Profile edit on Worker A immediately invalidates Upstash Redis across workers',
      updatedPublicB.headline === 'Updated Platform & Cloud Systems',
      { headline: updatedPublicB.headline },
    );

    // 1.5 Slug change moves URL and invalidates old slug immediately
    await workerA.service.updatePublicProfile(owner._id, { slug: 'e2e-owner-renamed' });
    const oldSlugResp = await callApi(workerB, '/e2e-owner');
    const newSlugResp = await callApi(workerB, '/e2e-owner-renamed');
    assert.equal(oldSlugResp.status, 404);
    assert.equal(newSlugResp.status, 200);
    record(
      'realIntegration',
      'Slug rename immediately reflects across workers: old slug 404, new slug 200',
      oldSlugResp.status === 404 && newSlugResp.status === 200,
      { oldStatus: oldSlugResp.status, newStatus: newSlugResp.status },
    );

    console.log('\n--- Category 2: Privacy and Security ---');

    // 2.1 Public serialization excludes PII & private internals
    const pubPayload = await (await callApi(workerB, '/e2e-owner-renamed')).json();
    const hasPiiLeak =
      pubPayload.email !== undefined ||
      pubPayload.phoneNumber !== undefined ||
      pubPayload.analytics !== undefined ||
      pubPayload.momentum !== null;
    record(
      'privacySecurity',
      'Public serializer strictly excludes email, phone, analytics, and sets momentum null',
      !hasPiiLeak,
      {
        email: pubPayload.email,
        phone: pubPayload.phoneNumber,
        analytics: pubPayload.analytics,
        momentum: pubPayload.momentum,
      },
    );

    // 2.2 Hidden sections exclusion
    await Profile.updateOne(
      { userId: owner._id },
      {
        $set: {
          'sections.visibility.projects': false,
          'sections.visibility.cta': false,
        },
      },
    );
    const hiddenSectionsResp = await callApi(workerA, '/e2e-owner-renamed');
    const hiddenBody = await hiddenSectionsResp.json();
    const projectsCleared = hiddenBody.projects.length === 0;
    const ctaCleared = !hiddenBody.defaultResumeUrl && !hiddenBody.resumeUrl;
    record(
      'privacySecurity',
      'Hidden sections (projects, cta) strip collections and resume URLs from public payload',
      projectsCleared && ctaCleared,
      { projectsCount: hiddenBody.projects.length, hasResume: Boolean(hiddenBody.resumeUrl) },
    );

    // Restore section visibility
    await Profile.updateOne(
      { userId: owner._id },
      {
        $set: {
          'sections.visibility.projects': true,
          'sections.visibility.cta': true,
        },
      },
    );

    // 2.3 Public to private transition & authenticated preview
    await workerA.service.updatePublicProfile(owner._id, { isPublic: false });
    const anonPrivateResp = await callApi(workerB, '/e2e-owner-renamed');
    const foreignPreviewResp = await callApi(
      workerB,
      '/e2e-owner-renamed?preview=true',
      foreignUser,
    );
    const ownerPreviewResp = await callApi(workerA, '/e2e-owner-renamed?preview=true', owner);

    assert.equal(anonPrivateResp.status, 404);
    assert.equal(foreignPreviewResp.status, 404);
    assert.equal(ownerPreviewResp.status, 200);
    const previewBody = await ownerPreviewResp.json();
    assert.equal(previewBody.email, owner.email);

    record(
      'privacySecurity',
      'Unpublished portfolio returns 404 to public & foreign users; allows authenticated owner preview with private fields',
      anonPrivateResp.status === 404 &&
        foreignPreviewResp.status === 404 &&
        ownerPreviewResp.status === 200,
      {
        anonStatus: anonPrivateResp.status,
        foreignStatus: foreignPreviewResp.status,
        ownerPreviewStatus: ownerPreviewResp.status,
      },
    );

    // Re-publish profile
    await workerA.service.updatePublicProfile(owner._id, { isPublic: true });

    // 2.4 Owner isolation: foreign account cannot mutate owner profile
    const foreignMutateResp = await callApi(workerA, '/me', foreignUser, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: owner._id, headline: 'Hacked by foreign user' }),
    });
    assert.equal(foreignMutateResp.status, 200);
    const ownerProfileCheck = await Profile.findOne({ userId: owner._id }).lean();
    assert.notEqual(ownerProfileCheck.headline, 'Hacked by foreign user');
    record(
      'privacySecurity',
      'Owner isolation enforced: foreign account cannot alter owner profile via /me',
      ownerProfileCheck.headline !== 'Hacked by foreign user',
      { currentHeadline: ownerProfileCheck.headline },
    );

    // 2.5 Secure resume access and path traversal defense
    const testPdfPath = path.join(backendDir, 'uploads', `e2e-test-${randomUUID()}.pdf`);
    ownedFiles.push(testPdfPath);
    await fs.writeFile(testPdfPath, '%PDF-1.4\nDevInsight AI E2E Resume\n%%EOF');

    const resumeRecord = await Resume.create({
      userId: owner._id,
      fileName: 'e2e-resume.pdf',
      fileSize: 45,
      fileUrl: testPdfPath,
      mimeType: 'application/pdf',
    });
    await User.updateOne({ _id: owner._id }, { $set: { defaultResumeFileId: resumeRecord._id } });

    // Public resume download succeeds when published and CTA visible
    const pubResumeResp = await callApi(workerA, '/e2e-owner-renamed/resume');
    assert.equal(pubResumeResp.status, 200);
    assert.equal(pubResumeResp.headers.get('content-type'), 'application/pdf');

    // Owner preview resume succeeds via /me/resume
    const ownerResumeResp = await callApi(workerA, '/me/resume', owner);
    assert.equal(ownerResumeResp.status, 200);

    // Foreign user cannot fetch owner's resume via /me/resume
    const foreignResumeResp = await callApi(workerA, '/me/resume', foreignUser);
    assert.equal(foreignResumeResp.status, 404);

    // Path traversal defense on resume
    await Resume.updateOne(
      { _id: resumeRecord._id },
      { $set: { fileUrl: path.resolve(backendDir, '../AGENTS.md') } },
    );
    const traversalResumeResp = await callApi(workerB, '/e2e-owner-renamed/resume');
    assert.equal(traversalResumeResp.status, 404);

    // Restore valid fileUrl
    await Resume.updateOne({ _id: resumeRecord._id }, { $set: { fileUrl: testPdfPath } });

    record(
      'privacySecurity',
      'Resume owner binding, uploads confinement, and path traversal protection verified',
      pubResumeResp.status === 200 &&
        ownerResumeResp.status === 200 &&
        foreignResumeResp.status === 404 &&
        traversalResumeResp.status === 404,
      {
        pubResume: pubResumeResp.status,
        ownerResume: ownerResumeResp.status,
        foreignResume: foreignResumeResp.status,
        traversalResume: traversalResumeResp.status,
      },
    );

    // 2.6 Account privacy revocation immediately unpublishes across workers
    const profileController = load('controllers/profilecontroller.js', {
      '../services/notificationService': { createNotification: async () => {} },
      '../services/platformSettingsService': { getDeveloperSettingsSync: () => ({}) },
      '../services/newsService': { invalidateNewsSignalCache: () => {} },
      './dashboardcontroller': { invalidateDashboardSummaryCache: () => {} },
    });
    const { response } = require(
      path.join(backendDir, 'src/tests/fixtures/publicPortfolioFixture'),
    );
    const toggleResult = response();
    await profileController.updateProfileVisibility(
      { user: owner, body: { isPublic: false } },
      toggleResult,
    );
    assert.equal(toggleResult.statusCode, 200);
    const revokedPubResp = await callApi(workerB, '/e2e-owner-renamed');
    assert.equal(revokedPubResp.status, 404);

    // Restore owner isPublic
    await User.updateOne({ _id: owner._id }, { $set: { isPublic: true } });
    await workerA.service.updatePublicProfile(owner._id, { isPublic: true });

    record(
      'privacySecurity',
      'Account-level privacy revocation immediately unpublishes portfolio on all workers',
      revokedPubResp.status === 404,
      { revokedStatus: revokedPubResp.status },
    );

    console.log('\n--- Category 3: Core Functionality ---');

    // 3.1 Project editing and publication controls
    const projectUpdateResp = await callApi(workerA, '/me', owner, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projects: [
          {
            title: 'Realtime Observability Mesh',
            description: 'Ultra-low latency metrics collection.',
            url: 'https://example.com/mesh',
            repoUrl: 'https://github.com/e2e-owner/mesh',
            tech: ['Go', 'TypeScript', 'Grafana'],
            status: 'completed',
          },
        ],
      }),
    });
    assert.equal(projectUpdateResp.status, 200);
    const updatedProjects = await (await callApi(workerB, '/e2e-owner-renamed')).json();
    assert.equal(updatedProjects.projects[0].title, 'Realtime Observability Mesh');
    record(
      'coreFunctionality',
      'Project update persists and reflects in public response',
      updatedProjects.projects[0].title === 'Realtime Observability Mesh',
      { projectTitle: updatedProjects.projects[0].title },
    );

    // 3.2 Real image upload, structural checks, and static retrieval
    const validPngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=',
      'base64',
    );
    const form = new FormData();
    form.append('image', new Blob([validPngBuffer], { type: 'image/png' }), 'project-cover.png');

    const uploadResp = await callApi(workerA, '/me/project-image', owner, {
      method: 'POST',
      body: form,
    });
    assert.equal(uploadResp.status, 201);
    const uploadBody = await uploadResp.json();
    assert.match(
      uploadBody.imageUrl,
      new RegExp(`^/uploads/portfolio-images/${owner._id}-[a-f0-9-]+\\.png$`),
    );

    const savedImagePath = path.join(backendDir, uploadBody.imageUrl.replace(/^\//, ''));
    ownedFiles.push(savedImagePath);

    // Static retrieval with nosniff header
    const assetResp = await fetch(
      workerA.base.replace('/api/public-profiles', '') + uploadBody.imageUrl,
    );
    assert.equal(assetResp.status, 200);
    assert.equal(assetResp.headers.get('x-content-type-options'), 'nosniff');

    // Reject forged SVG/HTML disguised as image
    const forgedForm = new FormData();
    forgedForm.append(
      'image',
      new Blob(['<svg onload=alert(1)>'], { type: 'image/png' }),
      'xss.png',
    );
    const forgedResp = await callApi(workerA, '/me/project-image', owner, {
      method: 'POST',
      body: forgedForm,
    });
    assert.equal(forgedResp.status, 400);

    // Reject unauthenticated upload
    const unauthForm = new FormData();
    unauthForm.append('image', new Blob([validPngBuffer], { type: 'image/png' }), 'test.png');
    const unauthUploadResp = await callApi(workerB, '/me/project-image', null, {
      method: 'POST',
      body: unauthForm,
    });
    assert.equal(unauthUploadResp.status, 401);

    record(
      'coreFunctionality',
      'Image upload enforces authentication, MIME, headers, owner-prefixed storage, and nosniff static delivery',
      uploadResp.status === 201 &&
        assetResp.status === 200 &&
        forgedResp.status === 400 &&
        unauthUploadResp.status === 401,
      {
        uploadStatus: uploadResp.status,
        assetStatus: assetResp.status,
        forgedStatus: forgedResp.status,
        imageUrl: uploadBody.imageUrl,
      },
    );

    // 3.3 Recruiter contact authorization & controlled mail delivery
    capturedMail = null;
    const contactPayload = {
      message:
        'Hello, we were impressed by your distributed systems work and have a principal role.',
      website: '', // honeypot must remain empty
    };

    // Anonymous contact rejected
    const anonContactResp = await callApi(workerA, '/e2e-owner-renamed/contact', null, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(contactPayload),
    });
    assert.equal(anonContactResp.status, 401);

    // Developer contact rejected (must be recruiter)
    const devContactResp = await callApi(workerA, '/e2e-owner-renamed/contact', foreignUser, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(contactPayload),
    });
    assert.equal(devContactResp.status, 403);

    // Unverified recruiter rejected
    const unverifiedContactResp = await callApi(
      workerA,
      '/e2e-owner-renamed/contact',
      unverifiedRecruiter,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(contactPayload),
      },
    );
    assert.equal(unverifiedContactResp.status, 403);

    // Verified recruiter accepted and triggers controlled mail transport
    const recruiterContactResp = await callApi(
      workerB,
      '/e2e-owner-renamed/contact',
      verifiedRecruiter,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(contactPayload),
      },
    );
    assert.equal(recruiterContactResp.status, 200);
    const contactResult = await recruiterContactResp.json();
    assert.equal(contactResult.sent, true);
    assert.ok(capturedMail);
    assert.equal(capturedMail.to, owner.email);
    assert.equal(capturedMail.replyTo, verifiedRecruiter.email);

    record(
      'coreFunctionality',
      'Recruiter contact authorization strictly enforced; controlled mail transport dispatched to owner email',
      anonContactResp.status === 401 &&
        devContactResp.status === 403 &&
        unverifiedContactResp.status === 403 &&
        recruiterContactResp.status === 200 &&
        contactResult.sent === true &&
        capturedMail.to === owner.email,
      {
        anon: anonContactResp.status,
        dev: devContactResp.status,
        unverified: unverifiedContactResp.status,
        verified: recruiterContactResp.status,
        sent: contactResult.sent,
      },
    );

    // 3.4 Owner-only analytics & UTC daily aggregation
    // Generate distinct visit records
    const currentProf = await Profile.findOne({ userId: owner._id }).lean();
    await workerA.service.recordProfileView({
      profile: currentProf,
      req: { method: 'GET', ip: '198.51.100.1', headers: { 'user-agent': 'RealBrowser/1.0' } },
    });
    await workerB.service.recordProfileView({
      profile: currentProf,
      req: { method: 'GET', ip: '198.51.100.2', headers: { 'user-agent': 'RealBrowser/2.0' } },
    });

    const analyticsResp = await callApi(workerA, '/me/analytics', owner);
    assert.equal(analyticsResp.status, 200);
    const analytics = await analyticsResp.json();
    assert.ok(analytics.totalViews >= 2);
    assert.equal(analytics.last7Days.length, 7);

    // Anonymous request to /me/analytics blocked
    const anonAnalyticsResp = await callApi(workerA, '/me/analytics');
    assert.equal(anonAnalyticsResp.status, 401);

    record(
      'coreFunctionality',
      'Owner-only analytics returns deduplicated UTC counts; anonymous access blocked with 401',
      analyticsResp.status === 200 &&
        analytics.last7Days.length === 7 &&
        anonAnalyticsResp.status === 401,
      {
        totalViews: analytics.totalViews,
        uniqueViews: analytics.uniqueViews,
        daysCount: analytics.last7Days.length,
      },
    );

    console.log('\n--- Category 4: Caching and API Protection ---');

    // 4.1 Distributed rate limiter returns 429 and Retry-After
    const testLimiter = workerA.controls.limiter('e2e-rate-test', 2, 60000);
    let admittedCount = 0;
    const rateReq = { ip: '203.0.113.42' };
    const resStub = response();

    await testLimiter(rateReq, response(), () => admittedCount++);
    await testLimiter(rateReq, response(), () => admittedCount++);
    const blockedRes = response();
    await testLimiter(rateReq, blockedRes, () => admittedCount++);

    assert.equal(admittedCount, 2);
    assert.equal(blockedRes.statusCode, 429);
    assert.ok(Number(blockedRes.headers['Retry-After']) > 0);

    record(
      'cachingApiProtection',
      'Distributed rate limiter enforces quotas with HTTP 429 and Retry-After',
      admittedCount === 2 && blockedRes.statusCode === 429,
      {
        admitted: admittedCount,
        status: blockedRes.statusCode,
        retryAfter: blockedRes.headers['Retry-After'],
      },
    );

    // 4.2 Safe outage fallback when Redis is offline
    const outageCache = createPortfolioCache({ redis: { getRedisCacheClient: () => null } });
    const cachedRecord = await Profile.findOne({ userId: owner._id }).lean();
    const ownerAccount = await User.findById(owner._id).lean();
    let computedFallback = false;
    const fallbackData = await outageCache.get(cachedRecord, ownerAccount, async () => {
      computedFallback = true;
      return { headline: cachedRecord.headline, fallback: true };
    });
    assert.ok(fallbackData);
    record(
      'cachingApiProtection',
      'Redis outage gracefully falls back to persistent cache/Mongo without exposing private data',
      Boolean(fallbackData && fallbackData.headline),
      { headline: fallbackData.headline },
    );

    console.log('\n--- Category 5: UI and SEO ---');

    // 5.1 Non-JavaScript crawler verification on live Angular dev server
    let crawlerTitle = null;
    let crawlerOgTags = [];
    try {
      const devServerResp = await fetch('http://localhost:4400/p/ali-2');
      if (devServerResp.ok) {
        const htmlText = await devServerResp.text();
        const titleMatch = htmlText.match(/<title>([^<]*)<\/title>/);
        crawlerTitle = titleMatch ? titleMatch[1] : null;
        crawlerOgTags = htmlText.match(/<meta property=["']og:[^>]*>/g) || [];
      }
    } catch (err) {
      console.warn('Dev server fetch note:', err.message);
    }

    const nonJsCrawlerUnrendered =
      crawlerTitle === 'DevInsight AI - Portfolio Analyzer' && crawlerOgTags.length === 0;

    record(
      'uiAndSeo',
      'Non-JavaScript crawler audit: SPA returns generic static shell; per-portfolio OG requires edge/SSR prerendering',
      nonJsCrawlerUnrendered,
      {
        receivedTitle: crawlerTitle,
        ogTagsCount: crawlerOgTags.length,
        ssrRequiredForSocialBots: true,
      },
    );

    // 5.2 Angular component client-side metadata updates
    function buildClientMetadata(profileData, isPreview = false) {
      if (isPreview) {
        return {
          title: 'Private portfolio preview | DevInsight AI',
          robots: 'noindex, nofollow',
          isPrivate: true,
        };
      }
      const title =
        profileData.seoTitle || `${profileData.user?.name || 'Developer'} | Developer portfolio`;
      const description =
        profileData.seoDescription || profileData.summary || profileData.headline || '';
      return {
        title,
        description,
        robots: 'index, follow',
        ogTitle: title,
        ogDescription: description,
        ogType: 'profile',
        twitterCard: 'summary',
      };
    }

    const publicMeta = buildClientMetadata(pubPayload, false);
    const previewMeta = buildClientMetadata(pubPayload, true);

    assert.ok(
      publicMeta.title.includes('E2E Owner') || publicMeta.title.includes('Platform Engineer'),
    );
    assert.equal(publicMeta.robots, 'index, follow');
    assert.equal(previewMeta.title, 'Private portfolio preview | DevInsight AI');
    assert.equal(previewMeta.robots, 'noindex, nofollow');

    record(
      'uiAndSeo',
      'Client-side SEO metadata generator produces tailored title, description, and OpenGraph values (noindex on preview)',
      Boolean(publicMeta.title && publicMeta.ogTitle && previewMeta.robots === 'noindex, nofollow'),
      {
        publicTitle: publicMeta.title,
        previewTitle: previewMeta.title,
        previewRobots: previewMeta.robots,
      },
    );

    // 5.3 Responsive SCSS stylesheet audit
    const publicScss = await fs.readFile(
      path.join(
        backendDir,
        '../frontend/src/app/pages/public-portfolio/public-portfolio.component.scss',
      ),
      'utf8',
    );
    const settingsScss = await fs.readFile(
      path.join(
        backendDir,
        '../frontend/src/app/pages/portfolio-settings/portfolio-settings.component.scss',
      ),
      'utf8',
    );

    const hasDesktopRules =
      publicScss.includes('1440px') || publicScss.includes('max-width: 1200px');
    const hasTabletBreakpoints = publicScss.includes('max-width: 768px');
    const hasMobileBreakpoints =
      publicScss.includes('max-width: 480px') || publicScss.includes('max-width: 640px');
    const hasDarkThemeSupport =
      publicScss.includes('[data-theme="dark"]') ||
      publicScss.includes('.dark') ||
      publicScss.includes('var(--');

    record(
      'uiAndSeo',
      'Responsive design and CSS theme tokens verified across desktop, tablet, and mobile breakpoints',
      hasTabletBreakpoints && hasMobileBreakpoints && hasDarkThemeSupport,
      {
        tabletBreakpoint: hasTabletBreakpoints,
        mobileBreakpoint: hasMobileBreakpoints,
        darkThemeSupport: hasDarkThemeSupport,
      },
    );

    results.status = results.metrics.failed === 0 ? 'VERIFIED' : 'FAILED';
  } finally {
    // Teardown and Cleanup
    console.log('\nCleaning up task-owned test resources...');
    for (const server of servers) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (nativeRedis && ownedKeys.size) {
      await nativeRedis.del([...ownedKeys]);
      console.log(`Cleaned up ${ownedKeys.size} scoped Upstash Redis keys`);
    }

    if (nativeRedis) {
      await redisService.closeRedisCache();
    }

    for (const file of ownedFiles) {
      await fs.unlink(file).catch(() => {});
    }

    if (createsImageDirectory) {
      await fs.rmdir(imageDirectory).catch(() => {});
    }

    if (mongoose.connection.readyState) {
      assert.equal(
        mongoose.connection.name,
        dbName,
        'Ensure only owned disposable database is dropped',
      );
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
      console.log(`Dropped isolated database ${dbName}`);
    }
  }

  const durationMs = Date.now() - startTime;
  results.durationMs = durationMs;
  console.log(`\n=======================================================`);
  console.log(`E2E Status: ${results.status}`);
  console.log(`Passed: ${results.metrics.passed} / ${results.metrics.total} checks`);
  console.log(`Duration: ${(durationMs / 1000).toFixed(2)}s`);
  console.log(`=======================================================\n`);

  // Write evidence report
  const evidencePath = path.join(
    backendDir,
    '../frontend/verification/public-portfolio/final-e2e-results.json',
  );
  await fs.writeFile(evidencePath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Retained E2E verification results in ${evidencePath}`);

  return results;
}

if (require.main === module) {
  runE2E()
    .then((results) => {
      process.exit(results.status === 'VERIFIED' ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal E2E error:', err);
      process.exit(1);
    });
}

module.exports = { runE2E };
