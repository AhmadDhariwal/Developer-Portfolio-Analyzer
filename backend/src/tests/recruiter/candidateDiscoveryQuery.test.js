const { randomBytes } = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const pagination = require('../../modules/recruiter/utils/hub/candidateDiscoveryQuery');

test('discovery cursors are scoped positions, not authentication or reusable cross-query grants', (t) => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  t.after(() => {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });
  const options = pagination.parse({
    search: 'literal .* query',
    skills: 'Node.js, node.js',
    limit: 12
  });
  assert.deepEqual(options.skills, ['node.js']);
  const scope = {
    recruiterId: 'owner',
    organizationId: 'organization',
    sessionRevision: 2,
    visibility: 'public'
  };
  const token = pagination.encode(options, scope, { _id: '0123456789abcdef01234567', position: 0 });
  const next = { ...options, page: 2, cursor: token };
  assert.equal(pagination.decode(next, scope).key, 0);
  for (const changed of [
    { ...scope, recruiterId: 'peer' },
    { ...scope, organizationId: 'other' },
    { ...scope, sessionRevision: 3 },
    { ...scope, visibility: 'organization' }
  ])
    assert.throws(() => pagination.decode(next, changed), { statusCode: 400 });
  assert.throws(() => pagination.decode({ ...next, limit: 24 }, scope), { statusCode: 400 });
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 16 * 60 * 1000);
  assert.throws(() => pagination.decode(next, scope), { statusCode: 400 });
});

test('invalid page/filter shapes and expensive offsets are rejected explicitly', () => {
  for (const query of [
    { page: {} },
    { limit: [] },
    { page: 'NaN' },
    { page: -1 },
    { page: '9007199254740992' },
    { sortBy: 'constructor' },
    {
      skills: Array(21)
        .fill('different')
        .map((value, index) => value + index)
    },
    { profileCompleteness: 101 },
    { search: 'x'.repeat(201) },
    { cursor: 'x'.repeat(2049) }
  ])
    assert.throws(() => pagination.parse(query), { statusCode: 400 });
  assert.throws(() => pagination.decode(pagination.parse({ page: 100000 }), {}), {
    statusCode: 400
  });
});
