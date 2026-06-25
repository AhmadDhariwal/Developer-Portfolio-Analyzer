# Coding Guidelines

## Language & Module System

### Backend (Node.js)
- **Language**: JavaScript (CommonJS)
- **Module system**: `require()` / `module.exports` — NO ES module imports
- **Async**: `async/await` with try-catch throughout
- **No TypeScript**: Backend is pure JavaScript

### Frontend (Angular)
- **Language**: TypeScript 5.9 strict mode
- **Module system**: ES modules with `import`/`export`
- **Components**: Standalone by default (no NgModules for pages)
- **Styling**: SCSS

## Backend Conventions

### File Naming
- **Controllers**: `entitycontroller.js` (e.g., `githubcontroller.js`)
- **Services**: `entityservice.js` or `entityService.js`
- **Routes**: `entity.routes.js` or `entityRoutes.js`
- **Models**: `entity.js` or `Entity.js` (PascalCase for some)
- **Middleware**: `entityMiddleware.js`
- **Prompts**: `entityPrompt.js`

### Code Structure

**Route files**:
```javascript
const router = require('express').Router();
const { protect, authorizeRoles } = require('../middleware/authmiddleware');
const controller = require('../controllers/entitycontroller');

router.get('/path', protect, controller.method);
router.post('/path', protect, authorizeRoles('admin'), controller.method);

module.exports = router;
```

**Controller files**:
```javascript
const Service = require('../services/entityService');
const Model = require('../models/entity');

const method = async (req, res) => {
    try {
        // Extract from req.body, req.params, req.user
        // Call service
        // Send response
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { method };
```

**Service files** (singleton pattern):
```javascript
class EntityService {
    constructor() { /* init */ }
    async doSomething() { /* logic */ }
}
module.exports = new EntityService();
```

**Model files**:
```javascript
const mongoose = require('mongoose');
const schema = new mongoose.Schema({ /* fields */ });
module.exports = mongoose.model('Entity', schema);
```

### Error Handling
- Controllers catch errors, send HTTP responses
- Services throw descriptive errors
- Use appropriate status codes: 400 (validation), 401 (auth), 403 (forbidden), 429 (rate limit), 500 (server)
- Response format: `{ message: 'Description' }`

### Auth
- Use `protect` for any authenticated route
- Use `authorizeRoles(...)` for role-restricted routes
- Access user via `req.user`
- User ID: `req.user._id`
- Role: `req.user.role`

## Frontend Conventions

### Component Structure
```
new-feature/
├── new-feature.component.ts
├── new-feature.component.html
├── new-feature.component.scss
└── new-feature.component.spec.ts
```

### Route Registration
In `app.routes.ts`, add:
```typescript
{ path: 'new-feature', component: NewFeatureComponent }
```

### Guard Usage
```typescript
{ path: 'secure-feature', component: SecureComponent, canActivate: [authGuard, adminSettingsGuard] }
```

### HTTP Calls
Use Angular's `HttpClient` with service classes. The auth interceptor automatically attaches JWT to `/api/*` requests.

## Patterns to Follow

1. **Backend**: Routes → Controllers → Services → Models (never skip layers)
2. **AI calls**: Always go through `aiservice.runAIAnalysis(prompt, fallback)`
3. **Prompts**: Keep in `src/prompts/`, export template functions
4. **Singleton services**: Export `new ServiceClass()` instance
5. **Frontend lazy loading**: Use `loadChildren` for large modules
6. **Auth**: Always use guards, never check auth in components

## What Not to Do

1. **Do NOT** add new roles without updating `models/user.js` role enum, `authmiddleware.js` role normalization, and all guards
2. **Do NOT** modify the User model schema without migration consideration — it's the most connected model
3. **Do NOT** change the middleware order in `index.js` — it's security-critical
4. **Do NOT** call AI APIs directly — always go through `aiservice.js`
5. **Do NOT** bypass the cache layers without understanding invalidation
6. **Do NOT** remove fields from any Mongoose model — add with defaults instead
7. **Do NOT** change `runAIAnalysis(prompt, fallback, retries)` signature — all features depend on it
8. **Do NOT** use ES module syntax (`import`/`export`) in backend
9. **Do NOT** create NgModules for simple pages — use standalone components

## Testing

### Backend
- Test runner: Node.js native test runner (`node --test`)
- Test files: `src/tests/**/*.test.js`
- Run: `npm test` in `backend/`

### Frontend
- Test framework: Vitest
- Run: `npm test` in `frontend/`

## Git Workflow
- Repository: `https://github.com/AhmadDhariwal/Developer-Portfolio-Analyzer`
- Commit messages: Descriptive, feature-focused
- Branch strategy: Feature branches from main