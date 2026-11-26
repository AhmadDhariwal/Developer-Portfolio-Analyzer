// Only exact public routes and bounded, typed diagnostic values may log queries.
// Unknown routes/parameters, credentials and private evidence stay query-free.
function safeDiagnosticQuery(pathname, originalUrl) {
  if (originalUrl.length > 2048) return '';
  const rules =
    pathname === '/api/recruiter-hub/shortlists'
      ? { jobId: /^[a-fA-F0-9]{24}$/ }
      : pathname === '/api/profile'
        ? { tab: /^(?:overview|settings|activity)$/ }
        : null;
  if (!rules) return '';

  const query = originalUrl.split('?')[1]?.split('#')[0] || '';
  // Reject malformed escapes rather than trying to recover ambiguous input.
  if (/%(?![a-fA-F0-9]{2})/.test(query)) return '';
  const params = new URLSearchParams(query);
  const safe = new URLSearchParams();
  for (const [key, pattern] of Object.entries(rules)) {
    const values = params.getAll(key);
    // Repeated keys are ambiguous, even when their first value is safe.
    if (values.length === 1 && pattern.test(values[0])) safe.set(key, values[0]);
  }
  const normalized = safe.toString();
  return normalized ? `?${normalized}` : '';
}

function requestLogPath(req) {
  const originalUrl = String(req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`);
  const pathname = originalUrl.split(/[?#]/, 1)[0];
  if (
    /^\/api\/recruiter-hub\/(?:shortlists\/applications(?:\/[^/]+)?|jobs\/[^/]+\/applications\/[^/]+(?:\/(?:shortlist|resume))?)\/?$/i.test(
      pathname
    )
  )
    return '/api/recruiter-hub/private-application-evaluation';
  const normalizedPath = pathname
    .replace(/(\/api\/tenant\/invitations\/accept\/)[^/]+/i, '$1:token')
    .replace(/(\/api\/tenant\/invitations\/)[^/]+(\/details\/?$)/i, '$1:token$2')
    .replace(/(\/api\/auth\/invite-details\/)[^/]+/i, '$1:token');
  return normalizedPath + safeDiagnosticQuery(pathname, originalUrl);
}

module.exports = requestLogPath;
