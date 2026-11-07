export interface RecommendedProject {
  actionableNextStep?: string;
  aiGenerated?: boolean;
  id: string;
  title: string;
  description: string;
  tech?: string[];
  newTech?: string[]; // subset of tech[] that are new to the user
  difficulty?: 'Beginner' | 'Intermediate' | 'Advanced';
  estimatedWeeks: string;
  impact: number | null;
  whyThisProject: string; // explanation of level fit
  triggerSkills?: string[];
  startUrl?: string;
  priority?: string;
  confidenceScore?: number | null;
  reason?: string;
  evidence?: string[];
  sourceSignalsUsed?: string[];
  estimatedImpact?: number | null;
  estimatedEffort?: string;
}

export interface RecommendedTechnology {
  name: string;
  category: string;
  priority: string;
  priorityRaw: 'High' | 'Medium' | 'Low';
  jobDemand: number | null;
  description: string;
  confidenceScore?: number | null;
  reason?: string;
  evidence?: string[];
  sourceSignalsUsed?: string[];
  estimatedImpact?: number | null;
  estimatedEffort?: string;
}

export interface CareerPath {
  id: string;
  title: string;
  salaryRange?: string;
  timeline?: string;
  description: string;
  hiringCompanies: string[];
  actionItems: string[];
  boostSkills?: string[];
  match: number | null;
  exploreUrl?: string;
  priority?: string;
  confidenceScore?: number | null;
  reason?: string;
  evidence?: string[];
  sourceSignalsUsed?: string[];
  estimatedImpact?: number | null;
  estimatedEffort?: string;
}

export interface RecommendationSource {
  type: string;
  id?: string | null;
  available?: boolean;
  timestamp?: string | null;
  freshness?: string;
  ruleVersion?: string | null;
}
export interface RecommendationCard {
  actionableNextStep?: string;
  sources?: RecommendationSource[];
  freshness?: string;
  evidenceStatus?: string | null;
  sourceConfidence?: string;
  targetSkill?: string | null;
  aiGenerated?: boolean;
  navigation?: {
    courses?: { route: string; query: Record<string, string> };
    careerSprint?: {
      route: string;
      api?: { method: string; url: string; body: { signalHash: string } };
    };
  };
  id: string;
  category: string;
  title: string;
  description: string;
  priority: 'High' | 'Medium' | 'Low' | string;
  confidenceScore: number | null;
  reason: string;
  evidence?: string[];
  sourceSignalsUsed?: string[];
  estimatedImpact: number | null;
  estimatedEffort: string;
  actionUrl?: string;
  actionLabel?: string;
}

export interface RecommendationScores {
  readinessScore: number | null;
  portfolioScore: number | null;
  learningScore: number | null;
  interviewScore: number | null;
  marketReadinessScore: number | null;
  careerGrowthScore: number | null;
  overallRecommendationScore: number | null;
  explanation?: Record<string, string>;
}

export interface RecommendationRoadmap {
  immediateActions: RecommendationCard[];
  next30Days: RecommendationCard[];
  next60Days: RecommendationCard[];
  next90Days: RecommendationCard[];
  longTermGrowth?: RecommendationCard[];
  suggestedProjects: Array<RecommendedProject | string>;
  suggestedCertifications?: RecommendationCard[];
  suggestedTechnologies?: RecommendedTechnology[];
  suggestedLearningPath?: string[];
  phases?: Array<{ label: string; items: string[] }>;
  learningSequence?: string[];
  timeline?: Array<{ label: string; items: string[] }>;
}

export interface RecommendationCacheMetadata {
  partial?: boolean;
  loadedFromCache?: boolean;
  cacheKey?: {
    githubUsername?: string;
    careerStack?: string;
    experienceLevel?: string;
    resumeHash?: string;
    resumeAnalysisId?: string;
    signalHash?: string;
    analysisVersion?: string;
  };
  signalHash?: string;
  analysisVersion?: string;
  recommendationVersion?: string;
  temporary?: boolean;
  ttlHours?: number;
  cachedAt?: string | null;
}

export interface RecommendationSignalsUsed {
  github: {
    connected: boolean;
    username: string;
    repoCount: number;
    developerLevel: string;
  };
  resume: {
    analyzed: boolean;
    analysisId?: string;
    atsScore: number | null;
    experienceLevel: string;
    fileName?: string;
    lastAnalyzedAt?: string | null;
    extractedSkills?: string[];
    experienceKeywords?: string[];
    strengths?: string[];
    weaknesses?: string[];
    missingSections?: string[];
    statusMessage?: string;
  };
  portfolio: {
    present: boolean;
    completenessScore: number;
    projectCount: number;
    liveLinkCount: number;
  };
  integrations: {
    providers: string[];
    score: number;
    strongestProof: string[];
  };
  weeklyProgress: {
    status: string;
    score: number;
    trendDelta: number;
  };
  careerSprint: {
    consistencyScore: number;
    streak: number;
    activeLearningFocus: string;
  };
  skillGap?: {
    present: boolean;
    coverage: number | null;
    knownSkills: string[];
    missingSkills: string[];
    weakSkills: string[];
    highDemandSkills: Array<{ name: string; demandScore?: number; postings?: number }>;
    updatedAt?: string | null;
  };
  careerProfile?: {
    careerStack: string;
    experienceLevel: string;
    careerGoal: string;
  };
  jobsDemand?: {
    sampledJobs: number;
    topSkills: Array<{ name: string; demandScore: number; postings: number }>;
  };
}

export interface AnalysisBasedOn {
  githubUsername: string;
  resumeAnalyzed: boolean;
  resumeStatus: string;
  careerStack: string;
  experienceLevel: string;
  lastAnalyzedAt?: string | null;
}

export interface RecommendationDataQuality {
  hasGitHubData: boolean;
  hasResumeData: boolean;
  hasSkillGapData: boolean;
  hasPortfolioData: boolean;
  hasJobMarketData: boolean;
  dataCompleteness: number;
  scoreAvailability: Partial<Record<keyof RecommendationScores, boolean>>;
}

export interface RecommendationsResult {
  recommendations?: RecommendationCard[];
  actions?: RecommendationCard[];
  ruleVersion?: string;
  verified?: boolean;
  source?: string;
  sourceMetadata?: Record<string, RecommendationSource>;
  aiUsed?: boolean;
  aiSuggestions?: Array<{ suggestion: string; aiGenerated: boolean; kind: string }>;
  sourceScores?: Record<string, number | null>;
  scoreProvenance?: { reason?: string; legacyComposite?: string };
  username: string;
  careerStack: string;
  experienceLevel: string;
  projects: RecommendedProject[];
  technologies: RecommendedTechnology[];
  careerPaths: CareerPath[];
  analysisSummary?: string;
  portfolioRecommendations?: string[];
  resumeRecommendations?: string[];
  learningActions?: string[];
  interviewReadinessActions?: string[];
  signalsUsed?: RecommendationSignalsUsed;
  analysisBasedOn?: AnalysisBasedOn;
  resumeStatusMessage?: string;
  claimedButNotProvenSkills?: string[];
  githubSkills?: string[];
  resumeSkills?: string[];
  recommendationScores?: RecommendationScores;
  dataQuality?: RecommendationDataQuality;
  structuredRecommendations?: Record<string, RecommendationCard[]>;
  roadmap?: RecommendationRoadmap;
  recommendationSignals?: Record<string, unknown>;
  recommendationVersioning?: {
    currentRecommendation?: Record<string, unknown>;
    previousRecommendation?: Record<string, unknown> | null;
    delta?: Record<string, number>;
    newRecommendations?: RecommendationCard[];
    completedRecommendations?: RecommendationCard[];
    obsoleteRecommendations?: RecommendationCard[];
  };
  cacheMetadata?: RecommendationCacheMetadata;
  fromCache?: boolean;
  fromFrontendCache?: boolean;
  cacheState?: 'cache-hit' | 'refreshing' | 'loading' | 'error' | 'empty';
}
