import { CareerSprint } from '../../../shared/services/career-sprint.service';

export function sprintFixture(overrides: Partial<CareerSprint> = {}): CareerSprint {
  return {
    _id: 'sprint-one',
    __v: 1,
    title: 'Ship a thoughtful portfolio',
    calendarPolicy: 'sprint-calendar-48h-v1',
    timeZone: 'Asia/Karachi',
    legacyAccess: {
      readOnly: false,
      calendarStatus: 'recorded',
      reason: null,
      timeZone: 'Asia/Karachi',
    },
    weekStartDate: '2026-10-11T19:00:00Z',
    weekEndDate: '2026-10-18T18:59:59.999Z',
    weeklyGoal: 5,
    currentStreak: 4,
    longestStreak: 8,
    streak: 4,
    xpPoints: 137,
    level: 2,
    goalStack: 'Frontend',
    goalExperienceLevel: 'Intern',
    tasks: [
      {
        _id: 'task-one',
        title: 'Test the authentication flow',
        description: 'Cover failure and retry states.',
        points: 5,
        priority: 'high',
        category: 'project',
        taskType: 'manual',
        isCompleted: false,
        startDate: '2026-10-15T19:00:00Z',
        endDate: '2026-10-16T18:59:59.999Z',
      },
    ],
    aiPlans: [
      {
        _id: 'draft-one',
        name: 'Frontend plan',
        source: 'ai',
        generatorType: 'deterministic',
        summary: 'Proposed work',
        confidenceScore: 60,
        consistencyScore: 40,
        signalsUsed: ['Profile'],
        tasks: [
          {
            title: 'Review Angular signals',
            description: 'Build a small demo.',
            points: 3,
            priority: 'medium',
            category: 'learning',
            taskType: 'ai',
            isCompleted: false,
          },
        ],
        createdAt: '2026-10-15T12:00:00Z',
        compatibility: {
          status: 'current',
          requiresAcknowledgement: false,
          currentFingerprint: 'fresh-context',
          recordedFingerprint: 'fresh-context',
        },
      },
    ],
    analytics: {
      totalTasks: 1,
      completedTasks: 0,
      pendingTasks: 1,
      overdueTasks: 0,
      totalPoints: 5,
      completedPoints: 0,
      progressPercent: 23,
      consistencyScore: 41,
      productivityScore: 32,
      activeWindowDays: 7,
      aiTaskCount: 0,
      manualTaskCount: 1,
      completedInLastSevenDays: 0,
      dailyActivity: [],
    },
    restoreMeta: { canRestore: false, policy: 'sprint-calendar-48h-v1' },
    ...overrides,
  };
}

export function legacyFixture(): CareerSprint {
  const sprint = sprintFixture();
  return {
    ...sprint,
    calendarPolicy: undefined,
    timeZone: undefined,
    legacyAccess: {
      readOnly: true,
      calendarStatus: 'provenance-unresolved',
      timeZone: null,
      reason: 'timezone-provenance-unresolved',
    },
    analytics: {
      ...sprint.analytics!,
      consistencyScore: null,
      activeWindowDays: null,
      completedInLastSevenDays: null,
      dailyActivity: [],
    },
  };
}
