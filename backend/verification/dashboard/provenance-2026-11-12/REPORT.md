# Approved Dashboard provenance acceptance — 2026-11-12

The approved optional server-owned AIVersion provenance is implemented. Local acceptance passes. Production acceptance remains **BLOCKED** by the previously documented absence of verified staging/test accounts, representative infrastructure/load/failover and live Prometheus evaluation. No production database was contacted; no migration, backfill, index, dependency, secret, deployment or Git publication was performed.

Source/current branch is `fix/dashboard`; integration target is not applicable. Preflight preserved all preceding Dashboard work. This report supersedes the preceding follow-up's history-approval blocker; earlier reports and screenshots remain historical evidence.

## Trust and comparison contract

The optional immutable nested schema has no default. Existing records are untouched. When present, all proof fields are required: fixed producer marker, resolved GitHub/profile/experience/selected-resume identity, scoring rule, source revision hash, assessment hash and actual calculation time. The enclosing AIVersion userId remains the owner. Hashes identify facts; they are not signatures and do not authenticate user-supplied records.

Only the authoritative server-resolved portfolio calculation calls the separate internal `createPortfolioVersion` writer. It hashes the resolved source facts and assessment; scoring formulas and effective weights are unchanged. Missing deterministic scores cannot acquire proof. Client-supplied previews remain unverified. The generic `createVersion` writer explicitly whitelists its existing fields and discards provenance even when a caller spreads it into the arguments. Public creation and rollback use this generic writer. Rollbacks do not copy trusted proof into a newly inserted version. There is no public update route; the schema also marks proof immutable.

New canonical caches save their assessment proof in the existing Mixed analysisData object. Cache hits reuse the original time and hash. Legacy caches without proof remain unverified, without assigning a new calculation time. Dashboard GETs do not write history or generate assessments.

History requires matching identity and both recorded/output scoring rules, valid source/assessment hashes and timestamps, and a numeric 0–100 score. Zero remains measured zero. Archive and assessment dates must be no later than the request snapshot. Repeated archive copies deduplicate by assessment hash. Two genuine comparable assessments enable the graph; equal measured scores yield a flat graph, not invented improvement. Different scopes, legacy records, forged public payloads and incomplete proof are excluded.

The existing owner/source/version index and latest-32 bound remain unchanged. Publicly created records can consume this window; sparse historical coverage is therefore explicitly an observation over the latest 32 versions, not a complete lifetime series. Existing best-effort archive behavior is unchanged: a failed archive write does not fail an otherwise successful scoring response and can leave a gap. No completeness guarantee or historical repair is claimed.

## Verification

| Gate                                                      | Result                                                                                                                                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend Dashboard and upstream regression suites          | PASS: 113 tests, 112 passed, one existing optional replica skip, zero failures                                                                                                     |
| Focused schema/authorization tests after final assertions | PASS: 3 tests covering optional legacy records, required proof, immutability, mass assignment, rollback and foreign ownership                                                      |
| Real local producer/API/Mongo                             | PASS: authoritative proof persisted; copied proof from public input ignored; cache hits deduplicate; two assessments visible from a second API process                             |
| Authenticated browser                                     | PASS: trusted history graph and exact two-row table, Light/Dark/System, 390px responsive view, keyboard and outage/mismatched-source states; zero page errors                      |
| Formatter write/check, JS syntax and whitespace           | PASS; explicit paths only                                                                                                                                                          |
| Frontend source/build baseline                            | No frontend source changed in this approval extension; preceding 633-test, TypeScript and production-build acceptance retained; existing Landing/Jobs style-budget warnings remain |
| External production acceptance                            | BLOCKED: see preserved environment audit in preceding follow-up; no verified authorized staging account/topology                                                                   |

Raw [local acceptance](local-acceptance.json) contains actual plans, pool observations, endpoint and browser checks. The final synthetic 30-request/concurrency-ten run measured p50 287 ms, p95/max 440 ms and 31.5 requests/second. Two page requests and 22 initial summary operations remain. Initial empty-history summary size was 10,577 bytes; this is not a measurement of the later graph-bearing response. Local sample timings vary and do not establish a production speedup or capacity guarantee.

The fixture stopped its native processes and removed 183 verified task-owned temporary database files. Final screenshots were retained and the mobile trusted graph was visually inspected. Exact modified/added files are in [file-inventory.json](file-inventory.json); no repository files were moved or deleted. Historical evidence was preserved. No disposable task scripts or logs remain.
Final post-cleanup/formatting rerun: 27 focused provenance, producer, consistency and Dashboard endpoint tests passed with no skips or failures. Syntax checks passed for all eight JavaScript files changed by this approval extension; working-tree and index whitespace validation passed.
