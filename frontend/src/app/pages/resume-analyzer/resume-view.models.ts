import { BadgeVariant, ProgressColor } from '../../shared/components';
export interface DisplayBreakdownDimension {
  key: string;
  label: string;
  description: string;
  weightPct: number;
  value: number | null;
  contribution: number | null;
  available: boolean;
  explanation: string;
  tone: ProgressColor;
}

export interface SkillGroupViewModel {
  category: string;
  skills: string[];
}

export interface SectionPresenceItem {
  key: string;
  label: string;
  present: boolean;
}

export interface QualityIndicatorConfig {
  label: string;
  badgeVariant: BadgeVariant;
  title: string;
  description: string;
  recoveryCta: string | null;
}
