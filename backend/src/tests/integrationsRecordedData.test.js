const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getAdapter } = require('../services/integrations');
const resources = require('../services/integrations/kaggleResources');
const observations = require('../services/kaggleResourceObservationService');
const root = path.resolve(__dirname, '../../verification/integrations');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const followup = read('real-provider-live-followup.json');
const recorded = (provider) => followup.providers.find((row) => row.provider === provider);

test('current Marketplace never advertises active HackerRank statistics or Hashnode ingestion', () => {
  const marketplace = require('../services/integrations').marketplace;
  const hackerRank = marketplace.find((row) => row.provider === 'hackerrank');
  if (hackerRank) assert.match(hackerRank.description, /unavailable/);
  assert.ok(!marketplace.some((row) => row.provider === 'hashnode'));
  assert.equal(marketplace.find((row) => row.provider === 'devblogs').name, 'Dev.to');
});

test('recorded lee215 response retains difficulty counts, identity, ranking and reputation', async (t) => {
  const source = recorded('leetcode').requests.at(-1).sample;
  const adapter = getAdapter('leetcode');
  t.mock.method(adapter, 'post', async () => ({ data: { matchedUser: source } }));
  const result = await adapter.ingestData({ externalUsername: 'lee215' });
  assert.equal(source.username.toLowerCase(), 'lee215');
  for (const row of source.submitStats.acSubmissionNum.filter((row) => row.difficulty !== 'All'))
    assert.equal(result.activity[row.difficulty.toLowerCase()], row.count);
  assert.equal(result.profile.ranking, source.profile.ranking);
  assert.equal(result.profile.reputation, source.profile.reputation);
  assert.equal(
    result.profile.solvedProblems,
    result.activity.easy + result.activity.medium + result.activity.hard
  );
});

test('recorded Stack Overflow response retains numeric ownership, counts, badges and top tags', async (t) => {
  const responses = recorded('stackoverflow').requests.slice(-3);
  const adapter = getAdapter('stackoverflow');
  t.mock.method(adapter, 'get', async (url) => responses.find((row) => row.url === url)?.sample);
  const result = await adapter.ingestData({ externalUsername: '22656' });
  const user = responses[0].sample.items[0];
  assert.equal(user.user_id, 22656);
  assert.equal(result.profile.userId, '22656');
  for (const [target, field] of [
    ['reputation', 'reputation'],
    ['answerCount', 'answer_count'],
    ['questionCount', 'question_count']
  ])
    assert.equal(result.profile[target], user[field]);
  assert.equal(
    result.profile.totalBadges,
    Object.values(user.badge_counts).reduce((sum, count) => sum + count, 0)
  );
  assert.deepEqual(
    result.activity.namedBadges,
    responses[1].sample.items.slice(0, 10).map((row) => row.name)
  );
  assert.deepEqual(
    result.activity.topTags,
    responses[2].sample.items.slice(0, 8).map((row) => row.tag_name)
  );
});

test('captured live swyx articles retain authors, titles, reactions, tags and timestamps without inventing views', async (t) => {
  const source = read('functional-gaps-2026-10-27.json').liveRequests[0].articles;
  const adapter = getAdapter('devblogs');
  t.mock.method(adapter, 'get', async () =>
    source.map((row) => ({
      title: row.title,
      positive_reactions_count: row.reactions,
      tag_list: row.tags,
      published_at: row.publishedAt,
      user: { username: row.author }
    }))
  );
  const result = await adapter.ingestData({ externalUsername: 'devto@swyx' });
  assert.ok(source.every((row) => row.author.toLowerCase() === 'swyx'));
  assert.equal(result.profile.totalArticles, source.length);
  assert.equal(
    result.profile.totalReactions,
    source.reduce((sum, row) => sum + row.reactions, 0)
  );
  assert.equal(result.profile.totalViews, null);
  result.activity.recentArticles.forEach((row, index) => {
    assert.equal(row.title, source[index].title);
    assert.equal(row.publishedAt, source[index].publishedAt);
  });
});

test('retained leerob.com HTML evidence matches persisted metadata observations', () => {
  const row = read('real-provider-live-results.json').providers.find(
    (item) => item.provider === 'portfolio'
  );
  const source = row.requests.find((request) => request.sample.htmlBytes)?.sample;
  assert.equal(row.persisted.normalized.profile.statusCode, 200);
  for (const field of ['hasMeta', 'hasViewport', 'hasOgTags'])
    assert.equal(row.persisted.normalized.activity[field], source[field]);
});

test('recorded Kaggle extraction retains every available field and no scoring or ownership verification', async (t) => {
  const source = read('kaggle-attribution-diagnostic-2026-10-27.json');
  const original = process.env.KAGGLE_API_TOKEN;
  process.env.KAGGLE_API_TOKEN = 'test-fixture-not-a-credential';
  t.after(() => {
    if (original === undefined) delete process.env.KAGGLE_API_TOKEN;
    else process.env.KAGGLE_API_TOKEN = original;
  });
  t.mock.method(resources, 'post', async (url) =>
    url.includes('Kernels')
      ? { kernels: source.notebooks.resources }
      : { datasets: source.datasets.resources }
  );
  const result = await getAdapter('kaggle').ingestData({ externalUsername: 'dansbecker' });
  assert.deepEqual(result.activity.notebooks.resources, source.notebooks.resources);
  assert.deepEqual(result.activity.datasets.resources, source.datasets.resources);
  for (const row of [...result.activity.notebooks.resources, ...result.activity.datasets.resources])
    assert.ok(row.ref.startsWith('dansbecker/'));
  assert.ok(result.activity.notebooks.resources.every((row) => row.language === undefined));
  const snapshot = observations.normalize(result);
  assert.equal(snapshot.ownershipVerified, false);
  assert.deepEqual(result.inferredSkills, []);
  assert.ok(!/profileScore|activityScore|confidence|medals|ranking/.test(JSON.stringify(snapshot)));
});

test('disposable certification input remains self-reported and requires no provider request', async (t) => {
  const adapter = getAdapter('certifications');
  t.mock.method(adapter, 'get', () => assert.fail('No provider HTTP for self-report'));
  const result = await adapter.ingestData({
    externalUsername: 'AWS Certified Solutions Architect'
  });
  assert.equal(result.profile.totalCertifications, 1);
  assert.deepEqual(result.activity.certifications, ['AWS Certified Solutions Architect']);
});
