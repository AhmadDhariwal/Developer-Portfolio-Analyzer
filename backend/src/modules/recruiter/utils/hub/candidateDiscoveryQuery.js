const crypto = require('node:crypto');
const { invalidInput } = require('../recruiterValidation');

const SORTS = {
  'score-desc': ['readiness', -1],
  'score-asc': ['readiness', 1],
  'experience-desc': ['experience', -1],
  'experience-asc': ['experience', 1],
  'name-asc': ['name', 1],
  latest: ['lastActive', -1]
};
const LIMIT = 240;
const MAX_OFFSET = 50000;
const CURSOR_TTL = 15 * 60 * 1000;

function scalar(value, name, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' && typeof value !== 'number')
    throw invalidInput(`${name} must be a scalar.`);
  const text = String(value).trim();
  if (text.length > 200) throw invalidInput(`${name} is too long.`);
  return text;
}
function number(value, name, fallback, max, integer = false) {
  const text = scalar(value, name, String(fallback));
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) throw invalidInput(`${name} is invalid.`);
  const parsed = Number(text);
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > max ||
    (integer && !Number.isSafeInteger(parsed))
  )
    throw invalidInput(`${name} is out of range.`);
  return parsed;
}
function parse(query = {}) {
  const sortBy = scalar(query.sortBy, 'sortBy', 'score-desc');
  if (!Object.hasOwn(SORTS, sortBy)) throw invalidInput('Unsupported candidate sort.');
  const page = number(query.page, 'page', 1, Number.MAX_SAFE_INTEGER, true);
  const limit = number(query.limit, 'limit', 12, LIMIT, true);
  if (!page || !limit) throw invalidInput('page and limit must be positive integers.');
  const skillsText = Array.isArray(query.skills)
    ? query.skills.map((value) => scalar(value, 'skills')).join(',')
    : scalar(query.skills, 'skills');
  const skills = [
    ...new Set(
      skillsText
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  ].sort();
  if (skills.length > 20 || skills.some((skill) => skill.length > 80))
    throw invalidInput('Too many or oversized skills.');
  if (
    query.cursor !== undefined &&
    (typeof query.cursor !== 'string' || query.cursor.length > 2048)
  )
    throw invalidInput('Invalid candidate cursor.');
  const cursor = query.cursor || '';
  const filters = {
    search: scalar(query.search, 'search'),
    stack: scalar(query.stack, 'stack'),
    location: scalar(query.location, 'location'),
    availability: scalar(query.availability, 'availability'),
    skills,
    minScore: number(query.minReadiness ?? query.minScore, 'minReadiness', 0, 100),
    experience: number(query.experience, 'experience', 0, 100),
    profileCompleteness: number(query.profileCompleteness, 'profileCompleteness', 0, 100),
    sortBy,
    limit
  };
  // Cursor length is validated separately; it contains a signed position, not a filter.
  return { ...filters, page, cursor };
}
function secret() {
  if (!process.env.JWT_SECRET)
    throw Object.assign(new Error('Pagination signing unavailable.'), { statusCode: 503 });
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update('candidate-discovery-v1')
    .digest();
}
const signature = (payload) =>
  crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
function binding(options, scope) {
  const { page, cursor, ...filters } = options;
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        String(scope.recruiterId || ''),
        String(scope.organizationId),
        Number(scope.sessionRevision || 0),
        scope.visibility,
        filters
      ])
    )
    .digest('hex');
}
function decode(options, scope) {
  if (!options.cursor) {
    if (
      !Number.isSafeInteger((options.page - 1) * options.limit) ||
      (options.page - 1) * options.limit > MAX_OFFSET
    )
      throw invalidInput('Use the next-page cursor for deep candidate pagination.');
    return null;
  }
  if (!scope.recruiterId || options.cursor.length > 2048)
    throw invalidInput('Invalid candidate cursor.');
  try {
    const [payload, supplied, extra] = options.cursor.split('.');
    if (!payload || !supplied || extra) throw Error();
    const expected = Buffer.from(signature(payload));
    const actual = Buffer.from(supplied);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual))
      throw Error();
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (
      value.v !== 1 ||
      value.binding !== binding(options, scope) ||
      !Number.isSafeInteger(value.page) ||
      value.page !== options.page ||
      value.page < 2 ||
      !/^[a-f0-9]{24}$/.test(value.id) ||
      !Number.isFinite(value.at) ||
      value.at > Date.now() ||
      Date.now() - value.at > CURSOR_TTL ||
      !['number', 'string'].includes(typeof value.key)
    )
      throw Error();
    return value;
  } catch (error) {
    if (error.statusCode === 503) throw error;
    throw Object.assign(
      invalidInput('Candidate cursor is invalid or expired. Restart this search.'),
      {
        code: 'CANDIDATE_CURSOR_INVALID'
      }
    );
  }
}
function encode(options, scope, row) {
  if (!scope.recruiterId) return null;
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      binding: binding(options, scope),
      page: options.page + 1,
      id: String(row._id),
      key: row.position,
      at: Date.now()
    })
  ).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

module.exports = { parse, decode, encode, SORTS, MAX_OFFSET };
