const test = require('node:test');
const assert = require('node:assert/strict');
const requestLogPath = require('../../core/observability/requestLogPath');

for (const pathname of [
  '/api/notifications',
  '/api/notifications/stream',
  '/api/notifications/STREAM/',
  '/API/Notifications/stream/',
  '/api/notifications/notice/read',
  '/api/notifications/bulk-delete'
]) {
  test(`notification log path omits credentials and private search: ${pathname}`, () => {
    const originalUrl = `${pathname}?token=synthetic-jwt&search=private-notification-text`;
    assert.equal(requestLogPath({ path: pathname, originalUrl }), pathname);
  });
}

test('notification logging safely handles a request without a parsed path', () => {
  assert.equal(
    requestLogPath({ originalUrl: '/api/notifications?token=synthetic-jwt' }),
    '/api/notifications'
  );
});

test('profile logging retains a known diagnostic tab; unknown routes discard queries', () => {
  assert.equal(requestLogPath({ originalUrl: '/api/profile?tab=settings' }), '/api/profile?tab=settings');
  // Intentional security contract: unknown routes no longer retain arbitrary queries.
  assert.equal(
    requestLogPath({ originalUrl: '/api/notifications-extra?value=1' }),
    '/api/notifications-extra'
  );
});

test('profile diagnostics never log encoded, repeated or malformed secrets', () => {
  for (const key of [
    'password',
    'token',
    'invitationToken',
    'otp',
    'api_key',
    'authorization',
    'applicationId',
    'applicationEvidence',
    'code',
    '%74oken',
    '%2574oken',
    'token[]'
  ]) {
    assert.equal(
      requestLogPath({ originalUrl: `/api/profile?tab=settings&${key}=synthetic-secret&${key}=again` }),
      '/api/profile?tab=settings'
    );
  }
  for (const query of [
    'tab=settings&%74ab=overview',
    'tab=synthetic-secret',
    'tab=%2573ettings',
    'tab=settings&token=%',
    'tab=settings&%ZZ=synthetic-secret',
    'tab=settings%00',
    'tab=settings&token=' + 'a'.repeat(2100)
  ]) {
    assert.equal(requestLogPath({ originalUrl: `/api/profile?${query}` }), '/api/profile');
  }
});

test('mounted notification routers retain a query-free full audit route', () => {
  assert.equal(
    requestLogPath({
      path: '/bulk-delete',
      baseUrl: '/api/notifications',
      originalUrl: '/api/notifications/bulk-delete?token=synthetic-jwt'
    }),
    '/api/notifications/bulk-delete'
  );
});
