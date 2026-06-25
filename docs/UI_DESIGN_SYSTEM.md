# UI Design System

## Technology Stack
- **Framework**: Angular 21 (standalone components)
- **Styling**: SCSS (ViewEncapsulation.Emulated)
- **Charts**: Chart.js via ng2-charts
- **Build**: Angular CLI (`@angular/build`)

## Component Architecture

### Page Components (`frontend/src/app/pages/`)
Each page is a standalone Angular component:
- Component class (`*.ts`)
- Template (`*.html`)
- Styles (`*.scss`)
- Tests (`*.spec.ts`)

### Shared Components (`frontend/src/app/shared/`)
Reusable components, pipes, and directives used across multiple pages.

### Layout (`frontend/src/app/layout/main-layout/`)
Shell component wrapping all protected `/app/*` routes:
- Sidebar navigation
- Header with user menu
- `<router-outlet>` for child content

## Route Configuration

All routes defined in `frontend/src/app/app.routes.ts`:
- Public routes: no guards, no layout
- Protected routes: `authGuard` → `MainLayout` → child components
- Lazy-loaded: Admin, Recruiter, SuperAdmin modules

## Guard Integration

| Guard | Effect when false |
|-------|-------------------|
| `authGuard` | Redirect to `/auth/login` |
| `publicGuard` | Redirect to `/app/dashboard` |
| `adminSettingsGuard` | Block access (403 behavior) |
| `recruiterRoleGuard` | Block access |
| `superAdminGuard` | Block access |

## HTTP Interceptor Pattern

```
Request → AuthInterceptor (add Bearer token) → HttpClient → Backend
Response → ErrorInterceptor (handle 401) → Component
```

## Styling Conventions

- **Global styles**: `frontend/src/styles.scss`
- **Component styles**: Each component's `*.scss` file
- **Style language**: SCSS (configured in `angular.json`)
- **Encapsulation**: Emulated (default)

## Module Loading

Standalone components are loaded directly.
Lazy modules (Admin, Recruiter, SuperAdmin) load via:
```typescript
loadChildren: () => import('./admin/admin.module').then(m => m.AdminModule)
```

## Build Configuration

| Config | Purpose |
|--------|---------|
| `angular.json` | Build, serve, test |
| `tsconfig.json` | TypeScript configuration |
| `tsconfig.app.json` | App-specific TS config |
| `tsconfig.spec.json` | Test-specific TS config |
| `proxy.conf.json` | Dev proxy to backend |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/app.ts` | Root component |
| `src/app/app.html` | Root template |
| `src/app/app.routes.ts` | All route definitions |
| `src/app/app.config.ts` | App providers |
| `src/main.ts` | Bootstrap entry |
| `src/index.html` | HTML shell |
| `src/styles.scss` | Global styles |
| `public/` | Static assets |

## Adding a New Page

1. Create component in `src/app/pages/new-feature/`
2. Add route to `app.routes.ts` under appropriate parent
3. Add guard if protected
4. Add navigation link in MainLayout sidebar