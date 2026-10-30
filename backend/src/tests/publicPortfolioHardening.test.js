const test = require('node:test');
const assert = require('node:assert/strict');
const { load, query, response } = require('./fixtures/publicPortfolioFixture');
const { createPortfolioCache, revisionFor } = require('../services/publicPortfolioCacheService');
const { imageType } = require('../middleware/portfolioImageUpload');

const profile = {
  _id: 'profile',
  userId: 'owner',
  slug: 'developer',
  isPublic: true,
  sections: { visibility: { projects: false, upcoming: false, testimonials: false, cta: false } },
  projects: [{ title: 'Hidden project' }],
  completedCourses: [{ title: 'Hidden course', isVisible: false }],
  totalViews: 15
};
const user = {
  _id: 'owner',
  name: 'Developer',
  email: 'private@example.com',
  phoneNumber: '12345'
};
function service(extra = {}) {
  return load('services/publicProfileService.js', {
    '../models/publicProfile': { findOne: () => query(profile) },
    '../models/user': { findById: () => query(user) },
    '../models/skillGraph': {
      findOne: () => query({ nodes: [{ kind: 'current', name: 'JavaScript', proficiency: 65 }] })
    },
    '../models/weeklyReport': {
      findOne: () => query({ progressSummary: 'Private report', biggestRiskArea: 'Private risk' })
    },
    './publicPortfolioVisibilityService': { isPortfolioEnabled: async () => true },
    ...extra
  });
}
test('public serializer excludes contacts, analytics, hidden collections and private weekly reports', async () => {
  const api = service();
  const publicPayload = await api.buildPublicProfilePayload(profile, user, null, {
    publicOnly: true
  });
  const serialized = JSON.stringify(publicPayload);
  for (const secret of [
    'private@example.com',
    '12345',
    'Hidden project',
    'Hidden course',
    'Private report',
    'Private risk',
    'totalViews'
  ])
    assert.ok(!serialized.includes(secret), secret);
  assert.deepEqual(publicPayload.projects, []);
  assert.deepEqual(publicPayload.workExperiences, []);
  assert.equal(publicPayload.sections.cta.resumeUrl, '');
  const owner = await api.buildPublicProfilePayload(profile, user);
  assert.equal(owner.email, user.email);
  assert.equal(owner.analytics.totalViews, 15);
  assert.equal(owner.completedCourses.length, 1);
});
test('visibility is checked before caches; unauthorized previews never invoke public cache', async () => {
  let reads = 0;
  const api = service({
    '../models/publicProfile': { findOne: () => query({ ...profile, isPublic: false }) },
    './publicPortfolioCacheService': {
      portfolioCache: {
        get: () => {
          reads++;
          throw Error('should not cache');
        }
      }
    }
  });
  assert.equal(await api.getPublicProfileBySlug('developer', {}), null);
  assert.equal(
    await api.getPublicProfileBySlug('developer', {
      query: { preview: 'true' },
      user: { _id: 'foreign' }
    }),
    null
  );
  const preview = await api.getPublicProfileBySlug('developer', {
    query: { preview: 'true' },
    user
  });
  assert.equal(preview.email, user.email);
  assert.equal(reads, 0);
});
test('authorization outage and inactive or deleted accounts fail closed', async () => {
  const api = service({
    '../models/publicProfile': {
      findOne: () => ({
        lean: async () => {
          throw Error('Mongo unavailable');
        }
      })
    }
  });
  await assert.rejects(api.getPublicProfileBySlug('developer', {}), /Mongo unavailable/);
  for (const account of [null, { ...user, isActive: false }])
    assert.equal(
      await service({
        '../models/user': { findById: () => query(account) }
      }).getPublicProfileBySlug('developer', {}),
      null
    );
});
test('platform revocation and settings lookup outage cannot serve a warmed cache', async () => {
  const disabled = service({
    './publicPortfolioVisibilityService': { isPortfolioEnabled: async () => false }
  });
  assert.equal(await disabled.getPublicProfileBySlug('developer', {}), null);
  assert.equal(await disabled.getPublicProfileResumeDownload('developer'), null);
  const unavailable = service({
    './publicPortfolioVisibilityService': {
      isPortfolioEnabled: async () => {
        throw Error('settings unavailable');
      }
    }
  });
  await assert.rejects(unavailable.getPublicProfileBySlug('developer', {}), /settings unavailable/);
});
test('validation rejects markup, credentials, malformed visibility, excessive arrays, unsafe URLs', () => {
  const api = service();
  for (const body of [
    { summary: '<img src=x onerror=alert(1)>' },
    { sections: { visibility: { projects: 'false' } } },
    { projects: Array(51).fill({}) },
    { projects: [{ url: 'javascript:alert(1)' }] },
    { socialLinks: { website: 'https://user:password@example.com' } }
  ])
    assert.throws(() => api.validatePublicProfileUpdatePayload(body), { statusCode: 400 });
  api.validatePublicProfileUpdatePayload({
    projects: [{ imageUrl: '/uploads/portfolio-images/owner-image.png' }],
    sections: { visibility: { projects: false } }
  });
});
test('cache revisions change for edits/account changes but not analytics updates', () => {
  assert.notEqual(revisionFor(profile, user), revisionFor({ ...profile, slug: 'new-slug' }, user));
  assert.notEqual(revisionFor(profile, user), revisionFor(profile, { ...user, name: 'Changed' }));
  assert.equal(
    revisionFor(profile, user),
    revisionFor({ ...profile, totalViews: 20, updatedAt: new Date() }, user)
  );
});
test('bounded local single-flight, TTL and same-revision stale fallback', async () => {
  let loads = 0;
  const rows = new Map();
  const store = {
    findOne: ({ key }) => query(rows.get(key)),
    updateOne: async (_filter, update) => rows.set(update.$set.key, update.$set)
  };
  const cache = createPortfolioCache({
    store,
    redis: { getRedisCacheClient: () => null },
    max: 2,
    freshMs: 10,
    staleMs: 1000
  });
  const loader = async () => {
    loads++;
    await new Promise((r) => setTimeout(r, 5));
    return { value: 'public' };
  };
  await Promise.all(Array.from({ length: 20 }, () => cache.get(profile, user, loader)));
  assert.equal(loads, 1);
  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(
    await cache.get(profile, user, async () => {
      throw Error('enrichment unavailable');
    }),
    { value: 'public' }
  );
  await assert.rejects(
    cache.get({ ...profile, headline: 'new revision' }, user, async () => {
      throw Error('no stale data for new content');
    }),
    /no stale/
  );
});
test('rate limiter preserves 429/Retry-After and fails closed on Mongo admission outage', async () => {
  const controls = load('middleware/publicPortfolioRateLimit.js', {
    '../services/integrationMongoGovernanceService': {
      requestWindow: async (_key, _maximum, windowMs) => {
        if (unavailable) throw Error('Mongo unavailable');
        return { count: ++count, until: Date.now() + windowMs };
      }
    }
  });
  let count = 0;
  let unavailable = false;
  const read = controls.limiter('test', 1, 60000);
  let allowed = 0;
  await read({ ip: '127.0.0.1' }, response(), () => allowed++);
  const denied = response();
  await read({ ip: '127.0.0.1' }, denied, () => allowed++);
  assert.equal(allowed, 1);
  assert.equal(denied.statusCode, 429);
  assert.ok(Number(denied.headers['Retry-After']) > 0);
  unavailable = true;
  const strict = response();
  await controls.uploadLimit({ user }, strict, () => assert.fail());
  assert.equal(strict.statusCode, 503);
  unavailable = false;
  count = 0;
  let mutationAllowed = false;
  await controls.mutationLimit({ user }, response(), () => {
    mutationAllowed = true;
  });
  assert.equal(mutationAllowed, true);
});
test('analytics excludes bots, owner/preview and invalid traffic before writes', async () => {
  let writes = 0;
  const api = service({ '../models/publicPortfolioVisit': { create: async () => writes++ } });
  for (const req of [
    { method: 'HEAD' },
    { method: 'GET', user },
    { method: 'GET', query: { preview: '1' } },
    { method: 'GET', ip: '127.0.0.1', headers: { 'user-agent': 'Googlebot' } }
  ])
    await api.recordProfileView({ profile, req });
  assert.equal(writes, 0);
});
test('resume rejects paths outside uploads and non-PDFs', () => {
  const api = service();
  for (const value of [
    '../../AGENTS.md',
    'C:/Windows/system.ini',
    'uploads/avatars/avatar.png',
    'uploads/nonexistent.pdf'
  ])
    assert.equal(api.resolveStoredResumePath(value), '');
});
test('resume requires published portfolio, owned file, active account and visible CTA', async () => {
  let files = 0;
  const api = service({
    '../models/resumeFile': {
      findOne: () => {
        files++;
        return query(null);
      }
    }
  });
  assert.equal(await api.getPublicProfileResumeDownload('developer'), null);
  assert.equal(files, 0);
});
test('image validator rejects SVG, HTML and forged empty files', () => {
  for (const input of ['<svg onload=alert(1)>', '<html>', 'RIFFfakeWEBP'])
    assert.equal(imageType(Buffer.from(input)), null);
  assert.equal(imageType(Buffer.alloc(0)), null);
  assert.equal(imageType(Buffer.from([255, 216, 255, 0, 255, 217])), null);
});
test('contact enforces recruiter identity and reports provider failure without fake success', async () => {
  let sent = 0;
  const contact = load('services/publicPortfolioContactService.js', {
    '../models/publicProfile': { findOne: () => query(profile) },
    '../models/user': { findById: () => query(user) },
    './publicPortfolioVisibilityService': { isPortfolioEnabled: async () => true },
    './emailService': {
      sendConfiguredEmail: async (mail) => {
        sent++;
        assert.equal(mail.replyTo, 'recruiter@example.com');
        assert.equal(mail.html, undefined);
        throw Error('SMTP offline');
      }
    }
  });
  const recruiter = {
    _id: 'other',
    role: 'recruiter',
    isVerified: true,
    email: 'recruiter@example.com'
  };
  await assert.rejects(
    contact.deliverContact('developer', user, {
      message: 'Interested in your project and experience.'
    }),
    { statusCode: 403 }
  );
  await assert.rejects(
    contact.deliverContact('developer', recruiter, {
      message: 'Interested in your project and experience.',
      website: 'spam'
    }),
    { statusCode: 400 }
  );
  await assert.rejects(
    contact.deliverContact('developer', recruiter, {
      message: 'Interested in your project and experience.'
    }),
    { statusCode: 503 }
  );
  assert.equal(sent, 1);
});
test('contact returns success only after SMTP accepts delivery to the portfolio owner', async () => {
  const contact = load('services/publicPortfolioContactService.js', {
    '../models/publicProfile': { findOne: () => query(profile) },
    '../models/user': { findById: () => query(user) },
    './publicPortfolioVisibilityService': { isPortfolioEnabled: async () => true },
    './emailService': {
      sendConfiguredEmail: async (mail) => {
        assert.equal(mail.to, user.email);
        assert.equal(mail.replyTo, 'verified@example.com');
        return { accepted: [user.email] };
      }
    }
  });
  const result = await contact.deliverContact(
    'developer',
    { _id: 'recruiter', role: 'recruiter', emailVerified: true, email: 'verified@example.com' },
    { message: 'Interested in discussing your project.', to: 'attacker@example.com' }
  );
  assert.deepEqual(result, { sent: true });
});
test('resume resolves symlinks before enforcing uploads confinement', () => {
  const path = require('node:path');
  const root = path.resolve(__dirname, '../../uploads');
  const api = service({
    'node:fs': {
      realpathSync: (candidate) =>
        candidate === root ? root : path.resolve(root, '../private.pdf'),
      statSync: () => ({ isFile: () => true })
    }
  });
  assert.equal(api.resolveStoredResumePath(path.join(root, 'link.pdf')), '');
});
test('memory capacity evicts old entries and expired stale data cannot be served', async () => {
  const cache = createPortfolioCache({
    store: { findOne: () => query(null), updateOne: async () => {} },
    redis: { getRedisCacheClient: () => null },
    max: 1,
    freshMs: 1,
    staleMs: 10
  });
  await cache.get(profile, user, async () => ({ value: 1 }));
  await cache.get({ ...profile, _id: 'another' }, user, async () => ({ value: 2 }));
  await assert.rejects(
    cache.get(profile, user, async () => {
      throw Error('evicted');
    }),
    /evicted/
  );
  await new Promise((resolve) => setTimeout(resolve, 15));
  await assert.rejects(
    cache.get({ ...profile, _id: 'another' }, user, async () => {
      throw Error('expired');
    }),
    /expired/
  );
  await assert.rejects(
    cache.get({ ...profile, isPublic: false }, user, async () => assert.fail()),
    { statusCode: 404 }
  );
});
