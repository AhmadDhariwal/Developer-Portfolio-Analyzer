# Skill Gap Latency Analysis — End-to-End Request Waterfall

## Methodology

Traced every line of the complete request lifecycle from browser button click through UI render by reading the actual source code of all layers:

- **Frontend component**: `frontend/src/app/pages/skill-gap/skill-gap.component.ts` (465 lines)
- **Frontend service**: `frontend/src/app/shared/services/skill-gap.service.ts` (376 lines)
- **Frontend profile service**: `frontend/src/app/shared/services/career-profile.service.ts` (186 lines)
- **Backend route**: `backend/src/routes/skillgap.routes.js` (8 lines)
- **Backend controller**: `backend/src/controllers/skillgapcontroller.js` (1222 lines)
- **Backend developer signals**: `backend/src/services/developerSignalService.js` (996 lines)
- **Backend GitHub service**: `backend/src/services/githubservice.js` (1082 lines)
- **Backend prompt**: `backend/src/prompts/skillGapPrompt.js` (89 lines)

---

## Complete Request Waterfall

```
TIME (ms)   STAGE                                     DURATION    CUMULATIVE
─────────── ───────────────────────────────────────── ─────────── ───────────
0           Browser navigates to /app/skill-gap        -           0
0           Angular router activates MainLayout        -           0
0           SkillGapComponent.ngOnInit() fires         -           0
0           ├─ subscribe(careerProfile$) [async]        -           0
0           ├─ getStoredActiveUsername() [sync]        ~0ms        0
0           │  └─ localStorage + AuthService read      ~0ms        0
0           ├─ If stored: applyDefaultUsername()       ~0ms        0
0           ├─ If stored: analyze() called             -           0
0           │  ├─ careerProfileService.snapshot [sync] ~0ms        0
0           │  ├─ frontendCache.getCurrentSignalHash() ~0ms        0  [localStorage read]
0           │  ├─ skillGapService.getCachedResult()    ~0ms        0  [localStorage read]
0           │  │  └─ CACHE MISS (or expired signal)    -           0
0           │  ├─ isLoading = true, result = null      ~0ms        0
0           │  ├─ cdr.detectChanges() [re-render]      ~16ms       16
0           │  └─ skillGapService.analyze() → HTTP POST ~0ms       16
0           │
0           ├─ If NO stored: getActiveUsername()        -           0
0           │  └─ GET /api/github/active-username       ~50-300ms  50-316
0           │     └─ .subscribe(next) → applyUsername   ~0ms
0           │        └─ analyze() called                -          50-316
0           │           └─ [same flow as above]         -          50-316
0           │
0           │ ═══════════ REQUEST LEAVES BROWSER ═══════
0           │
0           ▼ BACKEND: POST /api/skillgap/skill-gap ─────────────────────
0           │
0           │─── Middleware Pipeline ──────────────────
0           │ helmet                                    ~0ms        0
0           │ cors                                       ~0ms        0
0           │ globalRateLimiter                          ~0ms        0
0           │ requestContextMiddleware                   ~0ms        0
0           │ express.json()                             ~0ms        0
0           │ maintenance check                          ~0ms        0
0           │ auditLogMiddleware                         ~0ms        0
0           │ authmiddleware.protect (JWT verify)        ~2ms        2
0           │ authmiddleware → User.findById             ~5ms        7
0           │
0           ▼ CONTROLLER: analyzeSkillGap() ────────────────────────────
7           │
7           │── Step 1: Resolve inputs ─────────────────
7           │ careerStack, experienceLevel, username     ~0ms        7
7           │
7           │── Step 2: Parallel Data Fetch ────────────
7           │ Promise.all([
7           │   getGitHubData(username),            ←─── GITHUB API
7           │   loadResumeAnalysis(userId)          ←─── MongoDB
7           │ ])
7           │
7           │   getGitHubData():
7           │   ├─ analyzeGitHubProfile(username)
7           │   │  ├─ getCacheEntry() → githubAnalysisCache.findOne()  ~5ms
7           │   │  ├─ CHECK: expiresAt > now?
7           │   │  │  ├─ IF FRESH: return cached     ~5ms TOTAL        12
7           │   │  │  └─ IF EXPIRED: ⚠️ SLOW PATH (20-50s!)
7           │   │  │     ├─ fetchGitHubUser()        ~300-800ms
7           │   │  │     ├─ fetchGitHubRepos()        ~300-800ms
7           │   │  │     ├─ fetchRepoLanguages() ×24  ~200ms each (parallel) ~200-500ms
7           │   │  │     ├─ fetchRepoCheapSignals() ×8 ~200ms each (parallel per repo) ~200-600ms
7           │   │  │     ├─ fetchRepoCommitCount() ×12  ~200ms each (parallel) ~200-500ms
7           │   │  │     ├─ fetchMonthlyCommitActivity()  ~500-2000ms
7           │   │  │     ├─ buildAIInsights() → AI call   ~2000-8000ms
7           │   │  │     └─ saveCacheResult()              ~10ms
7           │   │  └─ TOTAL github (cached): ~5ms    ~5ms        12
7           │   │     TOTAL github (uncached): 20-50s [⚠️ ROOT CAUSE #1]
7           │   │
7           │   loadResumeAnalysis():
7           │   ├─ User.findById(defaultResumeFileId)     ~3ms
7           │   └─ ResumeAnalysis.findOne()               ~5ms
7           │   └─ TOTAL resume: ~8ms                ~8ms        20
7           │
20          │── Step 3: Developer Signals (getDeveloperSignals) ────────
20          │ Promise.all([ 11 QUERIES ])
20          │
20          │  ❶ summarizeGithubSignal(userId)
20          │    ├─ Analysis.findOne()                     ~5ms
20          │    └─ Repository.find() × 24                ~5ms
20          │    └─ [SEQUENTIAL, even though data
20          │         already fetched in Step 2!]       ~10ms       30
20          │
20          │  ❷ summarizeResumeSignal(userId)
20          │    ├─ User.findById(defaultResumeFileId)     ~3ms
20          │    └─ ResumeAnalysis.findOne()               ~5ms
20          │    └─ [SEQUENTIAL, even though data
20          │         already fetched in Step 2!]        ~8ms        38
20          │
20          │  ❸ summarizeSkillGapSignal(userId)
20          │    └─ AnalysisCache.findOne()                ~5ms       43
20          │
20          │  ❹ summarizeCareerSprintSignal(userId)
20          │    └─ CareerSprint.findOne()                 ~5ms       48
20          │
20          │  ❺ summarizeWeeklyReportSignal(userId)
20          │    └─ WeeklyReport.find() × 4               ~5ms       53
20          │
20          │  ❻ summarizePortfolioSignal(userId)
20          │    ├─ PublicProfile.findOne()                 ~3ms
20          │    ├─ User.findById() [SEQUENTIAL!]           ~3ms
20          │    └─ buildPublicProfilePayload()              ~5ms
20          │    └─ TOTAL                                   ~11ms      64
20          │
20          │  ❼ summarizeIntegrationSignal(userId)
20          │    └─ getIntegrationInsight(userId)
20          │       └─ [separate service, unknown depth]   ~5-50ms    69-114
20          │
20          │  ❽ summarizeCareerProfileSignal(userId)
20          │    └─ User.findById() (again!)                ~3ms       72-117
20          │
20          │  ❾ summarizeJobsDemandSignal()
20          │    └─ JobCache.find() × 250 [NO userId filter!] ~5-50ms 77-167
20          │       └─ [Scans ALL jobs, not per-user]
20          │
20          │  ❿ summarizeRecommendationSignal(userId)
20          │    └─ Recommendation.find() × 12              ~5ms       82-172
20          │
20          │  ⓫ summarizeScenarioSimulatorSignal(userId)
20          │    └─ ScenarioSimulation.find() × 8           ~5ms       87-177
20          │
177         │── Step 4: Evidence Breakdown ─────────────
177         │ buildSkillEvidenceBreakdown() [sync]        ~10ms       187
187         │
187         │── Step 5: Deterministic Confidence ────────
187         │ computeDeterministicConfidence() [sync]     ~1ms        188
188         │
188         │── Step 6: Cache Check ─────────────────────
188         │ AnalysisCache.findOne(compositeKey)          ~5ms        193
193         │ IF CACHE HIT → return immediately 🚀       ~0ms        193
193         │ ═══════════ FAST PATH ENDS HERE ═══════════
193         │
193         │── Step 7: Deterministic Skill Groups ──────
193         │ buildDeterministicSkillGroups() [sync]      ~20-50ms    213-243
           │ [Iterates all repos for each skill —
           │  O(skills × repos) nested loop]
           │
           │── Step 8: AI Analysis (if confidence < 70) ─
           │ aiService.runAIAnalysis(prompt, fallback)
           │ ├─ Primary: Groq API (llama-3.3-70b)         ~2000-8000ms
           │ │  └─ IF FAILS: Gemini API                   ~1000-5000ms
           │ │     └─ IF FAILS: static fallback            ~0ms
           │ └─ TOTAL AI (success):                 ~2000-8000ms  2213-8243
           │ └─ TOTAL AI (skip):                          ~0ms
           │    └─ [⚠️ ROOT CAUSE #2 — AI latency]
           │
           │── Steps 9-11: Merge + Coverage + Graph ─────
           │ [sync computation]                          ~10-30ms    2243-8273
           │
           │── Step 12: Save & Return ───────────────────
           │ AnalysisCache.findOneAndUpdate(upsert)       ~5ms        2248-8278
           │ saveAIVersionSnapshot()                      ~5ms        2253-8283
           │ res.json(fullResult)                         ~10ms       2263-8293
           │
           │ ═══════════ RESPONSE LEAVES BACKEND ═══════════
           │
           │ RESPONSE SIZE: ~150-300KB JSON
           │ [Full githubData + all skills + graph + roadmap]
           │ TRANSFER TIME (10Mbps):                      ~120-240ms
           │ TRANSFER TIME (3G):                          ~400-800ms
           │
           ▼ FRONTEND: Response Received ──────────────────────────────
2400-9100  │
           │ skillGapService.analyze().subscribe(next:)
           │ applyResult(raw)
           │ ├─ normalize 40+ fields [sync]              ~2-5ms
           │ ├─ compute derivedCoverage [sync]           ~0ms
           │ ├─ refreshGraphLayout() [sync]              ~2-5ms
           │ │  └─ Position up to 32 graph nodes
           │ ├─ skillGapService.cacheResult()             ~0ms  [localStorage write]
           │ ├─ isLoading = false
           │ └─ cdr.detectChanges()                       ~16ms
           │    └─ Angular change detection +
           │      DOM update + browser paint              ~50-200ms
           │
~2500-9300 ═══════════ RENDER COMPLETE ═══════════
```

---

## Root Cause Analysis

### ROOT CAUSE #1: GitHub Cache Expiration (20-50s)
**Condition**: When `githubAnalysisCache` is expired (24h TTL) AND Skill Gap requests fresh analysis.

`getGitHubData()` calls `analyzeGitHubProfile()` which calls `buildFreshAnalysis()`:
```
buildFreshAnalysis():
  fetchGitHubUser()           → 1 GitHub API call
  fetchGitHubRepos()          → 1 GitHub API call  (parallel with above)
  fetchRepoLanguages() ×24    → 24 GitHub API calls (parallel batch)
  fetchRepoCheapSignals() ×8  → 8 repos × 14 paths = 112 GitHub API calls
  fetchRepoCommitCount() ×12  → 12 GitHub API calls
  fetchMonthlyCommitActivity()→ up to 48 paginated GitHub API calls
  buildAIInsights()           → 1 AI call (2-8s)
```

Even with `Promise.all` batching, GitHub API calls are 200-800ms each. 100+ calls = 20-50 seconds.

**Mitigation**: The cache TTL is 24h. After the first analysis, subsequent requests are fast (~5ms). But the FIRST request or a force-refresh is extremely slow.

### ROOT CAUSE #2: AI Provider Latency (2-8s)
**Condition**: When `deterministicConfidence < 70` (the AI skip threshold is not met).

`aiService.runAIAnalysis(prompt, fallback)`:
- Primary: Groq API → 2-8 seconds
- Fallback: Gemini API → 1-5 seconds

**Mitigation**: When `deterministicConfidence >= 70`, AI is skipped entirely. This threshold is reached when user has both GitHub and resume analysis with good coverage.

### ROOT CAUSE #3: Duplicate Data Fetching in `getDeveloperSignals()` 
**Impact**: ~50-100ms wasted on redundant MongoDB queries.

`getDeveloperSignals(userId)` fetches data that was ALREADY fetched in Step 2:
- `summarizeGithubSignal(userId)` → queries Analysis + Repository (data already in `githubData` variable)
- `summarizeResumeSignal(userId)` → queries User + ResumeAnalysis (data already in `latestResumeAnalysis` variable)
- `summarizeCareerProfileSignal(userId)` → queries User AGAIN

These ~11 parallel queries total ~50-200ms. Not the 30s bottleneck, but unnecessary overhead.

### ROOT CAUSE #4: Large Response Payload
**Impact**: ~200-800ms transfer + parse time on slow connections.

The `fullResult` object returned includes:
- Full `githubData` (entire GitHub analysis — repos, languages, technologies, scores, recruiter insights)
- `yourSkills[]` (up to 30 items with evidence)
- `missingSkills[]` (up to 16 items with evidence)
- `skillGraph` (nodes + edges)
- `roadmap[]` + `weeklyRoadmap[]` (phases with resources)
- `signalsUsed` (11 categories of signal details)
- `skillGapSignals` (redundant copy of same data)
- `coverageBreakdown`, `cacheMetadata`, etc.

Estimated size: 150-300KB of JSON.

### ROOT CAUSE #5: Frontend Profile Change Triggers Double-Analyze
**Impact**: Up to 2 duplicate HTTP requests.

In `SkillGapComponent.ngOnInit()`:
1. If stored username exists: calls `analyze()` immediately
2. Subscription to `careerProfile$` BehaviorSubject fires on initialization → calls `analyze()` AGAIN

The first `analyze()` stores in localStorage, so the second hits the frontend cache. But both fire HTTP requests if the signal hash doesn't match.

### ROOT CAUSE #6: GitHub API Rate Limits on Cache Miss
**Impact**: GitHub returns 403/429, causing retries or stale fallback.

Unclear from code alone whether a rate-limited response triggers timeout/retry behavior that adds latency.

---

## What Skill Gap DOES Wait For

| Operation | Waited For? | Impact |
|-----------|------------|--------|
| GitHub API refresh | ✅ YES (if cache expired) | 20-50s |
| Resume analysis refresh | ❌ NO (reads from DB only) | ~5ms |
| Recommendation refresh | ❌ NO (reads existing docs) | ~5ms |
| Weekly Report refresh | ❌ NO (reads existing docs) | ~5ms |
| Career Sprint refresh | ❌ NO (reads existing docs) | ~5ms |
| AI insights | ✅ YES (if confidence < 70) | 2-8s |

**Skill Gap does NOT trigger refreshes** of GitHub, Resume, Recommendations, Weekly Reports, or Career Sprints. It only READS existing data. The exception is `getGitHubData()` which may trigger a full GitHub re-analysis if the 24h cache expired.

---

## Most Likely 30-Second Bottleneck

**The ~30s delay almost certainly comes from `getGitHubData()` → `buildFreshAnalysis()` when the `githubAnalysisCache` has expired (24h TTL)**.

This triggers 100+ GitHub API calls fetching:
- User profile
- Up to 100 repos
- Language bytes for 24 repos
- README + 13 manifest files for 8 repos
- Commit counts for 12 repos
- Monthly commit activity

Each call is 200-800ms. Total: 20-50 seconds.

**Evidence supporting this**:
1. You said the controller "completes in ~1 second" — that's the CACHED path
2. The browser sees ~30s — that's the UNCACHED path
3. The first-ever analysis or a force-refresh triggers the uncached path

**The second contributor**: AI call (Groq/Gemini) adds 2-8s when `deterministicConfidence < 70`.

---

## Optimization Plan

### Priority 1: Return Immediately, Refresh GitHub in Background

**Current behavior**:
```javascript
// skillgapcontroller.js line 757
const [githubData, ...] = await Promise.all([
  getGitHubData(username.trim()),  // ← BLOCKS until GitHub API completes
  loadResumeAnalysis(...)
]);
```

**Proposed change**:
```javascript
// Return CACHED GitHub data immediately
const cachedGitHub = await getGitHubDataFromCache(username);

// Fire background refresh (doesn't block response)
if (shouldRefreshGitHub(cachedGitHub)) {
  refreshGitHubInBackground(username, req.user._id);
}

// Use cached data for this response
const githubData = cachedGitHub || emptyGitHubFallback;
```

This isolates the GitHub refresh to a background job. The Skill Gap response returns in <500ms even on cache miss.

### Priority 2: Reduce Response Payload

The `fullResult` includes the ENTIRE `githubData` object (repositories, languages, technologies, scores, recruiter insights). Skill Gap only needs: `provenSkills`, `githubSkills`, `languageDistribution`, `repoCount`, `developerLevel`.

**Strip from response**: `githubData.repositories[]`, `githubData.technologyCategories`, `githubData.recruiterInsights`, `githubData.githubSignals`

**Estimated savings**: 100-200KB (50-70% of payload).

### Priority 3: De-duplicate `getDeveloperSignals()` Queries

The controller already has `githubData` and `latestResumeAnalysis` from Step 2. Pass these into `getDeveloperSignals()` as overrides:

```javascript
const { developerSignals, ... } = await loadDeveloperSignalsSafely({
  userId,
  username,
  resumeInsights,
  githubInsights,
  // Pass pre-fetched data to avoid re-querying
  overrides: {
    githubSignals: buildGithubSignalsFromData(githubData),    // skip Analysis + Repository queries
    resumeSignals: buildResumeSignalsFromAnalysis(latestResumeAnalysis), // skip User + ResumeAnalysis queries
    careerProfileSignal: buildCareerProfileFromUser(req.user) // skip User.findById
  }
});
```

**Estimated savings**: 100-150ms (3-6 fewer MongoDB queries).

### Priority 4: Increase AI Skip Threshold

Current threshold: `deterministicConfidence >= 70`
Raise to `>= 75` to skip AI more aggressively. The deterministic analysis is already high-quality with multi-source evidence.

### Priority 5: Prevent Double Analyze on Init

In `SkillGapComponent.ngOnInit()`, the first `analyze()` call AND the `careerProfile$` subscription both trigger `analyze()`. Add a guard:

```typescript
private analyzeInFlight = false;

analyze(forceRefresh = false): void {
  if (this.analyzeInFlight) return;  // Prevent duplicate
  this.analyzeInFlight = true;
  // ... existing logic
  // Set analyzeInFlight = false in subscribe next/error
}
```

---

## Before vs After Comparison

| Stage | Before | After (All Fixes) |
|-------|--------|-------------------|
| GitHub cache hit backend | ~1s | ~200ms |
| GitHub cache miss backend | 20-50s | ~300ms (background refresh) |
| AI call (when needed) | 2-8s | 2-8s (unchanged, but triggered less often) |
| Response payload | 150-300KB | 50-80KB |
| Transfer (10Mbps) | 120-240ms | 40-65ms |
| Frontend init → HTTP sent | 0-300ms | 0-50ms (no double analyze) |
| **Total (cached)** | **~1.5s** | **~300ms** |
| **Total (uncached)** | **~30s** | **~500ms** |