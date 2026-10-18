'use strict';

// Live provider verification writes only to a disposable loopback database.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const uri = process.env.CAREER_SPRINT_AI_VERIFY_URI;
assert.match(uri || '', /^mongodb:\/\/127\.0\.0\.1:\d+\/career_sprint_ai_test_[a-z0-9_]+$/);
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
process.env.MONGODB_URI = uri;
process.env.MONGO_URI = uri;
// This probe must not populate a configured shared/production Redis cache.
process.env.REDIS_URL = '';
process.env.UPSTASH_REDIS_TOKEN = '';
const mongoose = require('mongoose');
const User = require('../models/user');
const Sprint = require('../models/careerSprint');
const planner = require('../services/aiTaskService');
const manager = require('../services/aiProviderManager');
const selection = require('../services/sprintAiSelectionService');
const aiService = require('../services/aiservice');
const { sprintWindow } = require('../utils/sprintCalendar');
const output = path.resolve(__dirname, '../../verification/career-sprint/lock-verification/ai-live.json');
const report = { live: true, verifiedAt: new Date().toISOString(), providers: [], plans: [], responses: [] };
const owners = [];
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const runAIAnalysis = aiService.runAIAnalysis;
  aiService.runAIAnalysis = async (prompt, ...args) => {
    const result = await runAIAnalysis.call(aiService, prompt, ...args);
    const allowed = new Set(JSON.parse(prompt).targets.map((target) => target.id));
    const ids = Array.isArray(result?.value?.taskIds) ? result.value.taskIds : [];
    report.responses.push({
      providerOk: result?.ok,
      fields: Object.keys(result?.value || {}),
      expected: allowed.size,
      received: ids.length,
      unique: new Set(ids).size,
      unknownIds: ids.filter((id) => !allowed.has(id)).length
    });
    return result;
  };
  const permitted = Array.from({ length: 6 }, (_, index) => ({
    title: `Implement Docker exercise ${index + 1}`,
    category: 'practice'
  }));
  for (const [provider, key] of [
    ['groq', 'GROQ_API_KEY'],
    ['gemini', 'GEMINI_API_KEY'],
    ['openai', 'OPENAI_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
    ['openrouter', 'OPENROUTER_API_KEY']
  ]) {
    if (!process.env[key]) {
      report.providers.push({ provider, status: 'NOT_CONFIGURED' });
      continue;
    }
    const started = Date.now();
    const result = await manager.tryProvider(provider, selection.prompt(permitted), 0, JSON.parse, 4500);
    report.providers.push({
      provider,
      status: result.ok && selection.validate(result.parsed, permitted).ok ? 'PASS' : 'FAIL',
      reason: result.reason,
      model: result.model,
      elapsedMs: Date.now() - started
    });
  }
  for (const [stack, technology, level] of [
    ['Frontend', 'React', 'Intern'],
    ['Backend', 'Docker', '0-1 years'],
    ['Frontend', 'Angular', '5+ years']
  ]) {
    const user = await User.create({
      name: 'Live AI isolated fixture',
      email: `${new mongoose.Types.ObjectId()}@sprint.test`,
      password: 'fixture',
      careerStack: stack,
      activeCareerStack: stack,
      activeExperienceLevel: level,
      experienceLevel: level
    });
    owners.push(user._id);
    const window = sprintWindow('UTC');
    await Sprint.create({
      userId: user._id,
      ...window,
      weekStartDate: window.sprintStartDate,
      weekEndDate: window.sprintEndDate,
      xpPoints: 42,
      currentStreak: 3,
      tasks: [{ title: 'Previously completed owned work', isCompleted: true, points: 7 }]
    });
    const before = digest(await Sprint.find({ userId: user._id }).lean());
    const result = await planner.generateAiTasksWithLLM({
      userId: String(user._id),
      stack,
      technology,
      experienceLevel: level,
      forceRefresh: true
    });
    assert.equal(result.planMeta.context.careerStack, stack);
    assert.equal(result.planMeta.context.experienceLevel, level);
    assert.ok(result.tasks.length >= 6 && result.tasks.length <= 8);
    assert.ok(result.tasks.every((task) => !task.isCompleted && task.points >= 1 && task.points <= 10));
    assert.equal(
      digest(await Sprint.find({ userId: user._id }).lean()),
      before,
      'AI preview must not mutate Sprint state'
    );
    report.plans.push({
      stack,
      technology,
      level,
      tasks: result.tasks,
      planMeta: result.planMeta,
      previewWrites: false
    });
  }
  report.status =
    report.providers.some((p) => p.status === 'PASS') &&
    report.plans.every((p) => p.planMeta.generationMode === 'llm')
      ? 'VERIFIED'
      : 'BLOCKED';
}
main()
  .catch((error) => {
    report.status = 'BLOCKED';
    report.error = error.message;
  })
  .finally(async () => {
    if (mongoose.connection.readyState === 1) {
      await Sprint.deleteMany({ userId: { $in: owners } });
      await User.deleteMany({ _id: { $in: owners } });
    }
    await mongoose.disconnect();
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify({
        status: report.status,
        providers: report.providers,
        plans: report.plans.map((p) => ({
          stack: p.stack,
          technology: p.technology,
          mode: p.planMeta.generationMode
        }))
      })
    );
    process.exitCode = report.status === 'VERIFIED' ? 0 : 1;
  });
