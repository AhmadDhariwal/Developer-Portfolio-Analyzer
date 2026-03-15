const mongoose = require('mongoose');

/**
 * AnalysisCache Model: Stores AI results to avoid redundant API calls.
 * Keyed by githubUsername, careerStack, experienceLevel, and resumeHash.
 * All four fields are required for a correct cache hit — different experience
 * levels must never share a cached result.
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
    careerStack: {
        type: String,
        required: true,
        enum: ['Frontend', 'Backend', 'Full Stack', 'AI/ML']
    },
    experienceLevel: {
        type: String,
        required: true,
        enum: ['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years']
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

// All 4 fields required for a correct cache hit
analysisCacheSchema.index({ githubUsername: 1, careerStack: 1, experienceLevel: 1, resumeHash: 1 });

module.exports = mongoose.model('AnalysisCache', analysisCacheSchema);
