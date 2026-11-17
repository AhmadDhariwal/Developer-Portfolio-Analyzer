'use strict';

// Link-only discovery records, reviewed against official publisher pages 2026-11-05.
// No curriculum text, imagery, ratings, duration or licensed course content is copied.
module.exports = [
  ...require('./courseAcquisitionCatalog').courses,
  {
    id: 'fb_m1',
    title: 'MDN Learn Web Development',
    platform: 'MDN',
    url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development',
    topics: ['HTML', 'CSS', 'JavaScript', 'Accessibility'],
    description: 'Structured web development learning resources from MDN.',
    level: 'Beginner',
    courseType: 'curriculum',
    language: 'en',
  },
  {
    id: 'fb_o1',
    title: 'Full Stack JavaScript',
    platform: 'The Odin Project',
    url: 'https://www.theodinproject.com/paths/full-stack-javascript',
    topics: ['JavaScript', 'React', 'Node.js', 'SQL', 'HTML'],
    description: 'Project-based JavaScript learning path from The Odin Project.',
    level: null,
    courseType: 'learning-path',
    language: 'en',
  },
  {
    id: 'fb_h1',
    title: 'Full Stack Open',
    platform: 'Full Stack Open',
    url: 'https://fullstackopen.com/en/',
    topics: ['React', 'Node.js', 'MongoDB', 'GraphQL', 'TypeScript'],
    description: 'Modern web development course from the University of Helsinki.',
    level: null,
    courseType: 'course',
    language: 'en',
  },
];
