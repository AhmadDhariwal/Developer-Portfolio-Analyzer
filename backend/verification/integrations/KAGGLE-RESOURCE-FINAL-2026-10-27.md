# Kaggle final resource acceptance — 27 October 2026

**Verdict: PASS for bounded public resource observations; enabled when token configuration is valid.** This supersedes the earlier fallback-only result without deleting its evidence. Source/authorized working branch remains `task/integrations`; PR/merge target is not applicable. Pre-existing staged and unstaged work was preserved. No commit, push, deployment, credential edit or migration was performed.

| Gate            | Result                                                                                                                                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TOKEN ACCESS    | PASS: configured Bearer token permitted official resource reads under existing Redis admission. This establishes read access, not app-user ownership of the public account. No token/header values appear in reports or evidence.                              |
| NOTEBOOK DATA   | PASS: first-page sample of 20 notebook references/titles/display authors/timestamps/votes. Missing notebook numeric IDs and language fields remain absent, not inferred.                                                                                       |
| DATASET DATA    | PASS: sample of 19 datasets with returned numeric IDs, canonical references, titles, owner/creator metadata, timestamps, available engagement, licenses and tags. These are sample counts, not lifetime totals.                                                |
| ATTRIBUTION     | PASS for `dansbecker`: canonical reference namespace matches the requested user; returned dataset `ownerRef` must also agree. Display names and creator fields cannot establish ownership. App-account verification remains false.                             |
| PERSISTENCE     | PASS: real authenticated local Connect, normalization and fenced Mongo transaction using an isolated disposable replica. Resource snapshots remain outside scored insight records.                                                                             |
| DOWNSTREAM      | PASS: persisted snapshot read through insights' additive `publicResources`, Marketplace sample summary and canonical integration-signal summary; Sync and Disconnect passed. Historical scored snapshot remained byte-for-byte unchanged.                      |
| ENABLED/BLOCKED | ENABLED for resource-only ingestion after isolated acceptance. Missing/invalid token configuration disables Marketplace Connect/Sync. Foreign/private/malformed attribution fails closed per account. Linked Profile fallback remains available independently. |

## Exact old rejection and schema interpretation

The old `kaggle` dataset query really returned other owners' resources. Its first retained diagnostic row was `dmitriigluzdov/casmi26-pubchem-popularity-prior`, with `ownerRef: dmitriigluzdov`, and matching public creator metadata. Later rows belonged to `seyitkaangunes`, `prvsiyan` and others. Accepting that page as `kaggle` data would have been incorrect. The exact server-side reason for returning other owners for that selector was not established; no undocumented profile lookup was used to speculate about it.

No identity alias was needed to make the known account work. The fix was to use a documented public account with actual content and retain strict attribution, adding explicit dataset `ownerRef` agreement instead of weakening validation. The [official dataset schema](https://github.com/Kaggle/kaggle-sdk-python/blob/main/kagglesdk/datasets/types/dataset_api_service.py) separates `ref`, `ownerRef`, `ownerName`, `creatorName` and `creatorUrl`. Creator/display fields are preserved metadata; they are not interchangeable with owner identity. The [notebook schema](https://github.com/Kaggle/kaggle-sdk-python/blob/main/kagglesdk/kernels/types/kernels_api_service.py) returned `author: DanB` for this account, while the canonical reference namespace is `dansbecker`. Treating that display name as a login would be another mapping error.

The account selection was grounded in Kaggle's public [How Models Work notebook](https://www.kaggle.com/code/dansbecker/how-models-work) and the dataset examples in the [official resource documentation](https://github.com/Kaggle/kaggle-cli/tree/main/docs). Public page reading established a known test subject only; no page content or scraping result was used as integration data.

## Real data and pagination evidence

One successful sample contained:

- Notebook reference `dansbecker/exercise-machine-learning-competitions-testing`; title `Exercise: Machine Learning Competitions testing`; returned display author `DanB`; last run `2019-09-19T11:51:11.453Z`; 48 returned votes. Language and numeric notebook ID were not returned.
- Dataset ID `179555`, reference `dansbecker/powerlifting-database`, title `powerlifting-database`, owner `dansbecker`; updated `2019-04-30T21:07:41.560Z`; 35,593 returned downloads, 157,211 views and 444 votes in that diagnostic snapshot. Its returned license string was `Unknown`, which remains unknown. Engagement is time-dependent and may change on later syncs.

Notebook page two returned 20 entries with zero overlap against the first 20 references. The API omitted a next-page token despite these full notebook pages. Numeric page navigation therefore remains supported alongside optional tokens; missing continuation tokens are explicitly not proof of catalog completeness. Each production sync deliberately refreshes only page one of each listing, bounded at 20 entries each. It never silently accumulates all pages or reports a lifetime count. Subsequent page reads require an explicit bounded page/token.

Eight provider requests were made in this follow-up: two known-account diagnostic reads; one dataset-only reproduction of the original rejection; one notebook page-two check; and four reads during isolated Connect/Sync. No retries, quota resets, scraper endpoints, downloads, notebook runs, publication writes or Python CLI execution occurred.

Retained primary evidence:

- [Known-account diagnostic](kaggle-attribution-diagnostic-2026-10-27.json)
- [Original rejection identity fields](kaggle-original-rejection-identity-2026-10-27.json)
- [Notebook page two](kaggle-notebook-pagination-2026-10-27.json)
- [Full isolated resource lifecycle](kaggle-resource-lifecycle-2026-10-27.json)

## Minimal flow and scoring safeguards

The registered Kaggle adapter delegates to the same extractor accepted in the isolated run. It uses the already reviewed official SDK POST list operations and fixed production host, implemented in Node. Existing Redis quotas, deadlines, body/response limits, no-redirect and no-retry controls remain in use. `KAGGLE_API_TOKEN` stays server-side. The local `.env` was not changed.

`kaggleResourceObservationService` normalizes a versioned, public, unverified observation with no profile score, activity score, confidence or inferred-skill fields. The controller uses the existing manual connection flow and writes `metadata.resourceObservation`. Existing owner fences and lease transactions protect Connect and Sync. Snapshot updates use dotted metadata paths to retain legacy metadata. Successful resource syncs and failures do not manufacture scored trend rows; failures retain the existing connection error/retry/lease handling.

The existing scored Kaggle insight remains intact during resource Connect, Sync and Disconnect. Neither the score formulas nor aggregate eligibility rules were modified. Resource observations travel through a separate additive `publicResources` envelope in integration reads and canonical signal context. Existing provider scores, detected skills and verified skills keep their existing sources. Marketplace counts explicitly say **Public sample**, **Ownership unverified**, and **scoring unchanged**. The generic live-hook label is suppressed for this polled resource connector.

Disconnect clears the current resource connection/snapshot through the existing transactional boundary, removes it from active downstream resource reads, and preserves historic scored evidence. The separate Kaggle Linked Profile record is unaffected. Dataset-only mode was considered but is unnecessary because both listings passed for the known-content subject.

Automatic approval review initially rejected activating the adapter before its persistence/scoring safeguards and lifecycle acceptance. That patch was not applied or bypassed. An inactive extractor and narrow resource-only guards were implemented first; the verifier selected that extractor only in a disposable process. It then passed authenticated local Connect, real HTTP extraction, persisted comparisons, fresh Sync, downstream reads, duplicate prevention and Disconnect. Only after that PASS was the registered adapter and Marketplace enabled. No approval blocker remains for the completed local implementation.

The isolated replica never used the configured application Mongo URI. A marker-only historical Kaggle fixture verified byte-for-byte retention; it was not presented as provider evidence or fabricated achievement data. The local process stopped and 112 task-owned database files were cleaned by the existing containment-checked helper. The helper retains the cleanup count, not a per-file deletion inventory. No user records or historical reports were removed.

## Exact task-owned inventory

Changed existing files (including already-untracked work from the preceding task):

- `backend/.env.example` (Kaggle comments only)
- `backend/src/controllers/integrationscontroller.js`
- `backend/src/services/integrationPersistenceService.js`
- `backend/src/services/integrationSyncService.js`
- `backend/src/services/developerSignalService.js`
- `backend/src/services/integrations/kaggleAdapter.js`
- `backend/src/services/integrations/kaggleResources.js`
- `backend/src/services/integrations/index.js`
- `backend/src/scripts/verifyKaggleResources.js`
- `backend/src/tests/kaggleResources.test.js`
- `backend/src/tests/integrationsAdapters.test.js`
- `frontend/src/app/shared/services/integrations.service.ts`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.ts`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.html`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.spec.ts`
- `backend/verification/integrations/KAGGLE-RESOURCE-ACCEPTANCE-2026-10-27.md`
- `backend/verification/integrations/REAL-PROVIDER-ACCEPTANCE.md`

Added:

- `backend/src/services/integrations/kaggleResourceExtractor.js`
- `backend/src/services/kaggleResourceObservationService.js`
- `backend/src/scripts/verifyKaggleResourceLifecycle.js`
- `backend/verification/integrations/kaggle-attribution-diagnostic-2026-10-27.json`
- `backend/verification/integrations/kaggle-original-rejection-identity-2026-10-27.json`
- `backend/verification/integrations/kaggle-notebook-pagination-2026-10-27.json`
- `backend/verification/integrations/kaggle-resource-lifecycle-2026-10-27.json`
- `backend/verification/integrations/KAGGLE-RESOURCE-FINAL-2026-10-27.md`

No pre-existing files moved or deleted. A task-created preparatory `kaggleResourceCandidate.js` was renamed to the final `kaggleResourceExtractor.js`; its old references were updated. All earlier failed acceptance artifacts and the linked-profile implementation were retained. No standalone temporary scripts, traces, screenshots or logs remain; the verification scripts and evidence above are intentional retained artifacts.

## Focused checks

- Backend regressions: **45/45 PASS** — `kaggleResources.test.js`, `integrationsAdapters.test.js`, `integrationsLifecycle.test.js`, `integrationSyncService.test.js`, `integrationInsightService.test.js`, `hashnodePublication.test.js`. Includes the resource-failure guard that preserves scored history. No full backend suite.
- Frontend: **14/14 PASS** across Marketplace, Kaggle Linked Profile and integration service specs, explicitly selected with `npm test -- --watch=false --include=...`. The established external runner avoided the known sandbox cache-rename failure; no full frontend suite.
- TypeScript `--noEmit -p frontend/tsconfig.app.json`: **PASS**.
- One `npm run build`: **PASS**, retaining the unrelated landing-page stylesheet warning (56.67 kB vs 48 kB warning threshold).
- Explicit-path formatter **write/check PASS** on all 17 task-owned source files, three reports and four JSON evidence files. Backend/report options: `--single-quote --print-width 100 --trailing-comma none`; frontend uses `frontend/.prettierrc`. All 13 backend JavaScript files passed `node --check`. Staged and unstaged Git whitespace checks passed. A scan confirmed the configured Kaggle token is absent from the retained reports/evidence.

Scope limits: accepted bounded observations and local isolated persistence/downstream lifecycle, not deployment certification, complete catalogs, ownership verification of an app user, global ranks, medals, verified skills or new scores. Accounts whose responses do not satisfy attribution remain blocked at ingestion and can use the retained linked-profile fallback.
