// Synthetic HTTP fixtures only. No account or production writes.
const { profile: baseProfile } = require('./skill-gap-browser-fixture.cjs');
const profile = {
  ...baseProfile,
  careerStack: 'Frontend',
  activeCareerStack: 'Frontend',
  experienceLevel: 'Junior',
  activeExperienceLevel: 'Junior',
};
const NOW = '2026-10-16T12:00:00.000Z';
const clone = (value) => structuredClone(value);
const task = (id, title, extra = {}) => ({
  _id: id,
  title,
  description: 'Make the outcome clear, test it, and document what you learned.',
  points: 4,
  priority: 'medium',
  category: 'project',
  taskType: 'manual',
  isCompleted: false,
  startDate: '2026-10-15T19:00:00.000Z',
  endDate: '2026-10-16T18:59:59.999Z',
  ...extra,
});
const proposed = [
  task('proposal-one', 'Build an accessible command palette', {
    taskType: 'ai',
    sourceRecommendationId: 'action-fixture',
    sourceRule: 'fixture-rule',
    evidenceLimitation: 'Proposed work from synthetic recorded evidence, not verified proficiency.',
  }),
  task('proposal-two', 'Measure and improve the project loading experience', {
    taskType: 'ai',
    category: 'practice',
  }),
];
const draft = (id = 'draft-one') => ({
  _id: id,
  name: 'A stronger frontend portfolio',
  source: 'ai',
  generatorType: 'deterministic',
  summary: 'Two focused steps toward clearer, more convincing project evidence.',
  confidenceScore: 68,
  consistencyScore: 52,
  signalsUsed: ['Career profile', 'Current recommendations'],
  tasks: clone(proposed),
  createdAt: NOW,
  context: { careerStack: 'Frontend', experienceLevel: 'Junior', fingerprint: 'context-one' },
  compatibility: {
    status: 'current',
    requiresAcknowledgement: false,
    currentFingerprint: 'context-one',
    recordedFingerprint: 'context-one',
  },
});
function sprint(legacy = false) {
  return {
    _id: 'sprint-fixture',
    __v: 1,
    title: 'Build a portfolio that tells your story',
    timeZone: legacy ? undefined : 'Asia/Karachi',
    calendarPolicy: legacy ? undefined : 'sprint-calendar-48h-v1',
    legacyAccess: {
      readOnly: legacy,
      calendarStatus: legacy ? 'provenance-unresolved' : 'recorded',
      reason: legacy ? 'timezone-provenance-unresolved' : null,
      timeZone: legacy ? null : 'Asia/Karachi',
    },
    weekStartDate: '2026-10-11T19:00:00.000Z',
    weekEndDate: '2026-10-18T18:59:59.999Z',
    sprintStartDate: '2026-10-11T19:00:00.000Z',
    sprintEndDate: '2026-10-18T18:59:59.999Z',
    weeklyGoal: 5,
    goalStack: 'Frontend',
    goalTechnology: 'Angular',
    goalExperienceLevel: 'Junior',
    currentStreak: 4,
    longestStreak: 12,
    streak: 4,
    streakStatus: 'active',
    xpPoints: 137,
    level: 2,
    tasks: [
      task('task-one', 'Polish the portfolio case study', { priority: 'high', points: 5 }),
      task('task-two', 'Practice accessible Angular forms', {
        category: 'learning',
        taskType: 'ai',
        sourceRecommendationId: 'existing-action',
        sourceRule: 'fixture-rule',
      }),
      task('task-three', 'Review responsive navigation patterns', {
        category: 'practice',
        priority: 'low',
        endDate: '2026-10-14T18:59:59.999Z',
      }),
      task('task-four', 'Write the project README', {
        isCompleted: true,
        completedAt: NOW,
        points: 3,
      }),
      task('task-five', 'Study the saved TypeScript course', {
        description:
          'Review the course and apply one idea.\nCourse: course-fixture\nSkill: TypeScript\nhttps://www.udemy.com/course/fixture/',
        category: 'learning',
        startDate: null,
        endDate: null,
      }),
      task('task-six', 'Ship a reusable component', {
        isCompleted: true,
        completedAt: NOW,
        sourceScenarioId: 'scenario-fixture',
      }),
    ],
    aiPlans: [draft()],
    analytics: {
      totalTasks: 6,
      completedTasks: 2,
      pendingTasks: 4,
      overdueTasks: 1,
      totalPoints: 24,
      completedPoints: 7,
      progressPercent: 33,
      consistencyScore: legacy ? null : 64,
      productivityScore: 42,
      activeWindowDays: legacy ? null : 7,
      aiTaskCount: 1,
      manualTaskCount: 5,
      completedInLastSevenDays: legacy ? null : 6,
      dailyActivity: legacy
        ? []
        : [0, 1, 0, 2, 1, 0, 2].map((count, index) => ({
            date: `2026-10-${String(9 + index).padStart(2, '0')}T19:00:00.000Z`,
            count,
            active: count > 0,
          })),
    },
    comparison: { progressDelta: 8, completedTasksDelta: 1, streakDelta: 2, xpDelta: 21 },
    restoreMeta: { policy: 'sprint-calendar-48h-v1', canRestore: false },
    summary: {
      progressPercent: 33,
      completedTasks: 2,
      totalTasks: 6,
      overdueTasks: 1,
      consistencyScore: 64,
    },
    insights: ['Your completed work is building momentum. Keep the next step small and specific.'],
    signalsUsed: {
      careerSprint: { consistencyScore: legacy ? null : 64, activeLearningFocus: 'Angular' },
      weeklyReport: { status: 'Available', weeklyProgressScore: 56 },
      portfolio: { completenessScore: 71 },
      integrations: { usedProviders: ['GitHub'] },
    },
  };
}
function state(mode = 'normal') {
  const current = sprint(mode === 'legacy');
  if (mode === 'empty') {
    current.tasks = [];
    current.aiPlans = [];
    current.analytics = {
      ...current.analytics,
      totalTasks: 0,
      completedTasks: 0,
      pendingTasks: 0,
      overdueTasks: 0,
      totalPoints: 0,
      completedPoints: 0,
      progressPercent: 0,
    };
  }
  if (mode === 'restore' || mode === 'expired' || mode === 'boundary') {
    current.streakStatus = 'broken';
    current.restoreMeta = {
      policy: 'sprint-calendar-48h-v1',
      canRestore: mode !== 'expired',
      breakAt: '2026-10-14T13:00:00Z',
      expiresAt: '2026-10-16T13:00:00Z',
      remainingRestoreMs: 3600000,
    };
    if (mode === 'expired') current.restoreMeta.expiresAt = NOW;
  }
  const previous = sprint(true);
  previous._id = 'history-one';
  previous.title = 'Preserved Sprint · July';
  previous.weekStartDate = previous.sprintStartDate = '2026-07-05T19:00:00.000Z';
  previous.weekEndDate = previous.sprintEndDate = '2026-07-12T18:59:59.999Z';
  const overlap = clone(previous);
  overlap._id = 'history-overlap';
  overlap.title = 'Preserved overlapping Sprint';
  overlap.weekStartDate = overlap.sprintStartDate = '2026-07-10T19:00:00.000Z';
  overlap.weekEndDate = overlap.sprintEndDate = '2026-07-22T18:59:59.999Z';
  return {
    mode,
    current,
    history: [clone(current), overlap, previous],
    preference: 'Asia/Karachi',
    reads: [],
    writes: [],
    failMutation: false,
    failPlan: false,
    aiFallback: false,
    failHistory: mode === 'history-error',
    delay: mode === 'loading' ? 1500 : 0,
    serial: 0,
  };
}
module.exports = { profile, NOW, clone, proposed, draft, state };
