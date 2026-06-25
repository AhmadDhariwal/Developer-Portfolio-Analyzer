# API Reference

Base URL: `http://localhost:5000/api`

Use this as a route catalog. For implementation details, read the linked feature doc from [PROJECT_INDEX.md](PROJECT_INDEX.md).

## Auth
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/auth/signup` | Public | Register and send OTP. |
| POST | `/auth/verify-otp` | Public | Verify OTP and create user. |
| POST | `/auth/login` | Public | Login and return JWT. |
| POST | `/auth/forgot-password` | Public | Request reset. |
| POST | `/auth/reset-password` | Public | Reset password. |

## Profile
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/profile/me` | Private | Cache-first frontend read. Returns active fields and `profileHash`. |
| PUT | `/profile/me` | Private | Update personal/profile fields. Recomputes `profileHash`. |
| PUT | `/profile/career` | Private | Update base and active career profile fields. |
| PUT | `/profile/career/active` | Private | Update active career stack and level only. |
| PUT | `/profile/password` | Private | Change password. |
| PUT | `/profile/visibility` | Private | Toggle public profile visibility. |
| POST | `/profile/avatar` | Private | Upload avatar. |
| DELETE | `/profile/me` | Private | Delete account. |

## Dashboard
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/dashboard/summary` | Private | Main aggregate summary. Optional `refresh=true`. |
| GET | `/dashboard/contributions` | Private | Contribution activity. Optional `refresh=true`. |
| GET | `/dashboard/languages` | Private | Language distribution. Optional `refresh=true`. |
| GET | `/dashboard/skills` | Private | Skill overview. Optional `refresh=true`. |
| GET | `/dashboard/recommendations` | Private | Recommendation preview. Optional `refresh=true`. |
| GET | `/dashboard/integration-analytics` | Private | Integration analytics. Query: `days`. |

## GitHub Analyzer
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/github/analyze` | Public | Preview analysis. Body: `username`, optional `forceRefresh`. |
| POST | `/github/analyze-save` | Private | Analyze and persist for current user. |
| GET | `/github/active-username` | Private | Return active/default username. |

## Resume
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/resume/upload` | Private | Upload resume file. |
| POST | `/resume/analyze` | Private | Explicit analysis generation. |
| GET | `/resume/result` | Private | Read saved analysis. Optional `fileId`. |
| GET | `/resume/files` | Private | List uploaded files. |
| GET | `/resume/active` | Private | Read active resume context. |
| PUT | `/resume/active` | Private | Set active/default resume. |
| GET | `/resume/guide` | Private | Download resume guide. |

## Skill Gap
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/skillgap/skill-gap` | Private | Analyze skill gap. Body includes username/profile fields and optional `forceRefresh`. |

## Recommendations
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/recommendations` | Private | Saved/profile recommendations. |
| POST | `/recommendations/generate` | Optional | Temporary analysis can be public when `isTemporary=true`; saved analysis requires auth. |

## Tech News
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/news` | Private | Personalized feed. Optional `refresh=true`. |
| GET | `/news/saved` | Private | Saved articles. |
| POST | `/news/save` | Private | Save article. |
| DELETE | `/news/save/:id` | Private | Remove saved article. |
| PATCH | `/news/save/:id/read` | Private | Mark saved article read. |

## Scenario Simulator
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/simulator/context` | Private | Cached context. Optional `forceRefresh=true`. |
| GET | `/simulator/history` | Private | Saved scenarios. Query: `limit`, optional `forceRefresh=true`. |
| POST | `/simulator/what-if` | Private | Deterministic simulation. |
| POST | `/simulator/save` | Private | Save scenario. |
| POST | `/simulator/create-sprint` | Private | Merge scenario plan into Career Sprint. |
| DELETE | `/simulator/:id` | Private | Delete saved scenario. |

## Weekly Reports
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/weekly-reports/generate` | Private | Explicit report generation. Query: `forceRefresh=true|false`. |
| GET | `/weekly-reports/latest` | Private | Read latest saved report. |
| GET | `/weekly-reports/history` | Private | Read saved report history. Query: `limit`. |

## Career Sprint
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/career-sprints/current` | Private | Read current sprint. |
| GET | `/career-sprints/history` | Private | Read sprint history. |
| POST | `/career-sprints` | Private | Create sprint. |
| POST | `/career-sprints/generate-plan` | Private | Generate deterministic task plan. |
| POST | `/career-sprints/generate-ai-tasks` | Private | Alias for deterministic task generation. |
| POST | `/career-sprints/generate-ai-plan` | Private | LLM plan generation. |
| POST | `/career-sprints/:id/ai-plans` | Private | Save draft plan. |
| POST | `/career-sprints/:id/import-scenario` | Private | Import scenario plan. |
| POST | `/career-sprints/:id/tasks` | Private | Add task. |
| PUT | `/career-sprints/:id/tasks/:taskId` | Private | Update task completion. |
| PUT | `/career-sprints/:id/dates` | Private | Update sprint dates. |
| POST | `/career-sprints/:id/restore-streak` | Private | Restore streak when allowed. |

## Courses
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/courses` | Private | Deterministic course recommendations. Query: `stack`, `experience`, `platform`, `rating`, `level`, `topic`, `duration`, `page`, `limit`. |

## Jobs
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/jobs` | Private | Search/list jobs. |
| GET | `/jobs/:id` | Private | Job details. |
| GET | `/jobs/source-health` | Private | Source provider health. |
| GET | `/jobs/cache-health` | Private | Source/cache health. |

## Interview Prep
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/interview-prep/questions` | Private | Read questions by topic. |
| GET | `/interview-prep/search` | Private | Search bank. |
| POST | `/interview-prep/generate` | Private | Explicit generation. |
| POST | `/interview-prep/ask-question` | Private | Ask custom question. |
| POST | `/interview-prep` | Private | Create/update practice session. |

## Notifications
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/notifications` | Private | List notifications. |
| GET | `/notifications/stream` | Public stream | Server-sent notification stream endpoint. |
| PUT | `/notifications/:id/read` | Private | Mark one read. |
| PUT | `/notifications/read-all` | Private | Mark all read. |
| DELETE | `/notifications/:id` | Private | Delete notification. |

## Public Profiles
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/public-profiles/:slug` | Public | View public portfolio. |
| GET | `/public-profiles/:slug/resume` | Public | Download public resume when available. |
| GET | `/public-profiles/me` | Private | Read own public profile. |
| PUT | `/public-profiles/me` | Private | Update own public profile. |
| GET | `/public-profiles/me/analytics` | Private | Read analytics. |

## Admin, Recruiter, And Platform
Large role-scoped route families are documented in:
- [features/admin.md](features/admin.md)
- [features/recruiter.md](features/recruiter.md)
- [BACKEND_FLOW.md](BACKEND_FLOW.md)
