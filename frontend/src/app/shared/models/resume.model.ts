export type ContentQualityStatus = 'VALID' | 'PARTIALLY_READABLE' | 'UNREADABLE' | 'EMPTY' | 'INVALID';

export interface ResumeContentQualityState {
  state: ContentQualityStatus;
  scoreable: boolean;
  wordCount?: number;
  uniqueWordCount?: number;
  version?: string;
}

export interface ResumeScoringBreakdownItem {
  score: number;
  weight: number;
  contribution: number;
  available: boolean;
  explanation?: string;
}

export interface ResumeScoringEvidence {
  sources?: Array<{ type: string; id: string }>;
  inputs?: Record<string, any>;
  facts?: {
    quantifiedAchievementCount?: number;
    technologyCount?: number;
    sectionCount?: number;
    experienceYears?: number;
    wordCount?: number;
    [key: string]: any;
  };
}

export interface ResumeScoringResult {
  ruleVersion: string;
  calculatedAt: string;
  score: number | null;
  breakdown: Record<string, ResumeScoringBreakdownItem>;
  evidence: ResumeScoringEvidence;
  warnings: string[];
}

export interface ResumeAIInsights {
  aiUsed: boolean;
  focusAreas?: string[];
  critique?: string[];
  suggestions?: string[];
  priorities?: Array<{
    title: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    category?: string;
  }>;
  executiveSummary?: string;
  writingSuggestions?: string[];
  strengths?: string[];
  weaknesses?: string[];
  recommendations?: string[];
  [key: string]: any;
}

export interface ResumeSuggestion {
  id?: string;
  title: string;
  description: string;
  color?: 'red' | 'orange' | 'blue' | 'purple' | 'cyan';
  icon?: string;
  category?: string;
  impact?: 'high' | 'medium' | 'low';
  priorityLabel?: string;
}

export interface ResumeFile {
  fileId: string;
  userId?: string;
  fileName: string;
  fileUrl?: string;
  fileSize?: number;
  uploadDate: string | Date;
  isAnalyzed?: boolean;
  isDefault?: boolean;
  isActive?: boolean;
  lastAnalyzed?: string | null;
  resumeHash?: string;
  analysisVersion?: string;
  contentQualityState?: ResumeContentQualityState | null;
}

export interface ResumeWarning {
  code: string;
  severity: 'low' | 'medium' | 'high' | string;
  message: string;
  evidence?: string;
}

export interface ResumeRecruiterPerspective {
  strengths?: string[];
  concerns?: string[];
  interviewRisks?: string[];
  hiringReadiness?: string;
  resumeSummary?: string;
}

export interface ResumeNormalizedIntelligence {
  personalInfo?: Record<string, string>;
  education?: string[];
  experience?: string[];
  projects?: string[];
  skills?: Record<string, string[]>;
  certifications?: string[];
  achievements?: string[];
  publications?: string[];
  volunteerWork?: string[];
  leadership?: string[];
  openSourceContributions?: string[];
  sectionPresence?: Record<string, boolean>;
  experienceYears?: number;
  experienceLevel?: string;
}

export interface ScoreCardData {
  title: string;
  score: number | null;
  maxScore?: number;
  color: 'purple' | 'pink' | 'green' | 'amber';
  subtitle?: string;
  available?: boolean;
}

export interface ResumeAnalysis {
  fileId?: string;
  fileName?: string;
  fileSize?: number;
  uploadDate?: string;
  analyzedAt?: string;
  resumeHash?: string;
  analysisVersion?: string;

  // Authoritative scoring & content quality
  scoring?: ResumeScoringResult | null;
  contentQualityState?: ResumeContentQualityState | null;

  // Legacy sub-scores (sub-dimensions)
  atsScore: number;
  keywordDensity: number;
  formatScore: number;
  contentQuality: number;

  skills: {
    [category: string]: string[];
  };
  experienceYears?: number;
  experienceLevel?: string;
  certifications?: string[];
  keyAchievements?: string[];
  suggestions: ResumeSuggestion[];

  normalized?: ResumeNormalizedIntelligence;
  qualityScores?: Record<string, any>;
  technologyCategories?: Record<string, string[]>;
  consistencyWarnings?: ResumeWarning[];
  recruiterPerspective?: ResumeRecruiterPerspective;
  resumeSignals?: Record<string, any>;
  aiInsights?: ResumeAIInsights | null;

  cacheMetadata?: {
    loadedFromCache?: boolean;
    cacheHit?: boolean;
    aiUsed?: boolean;
    analysisVersion?: string;
    resumeHash?: string;
    analyzedAt?: string;
    [key: string]: any;
  };
  previousAnalysisId?: string | null;
  improvementDelta?: Record<string, any>;
  scoreChanges?: Record<string, number>;
  newSkillsAdded?: string[];
}
