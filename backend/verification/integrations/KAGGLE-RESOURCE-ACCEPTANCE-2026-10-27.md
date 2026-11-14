# Kaggle resource acceptance and fallback — 27 October 2026

## Superseding final result — resource extraction enabled

The known-content `dansbecker` account passed both listings (20 notebook and 19 dataset sample entries), strict attribution and the isolated authenticated Fetch → Normalize → MongoDB → Sync → Downstream → Disconnect lifecycle. Historical Kaggle scores/insights remained byte-for-byte unchanged. The adapter and Marketplace were enabled only after that isolated PASS; missing token configuration and mismatched resource owners still fail closed. The linked-profile fallback remains available.

The old rejection was reproduced precisely: the `kaggle` selector returned resource references and `ownerRef` values belonging to other users, so rejecting it was correct. Display author `DanB` is metadata, not username `dansbecker`. No ownership validation was bypassed. See [final causes, real-data evidence, exact inventory and verification](KAGGLE-RESOURCE-FINAL-2026-10-27.md). The earlier blocked verdict below is retained as historical evidence and is superseded within the final report's stated scope.

Source/authorized working branch: `task/integrations`. PR/merge target: not applicable. Preflight found the preceding integration work staged; the index was preserved. No credentials, application database records, scoring formulas, historical observations or existing adapters were overwritten. No commit, push, migration or deployment occurred.

## Final verdict

**Resource ingestion BLOCKED; Kaggle Linked Profile fallback implemented.** Documented resource contracts exist, but a suitable end-to-end extraction contract was not established by this run. This is not a claim that Kaggle's APIs are universally unavailable.

| Required result  | Verdict and evidence                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API AUTH         | Token present, no line breaks, quietly loaded from ignored `backend/.env`, and never printed or persisted in evidence. Bearer-authenticated read requests received HTTP 200 JSON. Token identity/ownership and rejection of an invalid token were not independently verified.                                                                        |
| NOTEBOOK DATA    | HTTP 200 with an empty protobuf-JSON result for the public `kaggle` account. Zero returned entries is an observed empty page, not a lifetime notebook total. Nonempty notebook extraction remains unverified live.                                                                                                                                   |
| DATASET DATA     | BLOCKED. The corrected owner-filtered request returned 20 entries, but the reader rejected the page's resource-attribution validation. No partial dataset observations were accepted or stored. The diagnostic did not retain rejected row payloads, so it does not identify which exact row/condition failed.                                       |
| PERSISTENCE      | Resource persistence NOT RUN because no valid combined resource sample was accepted. Separately, the fallback passed real Mongo transactions, owner isolation, duplicate prevention and historical-snapshot preservation in a disposable local replica.                                                                                              |
| DOWNSTREAM USAGE | Resource downstream adoption NOT RUN. The fallback passed a real controller read from Mongo and focused UI/service tests, plus link removal. This is not authenticated live-browser acceptance.                                                                                                                                                      |
| KAGGLE STATUS    | Separate **Kaggle Linked Profile** with **Ownership unverified**. Resource Connect/Sync remain disabled. No medals, ranks, verified skills, confidence or scores are generated from the link.                                                                                                                                                        |
| EXACT BLOCKERS   | Rejected dataset attribution, no nonempty live notebook sample, and consequently no resource Mongo/sync/downstream/disconnect acceptance. Automatic approval review rejected broader production-pipeline wiring while the resource contract was blocked; those edits were not applied. The authorized linked-profile fallback was completed instead. |

## API contract review and bounded live session

Reviewed [official resource commands](https://github.com/Kaggle/kaggle-cli/tree/main/docs), the official [notebook service](https://github.com/Kaggle/kaggle-sdk-python/blob/main/kagglesdk/kernels/services/kernels_api_service.py), [dataset service](https://github.com/Kaggle/kaggle-sdk-python/blob/main/kagglesdk/datasets/services/dataset_api_service.py), [JSON transport and authentication](https://github.com/Kaggle/kaggle-sdk-python/blob/main/kagglesdk/kaggle_http_client.py), [production host](https://github.com/Kaggle/kaggle-sdk-python/blob/main/kagglesdk/kaggle_env.py), and generated request/response types. Kaggle's official CLI is documentation/provenance only; it is not installed, invoked or required by this implementation.

The isolated Node reader uses these fixed official SDK JSON operations:

- `POST https://api.kaggle.com/v1/kernels.KernelsApiService/ListKernels`
- `POST https://api.kaggle.com/v1/datasets.DatasetApiService/ListDatasets`

It sends the configured token in an Authorization header and uses existing `kaggle` Redis job/request admission, deadlines, payload limits, no redirects and no automatic POST retries. It never uses website profile endpoints, scraping, a proxy, downloads, executions, uploads or mutation operations.

One focused contract-verification session used only the public account `kaggle`, with an initial two-request probe and a two-request correction after reviewing the official client selector mapping: **four outbound requests total; no automatic retries, quota resets or additional accounts**. Each request was limited to page one. The initial notebook request asked for five entries and returned none; the initial dataset request returned a 20-entry page that failed the five-entry bound. Its PUBLIC group selector did not match the official user's USER selection and was corrected. The corrected requests used the standard 20-entry bound and `DATASET_SELECTION_GROUP_USER`; notebooks remained empty and dataset attribution validation failed. We stopped external querying rather than expanding scans until a result appeared.

Retained evidence:

- [Initial probe](kaggle-resources-live-2026-10-27.json)
- [Corrected contract check](kaggle-resources-corrected-contract-2026-10-27.json)
- [Isolated fallback Mongo acceptance](kaggle-linked-profile-acceptance-2026-10-27.json)

The candidate reader accepts only whitelisted returned IDs, references, titles, language/type, metadata, timestamps and engagement fields. Missing fields remain missing; explicit nulls and zero values remain distinct. Foreign/private/duplicate resources, oversized pages, malformed timestamps and invalid counts fail closed. A returned next-page token is retained without treating the page as a complete catalog; subsequent page calls require an explicit bounded token. Neither production ingestion nor the scoring normalization path uses this candidate reader. Its diagnostic implementation is retained for tests and investigation, not presented as an accepted connector.

## Linked-profile fallback

The Marketplace offers a separate form accepting a Kaggle username or an HTTPS profile URL on `kaggle.com` / `www.kaggle.com`. It normalizes to the fixed official host, rejects external URLs/credentials/queries/fragments and nested resource paths, and never visits the entered URL. Existence and ownership are unchecked and explicitly labeled. No token is needed to save the link.

The additive `GET`, `POST`, `DELETE /api/integrations/linked-profiles/kaggle` endpoints reuse authentication and Redis mutation admission. Storage extends the existing linked-profile provider enum and unique user/provider index; no migration or new database was introduced. Atomic writes reuse the existing owner fence and Mongo transaction. HackerRank remains the default for its existing service methods and endpoints. The existing account-deletion lifecycle covers both linked-profile providers.

Fallback verification used a new isolated Mongo process, ephemeral port and task-owned temporary directory, never the configured application Mongo URI. It verified save/update/read/remove, foreign-owner isolation, one user/provider row, no connection/scored sync creation, and byte-for-byte preservation of an explicit historical marker fixture. It did not invent Kaggle metrics. The process stopped and its 64 temporary database files were removed by the existing exact-path/ownership-checked helper; no recursive directory deletion or user-data cleanup was performed. The helper retains a cleanup count, not an individual deleted-file inventory. Standard ignored frontend build/cache output is retained.

## Exact source and evidence inventory

Changed:

- `backend/.env.example` — comment clarifies diagnostic token use; no values changed.
- `backend/src/models/integrationLinkedProfile.js`
- `backend/src/services/integrationLinkedProfileService.js`
- `backend/src/controllers/integrationLinkedProfilescontroller.js`
- `backend/src/routes/integrations.routes.js`
- `backend/src/services/integrations/index.js` — Kaggle unavailable/fallback description only.
- `backend/src/scripts/verifyIntegrationsRealProviders.js` — main guard and export of its existing disposable-Mongo helper; direct CLI behavior retained.
- `frontend/src/app/shared/services/integrations.service.ts`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.ts`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.html`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.spec.ts`
- `backend/verification/integrations/REAL-PROVIDER-ACCEPTANCE.md`

Added:

- `backend/src/services/integrations/kaggleResources.js`
- `backend/src/scripts/verifyKaggleResources.js`
- `backend/src/scripts/verifyKaggleLinkedProfile.js`
- `backend/src/tests/kaggleResources.test.js`
- `frontend/src/app/pages/integrations-marketplace/components/kaggle-linked-profile.component.ts`
- `frontend/src/app/pages/integrations-marketplace/components/kaggle-linked-profile.component.html`
- `frontend/src/app/pages/integrations-marketplace/components/kaggle-linked-profile.component.spec.ts`
- `backend/verification/integrations/kaggle-resources-live-2026-10-27.json`
- `backend/verification/integrations/kaggle-resources-corrected-contract-2026-10-27.json`
- `backend/verification/integrations/kaggle-linked-profile-acceptance-2026-10-27.json`
- `backend/verification/integrations/KAGGLE-RESOURCE-ACCEPTANCE-2026-10-27.md`

Moved/deleted source files: none. The Kaggle form references the existing linked-profile stylesheet. Both failed contract evidence files are retained as essential acceptance history, not disposable duplicates. No temporary scripts, standalone logs, screenshots or traces were created.

## Focused verification and remaining work

- Backend: **34/34 passed** — `kaggleResources.test.js`, `integrationLinkedProfiles.test.js`, `integrationsLifecycle.test.js`, `integrationsAdapters.test.js`. Covers credential handling, documented route/selector mapping, bounds/pagination, missing metrics, rejected foreign/private/malformed resources, link ownership/provenance, existing providers and HackerRank isolation.
- Frontend: **16/16 passed** — Marketplace, Kaggle linked profile, HackerRank linked profile and integrations service specs, selected explicitly with `npm test -- --watch=false --include=...`. The established sandbox cache-rename failure was avoided by using the authorized external runner for only these files.
- TypeScript `--noEmit -p frontend/tsconfig.app.json`: **passed**.
- One frontend `npm run build`: **passed**, with the unchanged landing-page stylesheet warning (56.67 kB vs 48 kB warning budget).
- Explicit-path Prettier write/check, changed JavaScript syntax and staged/unstaged Git whitespace checks are required finalization; final results are recorded in the acceptance report.

No full test suite, production deployment, credential change, migration or production-data mutation ran. To enable resource Connect/Sync in future, first resolve the dataset attribution discrepancy and obtain a nonempty notebook payload for a bounded agreed account. Then complete isolated live resource normalization, persistence, synchronization, non-scoring downstream adoption and disconnect acceptance, preserving historical scores. This run does not approve production resource-pipeline wiring or a new scoring policy.
