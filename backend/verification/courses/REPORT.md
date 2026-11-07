# Learning Hub backend finalization

STATUS: VERIFIED

Date: 2026-10-14

## EXISTING BACKEND AUDIT

Read `AGENTS.md`, `docs/LEARNING_HUB_ARCHITECTURE.md`, `docs/features/courses.md`, actual backend/frontend contracts, provider/ranking code, cache/index migration code, the existing Courses tests and the verified Recommendations/Sprint handoff boundaries. Git status was clean before this task. Earlier Recommendations code and historical verification evidence were preserved.

The architecture describes the baseline accurately, including its obsolete `v6-skill-intelligence` lookup, 24-hour client cache, 3/3/2/2 platform blending, YouTube-derived ratings, static 27-course inventory, and absence of durable owned course progress. The current Skill Gap producer uses storage version `v8-skill-evidence-coverage` and authoritative rule `skill-evidence-coverage-v1`.

Defects found:

- Legacy missingSkills/yourSkills projections were used without active GitHub/resume or source-reference compatibility.
- A 30-second signal cache and a 24-hour client response cache could conceal changed evidence. Pool fingerprints truncated target lists and lacked source revisions.
- YouTube engagement was returned as review ratings, and likes as review counts. Missing metadata became zero or fabricated defaults; unverified historical catalog values were displayed as current provider facts.
- Platform quotas reordered relevance-ranked results. A YouTube-only outage silently returned courses from different platforms. Missing duration could pass the short-course filter.
- Topic substring matching could confuse Java with JavaScript and C with C++/C#. Duplicate identity depended on both URL and title rather than canonical resource identity.
- Redis/Mongo read failures could abort useful fallback responses. Provider failures swallowed by `Promise.allSettled` could avoid the circuit-breaker failure count. Concurrent provider queries were not shared across user-specific pools.
- Course progress and explicit course-to-Sprint actions had no owned persistence or API.

Scope is Learning Hub backend plus the necessary Courses client request-cache adapter and its tests. No frontend page, card, filter UI, shared theme, scoring engine, GitHub/Resume/Skill Gap/Recommendations engine, Sprint service/model, or public portfolio implementation was modified.

## SKILL GAP COMPATIBILITY

`coursePersonalizationService` uses canonical active career stack/experience and GitHub identity from the authenticated user's current context. It resolves the selected owned resume through `developerContextService`, never borrowing a historical analysis for an unanalyzed selection.

Fresh source reads precede pool-cache reuse. Current-rule snapshots must match user, username (case-insensitive), stack, experience, resume hash/analysis identity, source IDs, timestamps, rule versions and freshness. Compatibility reuses the existing pure Recommendations compatibility/source helpers without changing them; future-dated or unrecorded available-source clocks are rejected as well. The storage tag alone is not an evidence contract.

All five classifications remain distinct: DEMONSTRATED, PARTIAL, CLAIMED_ONLY, NOT_EVIDENCED and UNKNOWN. Required non-demonstrated targets precede optional targets; demonstrated skills are retained as context. Neither missing proof nor a resume/profile claim is labeled inability or verified proficiency. No old readiness or coverage scores enter course ranking.

Unavailable, legacy, temporary, expired or mismatched evidence yields `personalization.status = career-context-only` and an explicit limitation. Results still use the career context and explicit search/filters. The evidence fingerprint includes current source identity, profile revision and snapshot skill/status/requirement content, so changes invalidate all pool tiers immediately on the next request.

Spelling aliases are normalized with a focused map. Java/JavaScript, C/C++/C#, C#/.NET, SQL/PostgreSQL and React/React Native remain distinct. No new equivalence was added to locked skill engines.

## RANKING AND METADATA ACCURACY

The existing numerical weights are retained: relevance baseline 25; target match +18, known context +4, career alignment +10, explicit topic +14, level fit +12/+6, and the existing valid-duration adjustments. Existing final-score formulas remain 0.38 rating / 0.28 popularity / 0.34 relevance when genuine ratings exist, otherwise 0.45 popularity / 0.55 relevance. Missing public metadata remains null; neutral internal ranking arithmetic does not create public zero metadata.

Ranking now orders actual required-target matches, target matches and career-topic alignment before the existing score, with stable ID tie-breaking. Career alignment uses named topic mappings rather than requiring literal words such as Backend in every course title. Explanations list actual matched targets/topics and experience/filter signals. They make no competence or outcome guarantees.

The fixed 3 Udemy / 3 YouTube / 2 Coursera / 2 Other reordering was removed, as announced during implementation. No replacement platform weights were invented. A JavaScript regression fixture compares the entire All-platform inventory with the deterministic ranking, including page boundaries. For example, a relevant Coursera/edX item can lead the result instead of being placed behind three Udemy entries solely to satisfy quotas. A required SQL target also precedes a popular optional React course; career-only Frontend results prioritize actual frontend topics over unrelated beginner subjects.

Canonical provider resource URLs deduplicate results independently of titles and tracking parameters, including equivalent YouTube watch/short links. Filtering precedes pagination. Explicit YouTube filtering stays YouTube-only and returns an explained empty result on outage; All can show curated alternatives.

YouTube now returns `rating: null` and `reviewCount: null`, with separate `engagementScore`, `viewCount` and `likeCount`. Its retrieved duration and channel name retain YouTube API provenance. Unknown course level stays null rather than claiming All Levels. Derived popularity/engagement have explicit provenance labels. Genuine provider review numbers remain supported separately. The old calcYouTubeRating helper export is retained as a compatibility alias for the explicitly named engagement helper; its output is never assigned to the public rating field.

All 27 historical curated records were extracted into `data/courseCatalog.js` and verified byte-for-value against the original array. Their historical ratings, popularity and duration remain in that source record, but unverified values are not advertised as current provider reviews or duration: public rating/reviewCount/popularity/duration fields are null. Catalog provenance and unverified availability are explicit. Existing recorded titles, descriptions, topics, levels, instructor names and links remain attributed to the curated catalog. No pricing, certificate availability, proficiency, duration, instructor or provider availability was invented.

HTTPS URLs must use the expected provider host, without credentials, alternate ports, whitespace or backslashes. Thumbnail hosts are restricted. Cached Mixed documents are converted to bounded public DTOs; private/unrecognized fields are excluded. Link syntax/provenance is validated; an external provider's current enrollment availability is not guaranteed.

## PROVIDER/CACHE BEHAVIOR

No LLM call was introduced into GET /api/courses. The existing AI-service facade is used only for shared cache access.

- Provider queries share pending requests, cache successful YouTube results for six hours, and use failure caching plus the existing three-error/30-minute breaker. Search authentication/quota failures count toward the breaker, safe messages omit raw provider exceptions/keys, and cooldown recovery is tested. Explicit refresh bypasses provider-result cache while honoring the breaker.
- User-specific pool keys include all ranked target/known-skill inputs, filter identity, evidence fingerprint, version and an opaque provider-configuration fingerprint. Page/limit slice the full filtered pool and do not fragment it. User ownership partitions memory, Redis and Mongo keys/documents.
- Pool version is `courses_pool_v6_evidence`, isolating legacy results. Memory is bounded to 80 entries with the configured 60-second default; degraded fallback has a 15-second memory TTL. Redis retains its 120 ms lookup budget and 15-minute default TTL. Pool freshness is checked independently against six hours, or 60 seconds for degraded fallback, before reuse. Promotion does not reset source age.
- Redis and pool-Mongo read failures fall through to deterministic catalog building. If current evidence cannot be checked, personalization is explicitly limited rather than borrowed from old evidence. Empty or unsafe pools are not persisted.
- Identical requests share one pool build and one asynchronous persistence sequence. Legacy cache documents and unrelated indexes are preserved; expiry/variant pruning applies only to the new course-pool namespace. Progress records are durable and have no TTL.
- The strictly necessary Courses client adapter now shares only pending HTTP requests, evicts settled/error requests and contacts the backend on later reads. A retained 24-hour fulfilled response could not detect source changes made elsewhere. HTTP responses also use private/no-store. No frontend UI or progress/action controls were implemented.

Controlled performance probe, including a 25 ms fresh-context fixture read:

| Path       | p50       | p95       | Existing threshold                          |
| ---------- | --------- | --------- | ------------------------------------------- |
| Memory     | 31.14 ms  | 32.32 ms  | <50 ms                                      |
| Redis warm | 47.05 ms  | 48.00 ms  | <250 ms                                     |
| Cold       | 156.63 ms | 172.15 ms | <500 ms and unchanged historical comparison |

Five identical callers produced one build, one provider call, one Mongo write and one Redis write. `performance.json` retains the exact controlled probe and the script's historical comparison values; those historical values are not presented as a fresh pre-change production measurement.

## COURSE PROGRESS IMPLEMENTATION

`UserCourseProgress` has a unique `(userId, courseId)` identity and an indexed owned status list. Mutations accept only status, bounded plain-text notes and optional explicit numeric progress from 0 to 100 (or null). Course metadata, ownership, points, certificates and arbitrary URLs cannot be supplied by the client. New identities resolve from the server catalog or an owned recent returned pool; previously saved snapshots remain readable for history.

Supported states are `saved` (Save for Later), `in_progress` and `completed`. Progress percentages are user-entered and remain null unless supplied; marking Completed does not invent 100% watching progress. Completion is explicitly self-reported, preserves its timestamp on an identical repeat, and does not write skills, Skill Gap coverage, certificates or public portfolio data. Notes are limited to 2,000 characters. Lists are bounded to at most 50 records per page. Repeated updates are upserts with unique-index race recovery; repeated removal returns 204.

## CAREER SPRINT HANDOFF

A course must first be in the caller's owned My Learning collection. Target skill must match a recorded course topic. Completed courses return 409 rather than creating new study work. Unknown/foreign identities return 404; malformed identities or payloads return 400.

The adapter reuses the verified owned atomic-insertion pattern plus existing getCurrentSprint/invalidateCareerSprintCache boundaries. It creates a manual learning task and omits points, priority and dates so the existing Sprint defaults apply; it invents no scoring or duration policy. Tests observe the existing schema default of 3 points rather than supplying a new value.

Atomic duplicate detection uses the stable course identity, not just the current title. Concurrent repeats and a provider title rename still yield one task in the current Sprint. A repeated course with a different target skill returns 409. The response reports `alreadyAdded`, the owned Sprint ID, course/target context and the existing Sprint route. No locked Sprint service/model or scoring rules changed.

## API CONTRACTS

All endpoints require the existing JWT protect middleware and derive ownership from req.user.

| Method | Route                                  | Contract                                                                                                                                              |
| ------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/courses`                         | Existing courses/total/page/totalPages/hasMore/fromCache/recommendedBasedOn fields preserved; additive personalization, provenance and cache metadata |
| GET    | `/api/courses/my-learning`             | Optional status/page/limit; owned bounded records and totals                                                                                          |
| PUT    | `/api/courses/:courseId/progress`      | `{ "status": "saved                                                                                                                                   | in_progress | completed", "notes": "optional text", "progressPercent": 25 }`; notes/percentage optional; idempotent update |
| DELETE | `/api/courses/:courseId/progress`      | Owned removal; 204, including repeat                                                                                                                  |
| POST   | `/api/courses/:courseId/career-sprint` | `{ "targetSkill": "Node.js" }` or `{}` to use a recorded topic; owned current Sprint response                                                         |

GET filtering keeps platform/rating/level/topic/duration/page/limit compatibility. `skill` and `search` are accepted topic aliases; explicit `skillGaps` values are labeled requested targets rather than trusted evidence. `refresh=true` bypasses result caches. Structured/duplicate scalar filters are rejected; paging is bounded. Numeric rating and duration filters require genuinely available metadata, so an unverified catalog may correctly return no matches for those filters.

Progress DTOs omit internal IDs/userId and include a bounded course snapshot, status, notes, explicit progress, self-reporting source and timestamps. Progress errors return safe 400/404/409/503 responses; owned removal uses 204. Private source evidence and other users' course/progress/cache data are not returned.

Run migrations from `backend` with `node src/scripts/migrateCourseIndexes.js`. New indexes are `course_pool_evidence_lookup`, `course_skill_evidence_lookup`, `user_course_identity` and `user_course_status`. Real Mongo tests run migration twice to verify idempotency. Existing historical indexes/documents remain.

## FILES CHANGED / FINAL FOLDER STRUCTURE

All paths are absolute. Repository root: `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer`.

| Operation | Path                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| Modified  | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/controllers/courseController.js`             |
| Modified  | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/routes/courseRoutes.js`                      |
| Modified  | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/scripts/coursesPerfMeasure.js`               |
| Modified  | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/scripts/migrateCourseIndexes.js`             |
| Modified  | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/services/courseService.js`                   |
| Modified  | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/tests/coursesHardening.test.js`              |
| Modified  | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/tests/coursesPerformance.test.js`            |
| Modified  | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/src/app/shared/services/course.service.ts`      |
| Modified  | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/src/app/shared/services/course.service.spec.ts` |
| Added     | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/controllers/courseProgressController.js`     |
| Added     | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/data/courseCatalog.js`                       |
| Added     | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/models/userCourseProgress.js`                |
| Added     | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/services/courseHandoffService.js`            |
| Added     | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/services/coursePersonalizationService.js`    |
| Added     | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/services/courseProgressService.js`           |
| Added     | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/services/courseRecommendationService.js`     |
| Added     | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/tests/coursesFinalization.test.js`           |
| Added     | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/tests/coursesMongo.integration.test.js`      |
| Added     | `C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/utils/courseIdentity.js`                     |

The controller remains a thin compatibility entry point. Recommendation orchestration, current evidence resolution, owned progress and Sprint handoff live in focused services; persistence is in models, canonical identity/URL helpers in utils, historical catalog in data, migration/probe in scripts, and regression/integration coverage in tests. No source files were physically moved or deleted; existing logic/data was extracted while preserving its HTTP entry point.

New retained evidence files under `backend/verification/courses/`: `REPORT.md`, `performance.json`, `validation.json`.

## FORMATTING AND CLEANUP

Prettier write then check passed for the explicit same 17 backend JavaScript paths with singleQuote/printWidth 100; frontend-configured write/check passed for the two Courses adapter/test paths. All 17 backend JavaScript syntax checks passed. TypeScript checking passed. Git working-tree and staged whitespace validation passed after final documentation.

No temporary screenshots, traces, debug scripts or logs were created. Obsolete signal-cache logic, platform blending and duplicate inline catalog data were removed during extraction. No historical reports, old course records, unrelated untracked work, assets or licenses were deleted. Existing scripts were updated for the new evidence boundary, not replaced with throwaway probes. Integration fixtures use random owned IDs and remove only their records in teardown. No files were deleted as cleanup.

## FOCUSED / FULL / MONGODB TESTS

| Check                                                                                                   | Result                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Courses hardening + performance + new regressions + Mongo/JWT suites                                    | 41/41 passed                                                                                                                           |
| New real MongoDB/JWT suite                                                                              | 9/9 passed, zero skipped                                                                                                               |
| Complete backend, serial: `node --test --test-concurrency=1 --test-reporter=dot src/tests/**/*.test.js` | 343/343 passed, original thresholds unchanged                                                                                          |
| Initial full default-parallel run before final added regressions                                        | 338/340 passed; only existing locked Recommendations and Skill Gap memory p95 assertions failed under concurrent suite/other test work |
| Focused frontend Courses adapter                                                                        | 7/7 passed                                                                                                                             |
| Complete frontend suite                                                                                 | 200/200 passed, 40 files                                                                                                               |
| TypeScript `--noEmit -p frontend/tsconfig.app.json`                                                     | Passed                                                                                                                                 |
| Frontend production build                                                                               | Passed; existing unrelated landing-page SCSS budget warning                                                                            |
| Explicit-path Prettier checks and backend syntax                                                        | Passed                                                                                                                                 |

The initial parallel failures were memory p95 59.25 ms in Recommendations and 60.52 ms in Skill Gap. No locked code, tests or thresholds were changed. The entire backend passed serially. Existing Courses performance thresholds passed both focused and full runs.

Real integration exercises current-rule evidence, all five statuses, required/optional targets, legacy/temporary/stale/mismatched snapshots, active resume and source changes, career context and user isolation, memory/Redis/Mongo reuse and invalidation, expiry/outages, filtering/deep-links/paging/refresh, owned progress validation/concurrency/self-reporting, JWT routes and stable course-to-Sprint duplicate protection. YouTube success, authentication/quota failure, coalescing, caching and breaker recovery use controlled provider responses; no paid/real LLM call is made.

## DECISIONS REQUIRING APPROVAL

None. Existing numerical course weights and locked Sprint defaults were reused. The justified platform-quota correction was announced and has regression examples. The architecture's possible public showcase extension was not implemented because the task explicitly prohibits completion auto-publishing or evidence promotion.

## REMAINING ISSUES

- External course enrollment/link availability remains unverified for curated records. A currently configured live YouTube key/quota was not certified by these controlled provider tests; provider failures have tested safe behavior.
- Historical unverified rating/popularity/duration values are preserved in the source catalog but intentionally not exposed as authentic provider facts. Rating/duration filters can return no catalog matches until verified metadata is supplied.
- The initial parallel full-suite performance contention is recorded above. Serial full verification passes without weakening latency assertions.
- The frontend build retains its unrelated landing-page SCSS warning: 55.89 kB against a 48 kB budget. Existing unit-test jsdom canvas/navigation notices are non-failing.
- Frontend progress/action UI is intentionally the next task. No backend dependency requiring scoring-policy approval remains.

## NEXT

Learning Hub Frontend: consume the owned progress/action endpoints and evidence/provenance limitations; present missing metadata and self-reported completion clearly. Do not infer watched time, proficiency, certificates or public evidence from these records.
