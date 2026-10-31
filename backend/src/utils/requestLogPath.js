// Notification queries can contain private search text or rejected URL credentials.
// Keep other modules' established request/audit route representation unchanged.
function requestLogPath(req) {
  const pathname = String(req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`).split(
    /[?#]/,
    1
  )[0];
  return /^\/api\/notifications(?:\/|$)/i.test(pathname) ? pathname : req.originalUrl;
}

module.exports = requestLogPath;
