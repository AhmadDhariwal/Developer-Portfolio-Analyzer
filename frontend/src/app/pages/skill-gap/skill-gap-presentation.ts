export function sourceLabel(type: string): string {
  return (
    (
      {
        github: 'GitHub',
        resume: 'Active resume',
        profile: 'Developer profile',
        integration: 'Optional integration',
      } as Record<string, string>
    )[type] || type
  );
}

export function evidenceLabel(kind: string): string {
  return (
    (
      {
        IMPLEMENTATION: 'Inspected implementation',
        METADATA: 'Repository metadata / dependencies',
        CLAIM: 'Resume mention / self-reported claim',
      } as Record<string, string>
    )[kind] || kind
  );
}

export function warningLabel(warning: string): string {
  const [code, detail] = warning.split(':');
  const messages: Record<string, string> = {
    partial_source_limitations:
      'Some evidence sources are incomplete or unavailable. Coverage is calculated only when all required skills can be assessed.',
    career_requirements_unavailable:
      'Career requirements are unavailable. Configure your career target.',
    required_evidence_unknown:
      'Coverage cannot be calculated because evidence for one or more required skills is unknown.',
    github_and_resume_evidence_unavailable: 'No analyzed GitHub or resume evidence is available.',
    stale_source: 'This source is marked stale. Reanalyze it to update the evidence.',
    source_timestamp_unavailable: 'The source has no recorded timestamp.',
    freshness_age_not_calibrated:
      'Evidence age is recorded; no calibrated age threshold is defined.',
    conflicting_positive_evidence:
      'Conflicting positive evidence needs review; classification is conservative.',
    missing_requirement_entry: 'A career requirement matrix entry is missing.',
    score_unavailable: 'Coverage is unavailable for this evidence snapshot.',
  };
  return (messages[code] || warning.replace(/_/g, ' ')) + (detail ? ` (${detail})` : '');
}
