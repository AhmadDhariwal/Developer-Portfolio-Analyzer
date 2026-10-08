const test = require('node:test');
const assert = require('node:assert/strict');
const context = require('../services/developerContextService');
const User = require('../models/user');
const ResumeFile = require('../models/resumeFile');
const ResumeAnalysis = require('../models/resumeAnalysis');

const fixture = () => {
  const user = { _id: 'u', activeResumeFileId: 'active', defaultResumeFileId: 'default' };
  const files = [
    { _id: 'default', userId: 'u', uploadDate: 1 },
    { _id: 'active', userId: 'u', uploadDate: 2 },
    { _id: 'latest', userId: 'u', uploadDate: 3 },
    { _id: 'foreign', userId: 'other', uploadDate: 4 }
  ];
  const analyses = [
    { _id: 'a1', fileId: 'default', userId: 'u', analyzedAt: 1 },
    { _id: 'a2', fileId: 'active', userId: 'u', analyzedAt: 2 },
    { _id: 'a3', fileId: 'latest', userId: 'u', analyzedAt: 3 },
    { _id: 'orphan', fileId: 'deleted', userId: 'u', analyzedAt: 9 }
  ];
  const query = (items, filter) => {
    let rows = items.filter(row => Object.entries(filter).every(([key, value]) => row[key] === value));
    return {
      select() { return this; },
      then(resolve, reject) { return this.lean().then(resolve, reject); },
      sort(sort) {
        rows.sort((a, b) => {
          for (const [key, direction] of Object.entries(sort)) {
            if (a[key] !== b[key]) return a[key] > b[key] ? direction : -direction;
          }
          return 0;
        });
        return this;
      },
      async lean() { return rows[0] || null; }
    };
  };
  const models = {
    User: { findById: () => query([user], {}) },
    ResumeFile: { findOne: filter => query(files, filter) },
    ResumeAnalysis: { findOne: filter => query(analyses, filter) }
  };
  return { user, files, analyses, models };
};

test('active GitHub wins; legacy GitHub works; absent identity is clean null', () => {
  assert.equal(context.resolveGithubUsername({ activeGithubUsername: 'active', githubUsername: 'legacy' }), 'active');
  assert.equal(context.resolveGithubUsername({ githubUsername: 'legacy' }), 'legacy');
  assert.equal(context.resolveGithubUsername({ activeGithubUsername: '  ', githubUsername: 'legacy' }), 'legacy');
  assert.deepEqual(context.resolveIdentity({}), { githubUsername: null, careerStack: null, experienceLevel: null });
});
test('active career stack and experience level win, with legacy compatibility', () => {
  const user = { activeCareerStack: 'Backend', careerStack: 'Frontend', activeExperienceLevel: 'Intern', experienceLevel: 'Student' };
  assert.equal(context.resolveCareerStack(user), 'Backend');
  assert.equal(context.resolveExperienceLevel(user), 'Intern');
  assert.equal(context.resolveCareerStack({ careerStack: 'Frontend' }), 'Frontend');
  assert.equal(context.resolveExperienceLevel({ experienceLevel: 'Student' }), 'Student');
});
test('active resume wins over default and newer historical resume', async () => {
  const f = fixture();
  assert.equal((await context.resolveCurrentContext('u', f.user, f.models)).resumeFileId, 'active');
  assert.equal((await context.resolveResumeAnalysis('u', f.user, f.models)).fileId, 'active');
});
test('default resume wins when active is absent', async () => {
  const f = fixture(); delete f.user.activeResumeFileId;
  assert.equal((await context.resolveResumeFile('u', f.user, f.models))._id, 'default');
  assert.equal((await context.resolveResumeAnalysis('u', f.user, f.models)).fileId, 'default');
});
test('latest valid owned historical resume is used only without either selection', async () => {
  const f = fixture(); delete f.user.activeResumeFileId; delete f.user.defaultResumeFileId;
  assert.equal((await context.resolveResumeFile('u', f.user, f.models))._id, 'latest');
  assert.equal((await context.resolveResumeAnalysis('u', f.user, f.models))._id, 'a3');
});
test('no resume yields clean null context, even with orphan analyses', async () => {
  const f = fixture(); f.files.length = 0; delete f.user.activeResumeFileId; delete f.user.defaultResumeFileId;
  assert.deepEqual(await context.resolveCurrentContext('u', f.user, f.models), {
    githubUsername: null, careerStack: null, experienceLevel: null, resumeFileId: null, resumeFile: null
  });
  assert.equal(await context.resolveResumeAnalysis('u', f.user, f.models), null);
  assert.equal(await context.resolveResumeAnalysis(null, undefined, f.models), null);
});
test('an unanalyzed selection never borrows historical analysis', async () => {
  const f = fixture(); f.user.activeResumeFileId = 'unanalyzed';
  assert.equal(await context.resolveResumeAnalysis('u', f.user, f.models), null);
});
test('Dashboard, Simulator, Weekly Reports read the same active resume; switching preserves history', async t => {
  const f = fixture();
  t.mock.method(User, 'findById', f.models.User.findById);
  t.mock.method(ResumeFile, 'findOne', f.models.ResumeFile.findOne);
  t.mock.method(ResumeAnalysis, 'findOne', f.models.ResumeAnalysis.findOne);
  const loaders = [
    require('../controllers/dashboardcontroller').__test.loadDefaultResumeAnalysis,
    require('../services/scenarioSimulatorService').__test.loadCurrentResumeAnalysis,
    require('../services/weeklyReportService').__test.loadDefaultResumeAnalysis
  ];
  const originalHistory = JSON.stringify({ files: f.files, analyses: f.analyses });
  const originalUser = JSON.stringify(f.user);
  for (const load of loaders) assert.equal((await load('u')).fileId, 'active');
  assert.equal(JSON.stringify(f.user), originalUser, 'reads must not update context');
  f.user.activeResumeFileId = 'default';
  for (const load of loaders) assert.equal((await load('u')).fileId, 'default');
  delete f.user.activeResumeFileId; delete f.user.defaultResumeFileId;
  for (const load of loaders) assert.equal((await load('u')).fileId, 'latest');
  assert.equal(JSON.stringify({ files: f.files, analyses: f.analyses }), originalHistory);
});

test('profile completion counts active-only developer identity', () => {
  const { computeDeveloperProfileCompletion } = require('../controllers/profilecontroller').__test;
  assert.equal(computeDeveloperProfileCompletion({
    name: 'Developer', activeGithubUsername: 'active', jobTitle: 'Engineer', location: 'City',
    bio: 'About me', website: 'https://example.com', activeCareerStack: 'Backend', activeExperienceLevel: 'Intern'
  }), 100);
});
test('profile GET and resume context GET do not backfill legacy fields or save the user', async t => {
  const f = fixture(); delete f.user.activeResumeFileId; delete f.user.defaultResumeFileId;
  f.user.save = async () => assert.fail('GET must not save context');
  f.user.activeGithubUsername = 'active-only';
  t.mock.method(User, 'findById', f.models.User.findById);
  t.mock.method(ResumeFile, 'findOne', f.models.ResumeFile.findOne);
  t.mock.method(ResumeAnalysis, 'findOne', f.models.ResumeAnalysis.findOne);
  const Analysis = require('../models/analysis');
  t.mock.method(Analysis, 'findOne', () => ({ sort() { return this; }, select() { return this; }, lean: async () => null }));
  const before = JSON.stringify(f.user);
  const req = { user: f.user, protocol: 'https', get: () => 'example.com' };
  let result;
  const res = {
    status(code) { assert.fail(`unexpected HTTP ${code}`); },
    json(value) { result = value; },
    set() { return this; }, type() { return this; }, send(value) { result = JSON.parse(value); }
  };
  await require('../controllers/profilecontroller').getProfile(req, res);
  assert.equal(result.activeResume.fileId, 'latest');
  assert.equal(result.activeGithubUsername, 'active-only');
  await require('../controllers/resumecontoller').getActiveResumeContext(req, res);
  assert.equal(result.activeResume.fileId, 'latest');
  assert.equal(JSON.stringify(f.user), before);
});
test('selecting an active resume updates only selection and retains all historical files and analyses', async t => {
  const f = fixture();
  const nextId = '0123456789abcdef01234567';
  f.files[2]._id = nextId; f.analyses[2].fileId = nextId;
  const before = JSON.stringify({ files: f.files, analyses: f.analyses });
  t.mock.method(ResumeFile, 'findOne', f.models.ResumeFile.findOne);
  t.mock.method(User, 'findByIdAndUpdate', async (userId, update) => {
    assert.equal(userId, 'u');
    assert.deepEqual(update, { activeResumeFileId: nextId });
    Object.assign(f.user, update);
    return f.user;
  });
  t.mock.method(ResumeAnalysis, 'findOne', f.models.ResumeAnalysis.findOne);
  let response;
  await require('../controllers/resumecontoller').setActiveResume(
    { user: f.user, body: { fileId: nextId } },
    { status(code) { assert.fail(`unexpected HTTP ${code}`); }, json(value) { response = value; } }
  );
  assert.equal(response.fileId, nextId);
  assert.equal(f.user.defaultResumeFileId, 'default');
  assert.equal((await context.resolveResumeAnalysis('u', f.user, f.models)).fileId, nextId);
  assert.equal(JSON.stringify({ files: f.files, analyses: f.analyses }), before);
});

test('null and undefined inputs return clean nulls without throwing', async () => {
  assert.deepEqual(context.resolveIdentity(null), { githubUsername: null, careerStack: null, experienceLevel: null });
  assert.deepEqual(context.resolveIdentity(undefined), { githubUsername: null, careerStack: null, experienceLevel: null });
  assert.equal(context.resolveGithubUsername(null), null);
  assert.equal(context.resolveGithubUsername(undefined), null);
  assert.equal(context.resolveCareerStack(null), null);
  assert.equal(context.resolveCareerStack(undefined), null);
  assert.equal(context.resolveExperienceLevel(null), null);
  assert.equal(context.resolveExperienceLevel(undefined), null);
  assert.equal(context.resolveSelectedResumeFileId(null), null);
  assert.equal(context.resolveSelectedResumeFileId(undefined), null);
  assert.equal(await context.loadUser(null), null);
  assert.equal(await context.loadUser(undefined), null);
  assert.equal(await context.resolveResumeFile(null), null);
  assert.equal(await context.resolveResumeFile(undefined), null);
  assert.equal(await context.resolveResumeAnalysis(null), null);
  assert.equal(await context.resolveResumeAnalysis(undefined), null);
});

test('whitespace-only active fields cleanly fall back to legacy fields or null', () => {
  const user = {
    activeCareerStack: '   ',
    careerStack: 'Backend',
    activeExperienceLevel: ' \t\n ',
    experienceLevel: 'Intern',
    activeGithubUsername: '  ',
    githubUsername: 'octocat'
  };
  assert.equal(context.resolveCareerStack(user), 'Backend');
  assert.equal(context.resolveExperienceLevel(user), 'Intern');
  assert.equal(context.resolveGithubUsername(user), 'octocat');

  const emptyUser = {
    activeCareerStack: '  ',
    careerStack: '   ',
    activeExperienceLevel: ' ',
    experienceLevel: '\t',
    activeGithubUsername: '  ',
    githubUsername: '   '
  };
  assert.deepEqual(context.resolveIdentity(emptyUser), {
    githubUsername: null,
    careerStack: null,
    experienceLevel: null
  });
});

test('context resolution does not cause circular dependencies across consumers', () => {
  const modules = [
    '../services/developerContextService',
    '../services/developerSignalService',
    '../services/scenarioSimulatorService',
    '../services/weeklyReportService',
    '../services/publicProfileService',
    '../controllers/dashboardcontroller',
    '../controllers/jobController',
    '../controllers/recommendationscontroller',
    '../controllers/skillgapcontroller'
  ];
  for (const mod of modules) {
    const loaded = require(mod);
    assert.ok(loaded, `Module ${mod} should load successfully without circular dependency issues`);
  }
});

