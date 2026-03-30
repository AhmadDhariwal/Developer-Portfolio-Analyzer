require('dotenv').config();
const connectDB = require('../config/db');
const InterviewQuestionBank = require('../models/interviewQuestionBank');

const randomPopularity = () => Math.floor(Math.random() * 51) + 50;

const QUESTION_BANK = {
  javascript: [
    { question: 'What is closure?', answer: 'A closure is a function that retains access to its lexical scope even when executed outside it.', difficulty: 'medium', tags: ['javascript', 'functions'] },
    { question: 'What is hoisting?', answer: "Hoisting is JavaScript's behavior of moving declarations to the top of scope.", difficulty: 'easy', tags: ['javascript'] },
    { question: 'Difference between var, let, const?', answer: 'var is function-scoped, let/const are block-scoped; const cannot be reassigned.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is event loop?', answer: 'It handles async execution by moving callbacks from queue to call stack.', difficulty: 'medium', tags: ['javascript', 'async'] },
    { question: 'What is a promise?', answer: 'An object representing completion or failure of async operation.', difficulty: 'easy', tags: ['javascript', 'async'] },
    { question: 'What is async/await?', answer: 'Syntax to handle promises in a synchronous-looking way.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is prototype?', answer: 'An object from which other objects inherit properties.', difficulty: 'medium', tags: ['javascript'] },
    { question: 'What is this keyword?', answer: 'Refers to current execution context.', difficulty: 'medium', tags: ['javascript'] },
    { question: 'What is callback function?', answer: 'Function passed as argument to another function.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is debounce?', answer: 'Limits function execution after delay.', difficulty: 'medium', tags: ['javascript'] },
    { question: 'What is throttle?', answer: 'Limits function execution rate.', difficulty: 'medium', tags: ['javascript'] },
    { question: 'What is JSON?', answer: 'Lightweight data-interchange format.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is strict mode?', answer: 'Enables stricter parsing and error handling.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is NaN?', answer: 'Represents Not-a-Number value.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'Difference between == and ===?', answer: '== compares value, === compares value + type.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is closure use case?', answer: 'Data privacy and function factories.', difficulty: 'medium', tags: ['javascript'] },
    { question: 'What is module?', answer: 'Reusable code unit using import/export.', difficulty: 'medium', tags: ['javascript'] },
    { question: 'What is IIFE?', answer: 'Function executed immediately.', difficulty: 'medium', tags: ['javascript'] },
    { question: 'What is spread operator?', answer: 'Expands elements of iterable.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is rest operator?', answer: 'Collects arguments into array.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is DOM?', answer: 'Document Object Model.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is BOM?', answer: 'Browser Object Model.', difficulty: 'medium', tags: ['javascript'] },
    { question: 'What is fetch API?', answer: 'Used to make HTTP requests.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is localStorage?', answer: 'Browser storage for key-value data.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is sessionStorage?', answer: 'Temporary browser storage.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is garbage collection?', answer: 'Automatic memory management.', difficulty: 'medium', tags: ['javascript'] },
    { question: 'What is event delegation?', answer: 'Handling events at parent level.', difficulty: 'medium', tags: ['javascript'] },
    { question: 'What is arrow function?', answer: 'Short syntax function with lexical this.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is setTimeout?', answer: 'Executes code after delay.', difficulty: 'easy', tags: ['javascript'] },
    { question: 'What is setInterval?', answer: 'Executes code repeatedly.', difficulty: 'easy', tags: ['javascript'] }
  ],
  react: [
    { question: 'What is React?', answer: 'A JavaScript library for building UI.', difficulty: 'easy', tags: ['react'] },
    { question: 'What is Virtual DOM?', answer: 'Lightweight copy of DOM.', difficulty: 'easy', tags: ['react'] },
    { question: 'What are components?', answer: 'Reusable UI pieces.', difficulty: 'easy', tags: ['react'] },
    { question: 'What is JSX?', answer: 'Syntax extension for JS.', difficulty: 'easy', tags: ['react'] },
    { question: 'What is state?', answer: 'Component internal data.', difficulty: 'easy', tags: ['react'] },
    { question: 'What are props?', answer: 'Data passed to components.', difficulty: 'easy', tags: ['react'] },
    { question: 'What is useEffect?', answer: 'Hook for side effects.', difficulty: 'easy', tags: ['react'] },
    { question: 'What is useState?', answer: 'Hook for state.', difficulty: 'easy', tags: ['react'] },
    { question: 'What are hooks?', answer: 'Functions for React features.', difficulty: 'easy', tags: ['react'] },
    { question: 'What is reconciliation?', answer: 'Updating DOM efficiently.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is key prop?', answer: 'Unique identifier in lists.', difficulty: 'easy', tags: ['react'] },
    { question: 'What is context API?', answer: 'Global state management.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is Redux?', answer: 'State management library.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is controlled component?', answer: 'Form controlled by state.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is uncontrolled component?', answer: 'Form controlled by DOM.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is lazy loading?', answer: 'Load components on demand.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is memo?', answer: 'Prevents unnecessary re-renders.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is useMemo?', answer: 'Memoizes value.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is useCallback?', answer: 'Memoizes function.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is fragment?', answer: 'Group elements without div.', difficulty: 'easy', tags: ['react'] },
    { question: 'What is portal?', answer: 'Render outside DOM tree.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is error boundary?', answer: 'Catches errors in UI.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is SSR?', answer: 'Server-side rendering.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is CSR?', answer: 'Client-side rendering.', difficulty: 'easy', tags: ['react'] },
    { question: 'What is hydration?', answer: 'Attach JS to HTML.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is routing?', answer: 'Navigation between pages.', difficulty: 'easy', tags: ['react'] },
    { question: 'What is React Router?', answer: 'Routing library.', difficulty: 'easy', tags: ['react'] },
    { question: 'What is StrictMode?', answer: 'Highlights issues.', difficulty: 'easy', tags: ['react'] },
    { question: 'What is ref?', answer: 'Access DOM directly.', difficulty: 'medium', tags: ['react'] },
    { question: 'What is forwardRef?', answer: 'Pass ref to child.', difficulty: 'medium', tags: ['react'] }
  ],
  mern: [
    { question: 'What is MERN?', answer: 'MongoDB, Express, React, Node stack.', difficulty: 'easy', tags: ['mern'] },
    { question: 'Role of MongoDB?', answer: 'Database for storing data.', difficulty: 'easy', tags: ['mern'] },
    { question: 'Role of Express?', answer: 'Backend framework.', difficulty: 'easy', tags: ['mern'] },
    { question: 'Role of React?', answer: 'Frontend UI.', difficulty: 'easy', tags: ['mern'] },
    { question: 'Role of Node?', answer: 'Server runtime.', difficulty: 'easy', tags: ['mern'] },
    { question: 'What is REST API?', answer: 'API architecture.', difficulty: 'easy', tags: ['mern'] },
    { question: 'What is middleware?', answer: 'Functions in request cycle.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is JWT?', answer: 'Authentication token.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is CRUD?', answer: 'Create, Read, Update, Delete.', difficulty: 'easy', tags: ['mern'] },
    { question: 'What is MVC?', answer: 'Model View Controller pattern.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is schema?', answer: 'Structure of data.', difficulty: 'easy', tags: ['mern'] },
    { question: 'What is Mongoose?', answer: 'ODM for MongoDB.', difficulty: 'easy', tags: ['mern'] },
    { question: 'What is routing?', answer: 'Handling endpoints.', difficulty: 'easy', tags: ['mern'] },
    { question: 'What is API?', answer: 'Interface for communication.', difficulty: 'easy', tags: ['mern'] },
    { question: 'What is async programming?', answer: 'Non-blocking execution.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is CORS?', answer: 'Cross-origin requests.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is dotenv?', answer: 'Environment config.', difficulty: 'easy', tags: ['mern'] },
    { question: 'What is hashing?', answer: 'Secure password storage.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is bcrypt?', answer: 'Password hashing library.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is scalability?', answer: 'Handle growth.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is load balancing?', answer: 'Distribute traffic.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is microservice?', answer: 'Small independent services.', difficulty: 'hard', tags: ['mern'] },
    { question: 'What is monolith?', answer: 'Single application.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is caching?', answer: 'Store temporary data.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is Redis?', answer: 'In-memory cache.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is API rate limit?', answer: 'Limit requests.', difficulty: 'medium', tags: ['mern'] },
    { question: 'What is validation?', answer: 'Check data correctness.', difficulty: 'easy', tags: ['mern'] },
    { question: 'What is error handling?', answer: 'Manage errors.', difficulty: 'easy', tags: ['mern'] },
    { question: 'What is deployment?', answer: 'Hosting app.', difficulty: 'easy', tags: ['mern'] },
    { question: 'What is CI/CD?', answer: 'Automation pipeline.', difficulty: 'medium', tags: ['mern'] }
  ]
};

const run = async () => {
  await connectDB();

  const records = Object.entries(QUESTION_BANK).flatMap(([skill, questions]) => {
    return questions.map((item) => ({
      skill,
      question: String(item.question || '').trim(),
      answer: String(item.answer || '').trim(),
      difficulty: String(item.difficulty || 'medium').trim().toLowerCase(),
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean) : [skill],
      source: 'prebuilt',
      popularity: randomPopularity()
    }));
  });

  const operations = records.map((record) => ({
    updateOne: {
      filter: {
        skill: record.skill,
        question: record.question
      },
      update: {
        $setOnInsert: {
          skill: record.skill,
          question: record.question,
          answer: record.answer,
          difficulty: record.difficulty,
          tags: record.tags,
          createdAt: new Date()
        },
        $set: {
          source: 'prebuilt',
          popularity: record.popularity
        }
      },
      upsert: true
    }
  }));

  const result = await InterviewQuestionBank.bulkWrite(operations, { ordered: false });
  const inserted = Number(result.upsertedCount || 0);
  const total = await InterviewQuestionBank.countDocuments({ skill: { $in: ['javascript', 'react', 'mern'] } });

  console.log(`[seed-interview-question-bank] upserted=${inserted} total=${total}`);
  process.exit(0);
};

run().catch((error) => {
  console.error('[seed-interview-question-bank] failed:', error.message);
  process.exit(1);
});
