// Public diagnostics contain fixed codes only; never upstream messages, URLs or credentials.
const REASONS = new Set([
  'allowed',
  'budget_not_configured',
  'quota_store_unavailable',
  'interval',
  'shared_interval',
  'concurrency',
  'shared_concurrency',
  'daily_budget',
  'monthly_budget',
  'shared_daily_budget',
  'shared_monthly_budget',
  'cooldown',
  'shared_cooldown',
  'upstream_rate_limit',
  'upstream_access_denied',
  'circuit_open',
  'source_failure',
  'source_timeout',
  'response_too_large',
  'invalid_payload',
  'unexpected_redirect',
  'source_http_error',
  'credentials_missing',
  'platform_disabled'
]);
function failureType(error) {
  if (error?.code === 'NEWS_INVALID_PAYLOAD') return 'invalid_payload';
  if (['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'].includes(error?.code)) return 'source_timeout';
  if (/maxContentLength/.test(String(error?.message || ''))) return 'response_too_large';
  const status = Number(error?.response?.status || 0);
  if (status >= 300 && status < 400) return 'unexpected_redirect';
  return status ? 'source_http_error' : 'source_failure';
}
function outcome(error, feedback = {}) {
  const type = failureType(error);
  const httpStatus = Number(error?.response?.status || 0);
  return {
    status: [401, 403, 429].includes(httpStatus) ? 'quota_limited' : 'unavailable',
    reason: feedback?.reason && feedback.reason !== 'source_failure' ? feedback.reason : type,
    failureType: type,
    httpStatus,
    nextEligibleAt: feedback?.nextEligibleAt || null,
    items: []
  };
}
function invalidPayload() {
  return Object.assign(new Error('Invalid provider response'), { code: 'NEWS_INVALID_PAYLOAD' });
}
function publicFields(value = {}) {
  const statuses = ['success', 'disabled', 'unavailable', 'quota_limited'];
  const deadline = value.nextEligibleAt && Date.parse(value.nextEligibleAt);
  return {
    status: statuses.includes(value.status) ? value.status : undefined,
    reason: REASONS.has(value.reason) ? value.reason : undefined,
    failureType: REASONS.has(value.failureType) ? value.failureType : undefined,
    httpStatus:
      Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599
        ? value.httpStatus
        : undefined,
    nextEligibleAt: Number.isFinite(deadline) ? new Date(deadline).toISOString() : null
  };
}
module.exports = { outcome, invalidPayload, publicFields };
