'use strict';
// Executes legacy integration suites only against a newly created loopback replica set.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');
async function main() {
  const mongo = await startMongo();
  const root = path.resolve(__dirname, '../..');
  const output = process.env.RECOMMENDATIONS_BACKEND_OUTPUT
    ? path.resolve(process.env.RECOMMENDATIONS_BACKEND_OUTPUT)
    : path.join(root, 'verification/recommendations/production-final');
  const legacyUri = new URL(mongo.uri);
  legacyUri.pathname = '/career_sprint_legacy_test_recommendations';
  legacyUri.search = '';
  fs.mkdirSync(output, { recursive: true });
  const focused = process.argv.includes('--focused');
  const files = fs
    .readdirSync(path.join(root, 'src/tests'))
    .filter((name) =>
      /^(recommendation|skillGap|careerSprint|courses|resume|githubAnalyzer|scenario|weeklyReport|notifications).*\.test\.js$/.test(
        name
      )
    )
    .filter((name) => !focused || /^(recommendation|skillGapConsumer)/.test(name))
    .map((name) => `src/tests/${name}`);
  const started = Date.now();
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MONGODB_URI: mongo.uri,
      MONGO_URI: mongo.uri,
      CAREER_SPRINT_ISOLATED_MONGO_URI: legacyUri.href,
      GEMINI_API_KEY: '',
      GROQ_API_KEY: '',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      OPENROUTER_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (chunk) => {
    log += chunk;
  });
  child.stderr.on('data', (chunk) => {
    log += chunk;
  });
  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
  } finally {
    fs.writeFileSync(
      path.join(output, focused ? 'focused-backend-tests.log' : 'backend-tests.log'),
      log
    );
    const cleanup = await mongo.stop();
    fs.writeFileSync(
      path.join(output, focused ? 'focused-backend-results.json' : 'backend-results.json'),
      JSON.stringify(
        {
          exitCode,
          durationMs: Date.now() - started,
          files,
          summary: log
            .split(/\r?\n/)
            .filter((line) =>
              /^(ℹ|#) (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)/.test(line)
            ),
          cleanup
        },
        null,
        2
      ) + '\n'
    );
  }
  console.log(
    log
      .split(/\r?\n/)
      .filter((line) => /[✖]|^not ok|^(ℹ|#) (tests|pass|fail|skipped|duration_ms)/.test(line))
      .join('\n')
  );
  process.exitCode = exitCode;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
