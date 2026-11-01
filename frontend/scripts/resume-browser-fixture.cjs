const files = [
  {
    fileId: 'file-111',
    fileName: 'main-resume.pdf',
    fileSize: 102400,
    uploadDate: '2026-10-01T12:00:00.000Z',
    isAnalyzed: true,
    isDefault: true,
    isActive: true,
    resumeHash: 'hash-111',
    analysisVersion: 'resume-intel-v2',
  },
  {
    fileId: 'file-222',
    fileName: 'older-resume.pdf',
    fileSize: 98000,
    uploadDate: '2026-09-15T10:00:00.000Z',
    isAnalyzed: false,
    isDefault: false,
    isActive: false,
  },
];
const analysis = {
  fileId: 'file-111',
  fileName: 'main-resume.pdf',
  fileSize: 102400,
  uploadDate: '2026-10-01T12:00:00.000Z',
  analyzedAt: '2026-10-08T10:00:00.000Z',
  resumeHash: 'hash-111',
  analysisVersion: 'resume-intel-v2',
  // Authoritative score: 85 (differs from legacy atsScore 70)
  scoring: {
    score: 85,
    ruleVersion: 'resume-overall-score-v1',
    calculatedAt: '2026-10-08T10:00:00.000Z',
    warnings: [],
    evidence: {
      sources: [{ type: 'resume-file', id: 'file-111' }],
      inputs: {},
      facts: {
        quantifiedAchievementCount: 4,
        technologyCount: 15,
        sectionCount: 5,
        experienceYears: 4,
        wordCount: 320,
      },
    },
    breakdown: {
      atsScore: {
        value: 70,
        weight: 0.18,
        contribution: 12.6,
        available: true,
        explanation: 'Standard ATS headings',
      },
      contentQuality: {
        value: 88,
        weight: 0.16,
        contribution: 14.1,
        available: true,
        explanation: 'Strong action verbs',
      },
      keywordDensity: {
        value: 80,
        weight: 0.12,
        contribution: 9.6,
        available: true,
        explanation: 'Balanced terminology',
      },
      formatScore: {
        value: 90,
        weight: 0.12,
        contribution: 10.8,
        available: true,
        explanation: 'Clean bullet structure',
      },
      projectQuality: {
        value: 84,
        weight: 0.12,
        contribution: 10.1,
        available: true,
        explanation: 'Full-stack delivery evidence',
      },
      experienceStrength: {
        value: 92,
        weight: 0.12,
        contribution: 11.0,
        available: true,
        explanation: 'Quantified metrics present',
      },
      skillsCoverage: {
        value: 85,
        weight: 0.1,
        contribution: 8.5,
        available: true,
        explanation: 'Broad modern stack',
      },
      technicalDepth: {
        value: 0,
        weight: 0.08,
        contribution: 0.0,
        available: true,
        explanation: 'Zero deep systems measured',
      },
    },
  },
  contentQualityState: {
    state: 'VALID',
    scoreable: true,
    wordCount: 320,
    uniqueWordCount: 140,
  },
  // Legacy scores
  atsScore: 70,
  keywordDensity: 80,
  formatScore: 90,
  contentQuality: 88,
  skills: {
    Frontend: ['Angular', 'TypeScript', 'SCSS'],
    Backend: ['Node.js', 'Express', 'MongoDB'],
  },
  experienceYears: 4,
  experienceLevel: 'Mid-Level',
  keyAchievements: [
    'Reduced latency by 30% for 10,000 active users',
    'Improved test coverage to 85% across core APIs',
  ],
  suggestions: [
    {
      id: '1',
      title: 'Add CI/CD pipelines',
      description: 'Showcase GitHub Actions experience',
      color: 'orange',
    },
  ],
  normalized: {
    sectionPresence: {
      experience: true,
      projects: true,
      skills: true,
      education: true,
      certifications: false,
    },
  },
  aiInsights: {
    aiUsed: true,
    strengths: ['Clear enterprise Angular ownership', 'Demonstrated API performance improvements'],
    weaknesses: ['Add DevOps automation tools'],
    writingSuggestions: ['Highlight cross-functional leadership in team projects'],
    priorities: [
      {
        title: 'Quantify team scaling impact',
        description: 'Mention mentorship of junior engineers',
        impact: 'high',
      },
    ],
  },
};

module.exports = { files, analysis };
