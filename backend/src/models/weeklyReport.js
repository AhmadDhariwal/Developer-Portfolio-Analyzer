const mongoose = require('mongoose');

const weeklyReportSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  weekStartDate: {
    type: Date,
    required: true
  },
  weekEndDate: {
    type: Date,
    required: true
  },
  score: {
    type: Number,
    required: true
  },
  progressSummary: {
    type: String,
    required: true
  },
  insights: [{ type: String }],
  recommendations: [{ type: String }],
  topAchievements: [{ type: String }],
  biggestRiskArea: {
    type: String,
    default: ''
  },
  predictedHiringReadiness: {
    score: { type: Number, default: 0 },
    reason: { type: String, default: '' }
  },
  emailStatus: {
    type: String,
    enum: ['sent', 'skipped', 'failed'],
    default: 'skipped'
  },
  emailedAt: {
    type: Date,
    default: null
  },
  emailError: {
    type: String,
    default: ''
  },
  reportText: {
    type: String,
    required: true
  },
  meta: {
    githubScore: { type: Number, default: 0 },
    resumeScore: { type: Number, default: 0 },
    skillFocus: [{ type: String }],
    activity: {
      repositoriesTracked: { type: Number, default: 0 },
      activeRepositories: { type: Number, default: 0 },
      commits: { type: Number, default: 0 },
      weeklyCommitSignal: { type: Number, default: 0 },
      stars: { type: Number, default: 0 },
      forks: { type: Number, default: 0 }
    },
    sprint: {
      tasksCompleted: { type: Number, default: 0 },
      tasksTotal: { type: Number, default: 0 },
      completionRate: { type: Number, default: 0 },
      weeklyGoal: { type: Number, default: 0 },
      streak: { type: Number, default: 0 }
    },
    interview: {
      sessions: { type: Number, default: 0 },
      questionsGenerated: { type: Number, default: 0 }
    },
    comparisons: {
      scoreDelta: { type: Number, default: 0 },
      readinessDelta: { type: Number, default: 0 },
      githubDelta: { type: Number, default: 0 },
      resumeDelta: { type: Number, default: 0 },
      sprintCompletionDelta: { type: Number, default: 0 },
      tasksCompletedDelta: { type: Number, default: 0 },
      interviewSessionsDelta: { type: Number, default: 0 },
      interviewQuestionsDelta: { type: Number, default: 0 },
      activityCommitsDelta: { type: Number, default: 0 },
      activeReposDelta: { type: Number, default: 0 },
      missingSkillsDelta: { type: Number, default: 0 },
      coverageDelta: { type: Number, default: 0 }
    },
    dataSourcesUsed: {
      github: {
        connected: { type: Boolean, default: false },
        lastAnalyzedAt: { type: Date, default: null },
        status: { type: String, default: 'Unavailable' }
      },
      resume: {
        analyzed: { type: Boolean, default: false },
        lastAnalyzedAt: { type: Date, default: null },
        status: { type: String, default: 'Unavailable' }
      },
      skillGap: {
        analyzed: { type: Boolean, default: false },
        lastAnalyzedAt: { type: Date, default: null },
        status: { type: String, default: 'Unavailable' }
      },
      recommendations: {
        available: { type: Boolean, default: false },
        lastAnalyzedAt: { type: Date, default: null },
        status: { type: String, default: 'Unavailable' }
      },
      careerSprint: {
        connected: { type: Boolean, default: false },
        lastAnalyzedAt: { type: Date, default: null },
        status: { type: String, default: 'Unavailable' }
      },
      interviewPrep: {
        analyzed: { type: Boolean, default: false },
        lastAnalyzedAt: { type: Date, default: null },
        status: { type: String, default: 'Unavailable' }
      },
      portfolio: {
        connected: { type: Boolean, default: false },
        lastAnalyzedAt: { type: Date, default: null },
        status: { type: String, default: 'Unavailable' }
      },
      integrations: {
        connected: { type: Boolean, default: false },
        lastAnalyzedAt: { type: Date, default: null },
        status: { type: String, default: 'Unavailable' }
      }
    },
    snapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  }
}, { timestamps: true });

weeklyReportSchema.index({ userId: 1, weekStartDate: 1, weekEndDate: 1 }, { unique: true });

module.exports = mongoose.model('WeeklyReport', weeklyReportSchema);
