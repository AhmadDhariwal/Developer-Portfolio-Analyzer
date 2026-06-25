# DevInsight AI Project Index

Read this file first before changing code. It is the single entry point for coding agents and points to the smallest useful documentation set for each task.

## Agent Workflow
1. Read [agent/AGENT_RULES.md](agent/AGENT_RULES.md).
2. Identify the feature in the table below.
3. Read only that feature doc plus the referenced cross-cutting doc if needed.
4. Edit only the files listed in the feature doc unless the change impact requires more.
5. Run the smallest verification listed by the feature doc.

Example: "Implement frontend caching for Courses" means read this index, then [features/courses.md](features/courses.md), then inspect `CourseService`, `CoursesComponent`, and the listed tests.

## Agent Docs
| Document | Use When |
|---|---|
| [agent/AGENT_RULES.md](agent/AGENT_RULES.md) | Any coding task. Scope, safety, and verification rules. |
| [agent/CODING_AGENT_CONTEXT.md](agent/CODING_AGENT_CONTEXT.md) | One-file project map with structure, flows, files, usage, caches, and change impact. |
| [agent/COMMON_TASKS.md](agent/COMMON_TASKS.md) | Common edit recipes and where to start. |
| [agent/CHANGE_IMPACT.md](agent/CHANGE_IMPACT.md) | Before changing shared models, routes, caches, auth, AI, or profile signals. |

## Feature Docs
| Feature | Documentation | Backend Entry | Frontend Entry |
|---|---|---|---|
| Dashboard | [features/dashboard.md](features/dashboard.md) | `backend/src/controllers/dashboardcontroller.js` | `frontend/src/app/pages/dashboard/` |
| Profile | [features/profile.md](features/profile.md) | `backend/src/controllers/profilecontroller.js` | `frontend/src/app/pages/profile/` |
| GitHub Analyzer | [features/github-analyzer.md](features/github-analyzer.md) | `backend/src/controllers/githubcontroller.js` | `frontend/src/app/pages/github-analyzer/` |
| Resume Analyzer | [features/resume-analyzer.md](features/resume-analyzer.md) | `backend/src/controllers/resumecontoller.js` | `frontend/src/app/pages/resume-analyzer/` |
| Skill Gap | [features/skill-gap.md](features/skill-gap.md) | `backend/src/controllers/skillgapcontroller.js` | `frontend/src/app/pages/skill-gap/` |
| Recommendations | [features/recommendations.md](features/recommendations.md) | `backend/src/controllers/recommendationscontroller.js` | `frontend/src/app/pages/recommendations/` |
| Tech News | [features/news.md](features/news.md) | `backend/src/controllers/newsController.js` | `frontend/src/app/pages/news/` |
| Scenario Simulator | [features/scenario-simulator.md](features/scenario-simulator.md) | `backend/src/controllers/scenarioSimulatorController.js` | `frontend/src/app/pages/scenario-simulator/` |
| Weekly Reports | [features/weekly-reports.md](features/weekly-reports.md) | `backend/src/controllers/weeklyReportController.js` | `frontend/src/app/pages/weekly-reports/` |
| Career Sprint | [features/career-sprint.md](features/career-sprint.md) | `backend/src/controllers/careerSprintController.js` | `frontend/src/app/pages/career-sprint/` |
| Courses | [features/courses.md](features/courses.md) | `backend/src/controllers/courseController.js` | `frontend/src/app/pages/courses/` |
| Jobs | [features/jobs.md](features/jobs.md) | `backend/src/controllers/jobController.js` | `frontend/src/app/pages/jobs/` |
| Interview Prep | [features/interview-prep.md](features/interview-prep.md) | `backend/src/controllers/interviewPrepController.js` | `frontend/src/app/pages/interview-prep/` |
| Notifications | [features/notifications.md](features/notifications.md) | `backend/src/controllers/notificationcontroller.js` | `frontend/src/app/pages/notifications/` |
| Recruiter Hub | [features/recruiter.md](features/recruiter.md) | `backend/src/controllers/recruiter-hub/` | `frontend/src/app/features/recruiter/` |
| Admin and Super Admin | [features/admin.md](features/admin.md) | `backend/src/controllers/adminConsoleController.js`, `backend/src/controllers/superAdminController.js` | `frontend/src/app/admin/`, `frontend/src/app/super-admin/` |

## Cross-Cutting Docs
| Document | Use When |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Need the system shape or deployment boundaries. |
| [BACKEND_FLOW.md](BACKEND_FLOW.md) | Need Express startup, middleware, route registration, or workers. |
| [FRONTEND_FLOW.md](FRONTEND_FLOW.md) | Need Angular route/layout/guard flow. |
| [API_REFERENCE.md](API_REFERENCE.md) | Need endpoint catalog before changing contracts. |
| [DATABASE.md](DATABASE.md) | Need model/schema/index impact. |
| [CACHE_SYSTEM.md](CACHE_SYSTEM.md) | Need cache, signalHash/profileHash, inflight, or TTL behavior. |
| [AI_PIPELINE.md](AI_PIPELINE.md) | Need AI provider, prompt, fallback, or hidden generation behavior. |
| [UI_DESIGN_SYSTEM.md](UI_DESIGN_SYSTEM.md) | Need visual/component consistency. |
| [CODING_GUIDELINES.md](CODING_GUIDELINES.md) | Need repository coding conventions. |
| [DOCUMENTATION_POLICY.md](DOCUMENTATION_POLICY.md) | Need documentation update requirements and merge checklist. |
| [VERIFY_DOCUMENTATION.md](VERIFY_DOCUMENTATION.md) | Need lightweight docs verification steps. |

## Fast Routing
| Task | Start With |
|---|---|
| Add or change profile personalization | [features/profile.md](features/profile.md), then [agent/CHANGE_IMPACT.md](agent/CHANGE_IMPACT.md) |
| Add frontend caching | Feature doc, then [CACHE_SYSTEM.md](CACHE_SYSTEM.md) |
| Add an endpoint | Feature doc, then [API_REFERENCE.md](API_REFERENCE.md) |
| Change AI generation | Feature doc, then [AI_PIPELINE.md](AI_PIPELINE.md) |
| Change shared schema/model | Feature doc, then [DATABASE.md](DATABASE.md) and [agent/CHANGE_IMPACT.md](agent/CHANGE_IMPACT.md) |
| Change routes/navigation | Feature doc, then [FRONTEND_FLOW.md](FRONTEND_FLOW.md) |
