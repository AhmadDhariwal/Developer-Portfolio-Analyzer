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
    snapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('WeeklyReport', weeklyReportSchema);
