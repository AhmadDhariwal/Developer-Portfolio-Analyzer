const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateWeightedScore } = require('../../modules/recruiter/utils/matching/scoringEngine');
const { rankCandidates } = require('../../modules/recruiter/services/matching/aiRankingService');
const { generateMatches } = require('../../modules/recruiter/utils/hub/matchCalculator');

test('calculateWeightedScore applies recruiter formula weights', () => {
  const result = calculateWeightedScore({
    skillMatch: 80,
    projectQuality: 70,
    github: 60,
    experience: 50,
    consistency: 90,
    growth: 40
  });

  // 80*0.30 + 70*0.20 + 60*0.15 + 50*0.15 + 90*0.10 + 40*0.10 = 67.5
  assert.equal(result.finalScore, 67.5);
  assert.equal(result.breakdown.skillMatch.weighted, 24);
  assert.equal(result.breakdown.projectQuality.weighted, 14);
});

test('rankCandidates returns sorted candidates with explanations', () => {
  const job = {
    _id: 'job-1',
    title: 'Frontend Engineer',
    role: 'Frontend Engineer',
    minExperienceYears: 2,
    requiredSkills: ['angular', 'typescript', 'rxjs']
  };

  const candidates = [
    {
      id: 'c1',
      fullName: 'A Candidate',
      skills: ['angular', 'typescript', 'rxjs', 'scss'],
      projects: [{ title: 'Portal', impactScore: 80, status: 'completed' }],
      githubScore: 85,
      yearsOfExperience: 4,
      consistencyScore: 78,
      growthPotentialScore: 74
    },
    {
      id: 'c2',
      fullName: 'B Candidate',
      skills: ['javascript'],
      projects: [{ title: 'Landing', impactScore: 45, status: 'in-progress' }],
      githubScore: 55,
      yearsOfExperience: 1,
      consistencyScore: 40,
      growthPotentialScore: 35
    }
  ];

  const result = rankCandidates({ job, candidates });

  assert.equal(result.rankedCandidates.length, 2);
  assert.equal(result.rankedCandidates[0].rank, 1);
  assert.equal(result.rankedCandidates[1].rank, 2);
  assert.ok(result.rankedCandidates[0].rankScore >= result.rankedCandidates[1].rankScore);
  assert.equal(typeof result.rankedCandidates[0].aiInsight.summary, 'string');
  assert.ok(Array.isArray(result.rankedCandidates[0].aiInsight.strengths));
});

test('GitHub evidence contributes its configured weight and excludes unavailable values from normalization', () => {
  const { rankedCandidates } = rankCandidates({
    job: { requiredSkills: ['angular'] },
    candidates: [
      { id: 'zero', githubScore: 0, skills: ['angular'] },
      { id: 'high', githubScore: 80, skills: ['angular'] },
      { id: 'missing', githubScore: null, skills: ['angular'] }
    ]
  });
  const byId = new Map(rankedCandidates.map((row) => [row.candidateId, row]));
  assert.equal(byId.get('high').scoreBreakdown.github.weighted, 15);
  assert.equal(byId.get('zero').scoreBreakdown.github.weighted, 0);
  assert.equal(byId.get('missing').scoreBreakdown.github.raw, null);
  assert.equal(byId.get('missing').scoreBreakdown.github.weighted, null);
  assert.ok(byId.get('high').rankScore > byId.get('zero').rankScore);
});

test('match records publish absolute feature scores and canonical user IDs', () => {
  const { records } = generateMatches({
    job: { _id: 'job-1', requiredSkills: ['angular', 'rxjs'], minExperienceYears: 2 },
    candidates: [
      {
        id: 'legacy-id',
        userId: 'user-id',
        skills: ['angular'],
        yearsOfExperience: 2,
        githubScore: 80,
        projects: [{ impactScore: 75, status: 'completed' }]
      }
    ]
  });
  assert.equal(records[0].candidateId, 'user-id');
  assert.equal(records[0].skillMatchPercent, 50);
  assert.equal(records[0].experienceMatch, 'Strong');
  assert.equal(records[0].githubProjectScore, 80);
});
