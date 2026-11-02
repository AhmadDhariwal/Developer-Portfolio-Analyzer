'use strict';
const { extractSkillsFromText } = require('../utils/skilldetector');
// This parses claims, never proficiency. Negated/aspirational clauses cannot
// establish a claim of current ability. Catalog matching remains unchanged.
function extractClaims(text) {
  const clauses = String(text || '')
    .slice(0, 50000)
    .split(/\n|[;!?]|\.(?=\s|$)/);
  const supported = clauses.filter(
    (clause) =>
      !/\b(no experience|not familiar|do not know|don't know|never used|without experience|want to learn|plan to learn|planning to|aspire|interested in learning|learning next)\b/i.test(
        clause
      )
  );
  return extractSkillsFromText(supported).slice(0, 40);
}
module.exports = { extractClaims, VERSION: 'resume-claim-extraction-v2' };
