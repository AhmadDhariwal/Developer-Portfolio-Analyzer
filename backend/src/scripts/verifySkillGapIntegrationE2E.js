const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const assert = require("node:assert/strict");
require("dotenv").config();

const API_BASE = "http://127.0.0.1:5000/api";
const JWT_SECRET = process.env.JWT_SECRET;

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const userCol = mongoose.connection.collection("users");
  const uniqueSuffix = Date.now();
  const insertRes = await userCol.insertOne({
    name: "Historical Tester",
    email: `historical.tester.${uniqueSuffix}@example.com`,
    githubUsername: "ahmaddhariwal",
    activeGithubUsername: "ahmaddhariwal",
    careerStack: "Full Stack",
    experienceLevel: "Student",
    role: "developer",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const testUser = await userCol.findOne({ _id: insertRes.insertedId });
  assert.ok(testUser, "Test user exists");
  const token = jwt.sign({ id: String(testUser._id) }, JWT_SECRET, {
    issuer: "devinsight-api",
    audience: "devinsight-web",
    expiresIn: "7d",
  });

  const headers = { Authorization: "Bearer " + token };

  // SCENARIO A: Historical result with score 56
  console.log("\n--- SCENARIO A: Historical Result ---");
  await mongoose.connection.collection("analysiscaches").updateOne(
    {
      userId: testUser._id,
      analysisVersion: "v6-skill-intelligence",
    },
    {
      $set: {
        userId: testUser._id,
        analysisVersion: "v6-skill-intelligence",
        githubUsername: "ahmaddhariwal",
        careerStack: "Full Stack",
        experienceLevel: "Student",
        resumeHash: "no-resume",
        analysisData: {
          coverage: 56,
          missing: 44,
          yourSkills: ["JavaScript", "HTML"],
          weakSkills: ["CSS"],
          missingSkills: ["Docker", "AWS"],
          analysisSummary: "Historical legacy analysis summary",
        },
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    },
    { upsert: true },
  );

  // Clear any existing v8 cache entry for this exact user/context to simulate initial page load
  await mongoose.connection.collection("analysiscaches").deleteMany({
    userId: testUser._id,
    analysisVersion: "v8-skill-evidence-coverage",
  });

  // Call skill-gap with forceRefresh: false
  const resA = await axios.post(
    API_BASE + "/skillgap/skill-gap",
    {
      careerStack: "Full Stack",
      experienceLevel: "Student",
      forceRefresh: false,
    },
    { headers },
  );

  assert.equal(resA.status, 200);
  assert.equal(resA.data.isHistorical, true);
  assert.equal(resA.data.coverage, 56);
  assert.equal(resA.data.ruleVersion, undefined);
  console.log(
    "✓ Scenario A verified: Returns historical result with score 56 and isHistorical: true",
  );

  // SCENARIO B: Reanalysis (Run New Skill Analysis)
  console.log("\n--- SCENARIO B: Run New Skill Analysis ---");
  const resB = await axios.post(
    API_BASE + "/skillgap/skill-gap",
    {
      careerStack: "Full Stack",
      experienceLevel: "Student",
      forceRefresh: true,
    },
    { headers },
  );

  assert.equal(resB.status, 200);
  assert.equal(resB.data.ruleVersion, "skill-evidence-coverage-v1");
  assert.ok(
    typeof resB.data.coverage === "number" || resB.data.coverage === null,
  );
  assert.ok(Array.isArray(resB.data.skills));
  assert.ok(resB.data.skills.length > 0);
  assert.ok(resB.data.evidenceConfidence);
  assert.ok(resB.data.evidenceCompleteness);
  assert.equal(resB.data.isHistorical, undefined);
  console.log(
    "✓ Scenario B verified: Returned versioned snapshot ruleVersion=" +
      resB.data.ruleVersion +
      ", coverage=" +
      resB.data.coverage,
  );

  // SCENARIO C: Refresh/Reload
  console.log("\n--- SCENARIO C: Page Reload ---");
  const resC = await axios.post(
    API_BASE + "/skillgap/skill-gap",
    {
      careerStack: "Full Stack",
      experienceLevel: "Student",
      forceRefresh: false,
    },
    { headers },
  );

  assert.equal(resC.status, 200);
  assert.equal(resC.data.ruleVersion, "skill-evidence-coverage-v1");
  assert.equal(resC.data.coverage, resB.data.coverage);
  assert.equal(resC.data.fromCache, true);
  assert.equal(resC.data.isHistorical, undefined);
  console.log(
    "✓ Scenario C verified: Versioned snapshot persisted and retrieved from cache on reload",
  );

  // SCENARIO D & E: Scoring edge cases (null vs 0)
  console.log("\n--- SCENARIO D & E: Null vs 0 Handling ---");
  const evidenceEngine = require("../services/skillGapEvidenceService");
  const zeroResult = evidenceEngine.calculate({
    requirements: {
      available: true,
      version: "skill-gap-requirements-v1",
      skills: [
        {
          name: "Go",
          weight: 1,
          requirement: "REQUIRED",
          category: "Technical",
        },
      ],
    },
    observations: [],
    sources: [
      {
        type: "github",
        id: "gh",
        available: true,
        completeness: "COMPLETE",
        timestamp: new Date().toISOString(),
      },
    ],
  });
  assert.strictEqual(zeroResult.coverage, 0);
  console.log(
    "✓ Scenario D: genuine zero coverage returns number 0:",
    zeroResult.coverage,
  );

  const nullResult = evidenceEngine.calculate({
    requirements: {
      available: true,
      version: "skill-gap-requirements-v1",
      skills: [],
    },
    observations: [],
    sources: [],
  });
  assert.strictEqual(nullResult.coverage, null);
  assert.strictEqual(
    nullResult.coverageUnavailableReason,
    "career_requirements_unavailable",
  );
  console.log(
    "✓ Scenario E: unavailable coverage returns null (not 0):",
    nullResult.coverage,
    nullResult.coverageUnavailableReason,
  );

  // SCENARIO F: Missing source limitations
  console.log("\n--- SCENARIO F: Missing Evidence Source ---");
  assert.strictEqual(resB.data.evidenceCompleteness.complete, false);
  assert.ok(
    resB.data.warnings.some(
      (w) => w.includes("partial_source_limitations") || w.includes("source"),
    ),
  );
  console.log(
    "✓ Scenario F: Partial core sources detected and transparent warnings returned",
  );

  // SCENARIO G: Context changes (Stack/Level)
  console.log("\n--- SCENARIO G: Career Context Change ---");
  await axios.put(
    API_BASE + "/profile/career/active",
    {
      careerStack: "Frontend",
      experienceLevel: "1-2 years",
    },
    { headers },
  );
  const resG = await axios.post(
    API_BASE + "/skillgap/skill-gap",
    {
      careerStack: "Frontend",
      experienceLevel: "1-2 years",
      forceRefresh: true,
    },
    { headers },
  );
  assert.equal(resG.data.careerStack, "Frontend");
  assert.equal(resG.data.experienceLevel, "1-2 years");
  console.log(
    "✓ Scenario G: Context change properly routes to new stack requirements",
  );

  // SCENARIO I: Saved preview preserves versioned fields & null
  console.log("\n--- SCENARIO I: Saved Preview DTO Mapping ---");
  const previewRes = await axios.post(
    API_BASE + "/recommendations/saved-previews",
    {
      module: "skill-gap",
      githubUsername: "ahmaddhariwal",
      careerStack: "Full Stack",
      experienceLevel: "Student",
      resumeHash: "no-resume",
      result: {
        ruleVersion: "skill-evidence-coverage-v1",
        coverage: null,
        skills: [{ name: "TypeScript", status: "DEMONSTRATED" }],
        evidenceConfidence: "HIGH",
        evidenceCompleteness: { complete: true },
      },
    },
    { headers },
  );

  assert.equal(previewRes.status, 200);
  const summary = previewRes.data.preview.resultSummary;
  assert.strictEqual(summary.ruleVersion, "skill-evidence-coverage-v1");
  assert.strictEqual(summary.coverage, null);
  assert.strictEqual(summary.skills.length, 1);
  console.log(
    "✓ Scenario I verified: Saved preview endpoint preserves versioned contract and null coverage",
  );

  await mongoose.disconnect();
  console.log(
    "\nAll scenarios A through I verified successfully against the live backend API!",
  );
}

run().catch((err) => {
  console.error("FAILED:", err.response?.data || err);
  process.exit(1);
});
