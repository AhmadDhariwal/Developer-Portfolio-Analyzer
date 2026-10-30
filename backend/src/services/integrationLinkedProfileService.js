const LinkedProfile = require('../models/integrationLinkedProfile');
const persistence = require('./integrationPersistenceService');

const invalid = (provider = 'hackerrank') =>
  Object.assign(
    Error(
      `Enter a ${provider === 'kaggle' ? 'Kaggle' : 'HackerRank'} username or an HTTPS profile URL.`
    ),
    {
      status: 400
    }
  );
const assertProvider = (provider) => {
  if (!['hackerrank', 'kaggle'].includes(provider)) throw invalid();
};

function normalize(value, provider = 'hackerrank') {
  assertProvider(provider);
  if (typeof value !== 'string' || value.length > 300) throw invalid();
  const input = value.trim();
  let username = input;
  if (input.includes('://')) {
    let url;
    try {
      url = new URL(input);
    } catch {
      throw invalid();
    }
    if (
      url.protocol !== 'https:' ||
      !(
        provider === 'kaggle'
          ? ['kaggle.com', 'www.kaggle.com']
          : ['hackerrank.com', 'www.hackerrank.com']
      ).includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      throw invalid();
    const match = (
      provider === 'kaggle'
        ? /^\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,49})\/?$/
        : /^\/(?:profile\/)?([a-zA-Z0-9][a-zA-Z0-9_.-]{0,99})\/?$/
    ).exec(url.pathname);
    if (!match) throw invalid();
    username = match[1];
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(username)) throw invalid();
  if (provider === 'kaggle') {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/.test(username)) throw invalid();
    return { username, profileUrl: `https://www.kaggle.com/${username}` };
  }
  return { username, profileUrl: `https://www.hackerrank.com/profile/${username}` };
}

function present(row, provider = 'hackerrank') {
  if (!row) return null;
  // Never allow persisted or caller-supplied flags to imply provider verification.
  return {
    provider,
    ...normalize(row.username, provider),
    ownershipVerified: false,
    evidenceKind: 'user-entered-link'
  };
}

async function get(owner, provider = 'hackerrank') {
  assertProvider(provider);
  const row = await LinkedProfile.findOne({ userId: owner, provider }).select('username').lean();
  return present(row, provider);
}

async function save(owner, value, provider = 'hackerrank') {
  const profile = normalize(value, provider);
  await persistence.transaction(async (session) => {
    await persistence.ownerFence(owner, session);
    await LinkedProfile.findOneAndUpdate(
      { userId: owner, provider },
      { $set: profile },
      { upsert: true, runValidators: true, session }
    );
  });
  return present(profile, provider);
}

async function remove(owner, provider = 'hackerrank') {
  assertProvider(provider);
  await persistence.transaction(async (session) => {
    await persistence.ownerFence(owner, session);
    await LinkedProfile.deleteOne({ userId: owner, provider }, { session });
  });
}

module.exports = { normalize, get, save, remove };
