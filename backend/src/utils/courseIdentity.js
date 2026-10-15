'use strict';
const crypto = require('node:crypto');
// Only spelling aliases. Related technologies (Java/JavaScript, SQL/PostgreSQL,
// C#/.NET, React/React Native) remain distinct learning targets.
const ALIASES = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  nodejs: 'Node.js',
  'node js': 'Node.js',
  'node.js': 'Node.js',
  reactjs: 'React',
  'react.js': 'React',
  react: 'React',
  nextjs: 'Next.js',
  'next.js': 'Next.js',
  vuejs: 'Vue',
  'vue.js': 'Vue',
  vue: 'Vue',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  cpp: 'C++',
  'c++': 'C++',
  csharp: 'C#',
  'c#': 'C#',
  dotnet: '.NET',
  '.net': '.NET',
  k8s: 'Kubernetes',
  kubernetes: 'Kubernetes',
  sql: 'SQL',
  html5: 'HTML',
  html: 'HTML',
  css3: 'CSS',
  css: 'CSS',
  aws: 'AWS',
  'amazon web services': 'AWS',
  tailwind: 'Tailwind CSS',
  'tailwind css': 'Tailwind CSS',
};
const canonicalizeSkillName = (value) => ALIASES[String(value).toLowerCase()] || '';
const skillAliases = (name) => [
  name,
  ...Object.keys(ALIASES).filter((alias) => ALIASES[alias].toLowerCase() === name.toLowerCase()),
];
const HOSTS = {
  Udemy: ['udemy.com'],
  Coursera: ['coursera.org'],
  YouTube: ['youtube.com', 'youtu.be'],
  edX: ['edx.org'],
  freeCodeCamp: ['freecodecamp.org'],
};
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeCourseUrl = (value, platform) => {
  if (typeof value !== 'string' || value.length > 1000 || /[\\\s]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const hosts = platform ? HOSTS[platform] || [] : Object.values(HOSTS).flat();
    if (!hosts.some((host) => url.hostname === host || url.hostname.endsWith('.' + host)))
      return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
};
const canonicalCourseKey = (course) => {
  const safe = safeCourseUrl(course?.url, course?.platform);
  if (!safe) return null;
  const url = new URL(safe);
  if (course.platform === 'YouTube') {
    const id =
      url.hostname === 'youtu.be'
        ? url.pathname.slice(1)
        : url.searchParams.get('v') || url.pathname.split('/').pop();
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? 'youtube:' + id : null;
  }
  return url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/+$/, '').toLowerCase();
};
const skills = (values, limit = 12) => {
  const input = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? values.split(',')
      : [];
  const seen = new Set();
  const output = [];
  for (const value of input) {
    if (typeof value !== 'string') continue;
    const name = String(
      canonicalizeSkillName(value.trim().slice(0, 40)) || value.trim().slice(0, 40),
    );
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    output.push(name);
    if (output.length >= limit) break;
  }
  return output;
};
const validCourseId = (value) =>
  typeof value === 'string' &&
  /^(?:fb_[a-z][0-9]{1,4}|yt_[A-Za-z0-9_-]{11}|course_[a-f0-9]{24})$/.test(value);
module.exports = { safeCourseUrl, canonicalCourseKey, digest, skills, validCourseId, skillAliases };
