const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { z } = require('zod');
const { entries, renderNewsEnv } = require('../config/newsEnvCatalog');
const { newsEnvShape, validateNewsRelationships } = require('../config/newsConfig');

test('news configuration has one ordered, documented block and every runtime setting has a catalog entry', () => {
  const example = fs.readFileSync(path.resolve(__dirname, '../../.env.example'), 'utf8');
  const files = [example];
  const local = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(local)) files.push(fs.readFileSync(local, 'utf8'));
  for (const text of files) {
    const lines = text.split(/\r?\n/);
    assert.equal(lines.filter((line) => line.includes('TECH NEWS CONFIGURATION — START')).length, 1);
    assert.equal(lines.filter((line) => line.includes('TECH NEWS CONFIGURATION — END')).length, 1);
    const start = lines.findIndex((line) => line.includes('TECH NEWS CONFIGURATION — START'));
    const end = lines.findIndex((line) => line.includes('TECH NEWS CONFIGURATION — END'));
    const keys = [];
    lines.forEach((line, index) => {
      const key = line.match(/^(NEWS_[A-Z_]+|GNEWS_API_KEY)=/)?.[1];
      if (!key) return;
      keys.push(key);
      assert.ok(index > start && index < end, key + ' outside block');
      assert.match(lines[index - 1], /^# .+Default:.+(Restart backend|next test run)/);
    });
    assert.deepEqual(
      keys,
      entries.map((entry) => entry.key)
    );
    const parsed = dotenv.parse(text);
    assert.ok(z.object(newsEnvShape).safeParse(parsed).success, 'News values must pass startup validation');
    validateNewsRelationships(parsed);
  }
  const catalog = new Set(entries.map((entry) => entry.key));
  assert.equal(catalog.size, entries.length);
  for (const key of Object.keys(newsEnvShape)) assert.ok(catalog.has(key), key);
  assert.ok(!renderNewsEnv().includes('ARXIV'));
});

test('startup rejects inverted retention and invalid prewarm/manual refresh settings', () => {
  assert.throws(() =>
    validateNewsRelationships({ NEWS_QUERY_STALE_TTL_MS: 60000, NEWS_QUERY_FRESH_TTL_MS: 3600000 })
  );
  for (const config of [
    { NEWS_REFRESH_MIN_INTERVAL_MS: 1 },
    { NEWS_DISCOVERY_PREWARM_TOPICS: 'https://private.invalid' },
    { NEWS_DISCOVERY_PREWARM_TOPICS: 'a,b,c,d,e' }
  ])
    assert.equal(z.object(newsEnvShape).safeParse(config).success, false);
});

test('operator comments distinguish configured examples from fail-closed missing-value defaults', () => {
  const entry = (key) => entries.find((item) => item.key === key);
  assert.equal(entry('NEWS_DISCOVERY_ENABLED').value, 'true');
  assert.equal(entry('NEWS_DISCOVERY_ENABLED').runtimeDefault, 'false');
  assert.equal(entry('NEWS_HACKERNEWSSEARCH_CONTENT_APPROVED').runtimeDefault, 'false');
  assert.equal(entry('NEWS_HACKERNEWSSEARCH_DAILY_BUDGET').runtimeDefault, '0');
  assert.equal(entry('NEWS_HACKERNEWSSEARCH_MIN_INTERVAL_MS').runtimeDefault, '1200000');
  assert.match(renderNewsEnv(), /Default: sum of the enabled family adapter budgets/);
});
