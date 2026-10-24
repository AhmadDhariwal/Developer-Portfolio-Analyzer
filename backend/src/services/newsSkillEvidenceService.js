const developerContext = require('./developerContextService');
const evidence = require('./skillGapEvidenceService');
const dictionary = require('./skillGapRequirements');

const skillKey = (name) => (dictionary.canonicalize(name) || String(name || '').trim()).toLowerCase();

// Reuse the existing evidence classifier, never legacy "provenSkills" strings.
// Current canonical summaries contain metadata/claims, not inspected code proof.
function buildNewsSkillEvidence(user, context) {
  const signals = context.signals || {};
  const github = signals.githubSignals || {};
  const resume = signals.resumeSignals || {};
  const username = String(developerContext.resolveGithubUsername(user) || '')
    .trim()
    .toLowerCase();
  const githubSelected =
    github.present === true && username && String(github.username || '').toLowerCase() === username;
  const selectedResume = developerContext.resolveSelectedResumeFileId(user);
  const resumeSelected =
    resume.analyzed === true && (!selectedResume || String(selectedResume) === String(resume.fileId));
  const resolved = evidence.resolve({
    githubData: githubSelected
      ? {
          githubSignals: { username: github.username, analyzedAt: github.updatedAt },
          repositories: github.repositories || [],
          languageDistribution: github.languageDistribution || []
        }
      : {},
    resumeInsights: resumeSelected ? resume : {},
    profile: user,
    integrationSignal: signals.integrationSignal || signals.integrationSignals || {},
    profileSignal: signals.portfolioSignal || signals.portfolioSignals || {},
    careerStack: context.careerStack === 'AI / ML' ? 'AI/ML' : context.careerStack,
    experienceLevel: context.experienceLevel,
    // The resolver's preview mode consumes already-resolved resume insights;
    // it performs no database, provider, AI or analyzer operation.
    preview: true
  });
  const classified = new Map(resolved.skills.map((skill) => [skillKey(skill.name), skill]));
  const names = new Set([
    ...(context.knownSkills || []),
    ...(context.skillGaps || []),
    ...(context.recommendationTechnologies || []),
    ...(context.jobDemandSkills || [])
  ]);
  const uniqueNames = new Map();
  for (const name of names) if (!uniqueNames.has(skillKey(name))) uniqueNames.set(skillKey(name), name);
  return [...uniqueNames.values()].slice(0, 100).map((name) => {
    const skill = classified.get(skillKey(name));
    return {
      name,
      canonicalName: dictionary.canonicalize(name) || null,
      status: skill?.status || 'UNKNOWN',
      evidenceConfidence: skill?.evidenceConfidence || 'INSUFFICIENT',
      evidence: (skill?.evidence || []).slice(0, 5).map(({ type, kind, id, artifact, timestamp, freshness }) => ({
        type,
        kind,
        id,
        artifact,
        timestamp,
        freshness
      }))
    };
  });
}

function relatedNewsSkillEvidence(item, skills) {
  const matches = new Set(
    [...(item.relatedSkills || []), ...(item.relatedSkillGaps || []), ...(item.demandTags || [])].map(skillKey)
  );
  return skills.filter((skill) => matches.has(skillKey(skill.name)));
}

module.exports = {
  buildNewsSkillEvidence,
  relatedNewsSkillEvidence,
  SKILL_EVIDENCE_RULE_VERSION: evidence.RULE_VERSION
};
