import { ORGANIZATION_POLICIES } from './organization-policy-catalog';
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function organizationAuditSummary(log: { action: string; before: unknown; after: unknown }) {
  if (log.action !== 'ORGANIZATION_CONFIGURATION_UPDATED') return null;
  const before = record(log.before);
  const after = record(log.after);
  const previous = record(before['values']);
  const current = record(after['values']);
  return {
    previousVersion: typeof before['version'] === 'number' ? before['version'] : null,
    version: typeof after['version'] === 'number' ? after['version'] : null,
    policies: ORGANIZATION_POLICIES.filter((policy) => typeof current[policy.id] === 'boolean').map(
      (policy) => ({
        title: policy.title,
        previous: previous[policy.id],
        value: current[policy.id],
      }),
    ),
    metadataFields: Object.keys(record(current['general'])),
    dashboardChanged: Object.hasOwn(current, 'dashboardConfig'),
  };
}
