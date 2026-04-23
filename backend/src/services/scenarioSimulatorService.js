/**
 * Scenario Simulator Service — Career Growth Simulation Engine
 *
 * Scoring formula:
 *   finalScore = baseline + skillImpact + projectImpact + synergy - penalty
 *   capped at max +40 improvement
 */

const roleWeights     = require('../utils/roleWeights');
const skillDifficulty = require('../utils/skillDifficulty');
const marketDemand    = require('../utils/marketDemand');
const { estimateSkillsEffort, estimateProjectsEffort, calcOverloadPenalty } = require('../utils/timeEstimator');

const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
const round1 = (v) => Math.round(Number(v) * 10) / 10;

const MAX_IMPROVEMENT = 40;

// ── Role / level normalizers ──────────────────────────────────────────────

const normalizeRole = (role = '') => {
  const r = String(role).toLowerCase().trim();
  if (r.includes('front'))                                    return 'frontend';
  if (r.includes('back'))                                     return 'backend';
  if (r.includes('full'))                                     return 'full stack';
  if (r.includes('ai') || r.includes('ml') || r.includes('machine')) return 'ai/ml';
  if (r.includes('devops') || r.includes('cloud') || r.includes('infra')) return 'devops';
  return 'full stack';
};

const normalizeLevel = (level = '') => {
  const l = String(level).toLowerCase();
  if (l.includes('junior') || l.includes('0-1') || l.includes('intern') || l.includes('student')) return 'junior';
  if (l.includes('senior') || l.includes('5+') || l.includes('lead') || l.includes('staff'))      return 'senior';
  return 'mid';
};

// ── Lookup helpers ────────────────────────────────────────────────────────

const getRoleWeight = (role, skillName) => {
  const weights = roleWeights[role] || roleWeights.default;
  const key = String(skillName).toLowerCase().trim();
  return weights[key] ?? weights.default ?? 1.0;
};

const getDifficulty = (skillName) => {
  const key = String(skillName).toLowerCase().trim();
  return skillDifficulty[key] ?? skillDifficulty.default;
};

const getDemand = (skillName) => {
  const key = String(skillName).toLowerCase().trim();
  return marketDemand[key] ?? marketDemand.default;
};

/**
 * Classify a skill's relevance to a role into a human-readable tier.
 * Uses the role weight as the signal.
 */
const skillRelevanceTier = (weight) => {
  if (weight >= 1.4) return 'core';        // essential for this role
  if (weight >= 1.1) return 'valuable';    // useful but not primary
  if (weight >= 0.9) return 'transferable'; // general skill, some value
  return 'low';                             // not typical for this role
};

// ── Level multipliers ─────────────────────────────────────────────────────

const LEVEL_SKILL_MULT   = { junior: 1.3, mid: 1.0, senior: 0.75 };
const LEVEL_PROJECT_MULT = { junior: 1.2, mid: 1.0, senior: 0.8 };
const COMPLEXITY_WEIGHT  = { low: 0.8, medium: 1.0, high: 1.3 };

// ── Core calculations ─────────────────────────────────────────────────────

const computeSkillImpact = (skills, role, level) => {
  if (!skills.length) return { total: 0, perSkill: [] };

  const levelMult = LEVEL_SKILL_MULT[level] || 1.0;
  let total = 0;
  const perSkill = [];

  skills.forEach((skill, i) => {
    const relevance  = getRoleWeight(role, skill);
    const difficulty = getDifficulty(skill);
    const demand     = getDemand(skill);
    const diminish   = i < 3 ? 1.0 : i < 6 ? 0.7 : 0.4;
    const pts        = relevance * difficulty * demand * diminish * levelMult * 4.5;
    total += pts;
    perSkill.push({
      skill,
      pts:       round1(pts),
      relevance: round1(relevance),
      tier:      skillRelevanceTier(relevance),
      demand:    round1(demand),
      difficulty: round1(difficulty)
    });
  });

  return { total: Math.min(22, total), perSkill };
};

const computeProjectImpact = (projects, role, level) => {
  if (!projects.length) return 0;

  const levelMult = LEVEL_PROJECT_MULT[level] || 1.0;
  let total = 0;

  projects.forEach((p, i) => {
    const complexity = COMPLEXITY_WEIGHT[p.complexity] || 1.0;
    const weeks      = Math.min(12, Number(p.weeks) || 3);
    const durationW  = 0.7 + (weeks / 20);
    const impactNorm = (Number(p.impact) || 65) / 100;
    const diminish   = i === 0 ? 1.0 : i === 1 ? 0.8 : 0.6;
    total += complexity * durationW * impactNorm * diminish * levelMult * 12;
  });

  return Math.min(22, total);
};

const computeSynergy = (skills, projects) => {
  if (!skills.length || !projects.length) return 0;

  let matches = 0;
  skills.forEach(skill => {
    const s = skill.toLowerCase();
    projects.forEach(p => {
      const name = (p.name || '').toLowerCase();
      if (name.includes(s) || s.includes(name.split(' ')[0])) matches++;
    });
  });

  const base       = Math.min(6, skills.length * 0.8 + projects.length * 0.6);
  const matchBonus = Math.min(5, matches * 1.5);
  return Math.min(10, base + matchBonus);
};

// ── Insight generator (role-aware, honest) ────────────────────────────────

/**
 * Role-specific "must-have" skills used to detect mismatches.
 */
const ROLE_CORE_SKILLS = {
  frontend:    ['react', 'angular', 'vue', 'javascript', 'typescript', 'css', 'html', 'next.js'],
  backend:     ['node.js', 'node', 'python', 'java', 'golang', 'express', 'django', 'fastapi', 'spring boot'],
  'full stack': ['react', 'angular', 'vue', 'node.js', 'node', 'python', 'javascript', 'typescript'],
  'ai/ml':     ['python', 'machine learning', 'deep learning', 'pytorch', 'tensorflow', 'scikit-learn', 'pandas'],
  devops:      ['docker', 'kubernetes', 'aws', 'azure', 'gcp', 'terraform', 'ci/cd', 'linux'],
};

const ROLE_LABELS = {
  frontend:    'Frontend Developer',
  backend:     'Backend Developer',
  'full stack': 'Full Stack Developer',
  'ai/ml':     'AI/ML Engineer',
  devops:      'DevOps Engineer',
};

const generateInsights = (skills, projects, role, level, breakdown, overloadWarning, durationWeeks, perSkillData) => {
  const insights    = [];
  const warnings    = [];
  const suggestions = [];

  const roleLabel = ROLE_LABELS[role] || role;
  const coreSkills = ROLE_CORE_SKILLS[role] || [];

  // ── Per-skill relevance feedback ──────────────────────────────────────
  perSkillData.forEach(({ skill, tier, relevance }) => {
    if (tier === 'core') {
      insights.push(`${skill} is a core skill for ${roleLabel}s — strong addition.`);
    } else if (tier === 'valuable') {
      insights.push(`${skill} is useful for ${roleLabel}s and adds value to your profile.`);
    } else if (tier === 'transferable') {
      insights.push(`${skill} is a general skill — it has some value but is not a primary ${roleLabel} requirement.`);
    } else {
      // tier === 'low' — this is the React-for-backend case
      warnings.push(
        `${skill} has low relevance for ${roleLabel} roles (weight: ${relevance}). ` +
        `It will contribute minimal score improvement. Consider adding role-specific skills instead.`
      );
    }
  });

  // ── Missing core skills suggestion ────────────────────────────────────
  const addedLower = skills.map(s => s.toLowerCase());
  const missingCore = coreSkills.filter(c => !addedLower.some(a => a.includes(c) || c.includes(a)));
  if (missingCore.length > 0 && skills.length > 0) {
    const top3 = missingCore.slice(0, 3).join(', ');
    suggestions.push(`For ${roleLabel} roles, consider adding: ${top3}.`);
  }
  if (skills.length === 0) {
    suggestions.push(`Add skills that are core to ${roleLabel} roles: ${coreSkills.slice(0, 4).join(', ')}.`);
  }

  // ── Project insights ──────────────────────────────────────────────────
  if (projects.length > 0) {
    if (projects.some(p => p.complexity === 'high')) {
      insights.push('High-complexity projects significantly boost your practical experience signal.');
    }
    if (projects.some(p => Number(p.weeks) >= 6)) {
      insights.push('Long-duration projects (6+ weeks) demonstrate commitment and depth to employers.');
    }
    if (projects.every(p => p.complexity === 'low')) {
      suggestions.push('All your projects are low complexity. Add at least one medium or high complexity project for better impact.');
    }
  }

  // ── Synergy ───────────────────────────────────────────────────────────
  if (breakdown.synergy >= 5) {
    insights.push('Strong skill-project synergy detected — your skills align with your projects.');
  } else if (skills.length > 0 && projects.length > 0 && breakdown.synergy < 2) {
    suggestions.push('Name your projects to reflect the skills you are using (e.g. "React Dashboard") to unlock synergy bonus.');
  }

  // ── Overload ──────────────────────────────────────────────────────────
  if (overloadWarning) {
    warnings.push(overloadWarning);
  }

  // ── Level-specific ────────────────────────────────────────────────────
  if (level === 'junior') {
    suggestions.push('As a junior, depth beats breadth — master 2–3 core skills rather than listing many.');
  } else if (level === 'senior') {
    suggestions.push('Senior roles value system design, architecture, and leadership skills.');
  }

  // ── Duration ─────────────────────────────────────────────────────────
  if (durationWeeks < 4 && (skills.length > 3 || projects.length > 1)) {
    warnings.push(`${durationWeeks} weeks is tight for this plan. Extend to 6–8 weeks for realistic results.`);
  }

  // ── Score cap warning ─────────────────────────────────────────────────
  if (breakdown.total >= 35) {
    warnings.push('Maximum improvement cap reached (+40 pts). Additional skills/projects beyond this point have no further effect.');
  }

  return { insights, warnings, suggestions };
};

// ── Main entry point ──────────────────────────────────────────────────────

const simulateHiringOutcome = ({
  baselineHiringScore = 55,
  baselineJobMatch    = 48,
  role                = 'full stack',
  experienceLevel     = 'mid',
  skills              = [],
  projects            = [],
  durationWeeks       = 6
}) => {
  const normalizedRole  = normalizeRole(role);
  const normalizedLevel = normalizeLevel(experienceLevel);
  const duration        = Math.max(1, Math.min(52, Number(durationWeeks) || 6));

  const cleanSkills = [];
  const skillSet = new Set();
  (Array.isArray(skills) ? skills : []).forEach((entry) => {
    const safeSkill = String(entry || '').trim();
    const normalized = safeSkill.toLowerCase();
    if (!safeSkill || skillSet.has(normalized)) return;
    skillSet.add(normalized);
    cleanSkills.push(safeSkill);
  });

  const cleanProjects = (Array.isArray(projects) ? projects : [])
    .map(p => ({
      name:       String(p?.name || '').trim(),
      impact:     Math.max(0, Math.min(100, Number(p?.impact) || 65)),
      complexity: ['low', 'medium', 'high'].includes(p?.complexity) ? p.complexity : 'medium',
      weeks:      Math.max(1, Math.min(24, Number(p?.weeks) || 3))
    }))
    .filter(p => p.name);

  // Core calculations
  const { total: skillImpact, perSkill: perSkillData } = computeSkillImpact(cleanSkills, normalizedRole, normalizedLevel);
  const projectImpact = computeProjectImpact(cleanProjects, normalizedRole, normalizedLevel);
  const synergy       = computeSynergy(cleanSkills, cleanProjects);

  // Time constraint
  const skillsEffort   = estimateSkillsEffort(cleanSkills);
  const projectsEffort = estimateProjectsEffort(cleanProjects);
  const { penalty, warning: overloadWarning } = calcOverloadPenalty(skillsEffort, projectsEffort, duration);

  const rawImprovement   = skillImpact + projectImpact + synergy - penalty;
  const totalImprovement = Math.min(MAX_IMPROVEMENT, Math.max(0, rawImprovement));

  const predictedHiringScore = clamp(Number(baselineHiringScore) + totalImprovement);
  const jobMatchImprovement  = Math.round(totalImprovement * 0.72);
  const predictedJobMatch    = clamp(Number(baselineJobMatch) + jobMatchImprovement);

  const breakdown = {
    skills:   Math.round(skillImpact),
    projects: Math.round(projectImpact),
    synergy:  Math.round(synergy),
    penalty:  -Math.round(penalty),
    total:    Math.round(totalImprovement)
  };

  const { insights, warnings, suggestions } = generateInsights(
    cleanSkills, cleanProjects, normalizedRole, normalizedLevel,
    breakdown, overloadWarning, duration, perSkillData
  );

  return {
    baseline:  { hiringScore: clamp(baselineHiringScore), jobMatch: clamp(baselineJobMatch) },
    predicted: { hiringScore: predictedHiringScore, jobMatch: predictedJobMatch },
    improvements: {
      hiringScore: predictedHiringScore - clamp(baselineHiringScore),
      jobMatch:    predictedJobMatch    - clamp(baselineJobMatch)
    },
    breakdown,
    // Per-skill detail for frontend display
    skillDetails: perSkillData,
    insights,
    warnings,
    suggestions,
    assumptions: {
      skillsConsidered: cleanSkills,
      projectsConsidered: cleanProjects.map((project) => ({
        name: project.name,
        complexity: project.complexity,
        weeks: project.weeks,
        impact: project.impact
      }))
    },
    meta: {
      role:           normalizedRole,
      level:          normalizedLevel,
      durationWeeks:  duration,
      skillsEffort:   round1(skillsEffort),
      projectsEffort: round1(projectsEffort),
      overloaded:     !!overloadWarning
    }
  };
};

module.exports = { simulateHiringOutcome };
