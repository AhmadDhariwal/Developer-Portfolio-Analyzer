# GitHub live data final acceptance

Date: 1 November 2026 (Asia/Karachi).

**LOCAL VERIFICATION COMPLETE — FULL FRESH LIVE ACCEPTANCE PENDING.** At the user's request, finish local verification and defer the remaining live acceptance until valid GitHub credentials and sufficient quota are available. Passed direct captures and explicitly labeled source-replay comparisons remain retained evidence; they do not close the fresh live-acceptance gate. Production credentials and deployment-equivalent infrastructure gates remain pending. No production data, secrets, scoring weights, routes, dependencies or database schemas were changed.

## Source and authorization

Authorized checkout: `fix/github`. The initial index already contained the previous GitHub implementation; it was preserved. `task/notifications` exists and its Notifications UI and centralized service matched the current checkout before extraction. PR target: not applicable. No commit, push, merge or deployment was performed.

Read AGENTS.md, DEVINSIGHT_AI_SOLUTION_ARCHITECTURE_CHARTER.md and its ADRs, the previous GitHub implementation/UI reports and Notifications production finalization. The plan covered source characterization, baseline capture, component extraction, evidence corrections, regressions, explicit-path formatting, cleanup and final verification.

## Real observations versus replay and mocks

The verifier starts a disposable loopback Mongo replica set and mounts the actual Express GitHub routes, authentication, controllers, service, cache models and notification transaction. It never connects to the existing application's database. Public GitHub responses were obtained through real read-only HTTP. Safe source bodies, response dates, rate-limit metadata and collection timestamps are retained in each `*-source.json` file. Headers containing credentials are never recorded.

Initial direct application runs collected an empty profile, octocat and a large paginated profile. The invalid configured token returned 401; the public fallback initially exhausted its quota, then succeeded after the reset. Further correctness iterations reused those exact public response bodies through an explicitly labeled source-replay transport and exercised the real application pipeline and live Gemini provider. Replay eligibility uses the original source collection timestamp, with a one-hour bound; a replay's calculation/cache timestamp does not claim a new provider observation.

`live-accuracy-results.json` distinguishes each response origin and contains **2,113 field comparisons** across the three profiles. Original direct responses are retained as `*-initial-analysis.json`; current-code responses are `*-analysis.json`. These are source-snapshot acceptance results, not a claim that every external field was retrieved simultaneously or is still current at a later date.

| Profile     | Coverage                                        | Public repositories | Final score | Original source collection (UTC) |
| ----------- | ----------------------------------------------- | ------------------: | ----------: | -------------------------------- |
| HydronChain | Empty public profile, one empty repository page |                   0 |           0 | 2026-11-01 11:56                 |
| octocat     | Small profile, one page                         |                   8 |          38 | 2026-11-01 11:56                 |
| yyx990803   | Large profile, pages of 100 and 98              |                 198 |          62 | 2026-11-01 12:02                 |

The source times above correspond to 4:56 PM and 5:02 PM Pakistan time. Exact timestamps and source response dates are in the JSON evidence; the later canonical README captures are retained separately.

## Correctness findings and fixes

1. **README discovery:** Hello-World has an extensionless `README`. The previous fixed `README.md` request returned 404 and treated documentation as absent. The service now makes one bounded fallback to GitHub's repository README endpoint after that specific 404. `canonical-readme-source.json` records real 200 responses for Hello-World (`README`) and Spoon-Knife (`README.md`). This follows the [GitHub repository contents API](https://docs.github.com/en/rest/repos/contents#get-a-repository-readme). The inspected repository limit remains two, with at most one additional request per sampled repository. octocat's corrected evidence changes its score from 37 to 38 under the unchanged formula.
2. **Narrative evidence:** A real Gemini response inferred personal proficiency, original contributions and ownership from forked code and metadata. Forks are now excluded from the model's repository context and deterministic recruiter project examples. Qualitative acceptance rejects capability/ownership/adoption inferences, excluded repository references, model-generated numerical quantities, unsupported absence assertions and interview prompts that presume uninspected implementation. Rejected fields independently use deterministic fallback. AI never owns scores or evidence.
3. **Unavailable activity:** Unsampled or inaccessible repository-quality commit counts remain `null`, while the scoring calculation retains its established zero fallback internally. The frontend activity type now accepts the existing nullable API value. A legacy audit record without active-repository facts uses the actual sampled count rather than fabricating five repositories.
4. **Freshness compatibility:** `github-normalized-v2` identifies corrected extraction/qualitative semantics. `github-v2` and `github-health-score-v1` remain unchanged. Older cache documents/history are preserved, not relabeled or destructively migrated.

## Source-to-output scope

The retained comparisons cover profile identity/followers, public repository count and pagination, deduplicated names, stars/forks, primary-language null-to-Unknown display normalization, fork/archive flags, sizes, normalized push/update/create dates, sampled README state, aggregate language bytes, contributor sums, original/fork scoring facts, score reproduction and downstream score parity.

The six pillar weights remain Code Quality 24%, Diversity 17%, Contribution 18%, Consistency 13%, Impact 14% and Profile Strength 14%. The aggregate is reproduced from the exact recorded inputs with the existing score engine; scoring-foundation regressions independently preserve the locked formula. Heuristic repository quality is not a claim that source code correctness or engineering ability was verified.

Coverage limits remain explicit:

- Activity samples at most five original, nonarchived repositories and at most the first 100 contributors per repository. It sums repository contributor history across authors; it is neither verified personal commits nor a lifetime/12-month personal contribution total.
- Language bytes sample at most eight repositories. Primary-language fallback and missing byte data remain distinct from measured zero.
- README/manifests inspect at most two original, nonarchived repositories, with existing size/deadline limits. A missing manifest or unavailable sample does not prove absence across the portfolio.
- Forks remain visible in the repository inventory and public totals, while original-work scoring/activity/technology confidence excludes them. Per-profile exclusion records are retained.
- Source date, calculation date, cache date, sampled evidence, nulls, zero, stale and rate-limited states are separate concepts. Mocks verify failure/SWR branches; direct provider failures and real AI success/fallback were also observed.

A synthetic user verifies that public preview leaves identity/Repository/Analysis untouched, a mismatched save is rejected, and authenticated canonical save persists the same authoritative score and repository count. All writes and notifications in this check target disposable records only.

## Verification and deployment gates

Final local test/build/format results are retained in `final-backend-tests.txt`, `../../../frontend/verification/component-parity/final-frontend-tests.txt`, `final-build.txt` in that same frontend evidence directory, and the two component reports. Disposable two-worker notification results are separate from mocked GitHub lock tests. No deployment-equivalent shared Redis, production topology/index audit, soak or cross-browser acceptance is implied.

The configured GitHub token is still rejected. Replace it locally through the normal secret-management process before deployment and repeat an entirely fresh three-profile run with adequate quota. The captured public observations and current-code replay have passed, but they do not certify production credentials. Shared Redis/SWR fleet verification and existing Notifications rollout/retention approval gates remain pending. No retention policy was activated in the existing application.

## Exact inventory and cleanup

The complete changed-source inventory is retained in the two frontend reports and `../../../frontend/verification/component-parity/format-manifest.json`. Exact task-owned deletions are in `cleanup-manifest.json` beside that manifest. Only temporary copies, extraction helpers and superseded diagnostic crops were removed; original source, historical reports, final screenshots and public evidence remain.

- [backend/src/prompts/githubPrompt.js](D:/Developer-Portfolio-Analyzer/backend/src/prompts/githubPrompt.js)
- [backend/src/scripts/verifyGitHubLiveAccuracy.js](D:/Developer-Portfolio-Analyzer/backend/src/scripts/verifyGitHubLiveAccuracy.js)
- [backend/src/scripts/verifyNotificationsBrowser.js](D:/Developer-Portfolio-Analyzer/backend/src/scripts/verifyNotificationsBrowser.js)
- [backend/src/services/githubservice.js](D:/Developer-Portfolio-Analyzer/backend/src/services/githubservice.js)
- [backend/src/tests/githubAnalyzerHardening.test.js](D:/Developer-Portfolio-Analyzer/backend/src/tests/githubAnalyzerHardening.test.js)
- [backend/src/tests/notificationsProduction.test.js](D:/Developer-Portfolio-Analyzer/backend/src/tests/notificationsProduction.test.js)
- [backend/src/tests/notificationsRetention.test.js](D:/Developer-Portfolio-Analyzer/backend/src/tests/notificationsRetention.test.js)

## Final check results

- Backend and downstream/disposable integration checks: **121 passed, zero failed or skipped**.
- Frontend: **488 tests, 85 files passed**.
- Application TypeScript, production build, backend JavaScript syntax, explicit-path Prettier checks, and staged/unstaged Git whitespace checks: **passed**.
- Build: **3.72 MB initial**; only the existing landing-page stylesheet budget warning.
- Cleanup: **816 verified task-owned temporary files removed**, with exact absolute paths retained in the cleanup manifest. No tracked source deletion or file move.
