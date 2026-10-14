// Synthetic recommendation UI fixtures use the backend engine's actual card contract.
const engine = require('../../backend/src/services/recommendationEngineService');
const hash = 'a'.repeat(64);
function fixture() {
  const result = engine.buildPlan({
    username: 'fixture',
    careerStack: 'Backend',
    experienceLevel: 'Student',
    githubData: {
      repositories: [{ name: 'sample', hasReadme: false, hasTests: false }],
      fetchedAt: '2026-10-14T05:00:00Z',
    },
    resumeAnalysis: {
      _id: 'resume-fixture',
      analyzedAt: '2026-10-14T05:00:00Z',
      contentQualityState: { scoreable: false },
    },
    skillGap: {
      calculatedAt: '2026-10-14T05:00:00Z',
      signalHash: hash,
      skills: [
        'TypeScript',
        'Node.js',
        'SQL',
        'Testing',
        'Docker',
        'API design',
        'Security',
        'Observability',
        'System design',
      ].map((name, i) => ({
        name,
        status: ['PARTIAL', 'CLAIMED_ONLY', 'NOT_EVIDENCED', 'UNKNOWN'][i % 4],
        requirement: 'REQUIRED',
        evidenceConfidence: 'LOW',
        priority: i < 3 ? 'High' : 'Medium',
      })),
    },
  });
  for (const card of result.recommendations) {
    card.navigation.careerSprint.api = {
      method: 'POST',
      url: `/api/recommendations/${card.id}/career-sprint`,
      body: { signalHash: hash },
    };
  }
  return {
    ...result,
    aiUsed: false,
    cacheMetadata: {
      signalHash: hash,
      cachedAt: '2026-10-14T05:00:00Z',
      analysisVersion: 'recommendations-v-test',
    },
  };
}
module.exports = { fixture, hash };
