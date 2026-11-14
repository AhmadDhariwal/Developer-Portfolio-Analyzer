# Tech News final contract fix

STATUS: VERIFIED

READY FOR TECH NEWS FRONTEND INTEGRATION: YES

Scope: only the two backend contract blockers identified in the existing backend and frontend Tech News reports. Existing frontend edits, screenshots and staging were preserved. No frontend implementation, provider/cache/rate-limit architecture, ranking formula, dependency, locked module or production database was changed. Earlier reports remain historical evidence; this report supersedes their two contract limitations for a subsequent frontend integration task.

## Read / unread contract

The existing authenticated mutation route is unchanged:

```http
PATCH /api/news/save/:id/read
Content-Type: application/json

{"read": false}
```

| Body                                                               | Result                         |
| ------------------------------------------------------------------ | ------------------------------ |
| Empty HTTP body or `{}`                                            | Mark read, backward compatible |
| `{"read": true}`                                                   | Mark read                      |
| `{"read": false}`                                                  | Mark unread                    |
| Non-boolean read, structured/non-object body, or additional fields | 400                            |

The existing response envelope and fields are retained. The success message is `Read later item marked as read.` or `Read later item marked as unread.` The additive saved-item fields are returned by both GET saved-library and mutation responses:

| Field               | Semantics                                                                  |
| ------------------- | -------------------------------------------------------------------------- |
| `readAt` (existing) | Current completion timestamp; null means currently unread                  |
| `firstReadAt`       | Earliest recorded completion, preserved permanently through unread/re-read |
| `lastReadAt`        | Most recent completion, retained while unread                              |
| `readCount`         | Known unread-to-read completions; repeated read does not increment         |

For example, unread after two completed reads returns `readAt: null`, the original `firstReadAt`, the latest `lastReadAt` and `readCount: 2`. This is a bounded history summary, not an unbounded event log. No delete/recreate operation occurs. IDs, user ownership, article metadata, articleData and createdAt remain unchanged.

Two stages in one atomic Mongo update first preserve/hydrate legacy history and then apply the requested state. Concurrent identical updates are idempotent; mixed concurrent updates follow database application order, preserving the first completion and counting actual state transitions. $$NOW supplies server timestamps. An unread retry cannot clear historical timestamps or increment the count. Re-read after unread records a new current/latest timestamp while retaining the original first timestamp.

Existing records need no migration or new index. Legacy GET responses derive a history summary from readAt without writing. The first mutation lazily persists that history before clearing current read state. The owner filter and type=read_later restriction remain mandatory; foreign/missing IDs and bookmarks return the same 404. Existing JWT authentication, private/no-store headers and the dedicated mutation rate limiter remain in effect. Clients cannot supply timestamps, counts, owner IDs or historical fields through this route.

## Additive skill evidence contract

GET `/api/news` adds:

- `recommendedBasedOn.skillEvidence`: bounded per-skill evidence for the existing detected/growth/recommended/demand context.
- `recommendedBasedOn.skillEvidenceRuleVersion`: `skill-evidence-coverage-v1`.
- Each article's `relatedSkillEvidence`: the relevant subset matching existing relatedSkills, relatedSkillGaps or demandTags. Existing match arrays, explanations, rankScore and relevanceScore are unchanged.

Example metadata entry:

```json
{
  "name": "React",
  "canonicalName": "React",
  "status": "CLAIMED_ONLY",
  "evidenceConfidence": "LOW",
  "evidence": [
    {
      "type": "resume",
      "kind": "CLAIM",
      "id": "owned-analysis-id",
      "artifact": "",
      "timestamp": "2026-10-22T00:00:00.000Z",
      "freshness": "RECORDED"
    }
  ]
}
```

The news adapter calls the existing pure Skill Gap evidence resolver and canonical dictionary using already-resolved Developer signals. It does not modify the classifier, scoring engine or canonical service, query another database, call AI/providers or interpret legacy provenSkills strings as proof. GitHub identity and selected resume file are checked against canonical Developer Context before using their evidence. Former-selection data is excluded rather than promoted while the existing fifteen-second signal cache converges.

Classification uses the existing Skill Gap semantics:

| Status        | Meaning for integration                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEMONSTRATED  | Requires inspected meaningful technical implementation under the existing classifier; never inferred from names, language metadata or resume statements |
| PARTIAL       | Relevant technical metadata; not verified implementation or proficiency                                                                                 |
| CLAIMED_ONLY  | Resume/profile/integration/portfolio claims without technical demonstration                                                                             |
| NOT_EVIDENCED | A calibrated required skill is not established by available analyzed sources; does not establish inability                                              |
| UNKNOWN       | Unsupported name, unavailable/insufficient evidence, or no applicable calibrated requirement                                                            |

The existing classifier's current summary adapter deliberately emits no inspected-implementation observations. Therefore current news summaries cannot manufacture a DEMONSTRATED skill; the proven group may correctly be empty. Recommendations, demand and gaps create no positive observations by themselves. A recommendation can have claim/partial evidence only when independently present in analyzed sources. Unknown strings and legacy known/proven lists alone do not certify skills. Resume statements remain claims. Per-skill evidence includes source type, effective kind, bounded artifact/ID references, recorded timestamp and freshness; it is not a proficiency probability.

The projection contains at most 100 canonical-deduplicated skills and five evidence references per skill. It is computed per account after reading the unchanged shared public pool. Personalized provenance is never written into the public article cache. Existing 50/30/20 ranking inputs, weights, tie-breaking, response fields and provider admission controls remain unchanged; focused tests compare old ranking/explanation fields directly.

## Focused verification

**19 tests passed, 0 failed, 0 skipped**:

- `node --test backend/src/tests/newsContract.test.js backend/src/tests/newsHubHardening.test.js`: 13 passed. Five new contract tests cover claim/partial/unknown/missing-evidence classification, rejected legacy "proven" hints, integration/portfolio claims, canonical identity/resume selection changes, account isolation, additive article/context metadata, unchanged ranks/legacy fields and invalid mutation bodies. Eight existing focused news checks cover controlled provider behavior, quotas failing closed, URLs, freshness, public-cache handling and the unchanged 50/30/20 formula.
- With NEWS_TEST_MONGODB_URI pointing only to task-owned localhost:27129: `node --test --test-name-pattern=isolated.*Mongo backend/src/tests/newsContractMongo.integration.test.js backend/src/tests/newsHub.integration.test.js`: six passed (new parent plus four subtests, and the existing JWT integration case). Actual MongoDB 8.2 verifies backward-compatible empty-body reads, repeated read/unread, re-read, first/latest/count persistence, legacy field hydration, saved GET round trips, unchanged IDs/createdAt/articleData, twelve concurrent reads, twelve concurrent unreads, twelve concurrent re-reads, eight mixed competing transitions, foreign-owner rejection and bookmark protection. Existing authenticated route checks verify JWT protection and ownership with the additive contract.

The two test databases used random news*contract_test*<UUID> / news*hub_test*<UUID> names and were dropped after verification. No application .env/Mongo URI was loaded by the fixtures. Upstash integration was not repeated: Redis infrastructure and provider quotas were unchanged. Providers were controlled in unit tests; no paid API/AI call, full suite, frontend test, frontend build, deployment or production data mutation occurred.

After formatting, the six real-Mongo checks passed again before stopping the disposable process. After runtime cleanup, the thirteen controlled tests passed again. All six changed JavaScript files passed explicit-path Prettier write/check using the established backend single quotes, no trailing commas, two spaces and width 120, plus node --check. This report also passed formatting. Working-tree and staged Git whitespace checks passed.

## Exact task file inventory

Modified:

1. `backend/src/controllers/newsController.js` — validated read boolean, atomic state/history transition, additive saved responses and projection.
2. `backend/src/models/newsSavedItem.js` — optional firstReadAt, lastReadAt and readCount fields; existing records/indexes preserved.
3. `backend/src/services/newsService.js` — additive account-scoped context/article evidence projection only; ranking/cache/provider logic unchanged.

Added:

1. `backend/src/services/newsSkillEvidenceService.js` — pure adapter over the unchanged Skill Gap resolver and canonical Developer Context.
2. `backend/src/tests/newsContract.test.js` — five controlled contract/provenance tests.
3. `backend/src/tests/newsContractMongo.integration.test.js` — isolated real-Mongo transition/history/concurrency tests.
4. `backend/verification/tech-news/CONTRACT-FIX.md` — this exact contract and verification record.

Moved/deleted source files: none. Existing frontend staging and verification evidence remain untouched. No destructive Git cleanup was used.

## Integration handoff

The frontend can now send read:false on the existing PATCH route, use readAt for current read state and firstReadAt/lastReadAt/readCount for historical information. It can classify skill labels from skillEvidence/relatedSkillEvidence rather than interpreting the legacy detectedSkills list as verified evidence. No backend migration, new index or extra provider configuration is required for these additive fields. Wiring the frontend and running final E2E are deliberately not part of this fix.

## Runtime cleanup inventory

Stopped only the command-line-verified task-owned MongoDB process. Removed the following exact temporary files under the verified task-created contract-runtime directory after retaining the test results. No database credentials or application records were copied into that directory.

- `backend/verification/tech-news/contract-runtime/mongo.log`
- `backend/verification/tech-news/contract-runtime/mongo.pid`
- `backend/verification/tech-news/contract-runtime/mongo/_mdb_catalog.wt`
- `backend/verification/tech-news/contract-runtime/mongo/collection-18c1bb7e-47e6-451a-bb60-4f58b9cd0c2b.wt`
- `backend/verification/tech-news/contract-runtime/mongo/collection-1dfdd5ba-9897-4f46-a04c-2879c65d9dfc.wt`
- `backend/verification/tech-news/contract-runtime/mongo/collection-273c5047-6c3f-4b33-9a3d-b86151a674e5.wt`
- `backend/verification/tech-news/contract-runtime/mongo/index-44d70c25-208a-479e-b2c7-46f3f4816662.wt`
- `backend/verification/tech-news/contract-runtime/mongo/index-675b9869-0f66-46d4-af8d-38203f4fb87b.wt`
- `backend/verification/tech-news/contract-runtime/mongo/index-aea1f8d0-c2e7-4824-8f29-8822b5875778.wt`
- `backend/verification/tech-news/contract-runtime/mongo/index-c611c0c2-76db-4066-ba30-1f732fc27f8a.wt`
- `backend/verification/tech-news/contract-runtime/mongo/mongod.lock`
- `backend/verification/tech-news/contract-runtime/mongo/sizeStorer.wt`
- `backend/verification/tech-news/contract-runtime/mongo/storage.bson`
- `backend/verification/tech-news/contract-runtime/mongo/WiredTiger`
- `backend/verification/tech-news/contract-runtime/mongo/WiredTiger.lock`
- `backend/verification/tech-news/contract-runtime/mongo/WiredTiger.turtle`
- `backend/verification/tech-news/contract-runtime/mongo/WiredTiger.wt`
- `backend/verification/tech-news/contract-runtime/mongo/WiredTigerHS.wt`
- `backend/verification/tech-news/contract-runtime/mongo/diagnostic.data/metrics.2026-10-22T10-40-46Z-00000`
- `backend/verification/tech-news/contract-runtime/mongo/diagnostic.data/metrics.interim`
- `backend/verification/tech-news/contract-runtime/mongo/journal/WiredTigerLog.0000000001`
- `backend/verification/tech-news/contract-runtime/mongo/journal/WiredTigerPreplog.0000000001`
- `backend/verification/tech-news/contract-runtime/mongo/_tmp/spilldb/WiredTiger`
- `backend/verification/tech-news/contract-runtime/mongo/_tmp/spilldb/WiredTiger.lock`
- `backend/verification/tech-news/contract-runtime/mongo/_tmp/spilldb/WiredTiger.turtle`
- `backend/verification/tech-news/contract-runtime/mongo/_tmp/spilldb/WiredTiger.wt`
- `backend/verification/tech-news/contract-runtime/mongo/_tmp/spilldb/WiredTigerHS.wt`
