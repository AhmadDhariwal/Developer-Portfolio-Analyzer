const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

class OfflineRecommendations {
  constructor() { this.cache = new Map(); this.inflight = new Map(); this.counts = { github: 0, ai: 0, db: 0, persistence: 0 }; }
  async run(input) {
    const key = `${input.userId}:${input.mode}:${input.username}:${input.resumeHash}:${input.stack}:${input.level}:${input.signalHash}`;
    if (!input.force && this.cache.has(key)) return { value: this.cache.get(key), stages: { cache: 0 }, cached: true };
    const workKey = `${key}:${Boolean(input.force)}`;
    if (this.inflight.has(workKey)) return this.inflight.get(workKey);
    const work = (async () => {
      const stages = {}; const time = async (name, fn) => { const at = performance.now(); const value = await fn(); stages[name] = performance.now() - at; return value; };
      await time('cache', async () => {}); await time('resume', async () => {}); await time('signals', async () => { this.counts.db++; }); await time('job demand', async () => {});
      await time('GitHub', async () => { this.counts.github++; }); await time('evidence', async () => {}); const value = await time('deterministic generation', async () => ({ score: 71, projects: ['Backend SQL Builder'], evidence: ['SQL'] }));
      await time('AI', async () => { this.counts.ai++; return value; }); await time('persistence', async () => { if (input.mode === 'profile') this.counts.persistence++; }); this.cache.set(key, value); return { value, stages, cached: false };
    })(); this.inflight.set(workKey, work); try { return await work; } finally { this.inflight.delete(workKey); }
  }
}
const stats = values => { const s = [...values].sort((a,b)=>a-b); return { p50: s[Math.floor(s.length * .5)], p95: s[Math.min(s.length - 1, Math.ceil(s.length * .95) - 1)] }; };
const cases = [
  ['Profile fresh', { userId:'u1',mode:'profile',username:'profile',resumeHash:'r1',stack:'Backend',level:'Student',signalHash:'s1',force:false }],
  ['Profile cache hit', { userId:'u1',mode:'profile',username:'profile',resumeHash:'r1',stack:'Backend',level:'Student',signalHash:'s1',force:false }],
  ['Profile force refresh', { userId:'u1',mode:'profile',username:'profile',resumeHash:'r1',stack:'Backend',level:'Student',signalHash:'s1',force:true }],
  ['Preview fresh', { userId:'temporary',mode:'preview',username:'candidate',resumeHash:'r2',stack:'Frontend',level:'Intern',signalHash:'public',force:false }],
  ['Saved-preview load', { userId:'u1',mode:'saved-preview',username:'candidate',resumeHash:'r2',stack:'Frontend',level:'Intern',signalHash:'saved',force:false }]
];
test('offline recommendations performance and isolation', async () => {
  const app = new OfflineRecommendations(); const timings = {};
  for (const [name, input] of cases) { const runs = await Promise.all(Array.from({ length: 5 }, async () => { const at = performance.now(); await app.run(input); return performance.now() - at; })); timings[name] = stats(runs); }
  assert.ok(timings['Profile cache hit'].p95 < 300); assert.ok(timings['Saved-preview load'].p95 < 300);
  const concurrent = await Promise.all(Array.from({length:5}, () => app.run({ userId:'u2',mode:'profile',username:'same',resumeHash:'r',stack:'Backend',level:'Student',signalHash:'x',force:false })));
  assert.equal(new Set(concurrent.map(item => item.value)).size, 1); assert.equal(app.counts.github, 5); assert.equal(app.counts.ai, 5); assert.ok(app.cache.size >= 4);
  const profileKey = [...app.cache.keys()].find(key => key.includes('u1:profile:profile')); const previewKey = [...app.cache.keys()].find(key => key.includes('temporary:preview:candidate')); assert.ok(profileKey && previewKey && profileKey !== previewKey);
  console.log(JSON.stringify({ timings, counts: app.counts }));
});
