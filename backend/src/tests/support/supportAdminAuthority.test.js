const test = require('node:test');
const assert = require('node:assert/strict');
const supportRoutes = require('../../modules/support/support.routes');

test('organization admins cannot access platform-wide support administration', async () => {
  const routes = supportRoutes.stack
    .filter((layer) => layer.route?.path?.startsWith('/admin/tickets'))
    .map((layer) => layer.route.stack[1].handle);

  assert.equal(routes.length, 4);

  for (const authorize of routes) {
    let statusCode;
    let nextCalled = false;
    const response = {
      status(code) {
        statusCode = code;
        return this;
      },
      json() {
        return this;
      }
    };

    authorize({ user: { role: 'admin' } }, response, () => {
      nextCalled = true;
    });

    assert.equal(statusCode, 403);
    assert.equal(nextCalled, false);
  }
});

test('Super Admin support administration remains authorized', async () => {
  const routes = supportRoutes.stack
    .filter((layer) => layer.route?.path?.startsWith('/admin/tickets'))
    .map((layer) => layer.route.stack[1].handle);

  for (const authorize of routes) {
    let nextCalled = false;
    const response = {
      status() {
        throw new Error('Super Admin should be authorized.');
      },
      json() {
        throw new Error('Super Admin should be authorized.');
      }
    };

    authorize({ user: { role: 'super_admin' } }, response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
  }
});
