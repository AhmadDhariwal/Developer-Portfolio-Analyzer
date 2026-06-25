# Tech News

Implementation-driven guide for personalized tech news.

## Current Behavior
Tech News provides a personalized feed, saved articles, read-later state, and cache metadata. Feed keys include local profile signature and server signal hash to avoid stale personalization.

## Files To Modify
| Change | Files |
|---|---|
| UI/cache | `frontend/src/app/pages/news/*` |
| Frontend service | `frontend/src/app/shared/services/news.service.ts` |
| Backend controller | `backend/src/controllers/newsController.js`, `backend/src/routes/newsRoutes.js` |
| Backend service/cache | `backend/src/services/newsService.js` |
| Models | `backend/src/models/news.js`, `backend/src/models/newsSavedItem.js` |

## Dependencies
- Profile signature and `developerSignalService`.
- External/news provider logic inside `newsService`.
- `FrontendAnalysisCacheService` for feed/saved cache.

## Request Flow
Feed: `/app/news` -> `NewsComponent` -> `NewsService.getNews()` -> `GET /api/news` -> `newsController.getNews()` -> `newsService` -> response/cache.

Saved: `GET /api/news/saved`, `POST /api/news/save`, `DELETE /api/news/save/:id`, `PATCH /api/news/save/:id/read`.

## Change Impact
- Feed ranking changes affect user-visible personalized order.
- Saved routes must not clear feed cache unless save/read state requires it.
- Profile changes invalidate feed personalization, not saved news records.

## Testing Files
- `node --check backend/src/controllers/newsController.js`
- `node --check backend/src/services/newsService.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Do not force refresh on ordinary tab switches.
- Keep saved and feed caches separate.
- Do not use only local or only server signal state for personalized feed keys.
