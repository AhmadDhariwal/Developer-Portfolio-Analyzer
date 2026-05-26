const safeList = (values = [], limit = 8) =>
  (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, limit);

const formatTasks = (tasks = []) =>
  tasks.slice(0, 8).map((task, index) => (
    `${index + 1}. ${task.title} [${task.category}/${task.priority}/${task.points}pts] - ${task.description}`
  )).join('\n');

const getCareerSprintPrompt = ({
  careerStack,
  experienceLevel,
  focusTechnology,
  sprintWindow,
  missingSkills,
  githubWeakAreas,
  recommendationTechnologies,
  developerSignals,
  baselineTasks
}) => {
  const sprintSignal = developerSignals?.careerSprintSignal || {};
  const weeklySignal = developerSignals?.weeklyReportSignal || {};
  const portfolioSignal = developerSignals?.portfolioSignal || {};
  const integrationSignal = developerSignals?.integrationSignal || {};

  return `
You are generating a realistic developer sprint plan for DevInsight AI.

Return valid JSON only with this exact shape:
{
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "points": 1,
      "priority": "high|medium|low",
      "category": "learning|project|practice"
    }
  ],
  "planMeta": {
    "summary": "string",
    "confidenceScore": 0,
    "consistencyScore": 0,
    "signalsUsed": ["string"]
  }
}

Rules:
- Return 6 to 8 tasks.
- Keep tasks realistic for one sprint only.
- Balance learning, project, and practice work.
- Avoid duplicates.
- Use clear action-oriented descriptions.
- Keep titles short and professional.
- Points must be 1 to 10.
- confidenceScore and consistencyScore must be 0 to 100.
- Do not include markdown.
- Do not invent unavailable personal data.
- Prefer smaller tasks if consistency is low or repeated misses are high.

Developer context:
- Career stack: ${careerStack || 'Full Stack'}
- Experience level: ${experienceLevel || 'Student'}
- Focus technology: ${focusTechnology || 'General growth'}
- Sprint window: ${sprintWindow || 'Current sprint'}

Signals:
- Missing skills: ${safeList(missingSkills, 6).join(', ') || 'None detected'}
- GitHub weak areas: ${safeList(githubWeakAreas, 5).join(', ') || 'No major weak areas'}
- Recommendation technologies: ${safeList(recommendationTechnologies, 5).join(', ') || 'None'}
- Sprint consistency score: ${Number(sprintSignal.consistencyScore || 0)}
- Active learning focus: ${sprintSignal.activeLearningFocus || 'Not set'}
- Current streak: ${Number(sprintSignal.streak || 0)}
- Weekly progress score: ${Number(weeklySignal.weeklyProgressScore || 0)}
- Weekly repeated weak areas: ${safeList(weeklySignal.repeatedWeakAreas, 5).join(', ') || 'None'}
- Portfolio completeness: ${Number(portfolioSignal.completenessScore || 0)}%
- Integration proof providers: ${safeList(integrationSignal.usedProviders, 6).join(', ') || 'None'}
- Strongest proof: ${safeList(integrationSignal.strongestProof, 5).join(', ') || 'None'}

Baseline deterministic plan to improve:
${formatTasks(baselineTasks)}

Task quality requirements:
- At least 2 tasks should directly address high-priority gaps.
- At least 1 task should produce visible proof of work.
- At least 1 task should improve code quality, consistency, or interview readiness.
- If momentum is low, reduce scope and prefer tighter deliverables.
- If portfolio completeness is low, include one proof/presentation/polish task.
`.trim();
};

module.exports = {
  getCareerSprintPrompt
};
