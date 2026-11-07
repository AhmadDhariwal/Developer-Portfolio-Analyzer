const test = require('node:test');
const assert = require('node:assert/strict');
const hashnode = require('../services/integrations/hashnodePublication');
const { getAdapter, marketplace } = require('../services/integrations');

function configure(t) {
  const keys = ['HASHNODE_PAT', 'HASHNODE_PUBLICATION_HOST'];
  const original = keys.map((key) => process.env[key]);
  process.env.HASHNODE_PAT = 'fixture-pat';
  process.env.HASHNODE_PUBLICATION_HOST = 'writer.hashnode.dev';
  t.after(() =>
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    })
  );
}

function payload() {
  const post = {
    id: 'post-one',
    title: 'Typed APIs',
    reactionCount: 7,
    publishedAt: '2026-10-26T09:00:00Z',
    author: { username: 'writer' },
    tags: [{ slug: 'typescript' }]
  };
  return {
    data: {
      me: { id: 'owner-one', username: 'writer' },
      publication: {
        id: 'publication-one',
        author: { id: 'owner-one', username: 'writer' },
        postsCount: { totalDocuments: 40 },
        posts: {
          edges: [
            { node: post },
            { node: { ...post, id: 'post-two', author: { username: 'colleague' } } }
          ],
          pageInfo: { hasNextPage: true }
        }
      }
    }
  };
}

test('retained diagnostic helper preserves its contract without enabling retired Hashnode ingestion', async (t) => {
  configure(t);
  t.mock.method(getAdapter('devblogs'), 'fetchDevTo', () =>
    assert.fail('Hashnode must not fetch Dev.to')
  );
  t.mock.method(hashnode, 'post', async (url, body, config) => {
    assert.equal(url, 'https://gql-beta.hashnode.com');
    assert.equal(config.headers.Authorization, 'Bearer fixture-pat');
    assert.deepEqual(body.variables, { host: 'writer.hashnode.dev' });
    assert.match(body.query, /posts\(first: 30\)/);
    assert.doesNotMatch(body.query, /mutation|fixture-pat/);
    return payload();
  });
  const result = await hashnode.fetch('writer');
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].reactions, 7);
  assert.equal(result.articles[0].views, null);
  assert.equal(result.hasMorePublicationPosts, true);
  assert.equal(result.observedPublicationPosts, 2);
  assert.equal(result.sampleLimit, 30);
  assert.equal(result.publicationPostCount, 40);
  assert.ok(!JSON.stringify(result).includes('fixture-pat'));
  assert.doesNotMatch(
    marketplace.find((item) => item.provider === 'devblogs').description,
    /Hashnode/
  );
  await assert.rejects(
    getAdapter('devblogs').ingestData({ externalUsername: 'hashnode@writer' }),
    /retired/
  );
});

test('Hashnode rejects invalid configuration without an outbound request', async (t) => {
  configure(t);
  t.mock.method(hashnode, 'post', () => assert.fail('Unexpected request'));
  for (const host of [
    '',
    'http://writer.hashnode.dev',
    'https://writer.hashnode.dev/path',
    'writer.hashnode.dev/path',
    'user:pass@host.dev',
    'localhost'
  ]) {
    process.env.HASHNODE_PUBLICATION_HOST = host;
    await assert.rejects(hashnode.fetch('writer'), /HASHNODE_PUBLICATION_HOST/);
  }
});

test('Hashnode safely normalizes an HTTPS publication root URL without rewriting environment values', async (t) => {
  configure(t);
  process.env.HASHNODE_PUBLICATION_HOST = 'https://WRITER.hashnode.dev/';
  t.mock.method(hashnode, 'post', async (_url, body) => {
    assert.equal(body.variables.host, 'writer.hashnode.dev');
    return payload();
  });
  const result = await hashnode.fetch();
  assert.equal(result.username, 'writer');
  assert.equal(process.env.HASHNODE_PUBLICATION_HOST, 'https://WRITER.hashnode.dev/');
  for (const value of [
    'https://user:password@writer.hashnode.dev/',
    'https://writer.hashnode.dev/?secret=value',
    'https://writer.hashnode.dev/#fragment'
  ]) {
    process.env.HASHNODE_PUBLICATION_HOST = value;
    assert.equal(hashnode.validateConfig().ok, false);
  }
});

test('Hashnode requires publication ownership and reports the Pro gate without accepting partial data', async (t) => {
  configure(t);
  const notOwner = payload();
  notOwner.data.publication.author.id = 'another-owner';
  let response = notOwner;
  t.mock.method(hashnode, 'post', async () => response);
  await assert.rejects(hashnode.fetch('writer'), { code: 'HASHNODE_OWNER_MISMATCH' });
  response = {
    ...payload(),
    errors: [
      { message: 'Publication does not have an active Pro plan', extensions: { code: 'FORBIDDEN' } }
    ]
  };
  await assert.rejects(hashnode.fetch('writer'), { status: 403, code: 'HASHNODE_PRO_REQUIRED' });
  response = { errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] };
  await assert.rejects(hashnode.fetch('writer'), { status: 401, code: 'HASHNODE_AUTH_FAILED' });
});

test('Hashnode rejects partial errors, missing permissions, identity mismatch and malformed observations', async (t) => {
  configure(t);
  const cases = [
    { ...payload(), errors: [{ message: 'FORBIDDEN' }] },
    { data: { me: { username: 'writer' }, publication: null } },
    { data: { ...payload().data, me: { username: 'someone-else' } } }
  ];
  const invalidMetric = payload();
  delete invalidMetric.data.publication.posts.edges[0].node.reactionCount;
  cases.push(invalidMetric);
  const duplicatePost = payload();
  duplicatePost.data.publication.posts.edges.push(duplicatePost.data.publication.posts.edges[0]);
  cases.push(duplicatePost);
  for (const response of cases) {
    const mock = t.mock.method(hashnode, 'post', async () => response);
    await assert.rejects(hashnode.fetch('writer'), /unavailable|invalid|read failed/);
    mock.mock.restore();
  }
  t.mock.method(hashnode, 'post', async () => {
    throw Error('fixture-pat must not escape');
  });
  await assert.rejects(hashnode.fetch('writer'), (error) => {
    assert.match(error.message, /Verify the PAT, Pro publication and API permissions/);
    assert.ok(!error.message.includes('fixture-pat'));
    return true;
  });
});

test('Hashnode retains shared quota status and Retry-After without exposing provider errors', async (t) => {
  configure(t);
  t.mock.method(hashnode, 'post', async () => {
    throw Object.assign(Error('private upstream detail'), { status: 429, retryAfter: 60 });
  });
  await assert.rejects(hashnode.fetch('writer'), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfter, 60);
    assert.ok(!error.message.includes('private upstream detail'));
    return true;
  });
});

test('nullable tags and unknown publication counts stay unavailable, while impossible totals are rejected', async (t) => {
  configure(t);
  const response = payload();
  response.data.publication.posts.edges[0].node.tags = null;
  response.data.publication.postsCount.totalDocuments = null;
  t.mock.method(hashnode, 'post', async () => response);
  const result = await hashnode.fetch('writer');
  assert.deepEqual(result.articles[0].tags, []);
  assert.equal(result.publicationPostCount, null);
  assert.equal(result.articles.length, 1);
  response.data.publication.postsCount.totalDocuments = 1;
  await assert.rejects(hashnode.fetch('writer'), /invalid publication post count/);
});

test('Hashnode HTTP reads pass through the existing devblogs governance boundary', async (t) => {
  configure(t);
  const axios = require('axios');
  const governance = require('../services/integrationGovernanceService');
  let admitted = false;
  t.mock.method(governance, 'request', async (provider, operation) => {
    assert.equal(provider, 'devblogs');
    admitted = true;
    return operation({ maxRedirects: 0, timeout: 5000 });
  });
  t.mock.method(axios, 'post', async (url, body, config) => {
    assert.ok(admitted);
    assert.equal(url, 'https://gql-beta.hashnode.com');
    assert.equal(config.maxRedirects, 0);
    assert.equal(config.timeout, 5000);
    return { data: payload() };
  });
  const result = await hashnode.fetch('writer');
  assert.equal(result.articles.length, 1);
});
