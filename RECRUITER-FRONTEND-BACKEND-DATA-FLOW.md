# Recruiter Module — Frontend-to-Backend Data Flow

**Audit Scope:** End-to-end request, middleware, business logic, database, and UI rendering data flows for every Recruiter workflow.

---

## 1. Common Request & Security Pipeline

Every `/api/recruiter-hub/*` and `/api/recruiter/*` HTTP call traverses the following pipeline (**Verified** across `backend/index.js`, `auth.interceptor.ts`, `recruiterHubRoutes.js`, `recruiter.routes.js`):

```text
Angular Page / Component
  └─> Recruiter Service (RecruiterHubService | CandidateService | RecruiterJobService | RecruiterMatchService)
        └─> ApiService (HttpClient -> environment.apiBaseUrl + /recruiter-hub/...)
              └─> authInterceptor (checks authService.isLoggedIn(), attaches Bearer JWT; intercepts 401 -> logout, 503 maintenance -> logout + redirect)
                    └─> Express App (backend/index.js)
                          ├─> helmet(), cors(), globalRateLimiter, requestContextMiddleware
                          ├─> express.json({ limit: '100kb' })
                          ├─> Global maintenanceMode gate (503 if active)
                          ├─> metricsMiddleware
                          ├─> auditLogMiddleware (auto-logs POST/PUT/PATCH/DELETE on res.on('finish'))
                          └─> Router Guard Chain:
                                1. protect (JWT verify + User.findById + sessionRevision match + isActive !== false)
                                2. authorizeRoles('recruiter') (super_admin globally bypasses)
                                3. requireRecruiterAccessEnabled (PlatformSettingsSync.recruiter.enableRecruiterAccess !== false)
                                4. requireOrganizationContext(['recruiter']) (sets req.organizationId; super_admin gets null)
                                      └─> Hub Controller -> getRecruiterScope(req) (queries active Membership + Team)
                                            └─> Hub Service -> Mongoose Models -> JSON Response -> Angular Render
```

---

## 2. Feature-by-Feature Data Flows

### 2.1 Recruiter Dashboard (`/app/recruiter/dashboard`)
- **Status:** **Verified** (code-traced end-to-end; **Untested** in automated suite).
- **Flow:**
  1. `RecruiterDashboardComponent.ngOnInit()` calls `RecruiterHubService.getDashboard()`.
  2. `RecruiterHubService` returns cached `this.dashboard$` (`shareReplay(1)`) if populated, or calls `GET /api/recruiter-hub/analytics/dashboard`.
  3. `recruiterDashboardController.getDashboard` -> `recruiterDashboardService.getRecruiterDashboard(req)`:
     - Calls `getRecruiterScope(req)` (queries `Membership` + `Team`).
     - In parallel calls `listRecruiterAnalytics(req)` (which calls `getRecruiterScope(req)` a second time), `listRecruiterActivities({ limit: 12 })`, and `Organization.findById(scope.organizationId)`.
     - `listRecruiterAnalytics` runs 6 parallel queries:
       - `Job.find({ recruiterId, organizationId })`
       - `RecruiterMatch.find({ recruiterId, organizationId })`
       - `RecruiterShortlist.find({ recruiterId, organizationId })`
       - `AuditLog.find({ actor: recruiterId, organizationId }).limit(500)`
       - `listRecruiterCandidates({ organizationId, query: { limit: 240, sortBy: 'score-desc' } })`
       - `countTeamRecruiters(...)` (`Membership` + `User.countDocuments`)
     - Hydrates `recentMatches` (top 5) and `pendingFollowUps` (top 6) by calling `getRecruiterCandidateDetails(id, organizationId)` in `Promise.all` (N+1 queries).
  4. Response `{ metrics, charts, widgets, profile }` is normalized by `RecruiterDashboardComponent.normalizeDashboard()`, syncs `TenantContextService.syncOrganization()` with `myRole: 'recruiter'`, and renders 8 `app-recruiter-stat-card`s, quick actions, funnel, 8 `app-recruiter-performance-chart`s, and 4 priority queue lists.

### 2.2 Candidate Discovery & Filtering (`/app/recruiter/candidates`)
- **Status:** **Verified** (with **Defective** filter-bar binding).
- **Flow:**
  1. `CandidatesComponent.loadCandidates()` -> `CandidateService.listCandidates(filters)` -> `GET /api/recruiter-hub/candidates?search=...&stack=...&location=...&skills=...&minReadiness=...&sortBy=...&page=1&limit=12`.
  2. `candidateController.listCandidates` -> `candidateService.listRecruiterCandidates({ organizationId: req.organizationId, query })`.
  3. Calls `matchingService.listCandidates({ search, stack, experience, minScore, organizationId, limit: 320 })`:
     - Checks `PlatformSettings.findOne({ scope: 'global' })` (`recruiter.candidateVisibility`):
       - `'private'|'disabled'|'none'|'off'` -> returns `[]`.
       - `'organization'` -> filters `User.organizationId = organizationId`.
       - `'public'` (default) -> all `User` docs with `role in ['developer', 'user']`, `isPublic: true`, `isActive !== false`.
     - If `search` is set, builds `new RegExp(search, 'i')` (**Defective:** unescaped regex) against `name`, `email`, `githubUsername`, `jobTitle`.
     - `hydrateUserCandidates(users)` queries 5 collections in parallel (`Analysis`, `ResumeAnalysis`, `PublicProfile`, `CareerSprint`, `WeeklyReport`), computes `githubScore`, `resumeScore`, `consistencyScore`, `growthPotentialScore`, and weighted `score`.
     - Queries `Candidate.find({ isActive: true, userId: { $in: hydratedUserIds } })` and merges via `mergeCandidates()` (**Defective:** overwrites `id` with `Candidate._id` if a `Candidate` doc exists).
     - Applies in-memory filters (`applyCandidateFilters`), sorts by `score` desc, slices to `limit: 320`, and sanitizes (`sanitizePublicCandidate` removes `email` and internal fields).
  4. `candidateService` runs `enrichCandidates()` (re-queries `User` for `activeCareerStack`, `activeExperienceLevel`, `location`, `isActive`, `createdAt`, `updatedAt`), formats via `formatCandidateCard()`, applies Hub filters (`skills`, `location`, `availability`, `profileCompleteness`), sorts (`score-desc|score-asc|name-asc|experience-desc|experience-asc|latest`), and slices page `1..N`.
  5. Returns `{ candidates, filters: { stacks, locations, availability }, meta: { page, limit, total, totalPages, sortBy } }`.
  6. **Defective UI Binding:** In `CandidateFilterBarComponent.setValue(key, value)`, selecting Stack, Location, or Sort creates a new local object `this.model = { ...this.model, [key]: value }` without emitting to `CandidatesComponent.filters`, so dropdown filter selections are lost when `applyFilters()` runs.

### 2.3 Candidate Details & "Run AI Summary" (`/app/recruiter/candidates/:id`)
- **Status:** **Verified** (Note: "AI Summary" is heuristic, not LLM-backed).
- **Flow:**
  1. `CandidateDetailsComponent.ngOnInit()` -> `GET /api/recruiter-hub/candidates/:id`.
  2. `candidateController.getCandidateDetails`:
     - Calls `getRecruiterCandidateDetails(req.params.id, scope.organizationId)` -> `matchingService.getCandidateById` (validates ObjectId, checks `listPublicDeveloperUserIds`, checks `Candidate` by `_id` then `User` by `_id`, hydrates from 5 developer collections, formats card).
     - Calls `logCandidateView(...)` -> inserts `AuditLog` with `action: 'RECRUITER_CANDIDATE_VIEWED'`.
     - Returns `{ candidate }`.
  3. Clicking **Run AI Summary** calls `POST /api/recruiter-hub/candidates/:id/analyze`.
  4. `candidateService.analyzeRecruiterCandidate` re-fetches `getRecruiterCandidateDetails`, constructs deterministic `analysis` (`summary`, `strengths`, `weaknesses`, `recommendation`, `confidenceScore = avg(readinessScore, githubScore, resumeScore)`), inserts `AuditLog` (`RECRUITER_CANDIDATE_ANALYZED`), and returns `{ analysis }`.
  5. **Cache Gap:** `CandidateDetailsComponent.analyze()` does not call `RecruiterHubService.clearCache()`, leaving `candidatesAnalyzed` stale on cached Dashboard/Analytics views.

### 2.4 Recruiter Jobs CRUD & Archiving (`/app/recruiter/jobs`, `/app/recruiter/jobs/:id`)
- **Status:** **Verified** (with **Defective** empty description persistence & **Defective** missing ObjectId validation).
- **Flow:**
  1. `JobsComponent.ngOnInit()` -> `GET /api/recruiter-hub/jobs` -> `recruiterJobService.listRecruiterJobs` (`Job.find({ recruiterId, organizationId }).sort({ updatedAt: -1 })`).
  2. Create/Update form -> `POST /api/recruiter-hub/jobs` or `PATCH /api/recruiter-hub/jobs/:id`:
     - `recruiterJobController` gets `scope`, calls `createRecruiterJob` / `updateRecruiterJob`.
     - `recruiterJobService` validates payload (`validateJobPayload`) and `assertRecruiterTeamAccess` if `teamId` is provided (UI does not expose `teamId` selector).
     - **Defective:** UI form marks `description` Optional and `validateJobPayload` allows `""`, but `Job.js` has `description: { type: String, required: true, default: '' }`, causing Mongoose validation failure (`500`) on empty description.
     - Controller logs `AuditLog` (`RECRUITER_JOB_CREATED` / `RECRUITER_JOB_UPDATED`) in addition to `auditLogMiddleware`.
     - UI updates local `jobs` array and calls `hubService.clearCache()`.
  3. Archive -> `POST /api/recruiter-hub/jobs/:id/archive` -> sets `status: 'closed'`, `archivedAt: new Date()`, logs `RECRUITER_JOB_ARCHIVED`, clears `hubService` cache.
  4. Delete -> `DELETE /api/recruiter-hub/jobs/:id` -> `Job.findOneAndDelete({ _id: jobId, recruiterId, organizationId })` (**Note:** does NOT cascade-delete `RecruiterMatch` or `RecruiterShortlist` referencing `jobId`!), logs `RECRUITER_JOB_DELETED`, clears `hubService` cache.
  5. Job Details (`/app/recruiter/jobs/:id`) -> `GET /api/recruiter-hub/jobs/:id`. Clicking **Generate Match Results** calls `POST /api/recruiter-hub/matches/generate` with `{ jobId }`, clears cache, and navigates to `/app/recruiter/matches?jobId=...`.

### 2.5 AI Candidate Matching (`/app/recruiter/matches`)
- **Status:** **Verified** (with **Defective** scoring breakdown keys and stack filtering pitfalls).
- **Flow:**
  1. `MatchesComponent.ngOnInit()` loads jobs (`GET /api/recruiter-hub/jobs`), top 24 candidates (`GET /api/recruiter-hub/candidates?limit=24&sortBy=score-desc`), and existing matches for the selected job (`GET /api/recruiter-hub/matches?jobId=...`).
  2. Clicking **Generate Matches** -> `POST /api/recruiter-hub/matches/generate` with `{ jobId, candidateIds? }`.
  3. `matchService.generateRecruiterMatches`:
     - Loads `Job.findOne({ _id: jobId, recruiterId, organizationId })`.
     - Calls `matchingService.listCandidates({ organizationId, stack: job.stack, limit: 300 })`.
       - **Defective:** `jobs.component.html` placeholder suggests `"React, TypeScript"` for `stack`, while developers have `"Frontend"`, `"Backend"`, `"Full Stack"`, `"AI/ML"`. `candidate.stack.includes(job.stack)` filters out all candidates when `job.stack` is comma-separated technologies.
     - Calls `matchCalculator.generateMatches({ job, candidates })` -> `aiRankingService.rankCandidates({ job, candidates })`:
       - Extracts 6 features via `featureExtractor.js` (**Defective:** returns `githubScore` instead of `github`, so `aiRankingService` reads `features['github'] === undefined` -> `0`).
       - Normalizes min-max across the candidate batch (`normalizeFeatureMatrix`).
       - Computes weighted score (`0.30*skillMatch + 0.20*projectQuality + 0.15*github + 0.15*experience + 0.10*consistency + 0.10*growth`).
       - Generates rule-based explanation via `explanationEngine.js`.
     - `normalizeMatchRecord` maps `scoreBreakdown` to `RecruiterMatch` fields (**Defective:** reads non-existent keys `skillCoverage`, `requiredSkillAlignment`, `githubSignal`, `projectImpact`, `growthTrajectory`, `experienceAlignment`, producing `0` for `skillMatchPercent` and `githubProjectScore` and `'Moderate'` for `experienceMatch`).
     - Upserts each match into `RecruiterMatch` (`{ recruiterId, organizationId, jobId, candidateId }`), checks `RecruiterShortlist`, hydrates `candidate` and `job` via N+1 queries (`hydrateMatches`).
  4. `matchController.generateMatches` writes `AuditLog` (`RECRUITER_MATCH_GENERATED`).
  5. UI updates `matches` and clears `RecruiterHubService` cache.
  6. Match status actions:
     - **Shortlist** -> `POST /api/recruiter-hub/shortlists` (creates/upserts `RecruiterShortlist` and updates `RecruiterMatch.status = 'shortlisted'`).
     - **Reject / Reset** -> `PATCH /api/recruiter-hub/matches/:id/status` (`{ status: 'rejected' | 'generated' }`) -> updates `RecruiterMatch` and logs `RECRUITER_MATCH_STATUS_UPDATED`.

### 2.6 Shortlists Pipeline (`/app/recruiter/shortlists`)
- **Status:** **Verified**.
- **Flow:**
  1. `ShortlistsComponent` -> `GET /api/recruiter-hub/shortlists` -> `shortlistService.listShortlists` queries `RecruiterShortlist.find({ recruiterId, organizationId }).sort({ updatedAt: -1 })` and hydrates `candidate` + `job` in an N+1 loop.
  2. **Advance** -> `PATCH /api/recruiter-hub/shortlists/:id` with `{ status: nextStatus }` (`shortlisted -> reviewing -> contacted -> interview`). Updates `RecruiterShortlist`, syncs linked `RecruiterMatch` status to `'shortlisted'` (or `'rejected'` if status is `'rejected'`), logs `AuditLog` (`RECRUITER_SHORTLIST_UPDATED`), reloads list, clears `hubService` cache.
  3. **Remove** -> `DELETE /api/recruiter-hub/shortlists/:id` -> deletes `RecruiterShortlist`, resets linked `RecruiterMatch` status back to `'generated'`, logs `AuditLog` (`RECRUITER_SHORTLIST_REMOVED`), reloads list, clears `hubService` cache.
  4. **Functional Gap:** Backend supports `notes` on `POST` and `PATCH` shortlist, and `ShortlistCardComponent` displays `item?.notes`, but no UI input/modal exists to edit shortlist notes.

### 2.7 Candidate Comparison (`/app/recruiter/comparison`)
- **Status:** **Verified**.
- **Flow:**
  1. `ComparisonComponent.ngOnInit()` reads `ids` (up to 3) and `jobId` from query params, loads top 24 candidates and recruiter's jobs, then triggers `loadComparison()` if `>= 2` IDs are selected.
  2. Calls `POST /api/recruiter-hub/comparison` (`{ candidateIds, jobId? }`).
  3. `comparisonService.compareCandidates` fetches `getRecruiterCandidateDetails` for up to 3 IDs. If `jobId` is provided, loads `getRecruiterJobDetails` and runs `matchCalculator.generateMatches({ job, candidates })` in memory (does **not** persist to `RecruiterMatch` or write domain `AuditLog`).
  4. Renders `app-comparison-table` highlighting best values per metric row.

### 2.8 Recruiter Analytics (`/app/recruiter/analytics`)
- **Status:** **Verified**.
- **Flow:**
  1. `RecruiterAnalyticsComponent` -> `RecruiterHubService.getAnalytics()` (cached with `shareReplay(1)`) -> `GET /api/recruiter-hub/analytics`.
  2. `recruiterAnalyticsController` -> `recruiterAnalyticsService.listRecruiterAnalytics(req)` (same aggregation engine used by Dashboard).
  3. Renders 6 KPI cards, Top Performing Jobs, Weekly/Monthly Snapshot, and 8 `app-recruiter-performance-chart` visualizations.

### 2.9 Activity Logs (`/app/recruiter/activity-logs`)
- **Status:** **Verified**.
- **Flow:**
  1. `RecruiterActivityLogsComponent` -> `GET /api/recruiter-hub/activity?action=...&candidateId=...&jobId=...&from=...&to=...`.
  2. `recruiterActivityService.listRecruiterActivities` queries `AuditLog.find({ actor: recruiterId, organizationId, ... }).sort({ timestamp: -1 }).limit(100..200)`, hydrates referenced `Job` and `Candidate` objects, and returns `{ logs, filters: { actions, jobs, candidates } }`.
  3. **Duplicate Log Behavior:** Because both `auditLogMiddleware` and Hub controllers write `AuditLog` records for mutations, every job/match/shortlist/profile mutation produces two timeline entries.

### 2.10 Recruiter Personal Details / Profile (`/app/recruiter/profile`)
- **Status:** **Verified**.
- **Flow:**
  1. `RecruiterProfileComponent` -> `GET /api/recruiter-hub/profile`.
  2. `recruiterProfileService.getRecruiterProfile` queries `User.findOne({ _id: recruiterId, organizationId, role: 'recruiter' })`, populates `organizationId`, and attaches `scope.teams`.
  3. Save -> `PATCH /api/recruiter-hub/profile`. `recruiterProfileService.updateRecruiterProfile` validates field lengths and `yearsOfExperience` (`0..50`), updates whitelisted fields on `User` (including `recruiterDetails` and `recruiterPreferences`), logs `AuditLog` (`RECRUITER_PROFILE_UPDATED`), and returns `{ profile }`.
  4. UI updates `AuthService.updateCurrentUser()` (`name`, `avatar`, `githubUsername`) and clears `RecruiterHubService` cache.

### 2.11 Recruiter Invitation & Onboarding Flow (`/invitations/accept/:token`)
- **Status:** **Verified** (with **Defective** team membership omission and onboarding redirect trap).
- **Flow:**
  1. Admin triggers `POST /api/admin/invite-recruiter` (`admin/controllers/recruiterController.js`) -> creates `Invitation` (7-day TTL) + sends email synchronously via `sendRecruiterInvitationEmail`.
  2. Invitee visits `/invitations/accept/:token` (`AcceptInvitationComponent`).
  3. Component sends `GET /api/auth/invite-details/:token` (`X-Skip-Auth: 1`).
  4. Submitting sends `POST /api/auth/accept-invite` (`authcontroller.acceptInvite`):
     - Creates or promotes `User` (`role: 'recruiter'`, `organizationId: invitation.organizationId`, `isPublic: false`, `isVerified: true`).
     - Marks `Invitation` `accepted`.
     - Upserts `Membership` with `{ organizationId, userId, teamId: null }` (**Defective:** ignores `invitation.teamId`, so invited recruiters are never added to their assigned `Team`).
     - Computes `profileCompleted` (`isRecruiterProfileComplete(user)`). If `false`, returns `redirectTo: '/app/profile?onboarding=recruiter'` (**Defective:** `AuthService.canAccessUrl` blocks `/app/profile` for `recruiter` role!).
  5. UI stores JWT + `user` in `localStorage`, updates `TenantContextService`, and navigates to `redirectTo`.

