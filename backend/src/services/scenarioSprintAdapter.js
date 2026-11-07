'use strict';
const { digest } = require('../utils/scenarioIdentity');
const { calendar } = require('../utils/sprintCalendar');
const VERSION = 'scenario-sprint-proposal-v1';
const buildProposal = (scenario, sprint) => {
  const hash =
    scenario.scenarioHash ||
    scenario.result?.scenarioHash ||
    digest({ skills: scenario.skills, projects: scenario.projects });
  const items = [
    ...(scenario.skills || []).slice(0, 4).map((skill, index) => ({
      kind: 'skill',
      name: skill,
      category: 'learning',
      points: index < 2 ? 5 : 4,
      priority: index === 0 ? 'high' : 'medium',
    })),
    ...(scenario.projects || []).slice(0, 2).map((project) => ({
      kind: 'project',
      name: project.name,
      category: 'project',
      points: project.complexity === 'high' ? 6 : project.complexity === 'medium' ? 5 : 4,
      priority: project.impact >= 80 ? 'high' : 'medium',
    })),
  ];
  const c = calendar(sprint);
  const start = sprint.sprintStartDate || sprint.weekStartDate;
  const end = sprint.sprintEndDate || sprint.weekEndDate;
  const days = c.difference(start, end) + 1;
  if (!start || !end || days < 1)
    throw Object.assign(new Error('A valid target Sprint calendar is required.'), { statusCode: 409 });
  return items.map((item, index) => {
    const sourceScenarioItemKey = digest({
      hash,
      kind: item.kind,
      name: String(item.name).trim().toLowerCase(),
      version: VERSION,
    });
    const rawTitle = `${item.kind === 'skill' ? 'Learn' : 'Build'} ${item.name}`;
    const title =
      rawTitle.length > 120 ? `${rawTitle.slice(0, 109)} ${sourceScenarioItemKey.slice(0, 10)}` : rawTitle;
    const day = c.add(start, Math.min(days - 1, Math.floor((index * days) / items.length)));
    return {
      title,
      description: `Proposed ${item.kind} work from a hypothetical ${scenario.durationWeeks}-week plan. This Sprint schedules a planning step, not guaranteed completion or proficiency.`,
      points: item.points,
      priority: item.priority,
      category: item.category,
      taskType: 'manual',
      isCompleted: false,
      startDate: c.start(day),
      endDate: c.end(day),
      sourceScenarioId: scenario._id || null,
      sourceScenarioHash: hash,
      sourceScenarioItemKey,
    };
  });
};
module.exports = { buildProposal, VERSION };
