// Local-only UI fixtures. This server never contacts or writes production APIs.
// Run after ng serve --port 4216, or pass INTERVIEW_PREVIEW_DIST=1 after ng build.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildSeedRecordsForTopic,
  getImportantTopicByKey,
} = require('../../backend/src/services/interviewQuestionSeedCatalog');
const profile = { careerStack: 'Frontend', experienceLevel: 'Student', isConfigured: true };
const user = {
  _id: 'interview-ui-fixture',
  name: 'Preview Developer',
  role: 'developer',
  ...profile,
};
const requests = [];
const pools = new Map();
const pool = (skill) => {
  if (!pools.has(skill)) {
    const topic = getImportantTopicByKey(skill);
    pools.set(
      skill,
      topic
        ? buildSeedRecordsForTopic(topic).map((question, index) => ({
            ...question,
            _id: `fixture-${skill}-${index}`,
            verificationStatus: 'verified',
          }))
        : [],
    );
  }
  return pools.get(skill);
};
let sessions = [
  {
    _id: 'fixture-session',
    kind: 'practice',
    topicKey: 'react',
    ...profile,
    questions: pool('react').slice(0, 5),
    createdAt: new Date().toISOString(),
  },
];
const json = (res, value, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
};
const root = path.resolve(__dirname, '../dist/frontend/browser');
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4316');
  try {
    if (url.pathname === '/__interview_preview') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<html><body><p>Isolated Interview Prep fixture preview. No real account or API is used.</p><a href="/app/interview-prep">Open Interview Prep preview</a><script>
        localStorage.setItem('token', 'fixture.' + btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+36000,iss:'devinsight-api',aud:'devinsight-web'})) + '.fixture');
        localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
        localStorage.setItem('devinsight_career_profile', ${JSON.stringify(JSON.stringify(profile))});
        localStorage.setItem('devinsight_theme', 'light');
      </script></body></html>`);
    }
    if (url.pathname === '/__fixture/requests') return json(res, requests);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      requests.push({
        method: req.method,
        path: url.pathname,
        params: Object.fromEntries(url.searchParams),
      });
      if (url.pathname === '/api/auth/login') {
        const payload = Buffer.from(
          JSON.stringify({
            exp: Math.floor(Date.now() / 1000) + 36000,
            iss: 'devinsight-api',
            aud: 'devinsight-web',
          }),
        ).toString('base64url');
        return json(res, { ...user, user, token: `fixture.${payload}.fixture` });
      }
      const skill = body.skill || url.searchParams.get('skill') || 'react';
      const records = pool(skill);
      if (
        url.pathname.endsWith('/interview-prep/questions') ||
        url.pathname.endsWith('/interview-prep/search')
      ) {
        let questions = records;
        if (url.searchParams.get('block') === 'top')
          questions = questions.filter((question) => question.isTopQuestion);
        for (const field of ['difficulty', 'category']) {
          const value = url.searchParams.get(field);
          if (value) questions = questions.filter((question) => question[field] === value);
        }
        if (url.searchParams.get('source') === 'ai') questions = [];
        const tags = (url.searchParams.get('tags') || '').split(',').filter(Boolean);
        if (tags.length)
          questions = questions.filter((question) =>
            tags.some((tag) => question.tags.includes(tag)),
          );
        const query = url.searchParams.get('q');
        if (query)
          questions = questions.filter((question) =>
            `${question.question} ${question.answer}`.toLowerCase().includes(query.toLowerCase()),
          );
        const page = Number(url.searchParams.get('page') || 1),
          limit = Number(url.searchParams.get('limit') || 10);
        return json(res, {
          questions: questions.slice((page - 1) * limit, page * limit),
          total: questions.length,
          totalPages: Math.max(1, Math.ceil(questions.length / limit)),
          page,
          limit,
          topicKey: skill,
          source: 'db',
        });
      }
      if (url.pathname.endsWith('/interview-prep/history')) return json(res, { sessions });
      if (url.pathname.endsWith('/interview-prep/ask-question')) {
        if (body.question.toLowerCase().includes('unavailable'))
          return json(
            res,
            { message: 'Fixture provider unavailable. Your previous answer is preserved.' },
            503,
          );
        const answer = {
          ...records[0],
          question: body.question,
          sourceType: 'ai_generated',
          source: 'ai_generated',
          verificationStatus: 'unverified',
          sessionId: `fixture-custom-${sessions.length}`,
          stored: true,
        };
        sessions.unshift({
          _id: answer.sessionId,
          kind: 'custom',
          topicKey: skill,
          questions: [answer],
          createdAt: new Date().toISOString(),
        });
        return json(res, answer);
      }
      if (
        url.pathname.endsWith('/interview-prep/generate') ||
        url.pathname === '/api/interview-prep'
      ) {
        if ((body.query || '').includes('unavailable'))
          return json(
            res,
            { message: 'Fixture generation unavailable. Your previous set is preserved.' },
            503,
          );
        const questions = records.slice(0, Number(body.target || body.limit || 10));
        const sessionId =
          url.pathname === '/api/interview-prep' ? `fixture-session-${sessions.length}` : undefined;
        if (sessionId)
          sessions.unshift({
            _id: sessionId,
            kind: 'practice',
            topicKey: skill,
            ...profile,
            questions,
            createdAt: new Date().toISOString(),
          });
        return json(res, {
          questions,
          page: 1,
          total: questions.length,
          totalPages: 1,
          limit: questions.length,
          source: 'db',
          aiGeneratedCount: 0,
          sessionId,
          personalization: {
            status: 'career-context-only',
            limitation: 'Fixture preview: missing evidence does not establish inability.',
          },
        });
      }
      if (url.pathname.includes('/profile/career')) return json(res, profile);
      if (url.pathname.includes('/profile') || url.pathname.includes('/auth/me'))
        return json(res, { ...user, user });
      if (url.pathname.includes('/notifications'))
        return json(res, { notifications: [], unreadCount: 0 });
      return json(res, {});
    }
    let bytes, contentType;
    if (process.env.INTERVIEW_PREVIEW_DIST === '1') {
      let target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!target.startsWith(root + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory())
        target = path.join(root, 'index.html');
      bytes = fs.readFileSync(target);
      contentType =
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.ttf': 'font/ttf',
          '.svg': 'image/svg+xml',
        }[path.extname(target)] || 'application/octet-stream';
    } else {
      const upstream = await fetch(`http://127.0.0.1:4216${url.pathname}${url.search}`);
      bytes = Buffer.from(await upstream.arrayBuffer());
      contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    }
    if (contentType.includes('text/html'))
      bytes = Buffer.from(
        bytes
          .toString()
          .replace('http://localhost:5000', 'http://127.0.0.1:4316')
          .replace(
            '</body>',
            '<div style="position:fixed;bottom:5px;right:8px;z-index:99999;background:#111827;color:#fff;padding:3px 8px;border-radius:4px;font:10px sans-serif;pointer-events:none">Fixture data · focused UI verification</div></body>',
          ),
      );
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(bytes);
  } catch (error) {
    json(res, { message: error.message }, 500);
  }
});
server.listen(4316, '127.0.0.1', () =>
  console.log('Isolated Interview Prep preview: http://127.0.0.1:4316/__interview_preview'),
);
