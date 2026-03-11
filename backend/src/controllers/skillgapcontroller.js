const { analyzeGitHubProfile } = require('../services/githubservice');
const { detectSkillGaps, skillsFromLanguages } = require('../utils/skilldetector');

// ─── Learning-roadmap data ─────────────────────────────────────────────────
// Each phase is generic but refers to the skill groups a developer is most
// likely to need based on industry demand ordering.
const ROADMAP_PHASES = [
  {
    phase: 'Phase 1',
    duration: '2-4 weeks',
    title: 'Cloud Fundamentals',
    description: 'Start with AWS Cloud Practitioner certification and deploy your existing projects to AWS.',
    skills: ['AWS EC2', 'S3', 'IAM', 'VPC'],
    resources: ['AWS Free Tier', 'A Cloud Guru', 'AWS Documentation'],
    color: 'purple'
  },
  {
    phase: 'Phase 2',
    duration: '4-6 weeks',
    title: 'Container Orchestration',
    description: 'Learn Kubernetes fundamentals, deploy containerised applications, and understand cluster management.',
    skills: ['Kubernetes', 'Helm', 'kubectl', 'Deployments'],
    resources: ['Kubernetes.io Docs', 'CKAD Course', 'Minikube'],
    color: 'blue'
  },
  {
    phase: 'Phase 3',
    duration: '3-5 weeks',
    title: 'Caching & Messaging',
    description: 'Master Redis for caching and session management, then explore Kafka for event streaming.',
    skills: ['Redis', 'Kafka', 'Event Streaming', 'Pub/Sub'],
    resources: ['Redis University', 'Confluent Kafka', 'Real Python'],
    color: 'green'
  },
  {
    phase: 'Phase 4',
    duration: '4-6 weeks',
    title: 'Infrastructure as Code',
    description: 'Automate cloud infrastructure with Terraform and establish CI/CD pipelines.',
    skills: ['Terraform', 'Ansible', 'CI/CD', 'IaC Patterns'],
    resources: ['HashiCorp Learn', 'Terraform Docs', 'GitHub Actions'],
    color: 'orange'
  }
];

// Assign a proficiency score to a known skill (based on presence + position in list)
const scoreForSkill = (skillName, languageDistribution = []) => {
  const langEntry = languageDistribution.find(
    l => l.language?.toLowerCase() === skillName.toLowerCase()
  );
  if (langEntry) return Math.min(50 + langEntry.percentage, 100);
  // Default proficiency for skills detected from repo context
  const defaults = {
    'TypeScript': 85, 'Node.js': 78, 'Python': 72, 'React': 90,
    'REST APIs': 88, 'Go': 71, 'Git': 93, 'MongoDB': 65,
    'GraphQL': 60, 'Next.js': 80, 'Tailwind CSS': 85, 'Jest': 62,
    'PostgreSQL': 70, 'Docker': 65, 'CI/CD': 55, 'Java': 68
  };
  return defaults[skillName] || 65;
};

// @desc  Analyze skill gap for any GitHub username (public, no auth required)
// @route POST /api/analysis/skill-gap
// @access Public
const analyzeSkillGap = async (req, res) => {
  try {
    const { username } = req.body;
    if (!username?.trim()) {
      return res.status(400).json({ message: 'GitHub username is required.' });
    }

    // 1. Fetch GitHub data to derive current skills
    const githubData = await analyzeGitHubProfile(username.trim());

    // 2. Derive known skills from languages + common repo tools
    const detectedFromLangs = skillsFromLanguages(githubData.languageDistribution);

    // Also add skills present in the repo list (e.g. if user has a "docker-setup" repo)
    const repoNames = (githubData.repositories || []).map(r => r.name.toLowerCase()).join(' ');
    const extraSkills = [];
    if (repoNames.includes('docker'))     extraSkills.push('Docker');
    if (repoNames.includes('k8s') || repoNames.includes('kubernetes')) extraSkills.push('Kubernetes');
    if (repoNames.includes('redis'))      extraSkills.push('Redis');
    if (repoNames.includes('terraform'))  extraSkills.push('Terraform');
    if (repoNames.includes('graphql'))    extraSkills.push('GraphQL');
    if (repoNames.includes('kafka'))      extraSkills.push('Kafka');
    if (repoNames.includes('postgres') || repoNames.includes('postgresql')) extraSkills.push('PostgreSQL');
    if (repoNames.includes('mongo'))      extraSkills.push('MongoDB');

    const allCurrentSkillNames = [...new Set([...detectedFromLangs, ...extraSkills])];

    // 3. Detect gaps
    const { currentSkills, missingSkills } = detectSkillGaps(allCurrentSkillNames);

    // 4. Build "Your Skills" entries with proficiency percentage
    const yourSkills = currentSkills.map(skill => ({
      name:       skill.name,
      category:   skill.category,
      proficiency: scoreForSkill(skill.name, githubData.languageDistribution)
    }));

    // 5. Coverage stats
    const total    = currentSkills.length + missingSkills.length;
    const covered  = currentSkills.length;
    const coverage = total > 0 ? Math.round((covered / total) * 100) : 0;
    const missing  = 100 - coverage;

    // 6. Build missing skills response
    const missingSkillsData = missingSkills.map(skill => ({
      name:      skill.name,
      category:  skill.category,
      priority:  skill.priority,
      jobDemand: skill.jobDemand
    })).sort((a, b) => {
      const order = { High: 0, Medium: 1, Low: 2 };
      return order[a.priority] - order[b.priority];
    });

    // 7. Customise roadmap phases to highlight the top missing skills
    const topMissing = missingSkillsData.filter(s => s.priority === 'High').slice(0, 4).map(s => s.name);
    const roadmap = ROADMAP_PHASES.map((phase, i) => ({
      ...phase,
      // Replace first skills entry with an actual top-missing skill if available
      topSkill: topMissing[i] || phase.skills[0]
    }));

    // 8. Total roadmap weeks estimate
    const totalWeeks = '~16 weeks total';

    res.json({
      username: username.trim(),
      coverage,
      missing,
      yourSkills,
      missingSkills: missingSkillsData,
      roadmap,
      totalWeeks
    });

  } catch (error) {
    console.error('Skill Gap Error:', error.message);

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

    res.status(500).json({ message: msg || 'Failed to analyze skill gap.' });
  }
};

module.exports = { analyzeSkillGap };
