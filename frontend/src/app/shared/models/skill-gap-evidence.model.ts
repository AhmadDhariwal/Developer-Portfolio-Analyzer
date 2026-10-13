/** Backend-owned facts. Presentation must never derive proficiency or scores. */
export const SKILL_EVIDENCE_VERSION = 'skill-evidence-coverage-v1';
export type EvidenceStatus =
  | 'DEMONSTRATED'
  | 'PARTIAL'
  | 'CLAIMED_ONLY'
  | 'NOT_EVIDENCED'
  | 'UNKNOWN';
export type EvidenceConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
export interface SourceReference {
  type: string;
  id: string;
  available: boolean;
  completeness: string;
  timestamp: string | null;
  freshness: string;
  ruleVersion?: string;
}
export interface SkillSource {
  kind: 'IMPLEMENTATION' | 'METADATA' | 'CLAIM';
  type: string;
  id: string;
  origin: string;
  artifact: string;
  timestamp: string | null;
  freshness: string;
  conflicting: boolean;
}
export interface EvidenceSkill {
  name: string;
  category: string;
  requirement: 'REQUIRED' | 'OPTIONAL';
  weight: number;
  status: EvidenceStatus;
  evidenceCredit: number | null;
  evidenceConfidence: EvidenceConfidence;
  independentTechnicalSources: number;
  evidence: SkillSource[];
  warnings: string[];
}
export interface SkillEvidenceContract {
  ruleVersion?: string;
  requirementMatrixVersion?: string;
  calculatedAt?: string;
  coverageUnavailableReason?: string | null;
  skills?: EvidenceSkill[];
  requiredSkills?: EvidenceSkill[];
  optionalSkills?: EvidenceSkill[];
  evidenceConfidence?: EvidenceConfidence;
  evidenceCompleteness?: {
    githubAvailable: boolean;
    resumeAvailable: boolean;
    availableCoreSources: number;
    totalCoreSources: number;
    complete: boolean;
    sources: SourceReference[];
  };
  sourceReferences?: SourceReference[];
  categoryBreakdown?: Record<
    string,
    {
      requiredSkillCount: number;
      optionalSkillCount: number;
      requiredWeight: number;
      weightedCredit: number;
      coverage: number | null;
    }
  >;
  warnings?: string[];
  legacyReadinessScore?: number | null;
  legacyConfidence?: number;
  aiUsed?: boolean;
}
export const STATUS_LABELS: Record<EvidenceStatus, string> = {
  DEMONSTRATED: 'Demonstrated',
  PARTIAL: 'Partial',
  CLAIMED_ONLY: 'Claimed only',
  NOT_EVIDENCED: 'Not evidenced',
  UNKNOWN: 'Unknown',
};
export const STATUS_REASONS: Record<EvidenceStatus, string> = {
  DEMONSTRATED: 'Meaningful inspected implementation evidence supports practical use.',
  PARTIAL:
    'Relevant technical evidence exists; practical proficiency is not sufficiently demonstrated.',
  CLAIMED_ONLY:
    'A resume mention or self-reported claim has no independent technical confirmation.',
  NOT_EVIDENCED:
    'Available analyzed sources do not establish this skill. This does not mean you lack it.',
  UNKNOWN: 'Available sources are insufficient to assess this skill reliably.',
};
