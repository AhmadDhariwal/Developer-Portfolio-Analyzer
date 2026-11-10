// Narrative is selected from factual, deterministic statements. Arbitrary
// paraphrases cannot be proven grounded by JSON shape validation alone.
function isGrounded(candidate, facts) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  if (candidate.progressSummary !== facts.progressSummary) return false;
  return ['insights', 'recommendations', 'topAchievements'].every((key) => {
    const values = candidate[key];
    return (
      Array.isArray(values) &&
      values.length === facts[key].length &&
      new Set(values).size === values.length &&
      values.every((value) => typeof value === 'string' && facts[key].includes(value))
    );
  });
}
module.exports = { isGrounded };
