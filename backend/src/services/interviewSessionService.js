const mongoose = require('mongoose');
const Session = require('../models/interviewPrepSession');
const { hash } = require('./interviewCoordinationService');
const { normalizeComparableText } = require('./interviewQuestionQualityService');

const error = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const snapshotQuestions = (questions, topicKey) => {
  const seen = new Set();
  return questions
    .filter((item) => {
      const identity = normalizeComparableText(item.question);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .map((item) => ({
      ...item,
      normalizedQuestionHash: hash(normalizeComparableText(item.question)),
      questionId: item.questionId || String(item._id || hash(`${topicKey}:${normalizeComparableText(item.question)}`)),
      contentVersion: hash(JSON.stringify([item.question, item.answer, item.answerSections || {}])),
      verificationStatus:
        item.verificationStatus || (['verified_seed', 'prebuilt'].includes(item.sourceType) ? 'verified' : 'unverified')
    }));
};

const findRequest = async (userId, requestKey, requestFingerprint) => {
  if (!requestKey) return null;
  const existing = await Session.findOne({ userId, requestKey }).lean();
  if (existing && existing.requestFingerprint !== requestFingerprint)
    throw error(409, 'Idempotency key was used for a different request.');
  return existing;
};

const create = async (record) => {
  try {
    return await Session.create(record);
  } catch (failure) {
    if (failure.code !== 11000 || !record.requestKey) throw failure;
    return findRequest(record.userId, record.requestKey, record.requestFingerprint);
  }
};
const getOwned = async (userId, id) => {
  if (!mongoose.isObjectIdOrHexString(id)) throw error(400, 'Invalid session ID.');
  const session = await Session.findOne({ _id: id, userId }).lean();
  if (!session) throw error(404, 'Session not found.');
  return session;
};
const updateProgress = async ({ userId, id, expectedVersion, questionIndex, selfCheck, complete = false }) => {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw error(400, 'Invalid progress version.');
  const session = await getOwned(userId, id);
  const progress = session.progress || {};
  if (
    !complete &&
    (!Number.isInteger(questionIndex) ||
      questionIndex < 0 ||
      questionIndex >= session.questions.length ||
      !['review', 'comfortable'].includes(selfCheck))
  ) {
    throw error(400, 'Invalid question progress.');
  }
  if (complete && session.status === 'completed') return session;
  if (!complete && progress[String(questionIndex)] === selfCheck) return session;
  if (session.status === 'completed') throw error(409, 'Completed sessions cannot be changed.');
  if (complete && (!session.questions.length || session.questions.some((_, index) => !progress[String(index)])))
    throw error(409, 'Review each question before completing this session.');
  const updated = await Session.findOneAndUpdate(
    {
      _id: id,
      userId,
      status: { $ne: 'completed' },
      ...(expectedVersion === 0
        ? { $or: [{ progressVersion: 0 }, { progressVersion: { $exists: false } }] }
        : { progressVersion: expectedVersion })
    },
    {
      $set: complete ? { status: 'completed', completedAt: new Date() } : { [`progress.${questionIndex}`]: selfCheck },
      $inc: { progressVersion: 1 }
    },
    { returnDocument: 'after', runValidators: true }
  ).lean();
  if (!updated) throw error(409, 'Session changed. Reload before saving progress.');
  return updated;
};
module.exports = { snapshotQuestions, findRequest, create, getOwned, updateProgress };
