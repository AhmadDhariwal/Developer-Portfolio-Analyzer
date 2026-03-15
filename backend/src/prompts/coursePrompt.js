/**
 * Builds a Gemini prompt that requests a large, multi-platform course pool
 * in a single AI call.  Results are cached and paginated by the controller.
 *
 * @param {object} opts
 * @param {string}   opts.careerStack
 * @param {string}   opts.experienceLevel
 * @param {string[]} opts.skillGaps
 * @param {string[]} opts.knownSkills
 * @param {string}   opts.platform   – 'All' | 'Udemy' | 'Coursera' | 'Other'
 * @param {string}   opts.topic
 * @param {number}   opts.totalCount – total courses to generate (default 20)
 */
const getCoursePrompt = ({
  careerStack     = 'Full Stack',
  experienceLevel = 'Intermediate',
  skillGaps       = [],
  knownSkills     = [],
  platform        = 'All',
  topic           = '',
  totalCount      = 20
}) => {
  const skills    = skillGaps.length   ? skillGaps.join(', ')   : 'core fundamentals';
  const known     = knownSkills.length  ? knownSkills.join(', ') : 'basics';
  const topicLine = topic ? `\nFocus primarily on the topic: ${topic}.` : '';

  // Per-platform distribution ─────────────────────────────────────────────────
  let distributionLine;
  let platformInstruction;

  if (platform === 'All') {
    const u = Math.round(totalCount * 0.35);          // ~35 % Udemy
    const c = Math.round(totalCount * 0.25);          // ~25 % Coursera
    const e = Math.round(totalCount * 0.25);          // ~25 % edX
    const f = Math.max(1, totalCount - u - c - e);    // remainder → freeCodeCamp
    distributionLine    = `Exactly ${totalCount} courses distributed as: ${u} from Udemy, ${c} from Coursera, ${e} from edX, ${f} from freeCodeCamp.`;
    platformInstruction = 'Use ALL four platforms: Udemy, Coursera, edX, freeCodeCamp.';
  } else if (platform === 'Udemy') {
    distributionLine    = `Exactly ${totalCount} courses, ALL from Udemy.`;
    platformInstruction = 'Use ONLY Udemy.';
  } else if (platform === 'Coursera') {
    distributionLine    = `Exactly ${totalCount} courses, ALL from Coursera.`;
    platformInstruction = 'Use ONLY Coursera.';
  } else if (platform === 'Other') {
    const e = Math.ceil(totalCount / 2);
    const f = totalCount - e;
    distributionLine    = `Exactly ${totalCount} courses: ${e} from edX, ${f} from freeCodeCamp.`;
    platformInstruction = 'Use ONLY edX and freeCodeCamp.';
  } else {
    // Named single platform
    distributionLine    = `Exactly ${totalCount} courses, ALL from ${platform}.`;
    platformInstruction = `Use ONLY ${platform}.`;
  }

  return `You are an expert learning curator for software developers.

Generate a pool of real, high-quality courses for a developer with:
- Career Stack:    ${careerStack}
- Experience:      ${experienceLevel}
- Skill Gaps:      ${skills}
- Already knows:   ${known}
${topicLine}

DISTRIBUTION REQUIREMENT:
${distributionLine}
${platformInstruction}

STRICT RULES:
1. Return ONLY courses that genuinely exist on their platforms right now.
2. Use well-known, accurate instructor names.
3. URLs MUST follow these exact patterns:
   - Udemy:        https://www.udemy.com/course/<slug>/
   - Coursera:     https://www.coursera.org/learn/<slug>
   - edX:          https://www.edx.org/learn/<subject>/<institution>-<slug>
   - freeCodeCamp: https://www.freecodecamp.org/learn/<path>/
4. rating: 4.0 – 5.0  |  reviewCount: 500 – 250 000  |  duration: realistic string.
5. durationHours: numeric float (e.g. 10.5 for "10h 30m").
6. Prioritise courses that cover the listed skill gaps; also include broader ${careerStack} topics.
7. Mix difficulty levels: include Beginner, Intermediate, and Advanced courses.
8. Do NOT include YouTube — it is fetched separately.
9. Each course must have a unique title.

Return ONLY a valid JSON object. No markdown fences, no prose, no comments:
{
  "courses": [
    {
      "id": "unique-slug-id",
      "title": "Exact Course Title",
      "description": "2-3 sentence description.",
      "platform": "Udemy",
      "instructor": "Full Name",
      "rating": 4.7,
      "reviewCount": 45000,
      "duration": "10h 30m",
      "durationHours": 10.5,
      "level": "Intermediate",
      "thumbnail": "",
      "url": "https://www.udemy.com/course/example/",
      "topics": ["Topic1", "Topic2", "Topic3"],
      "popularity": 82
    }
  ]
}`;
};

module.exports = { getCoursePrompt };
