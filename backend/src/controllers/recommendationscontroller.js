const { analyzeGitHubProfile } = require('../services/githubservice');
const { detectSkillGaps, skillsFromLanguages } = require('../utils/skilldetector');

// ─── Static project catalogue keyed by required skill ─────────────────────
const PROJECT_CATALOGUE = [
  {
    id: 'p1',
    title: 'Build a Real-time Analytics Dashboard',
    description: 'Create a full-stack analytics platform using Next.js, Kafka for event streaming, and a Kubernetes deployment pipeline. This project will directly address your Kafka and K8s skill gaps.',
    tech: ['Next.js', 'Kafka', 'Kubernetes', 'Redis'],
    difficulty: 'Advanced',
    estimatedWeeks: '6-8 weeks',
    impact: 95,
    triggerSkills: ['Kafka', 'Kubernetes', 'Redis'],
  },
  {
    id: 'p2',
    title: 'Serverless AWS Microservices',
    description: 'Design and deploy a serverless architecture using AWS Lambda, API Gateway, DynamoDB, and SQS. Great project to showcase cloud skills to recruiters.',
    tech: ['AWS Lambda', 'DynamoDB', 'API Gateway', 'SQS'],
    difficulty: 'Intermediate',
    estimatedWeeks: '4-5 weeks',
    impact: 88,
    triggerSkills: ['AWS', 'Terraform'],
  },
  {
    id: 'p3',
    title: 'Infrastructure as Code Template Library',
    description: 'Build a reusable Terraform module library for common AWS infrastructure patterns. Open-source this to gain community visibility.',
    tech: ['Terraform', 'AWS', 'Ansible', 'GitHub'],
    difficulty: 'Intermediate',
    estimatedWeeks: '3-4 weeks',
    impact: 82,
    triggerSkills: ['Terraform', 'AWS', 'CI/CD'],
  },
  {
    id: 'p4',
    title: 'Distributed Cache System with Redis',
    description: 'Implement advanced Redis patterns: caching strategies, pub/sub-messaging, distributed locks, and rate limiting in a real application.',
    tech: ['Redis', 'Node.js', 'Docker', 'Testing'],
    difficulty: 'Intermediate',
    estimatedWeeks: '2-3 weeks',
    impact: 76,
    triggerSkills: ['Redis', 'Docker'],
  },
  {
    id: 'p5',
    title: 'Full-stack TypeScript Monorepo',
    description: 'Scaffold a production-grade monorepo with a Next.js frontend, Node.js backend, shared types, and a CI/CD pipeline on GitHub Actions.',
    tech: ['TypeScript', 'Next.js', 'Node.js', 'GitHub Actions'],
    difficulty: 'Intermediate',
    estimatedWeeks: '4-5 weeks',
    impact: 85,
    triggerSkills: ['TypeScript', 'Next.js', 'CI/CD'],
  },
  {
    id: 'p6',
    title: 'Go Microservice with gRPC',
    description: 'Write a performant Go microservice exposing a gRPC API with Prometheus metrics and Docker-based deployment.',
    tech: ['Go', 'gRPC', 'Prometheus', 'Docker'],
    difficulty: 'Advanced',
    estimatedWeeks: '5-6 weeks',
    impact: 79,
    triggerSkills: ['Go', 'Prometheus', 'Docker'],
  },
];

// ─── Technology descriptions keyed by skill name ───────────────────────────
const TECH_DESCRIPTIONS = {
  'Kubernetes':   'Highest demand in DevOps roles',
  'AWS':          'Required in 78% of senior roles',
  'Redis':        'Critical for system design interviews',
  'Kafka':        'Essential for distributed systems',
  'Go':           'Growing demand in backend roles',
  'Terraform':    'IaC is now a standard requirement',
  'Prometheus':   'Standard monitoring stack for K8s',
  'CI/CD':        'Required for all modern engineering teams',
  'Docker':       'Baseline containerization skill',
  'GraphQL':      'Increasingly adopted by product companies',
  'PostgreSQL':   'Most requested SQL database in job postings',
  'TypeScript':   'Default language for new projects',
  'React':        'Dominant frontend framework worldwide',
  'Next.js':      'Go-to for React SSR/SSG applications',
  'Rust':         'Systems programming with memory safety',
};

// Priority label shown on technology rows
const TECH_PRIORITY = {
  High:   'Must Learn',
  Medium: 'High Priority',
  Low:    'Recommended',
};

// ─── Career path templates ─────────────────────────────────────────────────
const CAREER_PATHS = [
  {
    id: 'cp1',
    title: 'Senior Full Stack Engineer',
    salaryRange: '$140K - $180K',
    timeline: '3-6 months',
    description: 'Your React and Node.js expertise positions you well. Fill the cloud and DevOps gaps to be fully competitive.',
    hiringCompanies: ['Stripe', 'Linear', 'Vercel', 'Notion'],
    actionItems: ['Add AWS', 'Add Kubernetes', 'Strengthen System Design'],
    boostSkills: ['AWS', 'Kubernetes', 'CI/CD'],
    requiredCoverage: 65,
  },
  {
    id: 'cp2',
    title: 'DevOps / Platform Engineer',
    salaryRange: '$130K - $170K',
    timeline: '6-9 months',
    description: 'Strong Docker foundation but needs significant cloud and orchestration experience. High growth opportunity.',
    hiringCompanies: ['HashiCorp', 'Datadog', 'GitLab', 'Cloudflare'],
    actionItems: ['Master Kubernetes', 'AWS/GCP', 'Terraform', 'Prometheus'],
    boostSkills: ['Kubernetes', 'AWS', 'Terraform', 'Prometheus'],
    requiredCoverage: 40,
  },
  {
    id: 'cp3',
    title: 'Backend / API Engineer',
    salaryRange: '$125K - $165K',
    timeline: '2-4 months',
    description: 'Strong Node.js and database skills. Add Redis and Kafka to reach 90%+ match for senior backend positions.',
    hiringCompanies: ['PlanetScale', 'Supabase', 'Neon', 'Railway'],
    actionItems: ['Add Redis', 'Add Kafka', 'System Design'],
    boostSkills: ['Redis', 'Kafka', 'PostgreSQL'],
    requiredCoverage: 55,
  },
];

// ─── Compute a match % for a career path given user's current skills ────────
const computeCareerMatch = (path, currentSkillNames) => {
  const lowerCurrent = currentSkillNames.map(s => s.toLowerCase());
  const hits = path.boostSkills.filter(s => lowerCurrent.includes(s.toLowerCase())).length;
  const base = path.requiredCoverage;
  const boost = Math.round((hits / path.boostSkills.length) * (100 - base));
  return Math.min(base + boost, 99);
};

// @desc  Generate personalised recommendations from GitHub profile (public)
// @route POST /api/recommendations
// @access Public
const getRecommendations = async (req, res) => {
  try {
    const { username } = req.body;
    if (!username?.trim()) {
      return res.status(400).json({ message: 'GitHub username is required.' });
    }

    // 1. Fetch GitHub profile data
    const githubData = await analyzeGitHubProfile(username.trim());

    // 2. Detect current skills & missing skills
    const detectedFromLangs = skillsFromLanguages(githubData.languageDistribution);
    const repoNames = (githubData.repositories || []).map(r => r.name.toLowerCase()).join(' ');
    const extraSkills = [];
    if (repoNames.includes('docker'))                                 extraSkills.push('Docker');
    if (repoNames.includes('k8s') || repoNames.includes('kubernetes')) extraSkills.push('Kubernetes');
    if (repoNames.includes('redis'))                                  extraSkills.push('Redis');
    if (repoNames.includes('terraform'))                              extraSkills.push('Terraform');
    if (repoNames.includes('graphql'))                                extraSkills.push('GraphQL');
    if (repoNames.includes('kafka'))                                  extraSkills.push('Kafka');
    if (repoNames.includes('postgres') || repoNames.includes('postgresql')) extraSkills.push('PostgreSQL');
    if (repoNames.includes('mongo'))                                  extraSkills.push('MongoDB');
    if (repoNames.includes('react'))                                  extraSkills.push('React');
    if (repoNames.includes('next'))                                   extraSkills.push('Next.js');
    if (repoNames.includes('go-'))                                    extraSkills.push('Go');

    const allCurrentSkillNames = [...new Set([...detectedFromLangs, ...extraSkills])];
    const lowerCurrent = allCurrentSkillNames.map(s => s.toLowerCase());
    const { missingSkills } = detectSkillGaps(allCurrentSkillNames);

    // 3. Select projects — prefer those that address the user's top missing skills
    const missingNames = missingSkills.map(s => s.name);
    const scored = PROJECT_CATALOGUE.map(proj => {
      const overlap = proj.triggerSkills.filter(s => missingNames.includes(s)).length;
      return { ...proj, score: overlap };
    });
    scored.sort((a, b) => b.score - a.score || b.impact - a.impact);
    const projects = scored.slice(0, 4).map(({ score: _s, ...rest }) => rest);

    // 4. Build technology recommendations from missing skills (sorted by jobDemand desc)
    const technologies = missingSkills
      .sort((a, b) => b.jobDemand - a.jobDemand)
      .slice(0, 6)
      .map(skill => ({
        name:        skill.name,
        category:    skill.category,
        priority:    TECH_PRIORITY[skill.priority] || 'Recommended',
        priorityRaw: skill.priority,
        jobDemand:   skill.jobDemand,
        description: TECH_DESCRIPTIONS[skill.name] || `In-demand ${skill.category} skill`,
      }));

    // 5. Career paths with personalised match %
    const careerPaths = CAREER_PATHS.map(path => ({
      ...path,
      match: computeCareerMatch(path, allCurrentSkillNames),
    }));
    careerPaths.sort((a, b) => b.match - a.match);

    res.json({
      username: username.trim(),
      projects,
      technologies,
      careerPaths,
    });

  } catch (error) {
    console.error('Recommendations Error:', error.message);

    // Friendly rate-limit message
    const msg = error.message || '';
    if (
      error.response?.status === 403 ||
      error.response?.status === 429 ||
      msg.toLowerCase().includes('rate limit')
    ) {
      return res.status(429).json({
        message: 'GitHub API rate limit exceeded. Please wait a few minutes and try again, or add a GITHUB_TOKEN to the backend .env file for a higher limit.'
      });
    }

    res.status(500).json({ message: msg || 'Failed to generate recommendations.' });
  }
};

module.exports = { getRecommendations };
