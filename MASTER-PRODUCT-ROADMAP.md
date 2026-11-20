# Master Product Roadmap

**Strategic Goal:** Stabilize multi-worker production correctness (P0), close the broken Developer ↔ Recruiter hiring & evidence loop on top of existing modules without duplication (P1), unlock collaborative team hiring & structured interviews (P2), and prepare commercial monetization & scale (P3).

---

## Priority Classification Framework

- **P0 — Critical Existing Defects & Production Blockers:** Multi-worker correctness, RBAC/navigation mismatches, misleading telemetry, and CI/test blockers.
- **P1 — Essential Workflow Completion & Data Consistency:** Connecting existing Developer & Recruiter modules, enabling team-scoped hiring, removing legacy dual surfaces, and eliminating memory-bound queries.
- **P2 — Valuable New Capabilities & Module Improvements:** Structured Interview Management, Candidate CRM/Notes, Enriched Developer Application Tracker, Verified Portfolio Evidence Badges, and Admin/Super-Admin UI consolidation.
- **P3 — Future Enhancements & Commercial Expansion:** Lightweight Offer Management, Stripe Subscription/Entitlements, and HRIS webhook handoff (Employee Onboarding explicitly rejected as out-of-scope).

---

## P0 — Critical Existing Defects & Production Blockers

| Item | Business Value | Technical Justification & Source Target | Dependencies | Complexity | Module Impact | Measurable Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **P0.1 Multi-Worker `PlatformSettings` Propagation** | Ensures emergency `maintenanceMode`, OTP/JWT rules, and role kill-switches take effect reliably across all API instances. | `platformSettingsService.js:359` (`getSettingsSnapshotSync()`) ignores `expiresAt` (`60s`) and `updateSettings()` only updates current process RAM. | Redis pub/sub (with 60s Mongo TTL fallback). | **Low** | `super-admin`, `backend/index.js`, `core/middleware` | `PUT /api/super-admin/settings` propagates to Worker B within ≤5s (via Redis pub/sub) or ≤60s (Mongo fallback) in 2-worker integration test. |
| **P0.2 Fix Recruiter `analyzeRecruiterCandidate` Honesty & Scoring** | Prevents recruiters from making hiring decisions on misleading `"AI"` labels and artificially penalized confidence scores. | `candidateService.js:213-234` returns hardcoded strings while UI labels it `"AI Candidate Assessment"`, and divides by 3 with `0` for `null` GitHub/Resume scores. | `AIService` (if AI-backed) or UI label alignment. | **Low** | `recruiter` (`candidateService.js`, `candidate-details.component.html`) | Non-null mean used for `confidenceScore` (0 `null`-as-`0` distortion); either backed by `AIService` with deterministic fallback & `aiUsed` flag OR relabeled `"Profile Fit Summary"`. |
| **P0.3 Fix Admin Sidebar vs `canAccessUrl` Mismatch & Refresh Bugs** | Stops Org Admins from hitting silent redirects on sidebar clicks and eliminates stale Admin tables after mutations. | `sidebar.component.ts:417-424` links `/app/integrations` & `/app/profile`, blocked by `auth.service.ts:583-585`; `AdminJobs`/`AdminTeams` drop same-page refreshes (`distinctUntilChanged`); `admin-dashboard` Chart.js `y1` error. | None. | **Low** | `core/layouts/sidebar`, `shared/services/auth.service.ts`, `features/admin` | 0 blocked sidebar links for `admin`; `AdminJobs`/`AdminTeams` refresh after edit; 0 console errors on `/app/admin/dashboard` in Playwright. |
| **P0.4 Fix Redis Reconnect Blast, Unbounded Maps & Worker Shutdowns** | Prevents OOM leaks, cross-worker OAuth replay, and cluster-wide interview cache flushes on reconnect. | `redisCacheService.js:173` resets `interview:revision:global` on reconnect; `githubservice.memoryAnalysisCache`, `recommendationMemoryCache`, `adminConsoleService.performanceCache`, `loginAttemptStore` are unbounded; `index.js:305` omits 6 worker `stop()` hooks. | Redis (for shared rate-limit/OAuth state optional upgrade). | **Medium** | `core/cache`, `core/middleware`, `github`, `recommendations`, `admin`, `backend/index.js` | Bounded LRU caps (`<=500`) on all process Maps; `performanceCache` invalidated or moved to Redis; 0 global `interview:revision:global` reset on worker reconnect; clean SIGTERM exit in <5s. |
| **P0.5 Production Ops Rollout & CI Baseline Closure** | Enables clean green CI/CD and verified staging/production deployment readiness. | Run `ensureRecruiterIndexes.js --apply` & `repairRecruiterLegacyRecords.js --apply` on staging/prod DB; resolve `interviewPrepFinalization` timeout mismatch (`6500ms` vs `20000ms`), `newsConfiguration` local `.env` duplicate block, and `4.07 MB` initial bundle budget (lazy-load developer routes). | Staging Mongo/Redis & Upstash env access. | **Low–Medium** | `recruiter` scripts, `interview-prep` test, `frontend/app.routes.ts` | `ensureRecruiterIndexes --explain` 0 `COLLSCAN`; `ng build` initial bundle `< 4.00 MB` with 0 warnings; full backend suite 0 unexpected failures in isolated CI. |

---

## P1 — Essential Workflow Completion & Data Consistency

| Item | Business Value | Technical Justification | Dependencies | Complexity | Module Impact | Measurable Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **P1.1 Internal Job Discovery & Direct Developer Application** | Closes the #1 platform gap: converts passive talent matching into a two-sided hiring marketplace between Developers and Recruiters. | `modules/jobs` only serves external `JobCache` feeds with boolean `UserJobAction`; `modules/recruiter/models/Job` has zero Developer visibility or inbound `JobApplication` model. | `recruiter/Job`, `jobs`, `resume`, `public-portfolio`, `notifications`. | **High** | `jobs`, `recruiter`, `notifications`, `developer/pages/jobs`, `recruiter/pages/job-details` | Developers see open org `Job`s on `/app/jobs`, submit 1-click application locking `ResumeFile` + `PublicProfile` snapshot; Recruiters see applicants in `JobDetails`/`Matches` with real-time SSE notification. |
| **P1.2 Team-Shared Recruiter Collaboration Scope** | Lets multi-recruiter hiring teams (`Membership` + `Team`) co-manage requisitions, matches, and shortlists instead of working in isolated silos. | `Job`, `RecruiterMatch`, and `RecruiterShortlist` store `teamId` and validate `Membership`, yet all Hub services filter strictly by creator `recruiterId`. | `admin/Membership`, `admin/Team`, `recruiterAccess.js`. | **Medium** | `recruiter` (`recruiterJobService`, `matchService`, `shortlistService`, `recruiterAnalyticsService`) | Peer recruiters in the same `Team` can view/collaborate on team-scoped jobs & shortlists; non-team/cross-org access returns `403`/`404` in multi-tenant tests. |
| **P1.3 Recruiter Server-Side Pagination & Aggregation** | Prevents candidate truncation at 240 (analytics) / 1000 (discovery) as the developer pool scales to 10k+ users. | `recruiterAnalyticsService.js:165` caps at `limit: 240`; `candidateService.js` loads up to `1000` users into Node memory before sorting/filtering. | Compound indexes on `User`, `Analysis`, `ResumeAnalysis`. | **Medium** | `recruiter` (`matchingService`, `candidateService`, `recruiterAnalyticsService`) | MongoDB aggregation handles filtering/sorting/counts with `0` `COLLSCAN` and p95 < 150ms on a 5,000-candidate test pool. |
| **P1.4 Hydrate Shortlist Status/Notes on Candidate Details & Clear `RecruiterHubService` Cache** | Eliminates stale cross-account state and gives recruiters immediate pipeline context on candidate profiles. | `candidateService.js:186-187` hardcodes `shortlistStatus: null, recruiterNotes: ''`; `RecruiterHubService` lacks logout/account-switch clearing if `shareReplay` is re-added. | None. | **Low** | `recruiter` (`candidateService`, `candidate-details`, `recruiter-hub.service`) | Candidate Details displays live shortlist stage & notes; switching recruiter accounts leaves zero cross-user UI artifacts. |
| **P1.5 Retire Legacy `/api/recruiter/*` & Duplicate Admin Surfaces** | Cuts maintenance surface and removes dead code (`stats.js`, empty `src/services/` & `src/jobSources/`). | Dual `/api/recruiter` + `/api/recruiter-hub`, `Candidate.js`/`Recruiter.js`, `ApiService` legacy methods, and overlapping Admin routes increase debt. | Confirm zero external API consumers on `/api/recruiter/*`. | **Medium** | `recruiter`, `admin`, `shared/services/api.service.ts` | Legacy endpoints deprecated/removed; all 22+ modules maintain 100% test pass rate with zero dead compatibility models. |

---

## P2 — Valuable New Capabilities & Module Improvements

| Item | Business Value | Technical Justification | Dependencies | Complexity | Module Impact | Measurable Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **P2.1 Structured Interview Management (Scheduling + Scorecards)** | Completes the core hiring funnel after shortlisting, turning `'interview'` from a static label into actionable scheduling & calibrated feedback. | `RecruiterShortlist` stops at `'interview'` string status; `modules/interview-prep` is self-practice only. | P1.1 (`JobApplication`), P1.2 (Team access), `notifications`, `core/messaging`. | **High** | New `Interview` model/routes inside `recruiter`, Developer interview invite view, `notifications` | Recruiters schedule rounds with panelists, collect structured 1–5 rubrics + hire/no-hire recommendation; candidates receive email + SSE invite and can confirm/reschedule. |
| **P2.2 Candidate CRM Extensions & Kanban Hiring Pipeline** | Increases recruiter retention by supporting multi-note history, custom tags, non-job talent pools, and visual stage progression. | `RecruiterShortlist` currently holds only a single flat `notes: String` tied to a single `jobId?`. | P1.2 (Team collaboration). | **Medium** | `recruiter` (`shortlists`, `candidates`, `candidate-details`) | Recruiters can log timestamped notes, `@mention` teammates, tag candidates, and drag/move candidates across pipeline stages with full `AuditLog` trail. |
| **P2.3 Enriched Developer Application Tracker** | Gives developers a single workspace to track both direct DPA applications and external job applications (status, resume used, follow-up dates). | `jobs.component.ts` `'Application tracker'` tab currently toggles only boolean `UserJobAction.applied`. | P1.1 (`JobApplication`). | **Medium** | `jobs`, `developer/pages/jobs`, `notifications` | External & internal applications show unified status timeline (`saved → applied → screening → interview → offer/closed`), attached resume version, and reminders. |
| **P2.4 Verified Portfolio Evidence Badges (`PublicProfile` Extension)** | Differentiates DPA portfolios from generic linktrees by cryptographically/platform-verifying developer claims for recruiters. | `PublicProfile`, `Analysis`, `ResumeAnalysis`, `IntegrationInsight`, and `CareerSprint` already hold the underlying evidence. | None (uses existing provenance hashes). | **Low–Medium** | `public-portfolio`, `developer/pages/portfolio-settings`, `recruiter/candidate-details` | Opt-in verified badges (`GitHub Verified`, `Skill Gap Tier`, `Sprint Streak`) render on `/p/:slug` and `CandidateDetails` with evidence timestamp & `0` unverified fabrication. |
| **P2.5 Consolidate Admin & Super-Admin Workspaces** | Eliminates role confusion and brings Admin/Super-Admin UI quality up to Developer & Recruiter standards. | Admin splits `/app/admin/dashboard` vs `/app/admin/console`; Super Admin splits `/super-admin/*` vs `/app/settings/*`. | P0.3. | **Medium** | `features/admin`, `features/super-admin`, `core/layouts/sidebar` | Single unified Org Admin console nav and single Super Admin workspace shell passing WCAG AA + responsive Playwright matrix (`1440/768/390/320`). |

---

## P3 — Future Enhancements & Commercial Expansion

| Item | Business Value | Technical Justification | Dependencies | Complexity | Module Impact | Measurable Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **P3.1 Lightweight Offer Management** | Closes the final step of the hiring funnel (offer letter, compensation terms, candidate acceptance) inside DPA. | No offer schema exists today; depends on completed Interview & Application stages. | P1.1, P2.1, `pdfkit`, `notifications`. | **Medium–High** | `recruiter` (`Offer` model/UI), `developer` offer response view | Recruiters issue structured offer + generated PDF; candidate accepts/declines in-app; `Job` headcount/status updates atomically on acceptance. |
| **P3.2 Stripe Subscription, Plans & Entitlements** | Monetizes recruiter seats, active job slots, and AI evaluation quotas for B2B organizations. | Zero billing/plan infrastructure exists today (only `SupportTicket.category = 'billing_issue'`). | `Organization`, `PlatformSettings`, `core/middleware`. | **High** | New lean `billing` module, `admin`, `super-admin` | Stripe Checkout + idempotent webhook updates `Organization.plan`; middleware enforces seat/job/AI entitlements with clear upgrade prompts. |
| **P3.3 Outbound HRIS Webhook on Hire (Instead of Employee Onboarding)** | Satisfies post-hire handoff without turning DPA into a compliance/payroll HRIS. | Employee Onboarding is rejected as out-of-scope for a portfolio & hiring platform. | P3.1. | **Low** | `recruiter`, `integrations` | Signed webhook (`HMAC-SHA256`) + JSON export emits hired candidate profile & offer summary to customer HRIS endpoints. |

---

## Recommended Execution Sequence

```text
Phase 1 (P0 Stabilization)
  └─▶ Multi-worker PlatformSettings sync + Recruiter confidence/AI honesty + Admin nav/refresh fixes
      + Bounded caches & worker shutdowns + DB index/repair rollout + Angular lazy-loading (<4 MB)

Phase 2 (P1 Marketplace & Team Core)
  └─▶ Internal Job Discovery & 1-Click Application (Bridges Developer Jobs ↔ Recruiter Jobs)
      + Team-Shared Recruiter Scope (Activates existing Team & Membership models)
      + MongoDB Aggregation Pagination + Legacy Route Retirement

Phase 3 (P2 Hiring Suite & Portfolio Differentiation)
  └─▶ Interview Management (Scheduling + Scorecards) + Kanban CRM Notes/Tags
      + Enriched Developer Application Tracker + Verified Portfolio Badges + Admin/SA Shell Consolidation

Phase 4 (P3 Commercialization)
  └─▶ Offer Management + Stripe Billing & Entitlements + Outbound HRIS Hire Webhook
```

