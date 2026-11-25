const ORG_ID = '65f1a2b3c4d5e6f708192a01';
const TEAM_ID = '65f1a2b3c4d5e6f708192b01';
const RECRUITER_ID = '65f1a2b3c4d5e6f708192c01';

const JOB_IDS = {
  backend: '65f1a2b3c4d5e6f708192d01',
  frontend: '65f1a2b3c4d5e6f708192d02',
  platform: '65f1a2b3c4d5e6f708192d03',
  archived: '65f1a2b3c4d5e6f708192d04',
};

const CANDIDATE_IDS = {
  arjun: '65f1a2b3c4d5e6f708192e01',
  elena: '65f1a2b3c4d5e6f708192e02',
  marcus: '65f1a2b3c4d5e6f708192e03',
  priya: '65f1a2b3c4d5e6f708192e04',
};

const recruiterUser = {
  _id: RECRUITER_ID,
  name: 'Nadia Hassan',
  email: 'nadia.hassan@devinsight.example',
  role: 'recruiter',
  organizationId: ORG_ID,
  organizationName: 'Northstar Talent Labs',
  githubUsername: 'nadiahassan',
  activeGithubUsername: 'nadiahassan',
  avatar: '',
};

const organizationsPayload = {
  organizations: [
    {
      _id: ORG_ID,
      name: 'Northstar Talent Labs',
      myRole: 'recruiter',
    },
  ],
};

const teamsPayload = {
  teams: [
    { _id: TEAM_ID, name: 'Core Platform Hiring' },
    { _id: '65f1a2b3c4d5e6f708192b02', name: 'Product Engineering' },
  ],
};

function createBaseCandidates() {
  return [
    {
      id: CANDIDATE_IDS.arjun,
      userId: CANDIDATE_IDS.arjun,
      name: 'Arjun Mehta',
      fullName: 'Arjun Mehta',
      stack: 'Backend',
      yearsOfExperience: 6,
      experienceLevel: 'Senior',
      headline: 'Senior Backend & Distributed Systems Engineer',
      profileSummary:
        'Designs high-throughput event pipelines in Python, TypeScript, PostgreSQL, and Kubernetes with verifiable open-source benchmarks.',
      location: 'Remote',
      githubUsername: 'arjunmehta-dev',
      publicProfileSlug: 'arjun-mehta',
      portfolio: '/p/arjun-mehta',
      publicPortfolioLink: '/p/arjun-mehta',
      score: 92,
      readinessScore: 92,
      githubScore: 91,
      resumeScore: 94,
      consistencyScore: 89,
      growthPotentialScore: 88,
      profileCompleteness: 95,
      availability: 'High intent',
      skills: ['Python', 'Node.js', 'PostgreSQL', 'Docker', 'Kubernetes', 'Redis', 'TypeScript'],
      skillGaps: ['Terraform'],
      skillScores: [
        { name: 'Python', score: 94 },
        { name: 'PostgreSQL', score: 90 },
        { name: 'Kubernetes', score: 84 },
        { name: 'Node.js', score: 86 },
      ],
      projects: [
        {
          title: 'StreamPulse Event Router',
          description:
            'Zero-allocation Kafka & Redis Streams ingestion service sustaining 85k events/sec.',
          technologies: ['Python', 'Redis', 'Docker'],
          status: 'completed',
          impactScore: 92,
        },
        {
          title: 'QueryGuard Postgres Profiler',
          description: 'Automated slow-query regression detector for CI pull requests.',
          technologies: ['TypeScript', 'PostgreSQL'],
          status: 'completed',
          impactScore: 87,
        },
      ],
      githubStats: { repos: 38, stars: 412, forks: 64, followers: 185 },
      lastActive: '2026-11-18T10:30:00.000Z',
      isActive: true,
      aiSummary:
        'Strong backend systems depth with verified repository velocity and production database tooling.',
      aiInsight: {
        summary:
          'Strong backend systems depth with verified repository velocity and production database tooling.',
        strengths: ['Distributed systems depth', 'Consistent GitHub commits', 'Strong API design'],
        weaknesses: ['Limited Terraform IaC examples'],
        recommendation: 'Strong fit for Senior Backend and Platform roles.',
      },
    },
    {
      id: CANDIDATE_IDS.elena,
      userId: CANDIDATE_IDS.elena,
      name: 'Elena Rostova',
      fullName: 'Elena Rostova',
      stack: 'Frontend',
      yearsOfExperience: 5,
      experienceLevel: 'Senior',
      headline: 'Staff Angular & Design Systems Architect',
      profileSummary:
        'Specializes in accessible Angular interfaces, state performance, and multi-theme design token architectures.',
      location: 'Berlin, Germany',
      githubUsername: 'erostova-ui',
      publicProfileSlug: 'elena-rostova',
      portfolio: '/p/elena-rostova',
      publicPortfolioLink: '/p/elena-rostova',
      score: 88,
      readinessScore: 88,
      githubScore: 86,
      resumeScore: 90,
      consistencyScore: 91,
      growthPotentialScore: 85,
      profileCompleteness: 92,
      availability: 'Available',
      skills: ['Angular', 'TypeScript', 'SCSS', 'Playwright', 'GraphQL', 'RxJS'],
      skillGaps: ['Kubernetes'],
      skillScores: [
        { name: 'Angular', score: 95 },
        { name: 'TypeScript', score: 91 },
        { name: 'Playwright', score: 88 },
      ],
      projects: [
        {
          title: 'TokenBridge UI Kit',
          description: 'WCAG AA compliant component library with live light/dark token switching.',
          technologies: ['Angular', 'TypeScript', 'SCSS'],
          status: 'completed',
          impactScore: 90,
        },
      ],
      githubStats: { repos: 29, stars: 268, forks: 39, followers: 140 },
      lastActive: '2026-11-17T14:10:00.000Z',
      isActive: true,
      aiSummary:
        'Deep Angular architecture background paired with strong accessibility and visual testing discipline.',
      aiInsight: {
        summary:
          'Deep Angular architecture background paired with strong accessibility and visual testing discipline.',
        strengths: ['Angular & RxJS mastery', 'Design system tokens', 'End-to-end QA coverage'],
        weaknesses: ['Minimal container orchestration history'],
        recommendation: 'Recommended for Senior Frontend & Design Systems engineering.',
      },
    },
    {
      id: CANDIDATE_IDS.marcus,
      userId: CANDIDATE_IDS.marcus,
      name: 'Marcus Vance',
      fullName: 'Marcus Vance',
      stack: 'Full Stack',
      yearsOfExperience: 4,
      experienceLevel: 'Mid-level',
      headline: 'Full Stack Product Engineer (Resume-Verified, GitHub Unlinked)',
      profileSummary:
        'Enterprise fintech full-stack developer working primarily inside private corporate repositories; GitHub telemetry unavailable.',
      location: 'Remote',
      githubUsername: '',
      publicProfileSlug: '',
      portfolio: '',
      publicPortfolioLink: '',
      score: 79,
      readinessScore: 79,
      githubScore: null,
      resumeScore: 85,
      consistencyScore: 74,
      growthPotentialScore: 82,
      profileCompleteness: 68,
      availability: 'Review needed',
      skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL'],
      skillGaps: ['Docker', 'Redis'],
      skillScores: [
        { name: 'React', score: 84 },
        { name: 'Node.js', score: 80 },
      ],
      projects: [],
      githubStats: { repos: 0, stars: 0, forks: 0, followers: 0 },
      lastActive: '2026-11-15T09:00:00.000Z',
      isActive: true,
      aiSummary:
        'Strong enterprise resume alignment; public GitHub telemetry is currently unavailable for verification.',
      aiInsight: {
        summary:
          'Strong enterprise resume alignment; public GitHub telemetry is currently unavailable for verification.',
        strengths: ['Solid full-stack delivery history', 'High resume structure score'],
        weaknesses: ['GitHub repository telemetry unavailable', 'Missing containerization proof'],
        recommendation: 'Proceed with technical live coding evaluation due to unlinked GitHub.',
      },
    },
    {
      id: CANDIDATE_IDS.priya,
      userId: CANDIDATE_IDS.priya,
      name: 'Priya Nair',
      fullName: 'Priya Nair',
      stack: 'DevOps',
      yearsOfExperience: 7,
      experienceLevel: 'Lead',
      headline: 'Principal Cloud Reliability & Platform Infrastructure Engineer',
      profileSummary:
        'Leads multi-region Kubernetes clusters, GitOps delivery, and automated FinOps observability across AWS and GCP.',
      location: 'London, UK',
      githubUsername: 'priyanair-ops',
      publicProfileSlug: 'priya-nair',
      portfolio: '/p/priya-nair',
      publicPortfolioLink: '/p/priya-nair',
      score: 85,
      readinessScore: 85,
      githubScore: 83,
      resumeScore: 88,
      consistencyScore: 86,
      growthPotentialScore: 81,
      profileCompleteness: 88,
      availability: 'Open to entry roles',
      skills: ['Kubernetes', 'Terraform', 'Docker', 'Python', 'AWS', 'Prometheus'],
      skillGaps: ['GraphQL'],
      skillScores: [
        { name: 'Kubernetes', score: 93 },
        { name: 'Terraform', score: 91 },
        { name: 'AWS', score: 89 },
      ],
      projects: [
        {
          title: 'KubeDrift Guard',
          description: 'Policy-as-code drift reconciliation operator for multi-tenant clusters.',
          technologies: ['Python', 'Kubernetes', 'Terraform'],
          status: 'in-progress',
          impactScore: 84,
        },
      ],
      githubStats: { repos: 24, stars: 195, forks: 28, followers: 112 },
      lastActive: '2026-11-16T18:45:00.000Z',
      isActive: true,
      aiSummary:
        'Experienced reliability engineer with strong IaC automation and production cluster ownership.',
      aiInsight: {
        summary:
          'Experienced reliability engineer with strong IaC automation and production cluster ownership.',
        strengths: ['Kubernetes & Terraform expertise', 'Production SLO monitoring'],
        weaknesses: ['Frontend UI breadth outside scope'],
        recommendation: 'Strong fit for Platform & Infrastructure Lead.',
      },
    },
  ];
}

function createBaseJobs() {
  return [
    {
      _id: JOB_IDS.backend,
      organizationId: ORG_ID,
      recruiterId: RECRUITER_ID,
      title: 'Senior Principal Distributed Systems & Backend Infrastructure Architect',
      role: 'Backend Architect',
      description:
        'Own high-throughput API gateways, PostgreSQL query performance, and event-driven matching pipelines across multi-tenant clusters.',
      stack: 'Backend',
      requiredSkills: ['Python', 'Node.js', 'PostgreSQL', 'Docker'],
      preferredSkills: ['Kubernetes', 'Redis', 'TypeScript'],
      minExperienceYears: 5,
      location: 'Remote',
      salaryRangeMin: 145000,
      salaryRangeMax: 185000,
      employmentType: 'full-time',
      status: 'open',
      archivedAt: null,
      createdAt: '2026-10-12T08:00:00.000Z',
      updatedAt: '2026-11-18T11:00:00.000Z',
    },
    {
      _id: JOB_IDS.frontend,
      organizationId: ORG_ID,
      recruiterId: RECRUITER_ID,
      title: 'Staff Angular Design Systems Engineer',
      role: 'Frontend Engineer',
      description:
        'Lead accessible multi-theme Angular UI foundations, responsive grid systems, and automated visual regression gates.',
      stack: 'Frontend',
      requiredSkills: ['Angular', 'TypeScript', 'SCSS'],
      preferredSkills: ['Playwright', 'RxJS'],
      minExperienceYears: 4,
      location: 'Berlin / Remote',
      salaryRangeMin: 120000,
      salaryRangeMax: 155000,
      employmentType: 'full-time',
      status: 'open',
      archivedAt: null,
      createdAt: '2026-10-28T09:00:00.000Z',
      updatedAt: '2026-11-17T15:30:00.000Z',
    },
    {
      _id: JOB_IDS.platform,
      organizationId: ORG_ID,
      recruiterId: RECRUITER_ID,
      title: 'Cloud Infrastructure & Reliability Specialist',
      role: 'Platform Engineer',
      description:
        'Draft role scoping multi-cluster Kubernetes observability and automated Terraform provisioning.',
      stack: 'DevOps',
      requiredSkills: ['Kubernetes', 'Terraform', 'AWS'],
      preferredSkills: ['Python', 'Prometheus'],
      minExperienceYears: 5,
      location: 'London, UK',
      salaryRangeMin: 0,
      salaryRangeMax: 0,
      employmentType: 'contract',
      status: 'draft',
      archivedAt: null,
      createdAt: '2026-11-05T12:00:00.000Z',
      updatedAt: '2026-11-16T10:15:00.000Z',
    },
    {
      _id: JOB_IDS.archived,
      organizationId: ORG_ID,
      recruiterId: RECRUITER_ID,
      title: 'Full Stack Growth Engineer (Q3 Cohort)',
      role: 'Full Stack Engineer',
      description: 'Completed hiring sprint for onboarding and analytics instrumentation.',
      stack: 'Full Stack',
      requiredSkills: ['React', 'Node.js', 'TypeScript'],
      preferredSkills: ['PostgreSQL'],
      minExperienceYears: 3,
      location: 'Remote',
      salaryRangeMin: 110000,
      salaryRangeMax: 135000,
      employmentType: 'full-time',
      status: 'closed',
      archivedAt: '2026-11-01T17:00:00.000Z',
      createdAt: '2026-08-19T10:00:00.000Z',
      updatedAt: '2026-11-01T17:00:00.000Z',
    },
  ];
}

function createBaseMatches(candidates, jobs) {
  const backendJob = jobs[0];
  const frontendJob = jobs[1];
  const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));

  return [
    {
      _id: '65f1a2b3c4d5e6f708192f01',
      rank: 1,
      jobId: backendJob._id,
      candidateId: CANDIDATE_IDS.arjun,
      status: 'shortlisted',
      shortlisted: true,
      matchScore: 93,
      skillMatchPercent: 100,
      experienceMatch: 'Strong',
      githubProjectScore: 90,
      readinessScore: 92,
      confidenceScore: 91,
      recommendation: 'Strong Fit: exceeds required distributed backend and database benchmarks.',
      strengths: ['Python & Node.js overlap', 'PostgreSQL profiling proof', '6+ yrs experience'],
      weaknesses: ['Terraform exposure is limited'],
      explanation:
        'Matched 4/4 required backend skills and 3/3 preferred infrastructure technologies with high GitHub velocity.',
      breakdown: {
        skillMatch: { raw: 100, weight: 0.3, weighted: 30 },
        projectQuality: { raw: 90, weight: 0.2, weighted: 18 },
        github: { raw: 91, weight: 0.15, weighted: 13.65 },
        experience: { raw: 95, weight: 0.15, weighted: 14.25 },
        consistency: { raw: 89, weight: 0.1, weighted: 8.9 },
        growth: { raw: 88, weight: 0.1, weighted: 8.8 },
        matchedSkills: ['Python', 'Node.js', 'PostgreSQL', 'Docker', 'Kubernetes', 'Redis', 'TypeScript'],
      },
      candidate: byId[CANDIDATE_IDS.arjun],
      job: {
        _id: backendJob._id,
        title: backendJob.title,
        stack: backendJob.stack,
        status: backendJob.status,
        description: backendJob.description,
        requiredSkills: backendJob.requiredSkills,
        preferredSkills: backendJob.preferredSkills,
      },
      createdAt: '2026-11-18T09:00:00.000Z',
      updatedAt: '2026-11-18T12:00:00.000Z',
    },
    {
      _id: '65f1a2b3c4d5e6f708192f02',
      rank: 2,
      jobId: backendJob._id,
      candidateId: CANDIDATE_IDS.priya,
      status: 'generated',
      shortlisted: false,
      matchScore: 81,
      skillMatchPercent: 75,
      experienceMatch: 'Strong',
      githubProjectScore: 84,
      readinessScore: 85,
      confidenceScore: 83,
      recommendation: 'Good Fit: strong Python & Kubernetes infrastructure crossover.',
      strengths: ['Kubernetes & Docker depth', '7 yrs production reliability'],
      weaknesses: ['Missing Node.js & TypeScript backend history'],
      explanation:
        'Strong operational reliability profile with partial overlap on application runtime skills.',
      breakdown: {
        skillMatch: { raw: 75, weight: 0.3, weighted: 22.5 },
        projectQuality: { raw: 84, weight: 0.2, weighted: 16.8 },
        github: { raw: 83, weight: 0.15, weighted: 12.45 },
        experience: { raw: 92, weight: 0.15, weighted: 13.8 },
        consistency: { raw: 86, weight: 0.1, weighted: 8.6 },
        growth: { raw: 81, weight: 0.1, weighted: 8.1 },
        matchedSkills: ['Python', 'Docker', 'Kubernetes'],
      },
      candidate: byId[CANDIDATE_IDS.priya],
      job: {
        _id: backendJob._id,
        title: backendJob.title,
        stack: backendJob.stack,
        status: backendJob.status,
        description: backendJob.description,
        requiredSkills: backendJob.requiredSkills,
        preferredSkills: backendJob.preferredSkills,
      },
      createdAt: '2026-11-18T09:05:00.000Z',
      updatedAt: '2026-11-18T09:05:00.000Z',
    },
    {
      _id: '65f1a2b3c4d5e6f708192f03',
      rank: 3,
      jobId: backendJob._id,
      candidateId: CANDIDATE_IDS.marcus,
      status: 'generated',
      shortlisted: false,
      matchScore: 69,
      skillMatchPercent: null,
      experienceMatch: 'Moderate',
      githubProjectScore: null,
      readinessScore: 79,
      confidenceScore: null,
      recommendation: 'Review Needed: GitHub telemetry unavailable; verify backend skills in interview.',
      strengths: ['Node.js & PostgreSQL experience', 'Strong resume completeness'],
      weaknesses: ['GitHub score unavailable', 'Missing Docker & Redis evidence'],
      explanation:
        'Partial score computed without public GitHub or repository project evidence.',
      breakdown: {
        skillMatch: { raw: 65, weight: 0.3, weighted: 19.5 },
        projectQuality: { raw: null, weight: 0.2, weighted: null },
        github: { raw: null, weight: 0.15, weighted: null },
        experience: { raw: 72, weight: 0.15, weighted: 10.8 },
        consistency: { raw: 74, weight: 0.1, weighted: 7.4 },
        growth: { raw: 82, weight: 0.1, weighted: 8.2 },
        matchedSkills: ['Node.js', 'PostgreSQL', 'TypeScript'],
      },
      candidate: byId[CANDIDATE_IDS.marcus],
      job: {
        _id: backendJob._id,
        title: backendJob.title,
        stack: backendJob.stack,
        status: backendJob.status,
        description: backendJob.description,
        requiredSkills: backendJob.requiredSkills,
        preferredSkills: backendJob.preferredSkills,
      },
      createdAt: '2026-11-18T09:10:00.000Z',
      updatedAt: '2026-11-18T09:10:00.000Z',
    },
    {
      _id: '65f1a2b3c4d5e6f708192f04',
      rank: 4,
      jobId: backendJob._id,
      candidateId: CANDIDATE_IDS.elena,
      status: 'rejected',
      shortlisted: false,
      matchScore: 48,
      skillMatchPercent: 25,
      experienceMatch: 'Moderate',
      githubProjectScore: 88,
      readinessScore: 88,
      confidenceScore: 68,
      recommendation: 'Role Mismatch: specialist Angular frontend profile rather than backend infrastructure.',
      strengths: ['TypeScript & engineering rigor'],
      weaknesses: ['Frontend focus outside backend infrastructure scope'],
      explanation: 'Strong overall engineer, low overlap with backend infrastructure requirements.',
      breakdown: {
        skillMatch: { raw: 25, weight: 0.3, weighted: 7.5 },
        projectQuality: { raw: 90, weight: 0.2, weighted: 18 },
        github: { raw: 86, weight: 0.15, weighted: 12.9 },
        experience: { raw: 68, weight: 0.15, weighted: 10.2 },
        consistency: { raw: 91, weight: 0.1, weighted: 9.1 },
        growth: { raw: 85, weight: 0.1, weighted: 8.5 },
        matchedSkills: ['TypeScript'],
      },
      candidate: byId[CANDIDATE_IDS.elena],
      job: {
        _id: backendJob._id,
        title: backendJob.title,
        stack: backendJob.stack,
        status: backendJob.status,
        description: backendJob.description,
        requiredSkills: backendJob.requiredSkills,
        preferredSkills: backendJob.preferredSkills,
      },
      createdAt: '2026-11-18T09:15:00.000Z',
      updatedAt: '2026-11-18T11:30:00.000Z',
    },
    {
      _id: '65f1a2b3c4d5e6f708192f05',
      rank: 1,
      jobId: frontendJob._id,
      candidateId: CANDIDATE_IDS.elena,
      status: 'shortlisted',
      shortlisted: true,
      matchScore: 95,
      skillMatchPercent: 100,
      experienceMatch: 'Strong',
      githubProjectScore: 88,
      readinessScore: 88,
      confidenceScore: 93,
      recommendation: 'Top Fit for Staff Angular Design Systems Engineer.',
      strengths: ['Angular & SCSS tokens', 'Playwright accessibility QA'],
      weaknesses: [],
      explanation: '100% overlap on all required and preferred frontend architecture skills.',
      breakdown: {
        skillMatch: { raw: 100, weight: 0.3, weighted: 30 },
        projectQuality: { raw: 90, weight: 0.2, weighted: 18 },
        github: { raw: 86, weight: 0.15, weighted: 12.9 },
        experience: { raw: 95, weight: 0.15, weighted: 14.25 },
        consistency: { raw: 91, weight: 0.1, weighted: 9.1 },
        growth: { raw: 85, weight: 0.1, weighted: 8.5 },
        matchedSkills: ['Angular', 'TypeScript', 'SCSS', 'Playwright', 'RxJS'],
      },
      candidate: byId[CANDIDATE_IDS.elena],
      job: {
        _id: frontendJob._id,
        title: frontendJob.title,
        stack: frontendJob.stack,
        status: frontendJob.status,
        description: frontendJob.description,
        requiredSkills: frontendJob.requiredSkills,
        preferredSkills: frontendJob.preferredSkills,
      },
      createdAt: '2026-11-17T16:00:00.000Z',
      updatedAt: '2026-11-17T16:40:00.000Z',
    },
  ];
}

function createBaseShortlists(candidates, jobs) {
  const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));
  return [
    {
      _id: '65f1a2b3c4d5e6f708193001',
      candidateId: CANDIDATE_IDS.arjun,
      jobId: jobs[0]._id,
      teamId: TEAM_ID,
      status: 'interview',
      notes: 'Architecture panel scheduled for Thursday; verify StreamPulse latency benchmarks.',
      candidate: byId[CANDIDATE_IDS.arjun],
      job: jobs[0],
      createdAt: '2026-11-15T10:00:00.000Z',
      updatedAt: '2026-11-18T14:20:00.000Z',
    },
    {
      _id: '65f1a2b3c4d5e6f708193002',
      candidateId: CANDIDATE_IDS.elena,
      jobId: jobs[1]._id,
      teamId: TEAM_ID,
      status: 'contacted',
      notes: 'Sent design-system portfolio prompt and calendar availability.',
      candidate: byId[CANDIDATE_IDS.elena],
      job: jobs[1],
      createdAt: '2026-11-16T09:15:00.000Z',
      updatedAt: '2026-11-18T09:40:00.000Z',
    },
    {
      _id: '65f1a2b3c4d5e6f708193003',
      candidateId: CANDIDATE_IDS.priya,
      jobId: jobs[2]._id,
      teamId: TEAM_ID,
      status: 'reviewing',
      notes: 'Comparing Terraform drift policy project against Platform Lead scope.',
      candidate: byId[CANDIDATE_IDS.priya],
      job: jobs[2],
      createdAt: '2026-11-17T11:20:00.000Z',
      updatedAt: '2026-11-17T18:05:00.000Z',
    },
    {
      _id: '65f1a2b3c4d5e6f708193004',
      candidateId: CANDIDATE_IDS.marcus,
      jobId: null,
      teamId: TEAM_ID,
      status: 'shortlisted',
      notes: 'Requesting live code walkthrough since public GitHub history is unavailable.',
      candidate: byId[CANDIDATE_IDS.marcus],
      job: null,
      createdAt: '2026-11-18T08:00:00.000Z',
      updatedAt: '2026-11-18T08:00:00.000Z',
    },
  ];
}

function createBaseActivity(candidates, jobs) {
  const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));
  return [
    {
      _id: '65f1a2b3c4d5e6f708194001',
      actor: RECRUITER_ID,
      organizationId: ORG_ID,
      teamId: TEAM_ID,
      action: 'RECRUITER_CANDIDATE_ANALYZED',
      method: 'POST',
      route: `/api/recruiter-hub/candidates/${CANDIDATE_IDS.arjun}/analyze`,
      statusCode: 200,
      timestamp: '2026-11-18T14:25:00.000Z',
      candidate: byId[CANDIDATE_IDS.arjun],
      job: null,
    },
    {
      _id: '65f1a2b3c4d5e6f708194002',
      actor: RECRUITER_ID,
      organizationId: ORG_ID,
      teamId: TEAM_ID,
      action: 'RECRUITER_MATCH_GENERATED',
      method: 'POST',
      route: '/api/recruiter-hub/matches/generate',
      statusCode: 200,
      timestamp: '2026-11-18T12:15:00.000Z',
      candidate: null,
      job: { _id: jobs[0]._id, title: jobs[0].title },
    },
    {
      _id: '65f1a2b3c4d5e6f708194003',
      actor: RECRUITER_ID,
      organizationId: ORG_ID,
      teamId: TEAM_ID,
      action: 'RECRUITER_SHORTLIST_UPDATED',
      method: 'PATCH',
      route: '/api/recruiter-hub/shortlists/65f1a2b3c4d5e6f708193001',
      statusCode: 200,
      timestamp: '2026-11-18T11:40:00.000Z',
      candidate: byId[CANDIDATE_IDS.arjun],
      job: { _id: jobs[0]._id, title: jobs[0].title },
    },
    {
      _id: '65f1a2b3c4d5e6f708194004',
      actor: RECRUITER_ID,
      organizationId: ORG_ID,
      teamId: TEAM_ID,
      action: 'RECRUITER_CANDIDATE_VIEWED',
      method: 'GET',
      route: `/api/recruiter-hub/candidates/${CANDIDATE_IDS.elena}`,
      statusCode: 200,
      timestamp: '2026-11-17T16:12:00.000Z',
      candidate: byId[CANDIDATE_IDS.elena],
      job: null,
    },
    {
      _id: '65f1a2b3c4d5e6f708194005',
      actor: RECRUITER_ID,
      organizationId: ORG_ID,
      teamId: TEAM_ID,
      action: 'RECRUITER_JOB_CREATED',
      method: 'POST',
      route: '/api/recruiter-hub/jobs',
      statusCode: 201,
      timestamp: '2026-11-16T10:15:00.000Z',
      candidate: null,
      job: { _id: jobs[2]._id, title: jobs[2].title },
    },
  ];
}

function createBaseProfile() {
  return {
    name: 'Nadia Hassan',
    email: 'nadia.hassan@devinsight.example',
    avatar: '',
    phoneNumber: '+92 300 5550148',
    countryCode: '+92',
    githubUsername: 'nadiahassan',
    linkedin: 'linkedin.com/in/nadia-hassan-talent',
    location: 'Karachi / Remote',
    bio: 'Lead Technical Recruiter partnering with distributed infrastructure and product engineering teams.',
    jobTitle: 'Lead Technical Recruiter',
    website: 'https://northstartalent.example',
    organization: { _id: ORG_ID, name: 'Northstar Talent Labs' },
    teams: teamsPayload.teams,
    recruiterDetails: {
      education: 'MBA Talent & People Operations',
      yearsOfExperience: 7,
      experienceSummary:
        'Scaled backend, platform reliability, and Angular design-systems teams across 40+ hires.',
      certifications: ['AIRS Technical Recruiter', 'SHRM-CP'],
      specialties: ['Distributed Systems', 'Design Systems', 'Platform Reliability'],
      toolsAndPlatforms: ['DevInsight Hub', 'Greenhouse', 'GitHub'],
      languages: ['English', 'Urdu'],
    },
    recruiterPreferences: {
      preferredStacks: ['Backend', 'Frontend', 'DevOps'],
      preferredLocations: ['Remote', 'Berlin, Germany', 'London, UK'],
      preferredJobTypes: ['full-time', 'contract'],
      noteTemplate:
        'Hi! Your verified engineering portfolio stood out for our platform team — open to a quick 20-minute intro?',
      activityDigest: true,
    },
  };
}

function createState(empty = false) {
  if (empty) {
    return {
      candidates: [],
      jobs: [],
      matches: [],
      shortlists: [],
      activity: [],
      profile: createBaseProfile(),
    };
  }
  const candidates = createBaseCandidates();
  const jobs = createBaseJobs();
  const matches = createBaseMatches(candidates, jobs);
  const shortlists = createBaseShortlists(candidates, jobs);
  const activity = createBaseActivity(candidates, jobs);
  const profile = createBaseProfile();
  return { candidates, jobs, matches, shortlists, activity, profile };
}

function buildAnalytics(state) {
  const { candidates, jobs, matches, shortlists, activity } = state;
  const openJobs = jobs.filter((j) => j.status === 'open').length;
  const draftJobs = jobs.filter((j) => j.status === 'draft').length;
  const closedJobs = jobs.filter((j) => j.status === 'closed').length;
  const shortlistedMatches = matches.filter((m) => m.status === 'shortlisted').length;
  const avgCandidateScore = candidates.length
    ? Math.round(
        (candidates.reduce((acc, c) => acc + Number(c.readinessScore || 0), 0) /
          candidates.length) *
          10,
      ) / 10
    : 0;
  const successRate = matches.length
    ? Math.round((shortlistedMatches / matches.length) * 100)
    : 0;
  const candidatesViewed = activity.filter((l) => l.action === 'RECRUITER_CANDIDATE_VIEWED').length;
  const candidatesAnalyzed = activity.filter(
    (l) => l.action === 'RECRUITER_CANDIDATE_ANALYZED',
  ).length;
  const activityScore = candidates.length
    ? Math.min(
        100,
        candidatesViewed * 8 +
          candidatesAnalyzed * 10 +
          jobs.length * 6 +
          shortlists.length * 6 +
          matches.length * 4,
      )
    : 0;

  return {
    metrics: {
      totalCandidates: candidates.length,
      avgCandidateScore,
      openJobs,
      draftJobs,
      closedJobs,
      teamRecruiters: 4,
      assignedTeams: teamsPayload.teams.length,
      candidatesViewed,
      candidatesAnalyzed,
      activeJobs: openJobs,
      matchesGenerated: matches.length,
      shortlistedCandidates: shortlists.length,
      recruiterActivityScore: activityScore,
      successRate,
    },
    charts: {
      scoreDistribution: candidates.length
        ? [
            { label: '90-100', min: 90, max: 100, count: 1 },
            { label: '80-89', min: 80, max: 89.999, count: 2 },
            { label: '70-79', min: 70, max: 79.999, count: 1 },
            { label: '60-69', min: 60, max: 69.999, count: 0 },
            { label: 'Below 60', min: -Infinity, max: 59.999, count: 0 },
          ]
        : [],
      candidatesByStack: candidates.length
        ? [
            { label: 'Backend', count: 1 },
            { label: 'Frontend', count: 1 },
            { label: 'Full Stack', count: 1 },
            { label: 'DevOps', count: 1 },
          ]
        : [],
      jobsPostedTrend: jobs.length
        ? [
            { label: 'Jun', count: 1 },
            { label: 'Jul', count: 0 },
            { label: 'Aug', count: 1 },
            { label: 'Sep', count: 1 },
            { label: 'Oct', count: 2 },
            { label: 'Nov', count: 1 },
          ]
        : [],
      experienceDistribution: candidates.length
        ? [
            { label: '0-2 Years', min: 0, max: 2, count: 0 },
            { label: '2-5 Years', min: 2, max: 5, count: 1 },
            { label: '5-8 Years', min: 5, max: 8, count: 3 },
            { label: '8+ Years', min: 8, max: Infinity, count: 0 },
          ]
        : [],
      topSkillsDemand: jobs.length
        ? [
            { label: 'TypeScript', count: 3 },
            { label: 'Python', count: 2 },
            { label: 'Node.js', count: 2 },
            { label: 'Kubernetes', count: 2 },
            { label: 'PostgreSQL', count: 2 },
            { label: 'Angular', count: 1 },
          ]
        : [],
      supplyVsDemand: candidates.length
        ? [
            { label: 'TypeScript', supply: 3, demand: 3 },
            { label: 'Python', supply: 2, demand: 2 },
            { label: 'Node.js', supply: 2, demand: 2 },
            { label: 'Kubernetes', supply: 2, demand: 2 },
            { label: 'PostgreSQL', supply: 2, demand: 2 },
            { label: 'Angular', supply: 1, demand: 1 },
          ]
        : [],
      candidateActivityTrend: activity.length
        ? [
            { date: '2026-11-14', count: 1 },
            { date: '2026-11-15', count: 2 },
            { date: '2026-11-16', count: 2 },
            { date: '2026-11-17', count: 3 },
            { date: '2026-11-18', count: 4 },
          ]
        : [],
      matchGenerationTrend: matches.length
        ? [
            { date: '2026-11-16', count: 1 },
            { date: '2026-11-17', count: 2 },
            { date: '2026-11-18', count: 4 },
          ]
        : [],
      weeklyRecruiterActivity: activity.length
        ? [
            { date: '2026-11-14', count: 2 },
            { date: '2026-11-15', count: 3 },
            { date: '2026-11-16', count: 4 },
            { date: '2026-11-17', count: 5 },
            { date: '2026-11-18', count: 7 },
          ]
        : [],
      aiUsageGraph: activity.length
        ? [
            { date: '2026-11-15', count: 1 },
            { date: '2026-11-16', count: 2 },
            { date: '2026-11-17', count: 2 },
            { date: '2026-11-18', count: 4 },
          ]
        : [],
      jobPerformanceChart: jobs.map((j) => ({
        label: j.title,
        status: j.status,
        updatedAt: j.updatedAt,
      })),
      skillDemandChart: jobs.length
        ? [
            { label: 'TypeScript', count: 2 },
            { label: 'Python', count: 1 },
            { label: 'Node.js', count: 2 },
            { label: 'PostgreSQL', count: 1 },
            { label: 'Angular', count: 1 },
            { label: 'Kubernetes', count: 1 },
          ]
        : [],
    },
    highlights: {
      mostMatchedSkills: matches.length
        ? [
            { label: 'TypeScript', count: 3 },
            { label: 'PostgreSQL', count: 2 },
            { label: 'Python', count: 2 },
            { label: 'Node.js', count: 2 },
          ]
        : [],
      mostActiveJobs: jobs.slice(0, 4).map((j, idx) => ({
        label: j.title,
        count: Math.max(1, 5 - idx),
      })),
      recentActivity: activity.slice(0, 10),
    },
    widgets: {
      assignedTeams: teamsPayload.teams,
      recentActivity: activity.slice(0, 8),
      topCandidates: candidates.slice(0, 5),
      recentJobs: jobs.slice(0, 5),
      recentMatches: matches.slice(0, 5),
      pendingFollowUps: shortlists.filter((s) =>
        ['shortlisted', 'reviewing', 'contacted'].includes(s.status),
      ),
      aiInsights: jobs.length
        ? [
            'Skill demand is strongest for TypeScript across active roles.',
            'Backend & Kubernetes supply matches current open requisitions.',
          ]
        : [],
    },
    profile: {
      recruiterId: RECRUITER_ID,
      organizationId: ORG_ID,
      organizationName: 'Northstar Talent Labs',
      organizationDescription: 'Enterprise Developer Intelligence & Technical Hiring',
      name: state.profile.name,
      teams: teamsPayload.teams,
    },
  };
}

function buildComparison(state, candidateIds, jobId) {
  const picked = state.candidates.filter((c) => candidateIds.includes(c.id));
  return picked.map((candidate) => {
    const projectScores = (candidate.projects || []).map((p) => Number(p.impactScore || 0));
    const projectQuality = projectScores.length
      ? Math.round(projectScores.reduce((a, b) => a + b, 0) / projectScores.length)
      : 0;
    const match = jobId
      ? state.matches.find((m) => m.candidateId === candidate.id && m.jobId === jobId) || null
      : null;

    return {
      id: candidate.id,
      name: candidate.name,
      stack: candidate.stack,
      experience: candidate.yearsOfExperience,
      readinessScore: candidate.readinessScore,
      githubScore: candidate.githubScore,
      resumeScore: candidate.resumeScore,
      projectQuality,
      skillGaps: candidate.skillGaps || [],
      recommendation: candidate.aiInsight?.recommendation || 'Evaluate fit',
      match,
    };
  });
}

module.exports = {
  ORG_ID,
  TEAM_ID,
  RECRUITER_ID,
  JOB_IDS,
  CANDIDATE_IDS,
  recruiterUser,
  organizationsPayload,
  teamsPayload,
  createState,
  buildAnalytics,
  buildComparison,
};

