const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value || 0)));

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

const buildPrereqsByTarget = (edges = []) => {
  const prereqsByTarget = new Map();
  edges.filter((edge) => edge.type === 'prerequisite').forEach((edge) => {
    const arr = prereqsByTarget.get(edge.to) || [];
    arr.push(edge.from);
    prereqsByTarget.set(edge.to, arr);
  });
  return prereqsByTarget;
};

const selectWeekSkills = ({ missingNodes, prereqsByTarget, completed, planned }) => {
  const weekSkills = [];

  for (const node of missingNodes) {
    if (planned.has(node.id)) continue;
    const prereqs = prereqsByTarget.get(node.id) || [];
    const ready = prereqs.every((pre) => completed.has(pre) || planned.has(pre));
    if (!ready) continue;

    weekSkills.push(node);
    planned.add(node.id);
    if (weekSkills.length >= 2) break;
  }

  if (!weekSkills.length && missingNodes.length) {
    const fallback = missingNodes.find((node) => !planned.has(node.id));
    if (fallback) {
      weekSkills.push(fallback);
      planned.add(fallback.id);
    }
  }

  return weekSkills;
};

const getWeekReason = (week, maxDemand, focusSkills = []) => {
  if (!focusSkills.length) {
    return 'Review and consolidate previous learning goals.';
  }

  const priorityLabel = maxDemand >= 80 ? 'high market demand' : 'strong dependency unlock';
  return `Prioritized for week ${week} due to ${priorityLabel} and prerequisite readiness.`;
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

    nodesById.set(id, {
      id,
      name,
      category: category || 'General',
      demandScore: clamp(demandFromSkill || (kind === 'missing' ? 72 : 58), 0, 100),
      proficiency: clamp(proficiency || (kind === 'current' ? 70 : 35), 0, 100),
      kind,
      relatedSkills: []
    });
  };

  current.forEach((skill) => addNode(skill, 'current'));
  missing.forEach((skill) => addNode(skill, 'missing'));

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
        const prereqNode = nodesById.get(prereqId);
        if (prereqNode && !prereqNode.relatedSkills.includes(node.name)) {
          prereqNode.relatedSkills.push(node.name);
        }
      }
    });
  });

  // Add soft related-skill edges by category.
  const byCategory = nodes.reduce((acc, node) => {
    const category = node.category || 'General';
    if (!acc[category]) acc[category] = [];
    acc[category].push(node);
    return acc;
  }, {});

  Object.values(byCategory).forEach((categoryNodes) => {
    categoryNodes.forEach((node, index) => {
      const next = categoryNodes[index + 1];
      if (!next) return;
      addEdge(node.id, next.id, 'related', 0.45);
      if (!node.relatedSkills.includes(next.name)) node.relatedSkills.push(next.name);
    });
  });

  return { nodes, edges };
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
      outcomes: focusSkills.length
        ? focusSkills.map((skill) => `Build one mini project task using ${skill}.`)
        : ['Refine documentation and portfolio evidence for completed skills.']
    });
  }

  return weekly;
};

module.exports = { buildSkillGraph, generateWeeklyLearningRoadmap };
