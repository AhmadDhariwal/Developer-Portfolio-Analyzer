# Personal Developer Dashboard

The `/app/dashboard` feature reads persisted evidence. It does not refresh providers,
generate AI analysis, persist GitHub data, or produce notifications during GET requests.
Recruiter, administrator and team dashboards are separate features.

## Request lifecycle

The page requests `/api/dashboard/summary`, then integration analytics. Contribution and
language charts are carried in the validated summary; their standalone endpoints remain
compatible. Skill coverage and recommendation previews come from the summary, avoiding a
fifth skills request that could overwrite the summary's dimensions. All six existing
routes remain available and JWT-protected. Responses use `Cache-Control: private, no-cache`.
The summary accepts strong, weak, list and wildcard `If-None-Match` validators.
An unchanged summary can return 304, but its evidence is still read before validation.

There is no backend summary TTL cache. The former map was never populated and has been
removed. `invalidateDashboardSummaryCache` remains an exported compatibility hook for
upstream writers. Durable reads avoid a process-local invalidation dependency between API
replicas. Redis was not introduced for Dashboard.

The page validates its summary on every entry and refresh. Secondary reads also bypass
local cached values after that validation. The existing cache adapter uses a 60-second
Dashboard TTL for explicit cache reads. Request cycles cancel superseded HTTP subscriptions
and destruction cancels pending work; rejected storage writes do not hide fetched data.
There is no promise of push updates while the page is left open: refresh or re-enter it to
observe external writes.

## Evidence ownership

| Owner | Dashboard read |
| --- | --- |
| GitHub Analyzer | Latest owned `Analysis`; reject an explicitly mismatched stored username |
| Resume Analyzer | `developerContext.resolveResumeAnalysis`: selected owned file and its analysis |
| Skill Gap | `skillGapCacheContract` owner/profile/resume/version/policy/retention scope |
| Recommendations / portfolio scoring | Owned `AnalysisCache`, active username, career stack, experience and selected resume identity |
| Career Sprint | Latest owned tasks; use authoritative point-weighted `sprintProgressScore` |
| Integrations | Owned persisted insight, connected-provider metadata and bounded-date sync history |
| Job Hub | Shared current, non-hidden, unexpired and still-valid job snapshot |
| Tech News | Shared canonical `news:v3:public:pool`, using the existing unique cache-key index |
| Learning Hub | Owned unique course-progress records; tracking and completions remain user-entered/self-reported |
| Weekly Reports | Latest owned report; freshness uses persistence time before reporting-period end |
| Notifications | Dashboard GETs do not write alerts; existing historical notifications and event producers remain owned by Notifications |

Dashboard now uses its own source-content revision instead of invoking the broad developer-signal aggregator. Two equal, scoped reads validate the snapshot; one retry pair is permitted, then continuing changes return retryable HTTP 409. This is bounded optimistic validation, not a distributed transaction. The canonical shared dependency hash is not overwritten by a Dashboard-owned revision. Cache, Learning and Integration aggregations have bounded output state and a 1.5-second Mongo execution budget. Core source budget failures and Integration budget failures return 503 instead of partial counts.

## Scoring and presentation

Career-stack weights and the existing 85/15 positive-integration blend are unchanged.
An explicit zero portfolio score is valid; it no longer falls through to an unrelated
positive score. Legacy `Analysis.readinessScore` defaults to zero before scoring, so its
existing GitHub fallback remains for compatibility.

Readiness Center no longer invents interview scores from session counts/sprint completion
or a market bonus from the presence of a job. It presents stored interview readiness and
canonical target-skill coverage. Missing dimensions remain unavailable. Sprint progress
uses the owning module's weighted, duplicate-aware rule. Learning Progress shows existing
reliable counts; it does not infer course verification or proficiency.

The expired-cache monthly comparison is removed. Durable portfolio history requires server-owned source provenance, selected-resume identity, scoring rule and distinct assessment identity/time. User-authored AI archives and legacy metadata cannot establish this proof. The typed reader/graph has explicit missing/unavailable states; the optional server-provenance schema and producer extension await approval under AGENTS.md. No retention migration or backfill is performed. Weekly Report scores are not substituted for portfolio scores.

Developer Progress now adds recorded UTC Sprint velocity, evidence completeness, canonical skill classification and owned integration connectivity. Learning Progress adds up to five recorded completed course titles/dates. Recorded effective scoring weights are used when inputs were renormalized; nominal weights remain unchanged. Missing evidence remains null, and verified GitHub-only fallback is labeled. The normal portfolio producer uses the same selected-resume cache identity as Dashboard; client-provided preview inputs remain separate.

Charts have text alternatives, theme-aware colors and reduced-motion support. Dashboard
surfaces use shared theme tokens and respond to Light, Dark and System preference changes.
Unsupported developer percentiles and synthetic stat growth arrows were removed. Source
availability is labeled as availability rather than calibrated confidence.

## Implementation and verification

- Backend: `backend/src/controllers/dashboardcontroller.js`, `backend/src/routes/dashboard.routes.js`, `backend/src/services/dashboardMetricsService.js`.
- Frontend: `frontend/src/app/pages/dashboard/`, including the feature-local Learning Progress component.
- Contracts: `backend/src/tests/dashboardEndpoints.test.js`, `backend/src/tests/dashboardMetrics.test.js`, Dashboard frontend specs and existing Skill Gap consumer tests.
- Local acceptance: `backend/src/scripts/verifyDashboardLocal.js`. It never loads `.env`; it creates a new disposable loopback replica set, two API processes and synthetic accounts. Set `DASHBOARD_PLAYWRIGHT_MODULE` to an existing installed Playwright package to include Chrome checks.
- Results and release blockers: `backend/verification/dashboard/REPORT.md` and `backend/verification/dashboard/followup-2026-11-12/`.

Do not equate fixture success with production acceptance. Approved staging identity,
representative data/load, query plans, failover, pool pressure and production topology still
require verification before a production-ready claim.
