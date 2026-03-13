const mongoose = require('mongoose');

/**
 * AnalysisCache Model: Stores AI results to avoid redundant API calls.
 * Keyed by githubUsername, targetRole, and resumeHash.
 */
const analysisCacheSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    githubUsername: {
        type: String,
        required: true,
        trim: true
    },
    targetRole: {
        type: String,
        required: true,
        enum: ['Frontend Developer', 'Backend Developer', 'Full Stack Developer', 'AI / ML Engineer', 'DevOps Engineer', 'Mobile Developer']
    },
    resumeHash: {
        type: String,
        required: true // SHA-256 hash of the extracted resume text
    },
    analysisData: {
        type: mongoose.Schema.Types.Mixed, // Stores the full structured AI response
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: '7d' // Cache expires after 7 days
    }
}, { timestamps: true });

// Index for fast lookups
analysisCacheSchema.index({ githubUsername: 1, targetRole: 1, resumeHash: 1 });

module.exports = mongoose.model('AnalysisCache', analysisCacheSchema);
