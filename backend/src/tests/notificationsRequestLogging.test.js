const test = require('node:test');
const assert = require('node:assert/strict');
const requestLogPath = require('../utils/requestLogPath');

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

test('unrelated module logging is unchanged and similar route names do not match', () => {
  for (const originalUrl of ['/api/profile?tab=settings', '/api/notifications-extra?value=1']) {
    assert.equal(requestLogPath({ path: originalUrl.split('?')[0], originalUrl }), originalUrl);
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
