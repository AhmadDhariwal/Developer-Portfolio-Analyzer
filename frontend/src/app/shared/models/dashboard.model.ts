export interface DashboardHistory {
  status: 'available' | 'missing' | 'unavailable';
  points: { at: string; value: number }[];
  reason: string;
}
export interface DashboardProgress {
  history: DashboardHistory;
  sprint: {
    available: boolean;
    weightedCompletion: number | null;
    velocity: { day: string; completed: number; points: number }[];
    undatedCompletions: number;
    basis: string;
  };
  skills: { available: boolean; proven: number | null; claimed: number | null; basis: string };
  evidence: {
    totalSources: number;
    available: number;
    fresh: number;
    stale: number;
    missing: number;
  };
  github: {
    available: boolean;
    historyStatus: string;
    activity: { month: string; count: number }[];
  };
  completedCourses: { title: string; completedAt: string | null }[];
}
export interface DashboardSummary {
  readinessScore?: number | null;
  readinessMeasurement?: { value: number | null; basis: 'portfolio' | 'github' | 'missing' };
  activitySnapshot?: { data: { month: string; count: number }[]; available: boolean };
  languageSnapshot?: { data: Record<string, number>; available: boolean };
  progress?: DashboardProgress;
  readinessModel?: { weights: Record<string, number>; basis: 'recorded' | 'nominal' };
  consistency?: {
    policy: 'dashboard-source-revisions-v1';
    revision: string;
    identity: {
      userId: string;
      githubUsername: string;
      careerStack: string;
      experienceLevel: string;
      resumeHash: string;
      resumeAnalysisId: string;
    };
    validation: 'two-equal-reads';
    maxAttempts: number;
  };
}

export interface DashboardIntegrationConnectivity {
  connectedCount: number;
  providers: string[];
  syncCount: number;
  failedSyncCount: number;
  days: number;
  lastSyncedAt: string | null;
}
