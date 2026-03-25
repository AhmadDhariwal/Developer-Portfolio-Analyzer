const mongoose = require('mongoose');

const sprintTaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  points: { type: Number, default: 1 },
  isCompleted: { type: Boolean, default: false },
  completedAt: { type: Date, default: null },
  dueDate: { type: Date, default: null }
}, { _id: true });

const careerSprintSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    default: 'Career Sprint'
  },
  weekStartDate: { type: Date, required: true },
  weekEndDate: { type: Date, required: true },
  weeklyGoal: { type: Number, default: 5 },
  streak: { type: Number, default: 0 },
  longestStreak: { type: Number, default: 0 },
  lastCompletedWeekAt: { type: Date, default: null },
  tasks: [sprintTaskSchema]
}, { timestamps: true });

module.exports = mongoose.model('CareerSprint', careerSprintSchema);
