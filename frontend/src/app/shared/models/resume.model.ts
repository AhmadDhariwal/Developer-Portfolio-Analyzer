export interface ResumeAnalysis {
  fileId?: string;
  atsScore: number;
  keywordDensity: number;
  formatScore: number;
  contentQuality: number;
  skills: {
    [category: string]: string[];
  };
  suggestions: ResumeSuggestion[];
  fileName?: string;
  fileSize?: number;
  uploadDate?: string;
  analyzedAt?: string;
  resumeHash?: string;
  analysisVersion?: string;
  normalized?: ResumeNormalizedIntelligence;
  qualityScores?: Record<string, any>;
  technologyCategories?: Record<string, string[]>;
  consistencyWarnings?: ResumeWarning[];
  recruiterPerspective?: ResumeRecruiterPerspective;
  resumeSignals?: Record<string, any>;
  aiInsights?: Record<string, any>;
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

export interface ResumeSuggestion {
  id: string;
  title: string;
  description: string;
  color: 'red' | 'orange' | 'blue' | 'purple' | 'cyan';
  icon?: string;
}

export interface ResumeFile {
  id: string;
  userId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  uploadDate: Date;
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
  score: number;
  maxScore?: number;
  color: 'purple' | 'pink' | 'green' | 'amber';
}
