# Architecture Structure Guide

This guide defines where new code belongs in Developer Portfolio Analyzer (DPA) after the structural reorganization.

## Frontend (`frontend/src/app`)

```text
frontend/src/app/
├── core/
│   ├── guards/              # Auth, role, and permission route guards
│   ├── interceptors/        # HTTP auth, CSRF, and error interceptors
│   └── layouts/main-layout/ # Authenticated application shell
├── shared/
│   ├── components/          # Cross-role reusable UI components
│   ├── constants/           # Shared constants (e.g. interview-prep.constants.ts)
│   ├── directives/          # Shared Angular directives
│   ├── models/              # Cross-feature TypeScript contracts
│   ├── pipes/               # Shared Angular pipes
│   ├── services/            # Cross-feature API & state services
│   └── styles/              # Shared SCSS partials (_developer-ui.scss, _jobs-ui.scss, _public-theme-tokens.scss)
├── features/
│   ├── public/              # Unauthenticated public pages (landing, portfolio, docs, legal, invitations)
│   ├── auth/                # Login, signup, OTP, and OAuth entry points
│   ├── developer/           # Developer role pages & feature-local components
│   ├── recruiter/           # Recruiter role pages, components, services, and models
│   ├── admin/               # Organization Admin role pages, services, and module
│   └── super-admin/         # Super Admin pages, shared components, and platform settings
└── app.routes.ts            # Top-level lazy route definitions
```

### Placement Rules
1. **Role Isolation:** Never import components or modules from another role folder (`developer`, `recruiter`, `admin`, `super-admin`). Promote genuinely shared UI into `shared/`.
2. **Page vs. Child Component:** Route-level containers live directly under `features/<role>/pages/<feature>/`. Focused UI sections (such as `interview-saved-sessions` or `interview-question-card`) live under `features/<role>/pages/<feature>/components/`.
3. **SCSS Imports:** Reference design tokens and shared mixins from `shared/styles/` using relative `@use` paths (e.g., `../../../../shared/styles/developer-ui`).

## Backend (`backend/src`)

```text
backend/src/
├── config/                  # Environment validation, constants (newsProviderKeys.js), DB/Redis setup
├── controllers/             # Express request/response handlers
├── data/                    # Curated static catalogs and seed data
├── jobs/                    # Scheduled job definitions
├── middleware/              # Auth, RBAC, rate-limit, CSRF, upload middleware
├── models/                  # Mongoose schemas and models
├── prompts/                 # Versioned AI prompt builders
├── routes/                  # Express route definitions mounted by backend/index.js
├── scripts/                 # Operational and verification scripts
├── services/                # Business logic, AI orchestration, caching, persistence
├── tests/                   # Node test runner unit and integration suites
├── utils/                   # Pure stateless utilities
└── workers/                 # Dedicated background worker entrypoints
```

### Dependency Rules
1. **Zero Circular `require()` Edges:** Keep constants (`newsProviderKeys.js`, `courseCatalogConstants.js`) and low-level transaction primitives (`notificationTransactionService.js`) in leaf modules with no upward service imports.
2. **Callback Registration for Cross-Service Hooks:** When a worker/helper service needs an action from an orchestrator service (e.g., `weeklyReportDeliveryService` → `weeklyReportService`), use explicit registration hooks rather than bidirectional `require()`.

