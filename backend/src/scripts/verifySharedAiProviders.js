// Explicit, bounded diagnostic: one synthetic request per configured production
// provider. No fallback, private prompts, raw responses or credential output.
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const manager = require('../services/aiProviderManager');
const config = require('../config/aiProviders');
const run = async () => {
  const report = {
    scope: 'Independent adapters; not a production load, quota or Mongo admission acceptance test',
    results: []
  };
  const { states } = manager.getProviderState();
  for (const provider of config.PRODUCTION_ORDER) {
    const state = states[provider];
    if (!state.enabled) {
      report.results.push({ provider, status: 'BLOCKED', reason: state.disabledReason });
      continue;
    }
    if (!process.argv.includes('--live')) {
      report.results.push({
        provider,
        status: 'NOT_RUN',
        reason: 'Pass --live to make one bounded synthetic request.'
      });
      continue;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.descriptor(provider).timeoutMs);
    const started = performance.now();
    try {
      const result = await Promise.race([
        manager.runProviderRequest({
          provider,
          prompt: 'Return only this JSON object: {"ok":true}',
          apiKey: state.apiKey,
          modelName: state.models[0],
          parseJson: JSON.parse,
          timeoutMs: config.descriptor(provider).timeoutMs,
          maxOutputTokens: 128,
          signal: controller.signal
        }),
        new Promise((_, reject) =>
          controller.signal.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('Diagnostic deadline'), { aiReason: 'timeout' })),
            { once: true }
          )
        )
      ]);
      report.results.push({
        provider,
        model: state.models[0],
        status: result?.ok === true ? 'PASS' : 'FAIL',
        reason: result?.ok === true ? 'synthetic_json_accepted' : 'unexpected_schema',
        elapsedMs: Math.round(performance.now() - started)
      });
    } catch (error) {
      report.results.push({
        provider,
        model: state.models[0],
        status: 'FAIL',
        reason: controller.signal.aborted ? 'timeout' : manager.classify(error),
        httpStatus: manager.getStatusCode(error) || undefined,
        elapsedMs: Math.round(performance.now() - started)
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  const output = path.resolve(__dirname, '../../verification/ai-providers/live-status.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
};
if (require.main === module)
  run().catch(() => {
    console.error('Provider diagnostic failed. No credentials or response bodies are logged.');
    process.exitCode = 1;
  });
module.exports = { run };
