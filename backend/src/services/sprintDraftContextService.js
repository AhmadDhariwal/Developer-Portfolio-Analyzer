'use strict';

const crypto = require('node:crypto');
const User = require('../models/user');
const developerContext = require('./developerContextService');
const VERSION = 'sprint-draft-context-v1';
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const currentContext = async (userId) => {
  const user = await User.findById(userId)
    .select(
      'activeCareerStack careerStack activeExperienceLevel experienceLevel activeGithubUsername githubUsername activeResumeFileId defaultResumeFileId updatedAt'
    )
    .lean();
  if (!user) {
    const error = new Error('Owner not found.');
    error.statusCode = 404;
    throw error;
  }
  const careerStack = developerContext.resolveCareerStack(user) || '';
  const experienceLevel = developerContext.resolveExperienceLevel(user) || '';
  const evidence = await require('./coursePersonalizationService').resolveSkillSignals(
    userId,
    careerStack,
    experienceLevel,
    null,
    user
  );
  const identity = {
    careerStack,
    experienceLevel,
    githubUsername: developerContext.resolveGithubUsername(user) || '',
    resumeFileId: String(developerContext.resolveSelectedResumeFileId(user) || ''),
    evidenceFingerprint: evidence.fingerprint
  };
  return {
    version: VERSION,
    ownerId: String(userId),
    ...identity,
    fingerprint: digest(identity),
    sourceRule: evidence.personalization?.ruleVersion || null,
    limitation: evidence.personalization?.limitation || 'General career guidance; not verified proficiency.'
  };
};
const compatibility = (plan, context) => {
  const recorded = plan.context;
  const complete = recorded?.version === VERSION && recorded.ownerId === context.ownerId && recorded.fingerprint;
  const stale = !complete || recorded.fingerprint !== context.fingerprint;
  return {
    status: !complete ? 'legacy-context-unknown' : stale ? 'different-context' : 'current',
    requiresAcknowledgement: Boolean(stale),
    currentFingerprint: context.fingerprint,
    recordedFingerprint: recorded?.fingerprint || null,
    proposedWorkOnly: true
  };
};
const requireAcknowledgement = (plan, context, acknowledgement) => {
  const state = compatibility(plan, context);
  if (state.requiresAcknowledgement && acknowledgement !== context.fingerprint) {
    const error = new Error(
      'Draft context differs or is unknown. Review the current context and acknowledge its fingerprint before adding tasks.'
    );
    error.statusCode = 409;
    throw error;
  }
  return state;
};
module.exports = { VERSION, currentContext, compatibility, requireAcknowledgement, digest };
