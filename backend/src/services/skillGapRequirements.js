"use strict";

// Migrated verbatim from Skill Gap's existing expected-skill hints and category
// filter. There were no per-skill weights or explicit optional entries.
const MATRIX_VERSION = "skill-gap-requirements-v1";
const DEFAULT_SKILLS = [
  "Testing",
  "System Design",
  "CI/CD",
  "Docker",
  "SQL",
  "Cloud Basics",
  "Security Basics",
  "Performance Optimization",
  "Design Patterns",
  "Monitoring and Observability",
  "API Versioning",
  "Caching Strategies",
  "Scalability Patterns",
  "Accessibility",
  "Documentation",
];
const STACK_SKILLS = {
  Frontend: [
    "React",
    "TypeScript",
    "Next.js",
    "Accessibility",
    "Testing",
    "CI/CD",
    "Deployment",
  ],
  Backend: [
    "Node.js",
    "REST APIs",
    "SQL",
    "PostgreSQL",
    "Docker",
    "CI/CD",
    "Caching Strategies",
    "Deployment",
  ],
  "Full Stack": [
    "React",
    "TypeScript",
    "Node.js",
    "REST APIs",
    "SQL",
    "Docker",
    "CI/CD",
    "Deployment",
  ],
  "AI/ML": [
    "Python",
    "SQL",
    "Docker",
    "AWS",
    "CI/CD",
    "Deployment",
    "Monitoring and Observability",
  ],
};
const LEVEL_SKILLS = {
  Student: ["Git", "Testing", "Documentation", "Deployment"],
  Intern: ["Git", "Testing", "Documentation", "Deployment"],
  "0-1 years": ["Testing", "SQL", "Deployment", "Documentation"],
  "1-2 years": ["Testing", "SQL", "CI/CD", "Deployment"],
  "2-3 years": ["System Design", "CI/CD", "Docker", "Performance Optimization"],
  "3-5 years": [
    "System Design",
    "CI/CD",
    "Monitoring and Observability",
    "Security Basics",
  ],
  "5+ years": [
    "System Design",
    "Scalability Patterns",
    "Security Basics",
    "Monitoring and Observability",
  ],
};
const STACK_CATEGORIES = {
  Frontend: [
    "Frontend",
    "Language",
    "Testing",
    "Tools",
    "DevOps",
    "Cloud",
    "Backend",
    "General",
  ],
  Backend: [
    "Backend",
    "Language",
    "Database",
    "Testing",
    "Tools",
    "DevOps",
    "Cloud",
    "General",
  ],
  "Full Stack": [
    "Frontend",
    "Backend",
    "Language",
    "Database",
    "Testing",
    "Tools",
    "DevOps",
    "Cloud",
    "General",
  ],
  "AI/ML": [
    "Language",
    "Database",
    "DevOps",
    "Cloud",
    "Testing",
    "Tools",
    "AI/ML",
    "General",
  ],
};

const { INDUSTRY_SKILLS } = require("../utils/skilldetector");
const EXTRA_SKILLS = [
  { name: "Scalability Patterns", category: "General" },
  { name: "React Native", category: "Mobile" },
  { name: ".NET", category: "Backend" },
  { name: "Ruby on Rails", category: "Backend" },
  { name: "Shell", category: "Language" },
  { name: "HCL", category: "Language" },
];
const CATALOG = new Map(
  [...INDUSTRY_SKILLS, ...EXTRA_SKILLS].map((skill) => [skill.name, skill]),
);
const ALIASES = Object.freeze({
  "react.js": "React",
  reactjs: "React",
  js: "JavaScript",
  ecmascript: "JavaScript",
  es6: "JavaScript",
  ts: "TypeScript",
  nextjs: "Next.js",
  "vue.js": "Vue",
  vuejs: "Vue",
  html5: "HTML",
  css3: "CSS",
  tailwind: "Tailwind CSS",
  nodejs: "Node.js",
  "node js": "Node.js",
  "rest api": "REST APIs",
  "rest apis": "REST APIs",
  restful: "REST APIs",
  golang: "Go",
  k8s: "Kubernetes",
  "amazon web services": "AWS",
  cicd: "CI/CD",
  "ci cd": "CI/CD",
  postgres: "PostgreSQL",
  mongo: "MongoDB",
  cpp: "C++",
  csharp: "C#",
  "c sharp": "C#",
  asm: "Assembly",
  "react-native": "React Native",
  reactnative: "React Native",
  dotnet: ".NET",
  rails: "Ruby on Rails",
});
const key = (value) =>
  typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLowerCase()
    : "";
const names = new Map([...CATALOG.keys()].map((name) => [key(name), name]));
const canonicalize = (value) =>
  names.get(key(value)) ||
  (Object.hasOwn(ALIASES, key(value)) ? ALIASES[key(value)] : "");
const normalize = (values) => [
  ...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) =>
        canonicalize(typeof value === "string" ? value : value?.name),
      )
      .filter(Boolean),
  ),
];
const metadata = (name) =>
  CATALOG.get(canonicalize(name)) || { name: "", category: "General" };
const resolveRequirements = (careerStack, experienceLevel) => {
  const missingEntries = [];
  if (!Object.hasOwn(STACK_SKILLS, careerStack))
    missingEntries.push(`careerStack:${careerStack || "(absent)"}`);
  if (!Object.hasOwn(LEVEL_SKILLS, experienceLevel))
    missingEntries.push(`experienceLevel:${experienceLevel || "(absent)"}`);
  if (missingEntries.length)
    return {
      available: false,
      version: MATRIX_VERSION,
      skills: [],
      missingEntries,
    };
  const skills = normalize([
    ...STACK_SKILLS[careerStack],
    ...LEVEL_SKILLS[experienceLevel],
    ...DEFAULT_SKILLS,
  ])
    .filter((name) =>
      STACK_CATEGORIES[careerStack].includes(metadata(name).category),
    )
    .map((name) => ({
      name,
      category: metadata(name).category,
      requirement: "REQUIRED",
      weight: 1,
    }));
  return { available: true, version: MATRIX_VERSION, skills, missingEntries };
};

module.exports = {
  MATRIX_VERSION,
  DEFAULT_SKILLS,
  STACK_SKILLS,
  LEVEL_SKILLS,
  STACK_CATEGORIES,
  ALIASES,
  canonicalize,
  normalize,
  metadata,
  resolveRequirements,
};
