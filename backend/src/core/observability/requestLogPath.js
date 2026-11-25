// Private application identifiers and notification queries must not enter logs.
// Keep other routes' established request/audit representation unchanged.
function requestLogPath(req) {
  const pathname = String(req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`).split(
    /[?#]/,
    1
  )[0];
  if (
    /^\/api\/recruiter-hub\/(?:shortlists\/applications(?:\/[^/]+)?|jobs\/[^/]+\/applications\/[^/]+(?:\/(?:shortlist|resume))?)\/?$/i.test(
      pathname
    )
  )
    return '/api/recruiter-hub/private-application-evaluation';
  return /^\/api\/notifications(?:\/|$)/i.test(pathname) ? pathname : req.originalUrl;
}

module.exports = requestLogPath;
