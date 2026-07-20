const clamp = (value, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
};

const SKILL_PREREQUISITES = {
  'React': ['TypeScript', 'Git'],
  'Next.js': ['React', 'TypeScript'],
  'Node.js': ['JavaScript', 'REST APIs'],
  'GraphQL': ['Node.js', 'REST APIs'],
  'Kubernetes': ['Docker'],
  'Terraform': ['AWS'],
  'CI/CD': ['Git'],
  'Kafka': ['Node.js'],
  'Prometheus': ['Kubernetes'],
  'Redis': ['PostgreSQL'],
  'System Design': ['REST APIs', 'Databases'],
  'Testing': ['Git'],
  'Cloud Basics': ['Linux'],
  'Performance Optimization': ['System Design'],
  'Scalability Patterns': ['System Design', 'Caching Strategies']
};

const toSkillName = (skill) => {
  if (!skill) return '';
  if (typeof skill === 'string') return skill.trim();
  return String(skill.name || skill.skill || '').trim();
};

const toNodeId = (name) => String(name || '').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');

const difficultyFromSkill = ({ kind, demandScore, proficiency, priority }) => {
  if (kind === 'current') return proficiency >= 75 ? 'Applied' : 'Needs Proof';
  if (priority === 'High' || demandScore >= 85) return 'Hard';
  if (demandScore >= 65) return 'Medium';
  return 'Easy';
};

const buildPrereqsByTarget = (edges = []) => {
  const prereqsByTarget = new Map();
  edges.filter((edge) => edge.type === 'prerequisite').forEach((edge) => {
    const arr = prereqsByTarget.get(edge.to) || [];
    arr.push(edge.from);
    prereqsByTarget.set(edge.to, arr);
  });
  return prereqsByTarget;
};

const describeSkillSet = (focusSkills = []) => {
  if (!focusSkills.length) return 'your current roadmap';
  if (focusSkills.length === 1) return focusSkills[0];
  if (focusSkills.length === 2) return `${focusSkills[0]} and ${focusSkills[1]}`;
  return `${focusSkills[0]}, ${focusSkills[1]}, and ${focusSkills[2]}`;
};

const selectWeekSkills = ({ missingNodes, prereqsByTarget, completed, planned }) => {
  const weekSkills = [];

  for (const node of missingNodes) {
    if (planned.has(node.id)) continue;
    const prereqs = prereqsByTarget.get(node.id) || [];
    // Dependencies must finish in an earlier week, not beside the dependent skill.
    const ready = prereqs.every((pre) => completed.has(pre));
    if (!ready) continue;

    weekSkills.push(node);
    planned.add(node.id);
    if (weekSkills.length >= 2) break;
  }

  return weekSkills;
};

const getWeekReason = (week, maxDemand, focusSkills = []) => {
  if (!focusSkills.length) {
    return 'Review and consolidate previous learning goals.';
  }

  const focusLabel = describeSkillSet(focusSkills);
  if (week === 1) {
    return `Start with ${focusLabel} because these skills are either immediately market-relevant or unblock the rest of your roadmap.`;
  }

  if (maxDemand >= 85) {
    return `Week ${week} focuses on ${focusLabel} because demand is high and the earlier dependencies should now be in place.`;
  }

  if (week <= 3) {
    return `Week ${week} moves into ${focusLabel} to build on the foundation from the previous milestone and keep momentum practical.`;
  }

  return `Week ${week} uses ${focusLabel} to deepen applied proof, close remaining gaps, and prepare stronger role-fit evidence.`;
};

const buildWeekOutcomes = (week, focusSkills = []) => {
  if (!focusSkills.length) {
    return [
      'Review completed notes and refine portfolio evidence for the strongest skills covered so far.',
      'Use the week to consolidate gaps that still feel unclear before moving forward.'
    ];
  }

  return focusSkills.map((skill, index) => {
    if (week <= 2) {
      return `Implement one small practice artifact that proves ${skill} in a realistic workflow.`;
    }
    if (week <= 5) {
      return index === 0
        ? `Add ${skill} to a portfolio-ready project and document the technical decisions behind it.`
        : `Write, test, or deploy a concrete feature that demonstrates ${skill} beyond tutorial-level understanding.`;
    }
    return index === 0
      ? `Prepare an interview-ready explanation showing where ${skill} fits in a production system.`
      : `Turn ${skill} into measurable proof through cleanup, documentation, and repeatable project evidence.`;
  });
};

const buildSkillGraph = ({ currentSkills = [], missingSkills = [] }) => {
  const current = Array.isArray(currentSkills) ? currentSkills : [];
  const missing = Array.isArray(missingSkills) ? missingSkills : [];

  const nodesById = new Map();

  const addNode = (skill, kind) => {
    const name = toSkillName(skill);
    if (!name) return;
    const id = toNodeId(name);
    if (nodesById.has(id)) return;

    const demandFromSkill = typeof skill === 'object' ? skill.jobDemand : 0;
    const proficiency = typeof skill === 'object' ? skill.proficiency : 0;
    const category = typeof skill === 'object' ? skill.category : 'General';
    const priority = typeof skill === 'object' ? skill.priority : 'Medium';
    const demandScore = clamp(demandFromSkill || (kind === 'missing' ? 72 : 58), 0, 100);
    const normalizedProficiency = clamp(proficiency || (kind === 'current' ? 70 : 35), 0, 100);

    nodesById.set(id, {
      id,
      name,
      category: category || 'General',
      demandScore,
      jobDemand: demandScore,
      proficiency: normalizedProficiency,
      kind,
      priority,
      confidenceScore: typeof skill === 'object' ? clamp(skill.confidenceScore || 0, 0, 100) : 0,
      source: typeof skill === 'object' ? String(skill.source || '').trim() : '',
      evidence: typeof skill === 'object' && Array.isArray(skill.evidence) ? skill.evidence.slice(0, 4) : [],
      prerequisites: [],
      difficulty: difficultyFromSkill({ kind, demandScore, proficiency: normalizedProficiency, priority }),
      learningOrder: 0,
      relatedSkills: []
    });
  };

  current.forEach((skill) => addNode(skill, 'current'));

  const addMissingWithPrerequisites = (skill, visiting = new Set()) => {
    const name = toSkillName(skill);
    if (!name || visiting.has(name)) return;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(name);
    (SKILL_PREREQUISITES[name] || []).forEach((prerequisite) => {
      addMissingWithPrerequisites({ name: prerequisite }, nextVisiting);
    });
    addNode(skill, 'missing');
  };

  missing.forEach((skill) => addMissingWithPrerequisites(skill));

  const edges = [];
  const edgeKeys = new Set();
  const nodes = Array.from(nodesById.values());
  const nodeNameToId = new Map(nodes.map((node) => [node.name.toLowerCase(), node.id]));

  const addEdge = (from, to, type, weight) => {
    if (!from || !to || from === to) return;
    const key = `${from}:${to}:${type}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, type, weight });
  };

  nodes.forEach((node) => {
    const prereqs = SKILL_PREREQUISITES[node.name] || [];
    prereqs.forEach((prereqName) => {
      const prereqId = nodeNameToId.get(prereqName.toLowerCase());
      if (prereqId) {
        addEdge(prereqId, node.id, 'prerequisite', 0.92);
        if (!node.prerequisites.includes(prereqName)) node.prerequisites.push(prereqName);
        const prereqNode = nodesById.get(prereqId);
        if (prereqNode && !prereqNode.relatedSkills.includes(node.name)) {
          prereqNode.relatedSkills.push(node.name);
        }
      }
    });
  });

  const rankedNodes = nodes
    .slice()
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'current' ? -1 : 1;
      return (b.demandScore - a.demandScore) || (b.confidenceScore - a.confidenceScore) || a.name.localeCompare(b.name);
    });
  let missingOrder = 0;
  rankedNodes.forEach((node) => {
    if (node.kind === 'missing') missingOrder += 1;
    node.learningOrder = node.kind === 'missing' ? missingOrder : 0;
  });

  return { nodes: rankedNodes, edges };
};

const generateWeeklyLearningRoadmap = (graph, weeks = 8) => {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  const missingNodes = nodes
    .filter((node) => node.kind === 'missing')
    .sort((a, b) => (b.demandScore - a.demandScore) || (a.proficiency - b.proficiency));

  const prereqsByTarget = buildPrereqsByTarget(edges);

  const completed = new Set(nodes.filter((node) => node.kind === 'current').map((node) => node.id));
  const planned = new Set();
  const weeksCount = clamp(weeks, 1, 16);
  const weekly = [];

  for (let week = 1; week <= weeksCount; week += 1) {
    const weekSkills = selectWeekSkills({ missingNodes, prereqsByTarget, completed, planned });

    weekSkills.forEach((skill) => completed.add(skill.id));

    const focusSkills = weekSkills.map((skill) => skill.name);
    const maxDemand = weekSkills.reduce((max, skill) => Math.max(max, skill.demandScore || 0), 0);
    const reason = getWeekReason(week, maxDemand, focusSkills);

    weekly.push({
      week,
      focusSkills,
      reason,
      outcomes: buildWeekOutcomes(week, focusSkills)
    });
  }

  return weekly;
};

module.exports = { buildSkillGraph, generateWeeklyLearningRoadmap };
