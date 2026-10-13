"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../../.env"),
});
const ResumeFile = require("../models/resumeFile");
const ResumeAnalysis = require("../models/resumeAnalysis");
const AnalysisCache = require("../models/analysisCache");
const mock = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("Skill Gap Mongo: active selection, reanalysis, source revisions, history and concurrent invalidation", async (t) => {
  assert.ok(
    process.env.MONGODB_URI,
    "MONGODB_URI is required for Skill Gap database verification",
  );
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 5000,
  });
  const owner = new mongoose.Types.ObjectId();
  const foreign = new mongoose.Types.ObjectId();
  t.after(async () => {
    await Promise.all([
      ResumeFile.deleteMany({ userId: { $in: [owner, foreign] } }),
      ResumeAnalysis.deleteMany({ userId: { $in: [owner, foreign] } }),
      AnalysisCache.deleteMany({ userId: { $in: [owner, foreign] } }),
    ]);
    await mongoose.disconnect();
  });
  const now = new Date();
  const files = await ResumeFile.create(
    ["a", "b", "unanalyzed"].map((name) => ({
      userId: owner,
      fileName: `${name}.pdf`,
      fileUrl: `/skill-gap-test/${name}`,
      fileSize: 1,
    })),
  );
  const [a, b] = await ResumeAnalysis.create([
    {
      userId: owner,
      fileId: files[0]._id,
      fileName: "a.pdf",
      fileSize: 1,
      analyzedAt: now,
      atsScore: 10,
      resumeSignals: {
        skills: ["React"],
        scoring: { ruleVersion: "resume-overall-score-v1" },
      },
    },
    {
      userId: owner,
      fileId: files[1]._id,
      fileName: "b.pdf",
      fileSize: 1,
      analyzedAt: now,
      atsScore: 90,
      resumeSignals: { skills: ["SQL"] },
    },
  ]);
  const history = await AnalysisCache.create({
    userId: owner,
    githubUsername: "fixture",
    careerStack: "Frontend",
    experienceLevel: "Student",
    resumeHash: crypto
      .createHash("sha256")
      .update("historical-fixture")
      .digest("hex"),
    analysisVersion: "v6-skill-intelligence",
    resumeAnalysisId: String(a._id),
    signalHash: "historic",
    analysisData: {
      coverage: 87,
      legacyField: true,
      calculatedAt: "2010-01-01",
    },
  });
  const historicalBefore = await AnalysisCache.findById(history._id).lean();
  const shared = new Map();
  const summaries = new Map();
  const counts = { ai: 0, github: 0 };
  const github = {
    repoCount: 1,
    repositories: [
      { name: "fixture", language: "TypeScript", topics: ["react"] },
    ],
    languageDistribution: [{ language: "TypeScript" }],
    githubSignals: { username: "fixture", analyzedAt: now.toISOString() },
    cache: { cachedAt: now.toISOString(), source: "cache" },
    dataAvailability: {
      repositories: "complete",
      repositorySignals: "sampled",
    },
  };
  let hold = null;
  mock("../services/githubservice", {
    parseGitHubUsername: (value) => String(value).trim(),
    getCachedGitHubAnalysis: async () => {
      counts.github += 1;
      return { status: "fresh", data: structuredClone(github) };
    },
    refreshGitHubAnalysisInBackground: () => ({ queued: false }),
  });
  mock("../services/aiservice", {
    getSharedCache: async (key, namespace) =>
      shared.get(`${namespace}:${key}`) || null,
    setSharedCache: async (key, value, _ttl, namespace) =>
      shared.set(`${namespace}:${key}`, value),
    getDeterministicSummary: async (_scope, key) =>
      summaries.get(JSON.stringify(key)) || null,
    setDeterministicSummary: async (_scope, key, value) =>
      summaries.set(JSON.stringify(key), value),
    runAIAnalysis: async (_prompt, fallback) => {
      counts.ai += 1;
      if (hold) {
        hold.entered += 1;
        if (hold.entered === 1) hold.first.resolve();
        if (hold.entered === 2) hold.second.resolve();
        await hold.gate.promise;
      }
      return { ok: false, value: fallback };
    },
    recordDeterministicSkip: () => {},
  });
  mock("../services/aiVersionService", { createVersion: async () => {} });
  mock("../services/notificationService", {
    createNotification: async () => {},
  });
  const signals = require("../services/developerSignalService");
  mock("../services/developerSignalService", {
    ...signals,
    getDeveloperSignals: async () => ({
      integrationSignal: {
        present: false,
        integrationScore: 0,
        detectedSkills: [],
      },
      jobsDemandSignal: { present: false },
      portfolioSignal: {},
      weeklyReportSignal: {},
      careerSprintSignal: {},
    }),
  });
  delete require.cache[require.resolve("../controllers/skillgapcontroller")];
  const controller = require("../controllers/skillgapcontroller");
  const user = {
    _id: owner,
    activeGithubUsername: "fixture",
    activeCareerStack: "Frontend",
    activeExperienceLevel: "Student",
    activeResumeFileId: files[0]._id,
    defaultResumeFileId: files[1]._id,
  };
  const call = async (body) => {
    let output,
      status = 200;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(value) {
        output = value;
        return this;
      },
    };
    await controller.analyzeSkillGap(
      { user: { ...user }, body: body || {} },
      res,
    );
    assert.equal(status, 200);
    return output;
  };
  const first = await call();
  assert.deepEqual(first.resumeSkills, ["React"]);
  assert.equal(
    first.skills.find((skill) => skill.name === "React").status,
    "PARTIAL",
  );
  assert.equal(first.provenSkills.length, 0);
  const mongoFirst = await AnalysisCache.findOne({
    userId: owner,
    analysisVersion: controller.ANALYSIS_VERSION,
    signalHash: first.cacheMetadata.signalHash,
  }).lean();
  assert.ok(mongoFirst);
  assert.equal(
    mongoFirst.analysisData.ruleVersion,
    "skill-evidence-coverage-v1",
  );

  controller.clearSkillGapMemoryCache();
  shared.clear();
  const aiBefore = counts.ai;
  const databaseHit = await call();
  assert.equal(databaseHit.fromCache, true);
  assert.equal(counts.ai, aiBefore);
  assert.equal(databaseHit.calculatedAt, first.calculatedAt);
  assert.deepEqual(databaseHit.skills, first.skills);

  user.activeResumeFileId = files[1]._id;
  const switched = await call();
  assert.deepEqual(switched.resumeSkills, ["SQL"]);
  assert.notEqual(
    switched.cacheMetadata.signalHash,
    first.cacheMetadata.signalHash,
  );
  assert.equal(switched.coverage, first.coverage); // Claims alone do not change coverage.
  await ResumeAnalysis.updateOne(
    { _id: b._id },
    { $set: { "resumeSignals.skills": ["SQL", "Docker"] } },
  );
  const reanalyzed = await call();
  assert.deepEqual(reanalyzed.resumeSkills, ["Docker", "SQL"]);
  assert.notEqual(
    reanalyzed.cacheMetadata.signalHash,
    switched.cacheMetadata.signalHash,
  );
  assert.equal(
    reanalyzed.skills.find((skill) => skill.name === "Docker").status,
    "CLAIMED_ONLY",
  );

  github.repositories[0].topics.push("docker");
  const revisedGithub = await call();
  assert.notEqual(
    revisedGithub.cacheMetadata.signalHash,
    reanalyzed.cacheMetadata.signalHash,
  );
  assert.equal(
    revisedGithub.skills.find((skill) => skill.name === "Docker").status,
    "PARTIAL",
  );
  assert.ok(revisedGithub.coverage > reanalyzed.coverage);
  user.activeResumeFileId = files[2]._id;
  assert.deepEqual((await call()).resumeSkills, []); // Never borrow an analyzed historical resume.
  const foreignFile = await ResumeFile.create({
    userId: foreign,
    fileName: "foreign.pdf",
    fileUrl: "/skill-gap-test/foreign",
    fileSize: 1,
  });
  await ResumeAnalysis.create({
    userId: foreign,
    fileId: foreignFile._id,
    fileName: "foreign.pdf",
    fileSize: 1,
    analyzedAt: now,
    resumeSignals: { skills: ["Kubernetes"] },
  });
  user.activeResumeFileId = foreignFile._id;
  assert.deepEqual((await call()).resumeSkills, []); // Active file ID never bypasses ownership.

  user.activeResumeFileId = files[1]._id;
  user.activeCareerStack = "Backend";
  const backend = await call();
  assert.ok(backend.requiredSkills.some((skill) => skill.name === "Node.js"));
  user.activeExperienceLevel = "5+ years";
  assert.notEqual(
    (await call()).cacheMetadata.signalHash,
    backend.cacheMetadata.signalHash,
  );
  user.activeGithubUsername = "fixture2";
  assert.notEqual(
    (await call()).cacheMetadata.signalHash,
    backend.cacheMetadata.signalHash,
  );
  user.activeGithubUsername = "fixture";
  user.activeCareerStack = "Frontend";
  user.activeExperienceLevel = "Student";

  // Reanalysis during an in-flight request must not borrow its old snapshot.
  hold = {
    entered: 0,
    first: deferred(),
    second: deferred(),
    gate: deferred(),
  };
  const pending = call({ forceRefresh: true });
  await hold.first.promise;
  await ResumeAnalysis.updateOne(
    { _id: b._id },
    { $set: { "resumeSignals.skills": ["Java"] } },
  );
  const newer = call({ forceRefresh: true });
  await hold.second.promise;
  hold.gate.resolve();
  const [olderSnapshot, newerSnapshot] = await Promise.all([pending, newer]);
  hold = null;
  assert.notEqual(
    olderSnapshot.cacheMetadata.signalHash,
    newerSnapshot.cacheMetadata.signalHash,
  );
  assert.deepEqual(newerSnapshot.resumeSkills, ["Java"]);
  assert.deepEqual(olderSnapshot.resumeSkills, ["Docker", "SQL"]);
  assert.deepEqual((await call()).resumeSkills, ["Java"]);

  assert.deepEqual(
    await AnalysisCache.findById(history._id).lean(),
    historicalBefore,
  );
  assert.equal(await ResumeAnalysis.countDocuments({ userId: owner }), 2);
  assert.equal(await ResumeFile.countDocuments({ userId: owner }), 3);
  assert.ok(
    (await AnalysisCache.countDocuments({
      userId: owner,
      analysisVersion: controller.ANALYSIS_VERSION,
    })) >= 2,
  );
});

test("Skill Gap: historical 56 reload behavior, reanalysis contract, and persistence", async (t) => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 5000,
    });
  }
  const testUser = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();
  const now = new Date();
  const SavedPreview = require("../models/savedPreview");
  t.after(async () => {
    await Promise.all([
      ResumeFile.deleteMany({ userId: testUser }),
      ResumeAnalysis.deleteMany({ userId: testUser }),
      AnalysisCache.deleteMany({ userId: testUser }),
      SavedPreview.deleteMany({ userId: testUser }),
    ]);
    await mongoose.disconnect();
  });

  const resumeText =
    "Experienced full-stack engineer with Node.js and React expertise.";
  const resumeHash = crypto
    .createHash("sha256")
    .update(resumeText)
    .digest("hex");
  const resumeAnalysis = await ResumeAnalysis.create({
    userId: testUser,
    fileId,
    fileName: "resume.pdf",
    fileSize: 1024,
    analyzedAt: now,
    atsScore: 82,
    resumeSignals: {
      skills: ["React", "Node.js"],
      scoring: { ruleVersion: "resume-overall-score-v1" },
    },
  });

  const developerSignalsModule = require("../services/developerSignalService");
  const resumeInsights = developerSignalsModule.buildResumeAnalysisSignals(
    resumeAnalysis,
    "2-3 years",
  );
  const resumeCacheIdentity = developerSignalsModule.buildResumeCacheIdentity({
    resumeAnalysis,
  });
  const githubData = {
    repoCount: 1,
    repositories: [
      { name: "my-app", language: "JavaScript", topics: ["react"] },
    ],
    languageDistribution: [{ language: "JavaScript" }],
    githubSignals: {
      username: "testhistorical",
      analyzedAt: now.toISOString(),
    },
    cache: { cachedAt: now.toISOString(), source: "cache" },
    dataAvailability: {
      repositories: "complete",
      repositorySignals: "sampled",
    },
  };

  // Seed Scenario A: unversioned historical record with score 56
  const historicalRecord = await AnalysisCache.create({
    userId: testUser,
    githubUsername: "testhistorical",
    careerStack: "Full Stack",
    experienceLevel: "2-3 years",
    resumeHash: resumeCacheIdentity.resumeHash,
    resumeAnalysisId: resumeCacheIdentity.resumeAnalysisId,
    signalHash: "legacy-signal-hash",
    analysisVersion: "v6-skill-intelligence",
    analysisData: {
      coverage: 56,
      missing: 44,
      yourSkills: [{ name: "JavaScript", proficiency: 60 }],
      missingSkills: [{ name: "TypeScript", priority: "High" }],
      calculatedAt: "2025-01-01T00:00:00.000Z",
    },
  });

  mock("../services/githubservice", {
    parseGitHubUsername: (value) => String(value).trim(),
    getCachedGitHubAnalysis: async () => ({
      status: "fresh",
      data: structuredClone(githubData),
    }),
    refreshGitHubAnalysisInBackground: () => ({ queued: false }),
  });
  mock("../services/aiservice", {
    getSharedCache: async () => null,
    setSharedCache: async () => {},
    getDeterministicSummary: async () => null,
    setDeterministicSummary: async () => {},
    runAIAnalysis: async (_prompt, fallback) => ({
      ok: false,
      value: fallback,
    }),
    recordDeterministicSkip: () => {},
  });
  mock("../services/aiVersionService", { createVersion: async () => {} });
  mock("../services/notificationService", {
    createNotification: async () => {},
  });

  delete require.cache[require.resolve("../controllers/skillgapcontroller")];
  const controller = require("../controllers/skillgapcontroller");

  const callController = async (body = {}) => {
    let output,
      statusCode = 200;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(value) {
        output = value;
        return this;
      },
    };
    await controller.analyzeSkillGap(
      {
        user: {
          _id: testUser,
          activeGithubUsername: "testhistorical",
          activeCareerStack: "Full Stack",
          activeExperienceLevel: "2-3 years",
          activeResumeFileId: fileId,
        },
        body,
      },
      res,
    );
    assert.equal(statusCode, 200);
    return output;
  };

  // Scenario A: forceRefresh is false, existing historical result returned
  controller.clearSkillGapMemoryCache();
  const historicalRes = await callController({ forceRefresh: false });
  assert.equal(
    historicalRes.coverage,
    56,
    "Historical coverage 56 must be returned",
  );
  assert.equal(
    historicalRes.ruleVersion,
    undefined,
    "Historical result must have no ruleVersion",
  );
  assert.equal(historicalRes.fromCache, true);
  assert.equal(historicalRes.isHistorical, true);

  // Scenario B: User clicks Run New Skill Analysis (forceRefresh: true)
  const reanalyzedRes = await callController({ forceRefresh: true });
  assert.equal(
    reanalyzedRes.ruleVersion,
    "skill-evidence-coverage-v1",
    "Must return versioned contract",
  );
  assert.ok(
    typeof reanalyzedRes.coverage === "number" ||
      reanalyzedRes.coverage === null,
  );
  assert.ok(Array.isArray(reanalyzedRes.skills));
  assert.ok(reanalyzedRes.evidenceConfidence);
  assert.ok(reanalyzedRes.evidenceCompleteness);

  // Verify MongoDB now has the v8-skill-evidence-coverage document
  const mongoV8 = await AnalysisCache.findOne({
    userId: testUser,
    analysisVersion: controller.ANALYSIS_VERSION,
  }).lean();
  assert.ok(mongoV8, "v8 document must exist in MongoDB AnalysisCache");
  assert.equal(mongoV8.analysisData.ruleVersion, "skill-evidence-coverage-v1");

  // Verify historical document is untouched in MongoDB
  const historicalStillInDb = await AnalysisCache.findById(
    historicalRecord._id,
  ).lean();
  assert.ok(historicalStillInDb);
  assert.equal(historicalStillInDb.analysisData.coverage, 56);

  // Scenario C: User refreshes page (forceRefresh: false) -> versioned snapshot persists
  controller.clearSkillGapMemoryCache();
  const reloadRes = await callController({ forceRefresh: false });
  assert.equal(
    reloadRes.ruleVersion,
    "skill-evidence-coverage-v1",
    "Reload must retrieve versioned snapshot",
  );
  assert.notEqual(
    reloadRes.coverage,
    56,
    "Reload must not revert to historical score 56",
  );
  assert.equal(reloadRes.fromCache, true);

  // Scenario I: Saved preview serialization preserves versioned evidence and valid null coverage
  const recsController = require("../controllers/recommendationscontroller");

  let savedPreviewOutput;
  const previewRes = {
    status(code) {
      assert.equal(code, 200);
      return this;
    },
    json(data) {
      savedPreviewOutput = data;
      return this;
    },
  };
  await recsController.savePreview(
    {
      user: { _id: testUser },
      body: {
        module: "skill-gap",
        title: "Test Versioned Preview",
        githubUsername: "testhistorical",
        careerStack: "Full Stack",
        experienceLevel: "2-3 years",
        resumeHash: "no-resume",
        result: {
          ruleVersion: "skill-evidence-coverage-v1",
          coverage: null,
          skills: [
            { name: "React", status: "DEMONSTRATED", requirement: "REQUIRED" },
          ],
          evidenceConfidence: "HIGH",
          evidenceCompleteness: { complete: true, availableCoreSources: 2 },
          analysisSummary: "Demonstrated skills verified.",
        },
      },
    },
    previewRes,
  );
  assert.ok(savedPreviewOutput?.preview);
  const summary = savedPreviewOutput.preview.resultSummary;
  assert.equal(
    summary.ruleVersion,
    "skill-evidence-coverage-v1",
    "Must preserve ruleVersion in saved preview",
  );
  assert.equal(
    summary.coverage,
    null,
    "Must preserve valid null coverage, never convert to 0",
  );
  assert.equal(summary.evidenceConfidence, "HIGH");
  assert.deepEqual(summary.skills, [
    { name: "React", status: "DEMONSTRATED", requirement: "REQUIRED" },
  ]);
});
