'use strict';

// Reviewed link metadata only, 2026-11-06. No lessons, reviews, prices or media copied.
// Attribution and retrieval constraints: courseAcquisitionSources.md.
const reviewedAt = '2026-11-06T00:00:00.000Z';
const fcc = [
  [
    'fb_f8',
    'Data Analysis with Python',
    'data-analysis-with-python',
    ['Python', 'Data Science', 'Statistics'],
  ],
  [
    'fb_f9',
    'Machine Learning with Python',
    'machine-learning-with-python',
    ['Python', 'Machine Learning'],
  ],
  ['fb_f10', 'Quality Assurance', 'quality-assurance', ['Testing', 'Node.js', 'JavaScript']],
  ['fb_f11', 'Data Visualization', 'data-visualization', ['JavaScript', 'Data Science']],
  ['fb_f12', 'Coding Interview Prep', 'coding-interview-prep', ['Data Structures', 'Algorithms']],
  [
    'fb_f13',
    'College Algebra with Python',
    'college-algebra-with-python',
    ['Python', 'Statistics'],
  ],
  [
    'fb_f14',
    'Relational Databases',
    'relational-databases-v9',
    ['SQL', 'PostgreSQL', 'Shell', 'Git'],
  ],
  ['fb_f15', 'Responsive Web Design', 'responsive-web-design-v9', ['HTML', 'CSS', 'Accessibility']],
  ['fb_f16', 'JavaScript', 'javascript-v9', ['JavaScript', 'Data Structures', 'Algorithms']],
  ['fb_f17', 'Python', 'python-v9', ['Python', 'Data Structures', 'Algorithms']],
].map(([id, title, slug, topics]) => ({ id, title, slug, topics }));
const mdn = [
  ['fb_m2', 'Semantic HTML', 'core/semantic-html', ['HTML', 'Accessibility']],
  ['fb_m3', 'CSS fundamentals', 'core/css-fundamentals', ['CSS']],
  ['fb_m4', 'JavaScript fundamentals', 'core/javascript-fundamentals', ['JavaScript']],
  ['fb_m5', 'Accessibility', 'core/accessibility', ['Accessibility']],
  ['fb_m6', 'Version control', 'core/version-control', ['Git']],
  ['fb_m7', 'Performance', 'extensions/performance', ['Performance Optimization']],
  ['fb_m8', 'Security and privacy', 'extensions/security-and-privacy', ['Security Basics']],
  ['fb_m9', 'Testing', 'extensions/testing', ['Testing']],
  ['fb_m10', 'Web APIs', 'extensions/web-apis', ['JavaScript', 'API']],
].map(([id, title, slug, topics]) => ({
  id,
  title,
  topics,
  platform: 'MDN',
  url: `https://developer.mozilla.org/en-US/curriculum/${slug}/`,
  courseType: 'curriculum',
  language: 'en',
  level: null,
  description: `MDN curriculum resource: ${title}.`,
  provenance: { metadataVerifiedAt: reviewedAt },
}));
const curated = [
  [
    'fb_u12',
    'AI Engineer Core Track: LLM Engineering, RAG, QLoRA, Agents',
    'Udemy',
    'https://www.udemy.com/course/llm-engineering-master-ai-and-large-language-models/',
    ['Generative AI', 'LLM', 'RAG', 'Python'],
  ],
  [
    'fb_c10',
    'Generative AI with Large Language Models',
    'Coursera',
    'https://www.coursera.org/learn/generative-ai-with-llms',
    ['Generative AI', 'LLM', 'Machine Learning', 'Python'],
  ],
  [
    'fb_c11',
    'Retrieval Augmented Generation (RAG)',
    'Coursera',
    'https://www.coursera.org/learn/retrieval-augmented-generation-rag',
    ['RAG', 'LLM', 'Generative AI'],
  ],
  [
    'fb_c12',
    'Introduction to Containers w/ Docker, Kubernetes & OpenShift',
    'Coursera',
    'https://www.coursera.org/learn/ibm-containers-docker-kubernetes-openshift',
    ['Docker', 'Kubernetes', 'Deployment'],
  ],
  [
    'fb_c13',
    'Getting Started with Angular',
    'Coursera',
    'https://www.coursera.org/learn/getting-started-with-angular',
    ['Angular', 'TypeScript'],
  ],
  [
    'fb_c14',
    'Introduction to Angular',
    'Coursera',
    'https://www.coursera.org/learn/introduction-to-angular',
    ['Angular', 'TypeScript'],
  ],
  [
    'fb_e10',
    'Generative AI Engineering',
    'edX',
    'https://www.edx.org/certificates/professional-certificate/ibm-generative-ai-engineering',
    ['Generative AI', 'LLM'],
  ],
].map(([id, title, platform, url, topics]) => ({
  id,
  title,
  platform,
  url,
  topics,
  level: null,
  language: platform === 'edX' ? null : 'en',
  courseType: platform === 'edX' ? 'learning-path' : 'course',
  description: `Publisher-listed learning offering: ${title}. Confirm current access with the provider.`,
  provenance: { metadataVerifiedAt: reviewedAt },
}));

module.exports = {
  reviewedAt,
  fcc: [
    ...require('./courseCatalog')
      .filter((course) => course.platform === 'freeCodeCamp')
      .map((course) => {
        const slug = new URL(course.url).pathname.replace(/^\/learn\//, '').replace(/\/$/, '');
        return {
          id: course.id,
          title: course.title,
          topics: course.topics,
          slug,
          manifestSlug: slug === '2022/responsive-web-design' ? 'responsive-web-design-22' : slug,
        };
      }),
    ...fcc,
  ],
  courses: [
    ...fcc.map(({ slug, ...course }) => ({
      ...course,
      platform: 'freeCodeCamp',
      url: `https://www.freecodecamp.org/learn/${slug}/`,
      courseType: 'curriculum',
      language: 'en',
      level: null,
      description: `Official freeCodeCamp curriculum: ${course.title}.`,
      provenance: { metadataVerifiedAt: reviewedAt },
    })),
    ...mdn,
    ...curated,
  ],
};
