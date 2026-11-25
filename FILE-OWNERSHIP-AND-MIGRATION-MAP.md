# File Ownership and Migration Map

> Branch: `fix/files` · Baseline commit: `2060a276 Fix the component and file system`

## Summary Inventory

| Layer / Batch | Moved | Deleted (0-Consumer Verified) | Created / Extracted |
|---|---:|---:|---:|
| Frontend Batch F1 (`features/notifications/` + dead cleanup) | 4 | 27 | 0 |
| Batch B0 — Dead Code Removal & Shared Validation Extraction | 0 | 11 | 1 |
| Batch B1 — Backend Core Infrastructure (`src/core/`) | 65 | 0 | 0 |
| Batch B2 — Auth & Profile Modules | 15 | 0 | 0 |
| Batch B3 — Notifications, Support & Workflows Modules | 26 | 0 | 0 |
| Batch B4 — Public Portfolio & Weekly Reports Modules | 32 | 0 | 0 |
| Batch B5 — Courses, Jobs & News Modules | 65 | 0 | 0 |
| Batch B6 — Integrations, GitHub & Resume Modules | 56 | 0 | 0 |
| Batch B7 — Skill Gap, Recommendations & Dashboard Modules | 41 | 0 | 0 |
| Batch B8 — Interview Prep, Career Sprint & Scenario Simulator Modules | 58 | 0 | 0 |
| Batch B9 — Recruiter, Admin & Super Admin Modules | 78 | 0 | 0 |
| Batch B11 — Domain-Owned Backend Test Organization (`src/tests/<domain>/`) | 169 | 0 | 0 |
| Batch B10 — Controller Decomposition (`adminConsoleService`, `superAdminAnalyticsService`) | 0 | 0 | 2 |
| **Total** | **609** | **38** | **3** |

## Frontend Finalization (Batch F1)

### Moved to Role-Neutral Ownership

| Old Path | New Path | Reason |
|---|---|---|
| `frontend/src/app/features/developer/pages/notifications/notifications.component.ts` | `frontend/src/app/features/notifications/notifications.component.ts` | Shared across Developer and Recruiter hubs |
| `frontend/src/app/features/developer/pages/notifications/notifications.component.html` | `frontend/src/app/features/notifications/notifications.component.html` | Paired template |
| `frontend/src/app/features/developer/pages/notifications/notifications.component.scss` | `frontend/src/app/features/notifications/notifications.component.scss` | Paired styles |
| `frontend/src/app/features/developer/pages/notifications/notifications.component.spec.ts` | `frontend/src/app/features/notifications/notifications.component.spec.ts` | Paired spec (plus `components/` & `styles/` subfolder) |

### Removed Verified Dead Files (13 Targets, 27 Files)

- `frontend/src/app/core/guards/admin-console.guard.ts`
- `frontend/src/app/shared/services/layout.service.ts`
- `frontend/src/app/shared/services/skill-icon.service.ts`
- `frontend/src/app/shared/components/file-upload/ (3 files)`
- `frontend/src/app/shared/components/suggestion-card/ (3 files)`
- `frontend/src/app/features/recruiter/models/candidate.model.ts`
- `frontend/src/app/features/recruiter/models/match.model.ts`
- `frontend/src/app/features/recruiter/models/recruiter-job.model.ts`
- `frontend/src/app/features/public/pages/public-portfolio/components/cta-section/ (3 files)`
- `frontend/src/app/features/public/pages/public-portfolio/components/testimonial-card/ (3 files)`
- `frontend/src/app/features/public/pages/public-portfolio/components/testimonials-section/ (3 files)`
- `frontend/src/app/features/public/pages/public-portfolio/components/upcoming-project-card/ (3 files)`
- `frontend/src/app/features/public/pages/public-portfolio/components/upcoming-projects-section/ (3 files)`

## Newly Created / Extracted Backend Modules

| File | Purpose | Source Origin |
|---|---|---|
| `backend/src/core/utils/validation.js` | Shared `escapeRegex` and `isValidObjectId` utilities | Deduplicated from 7 backend modules |
| `backend/src/modules/admin/services/adminConsoleService.js` | Team hydration, normalization, performance caching & analytics aggregation | Extracted from `adminConsoleController.js` |
| `backend/src/modules/super-admin/services/superAdminAnalyticsService.js` | Windowing, bucketing, metrics snapshot & analytics computation | Extracted from `superAdminController.js` |

## Batch B0 — Dead Code Removal & Shared Validation Extraction

### Removed Verified 0-Consumer Files

- `backend/src/services/test_gen_ai.js`
- `backend/src/services/analysisservice.js`
- `backend/src/utils/scorecalculator.js`
- `backend/src/services/recruiterService.js`
- `backend/src/middleware/superAdminGuard.js`
- `backend/src/controllers/recruiterController.js`
- `backend/src/controllers/recruiter/recruiterController.js`
- `backend/src/models/newsProviderCircuit.js`
- `backend/src/prompts/jobPrompt.js`
- `backend/src/utils/experienceMapper.js`
- `backend/src/utils/timeEstimator.js`

## Batch B1 — Backend Core Infrastructure (`src/core/`)

### Relocated Files

| Old Path (`backend/src/...`) | New Path (`backend/src/...`) |
|---|---|
| `config/db.js` | `core/config/db.js` |
| `config/env.js` | `core/config/env.js` |
| `config/aiProviders.js` | `core/config/aiProviders.js` |
| `config/githubOauth.js` | `core/config/githubOauth.js` |
| `middleware/authmiddleware.js` | `core/middleware/authmiddleware.js` |
| `middleware/rbacMiddleware.js` | `core/middleware/rbacMiddleware.js` |
| `middleware/orgMiddleware.js` | `core/middleware/orgMiddleware.js` |
| `middleware/securityMiddleware.js` | `core/middleware/securityMiddleware.js` |
| `middleware/requestContextMiddleware.js` | `core/middleware/requestContextMiddleware.js` |
| `middleware/auditLogMiddleware.js` | `core/middleware/auditLogMiddleware.js` |
| `middleware/platformSettingsMiddleware.js` | `core/middleware/platformSettingsMiddleware.js` |
| `middleware/uploadmiddleware.js` | `core/middleware/uploadmiddleware.js` |
| `middleware/avatarUploadMiddleware.js` | `core/middleware/avatarUploadMiddleware.js` |
| `middleware/storedImageMiddleware.js` | `core/middleware/storedImageMiddleware.js` |
| `middleware/publicUploadAccess.js` | `core/middleware/publicUploadAccess.js` |
| `services/redisCacheService.js` | `core/cache/redisCacheService.js` |
| `services/metricsService.js` | `core/observability/metricsService.js` |
| `services/tracingService.js` | `core/observability/tracingService.js` |
| `services/requestAdmissionMetrics.js` | `core/observability/requestAdmissionMetrics.js` |
| `utils/logger.js` | `core/observability/logger.js` |
| `utils/requestLogPath.js` | `core/observability/requestLogPath.js` |
| `services/aiProviderManager.js` | `core/ai/aiProviderManager.js` |
| `services/aiTaskService.js` | `core/ai/aiTaskService.js` |
| `services/aiservice.js` | `core/ai/aiservice.js` |
| `services/aiProviderAdmissionService.js` | `core/ai/aiProviderAdmissionService.js` |
| `services/promptBuilderService.js` | `core/ai/promptBuilderService.js` |
| `models/aiProviderAdmission.js` | `core/ai/models/aiProviderAdmission.js` |
| `models/savedPreview.js` | `core/ai/models/savedPreview.js` |
| `utils/aiRequestBudget.js` | `core/ai/utils/aiRequestBudget.js` |
| `services/b2ObjectStorageService.js` | `core/storage/b2ObjectStorageService.js` |
| `services/publicImageStorageService.js` | `core/storage/publicImageStorageService.js` |
| `services/storedAssetService.js` | `core/storage/storedAssetService.js` |
| `services/imageOptimizationService.js` | `core/storage/imageOptimizationService.js` |
| `services/storageCleanupWorkerService.js` | `core/storage/storageCleanupWorkerService.js` |
| `models/storedAsset.js` | `core/storage/models/storedAsset.js` |
| `utils/imageType.js` | `core/storage/utils/imageType.js` |
| `services/emailService.js` | `core/messaging/emailService.js` |
| `services/emailRetryQueueService.js` | `core/messaging/emailRetryQueueService.js` |
| `services/emailAuditService.js` | `core/messaging/emailAuditService.js` |
| `services/smsService.js` | `core/messaging/smsService.js` |
| `services/invitationEmailService.js` | `core/messaging/invitationEmailService.js` |
| `models/emailDeliveryJob.js` | `core/messaging/models/emailDeliveryJob.js` |
| `services/scoring/README.md` | `core/scoring/README.md` |
| `services/scoring/aggregate.js` | `core/scoring/aggregate.js` |
| `services/scoring/evidence.js` | `core/scoring/evidence.js` |
| `services/scoring/githubHealthScore.js` | `core/scoring/githubHealthScore.js` |
| `services/scoring/index.js` | `core/scoring/index.js` |
| `services/scoring/math.js` | `core/scoring/math.js` |
| `services/scoring/portfolioScore.js` | `core/scoring/portfolioScore.js` |
| `services/scoring/result.js` | `core/scoring/result.js` |
| `services/scoring/resumeOverallScore.js` | `core/scoring/resumeOverallScore.js` |
| `services/scoring/scenarioPlanningLegacy.js` | `core/scoring/scenarioPlanningLegacy.js` |
| `services/scoring/scenarioPlanningRules.js` | `core/scoring/scenarioPlanningRules.js` |
| `services/scoring/scenarioPlanningScore.js` | `core/scoring/scenarioPlanningScore.js` |
| `services/scoring/sprintProgressScore.js` | `core/scoring/sprintProgressScore.js` |
| `services/developerContextService.js` | `core/developer-context/developerContextService.js` |
| `services/developerSignalService.js` | `core/developer-context/developerSignalService.js` |
| `services/transparentScoringService.js` | `core/developer-context/transparentScoringService.js` |
| `utils/dateUtils.js` | `core/utils/dateUtils.js` |
| `utils/hash.js` | `core/utils/hash.js` |
| `utils/roleWeights.js` | `core/utils/roleWeights.js` |
| `utils/marketDemand.js` | `core/utils/marketDemand.js` |
| `utils/skillDifficulty.js` | `core/utils/skillDifficulty.js` |
| `utils/skilldetector.js` | `core/utils/skilldetector.js` |
| `utils/taskTemplates.js` | `core/utils/taskTemplates.js` |

## Batch B2 — Auth & Profile Modules

### Relocated Files

| Old Path (`backend/src/...`) | New Path (`backend/src/...`) |
|---|---|
| `routes/auth.routes.js` | `modules/auth/auth.routes.js` |
| `controllers/authcontroller.js` | `modules/auth/authcontroller.js` |
| `services/oauthAuthService.js` | `modules/auth/services/oauthAuthService.js` |
| `services/otpService.js` | `modules/auth/services/otpService.js` |
| `services/accountDeletionService.js` | `modules/auth/services/accountDeletionService.js` |
| `models/user.js` | `modules/auth/models/user.js` |
| `models/otp.js` | `modules/auth/models/otp.js` |
| `models/pendingRegistration.js` | `modules/auth/models/pendingRegistration.js` |
| `models/accountDeletionCleanup.js` | `modules/auth/models/accountDeletionCleanup.js` |
| `utils/authSessionToken.js` | `modules/auth/utils/authSessionToken.js` |
| `utils/otpGenerator.js` | `modules/auth/utils/otpGenerator.js` |
| `utils/passwordPolicy.js` | `modules/auth/utils/passwordPolicy.js` |
| `utils/passwordResetChallenge.js` | `modules/auth/utils/passwordResetChallenge.js` |
| `routes/profile.routes.js` | `modules/profile/profile.routes.js` |
| `controllers/profilecontroller.js` | `modules/profile/profilecontroller.js` |

## Batch B3 — Notifications, Support & Workflows Modules

### Relocated Files

| Old Path (`backend/src/...`) | New Path (`backend/src/...`) |
|---|---|
| `routes/notification.routes.js` | `modules/notifications/notification.routes.js` |
| `controllers/notificationcontroller.js` | `modules/notifications/notificationcontroller.js` |
| `middleware/notificationAdmission.js` | `modules/notifications/middleware/notificationAdmission.js` |
| `services/notificationService.js` | `modules/notifications/services/notificationService.js` |
| `services/notificationPersistenceService.js` | `modules/notifications/services/notificationPersistenceService.js` |
| `services/notificationRetentionService.js` | `modules/notifications/services/notificationRetentionService.js` |
| `services/notificationStreamService.js` | `modules/notifications/services/notificationStreamService.js` |
| `services/notificationTransactionService.js` | `modules/notifications/services/notificationTransactionService.js` |
| `services/notificationMetrics.js` | `modules/notifications/services/notificationMetrics.js` |
| `models/notification.js` | `modules/notifications/models/notification.js` |
| `models/notificationReceipt.js` | `modules/notifications/models/notificationReceipt.js` |
| `models/notificationState.js` | `modules/notifications/models/notificationState.js` |
| `routes/support.routes.js` | `modules/support/support.routes.js` |
| `controllers/support.controller.js` | `modules/support/support.controller.js` |
| `services/support.service.js` | `modules/support/services/support.service.js` |
| `services/supportNotificationDeliveryService.js` | `modules/support/services/supportNotificationDeliveryService.js` |
| `models/supportTicket.js` | `modules/support/models/supportTicket.js` |
| `models/supportTicketDedupe.js` | `modules/support/models/supportTicketDedupe.js` |
| `models/supportTicketQuota.js` | `modules/support/models/supportTicketQuota.js` |
| `routes/workflow.routes.js` | `modules/workflows/workflow.routes.js` |
| `routes/preview.routes.js` | `modules/workflows/preview.routes.js` |
| `routes/analysis.routes.js` | `modules/workflows/analysis.routes.js` |
| `controllers/workflowcontroller.js` | `modules/workflows/workflowcontroller.js` |
| `controllers/analysiscontroller.js` | `modules/workflows/analysiscontroller.js` |
| `services/workflowExecutorService.js` | `modules/workflows/services/workflowExecutorService.js` |
| `models/workflowRun.js` | `modules/workflows/models/workflowRun.js` |

## Batch B4 — Public Portfolio & Weekly Reports Modules

### Relocated Files

| Old Path (`backend/src/...`) | New Path (`backend/src/...`) |
|---|---|
| `routes/publicProfile.routes.js` | `modules/public-portfolio/publicProfile.routes.js` |
| `controllers/publicProfileController.js` | `modules/public-portfolio/publicProfileController.js` |
| `middleware/publicPortfolioRateLimit.js` | `modules/public-portfolio/middleware/publicPortfolioRateLimit.js` |
| `middleware/portfolioImageUpload.js` | `modules/public-portfolio/middleware/portfolioImageUpload.js` |
| `services/publicProfileService.js` | `modules/public-portfolio/services/publicProfileService.js` |
| `services/publicPortfolioAnalyticsPersistence.js` | `modules/public-portfolio/services/publicPortfolioAnalyticsPersistence.js` |
| `services/publicPortfolioCacheService.js` | `modules/public-portfolio/services/publicPortfolioCacheService.js` |
| `services/publicPortfolioContactService.js` | `modules/public-portfolio/services/publicPortfolioContactService.js` |
| `services/publicPortfolioVisibilityService.js` | `modules/public-portfolio/services/publicPortfolioVisibilityService.js` |
| `models/publicProfile.js` | `modules/public-portfolio/models/publicProfile.js` |
| `models/publicProfileCache.js` | `modules/public-portfolio/models/publicProfileCache.js` |
| `models/publicProfileView.js` | `modules/public-portfolio/models/publicProfileView.js` |
| `models/publicPortfolioVisit.js` | `modules/public-portfolio/models/publicPortfolioVisit.js` |
| `prompts/portfolioScorePrompt.js` | `modules/public-portfolio/prompts/portfolioScorePrompt.js` |
| `routes/weeklyReport.routes.js` | `modules/weekly-reports/weeklyReport.routes.js` |
| `controllers/weeklyReportController.js` | `modules/weekly-reports/weeklyReportController.js` |
| `services/weeklyReportService.js` | `modules/weekly-reports/services/weeklyReportService.js` |
| `services/weeklyReportAdmissionService.js` | `modules/weekly-reports/services/weeklyReportAdmissionService.js` |
| `services/weeklyReportCalendar.js` | `modules/weekly-reports/services/weeklyReportCalendar.js` |
| `services/weeklyReportCoordinationService.js` | `modules/weekly-reports/services/weeklyReportCoordinationService.js` |
| `services/weeklyReportDeliveryService.js` | `modules/weekly-reports/services/weeklyReportDeliveryService.js` |
| `services/weeklyReportEvidence.js` | `modules/weekly-reports/services/weeklyReportEvidence.js` |
| `services/weeklyReportNarrative.js` | `modules/weekly-reports/services/weeklyReportNarrative.js` |
| `services/weeklyReportPdfService.js` | `modules/weekly-reports/services/weeklyReportPdfService.js` |
| `services/weeklyReportPresentation.js` | `modules/weekly-reports/services/weeklyReportPresentation.js` |
| `services/weeklyReportSnapshotService.js` | `modules/weekly-reports/services/weeklyReportSnapshotService.js` |
| `models/weeklyReport.js` | `modules/weekly-reports/models/weeklyReport.js` |
| `models/weeklyReportCoordination.js` | `modules/weekly-reports/models/weeklyReportCoordination.js` |
| `models/weeklyReportRevision.js` | `modules/weekly-reports/models/weeklyReportRevision.js` |
| `prompts/weeklyReportPrompt.js` | `modules/weekly-reports/prompts/weeklyReportPrompt.js` |
| `workers/weeklyReports.js` | `modules/weekly-reports/workers/weeklyReports.js` |
| `assets/fonts/Manrope.ttf` | `modules/weekly-reports/assets/fonts/Manrope.ttf` |

## Batch B5 — Courses, Jobs & News Modules

### Relocated Files

| Old Path (`backend/src/...`) | New Path (`backend/src/...`) |
|---|---|
| `routes/courseRoutes.js` | `modules/courses/courseRoutes.js` |
| `controllers/courseController.js` | `modules/courses/courseController.js` |
| `controllers/courseProgressController.js` | `modules/courses/courseProgressController.js` |
| `middleware/courseAdmission.js` | `modules/courses/middleware/courseAdmission.js` |
| `services/courseService.js` | `modules/courses/services/courseService.js` |
| `services/sharedCourseCatalogService.js` | `modules/courses/services/sharedCourseCatalogService.js` |
| `services/courseCatalogAcquisitionService.js` | `modules/courses/services/courseCatalogAcquisitionService.js` |
| `services/courseCatalogConstants.js` | `modules/courses/services/courseCatalogConstants.js` |
| `services/courseCatalogCoverageService.js` | `modules/courses/services/courseCatalogCoverageService.js` |
| `services/courseCatalogMaintenanceService.js` | `modules/courses/services/courseCatalogMaintenanceService.js` |
| `services/courseCatalogSearchService.js` | `modules/courses/services/courseCatalogSearchService.js` |
| `services/courseCatalogTaxonomy.js` | `modules/courses/services/courseCatalogTaxonomy.js` |
| `services/courseDiscoveryStatusService.js` | `modules/courses/services/courseDiscoveryStatusService.js` |
| `services/courseGovernanceService.js` | `modules/courses/services/courseGovernanceService.js` |
| `services/courseHandoffService.js` | `modules/courses/services/courseHandoffService.js` |
| `services/coursePersonalizationService.js` | `modules/courses/services/coursePersonalizationService.js` |
| `services/courseProgressService.js` | `modules/courses/services/courseProgressService.js` |
| `services/courseRecommendationService.js` | `modules/courses/services/courseRecommendationService.js` |
| `models/userCourseProgress.js` | `modules/courses/models/userCourseProgress.js` |
| `prompts/coursePrompt.js` | `modules/courses/prompts/coursePrompt.js` |
| `utils/courseIdentity.js` | `modules/courses/utils/courseIdentity.js` |
| `data/courseCatalog.js` | `modules/courses/data/courseCatalog.js` |
| `data/courseAcquisitionCatalog.js` | `modules/courses/data/courseAcquisitionCatalog.js` |
| `data/openLearningCatalog.js` | `modules/courses/data/openLearningCatalog.js` |
| `data/courseAcquisitionSources.md` | `modules/courses/data/courseAcquisitionSources.md` |
| `routes/jobRoutes.js` | `modules/jobs/jobRoutes.js` |
| `controllers/jobController.js` | `modules/jobs/jobController.js` |
| `controllers/jobActionController.js` | `modules/jobs/jobActionController.js` |
| `middleware/jobsRateLimit.js` | `modules/jobs/middleware/jobsRateLimit.js` |
| `services/jobService.js` | `modules/jobs/services/jobService.js` |
| `services/jobActionService.js` | `modules/jobs/services/jobActionService.js` |
| `services/jobGovernanceService.js` | `modules/jobs/services/jobGovernanceService.js` |
| `services/jobPoolCacheService.js` | `modules/jobs/services/jobPoolCacheService.js` |
| `services/jobProviderTransport.js` | `modules/jobs/services/jobProviderTransport.js` |
| `services/jobSourceSyncService.js` | `modules/jobs/services/jobSourceSyncService.js` |
| `services/jobsHiddenAccessService.js` | `modules/jobs/services/jobsHiddenAccessService.js` |
| `models/jobCache.js` | `modules/jobs/models/jobCache.js` |
| `models/jobSourceHealth.js` | `modules/jobs/models/jobSourceHealth.js` |
| `models/userJobAction.js` | `modules/jobs/models/userJobAction.js` |
| `utils/jobRanker.js` | `modules/jobs/utils/jobRanker.js` |
| `routes/newsRoutes.js` | `modules/news/newsRoutes.js` |
| `controllers/newsController.js` | `modules/news/newsController.js` |
| `middleware/newsMiddleware.js` | `modules/news/middleware/newsMiddleware.js` |
| `config/newsProviderKeys.js` | `modules/news/config/newsProviderKeys.js` |
| `config/newsConfig.js` | `modules/news/config/newsConfig.js` |
| `config/newsEnvCatalog.js` | `modules/news/config/newsEnvCatalog.js` |
| `services/newsService.js` | `modules/news/services/newsService.js` |
| `services/newsAdaptiveService.js` | `modules/news/services/newsAdaptiveService.js` |
| `services/newsCatalogService.js` | `modules/news/services/newsCatalogService.js` |
| `services/newsDiscoveryProviders.js` | `modules/news/services/newsDiscoveryProviders.js` |
| `services/newsDiscoveryService.js` | `modules/news/services/newsDiscoveryService.js` |
| `services/newsGovernanceService.js` | `modules/news/services/newsGovernanceService.js` |
| `services/newsMetricsService.js` | `modules/news/services/newsMetricsService.js` |
| `services/newsPoolService.js` | `modules/news/services/newsPoolService.js` |
| `services/newsSkillEvidenceService.js` | `modules/news/services/newsSkillEvidenceService.js` |
| `models/news.js` | `modules/news/models/news.js` |
| `models/newsArticle.js` | `modules/news/models/newsArticle.js` |
| `models/newsSavedItem.js` | `modules/news/models/newsSavedItem.js` |
| `models/newsTopicCache.js` | `modules/news/models/newsTopicCache.js` |
| `utils/newsFormatter.js` | `modules/news/utils/newsFormatter.js` |
| `utils/newsProviderErrors.js` | `modules/news/utils/newsProviderErrors.js` |
| `utils/newsQuery.js` | `modules/news/utils/newsQuery.js` |
| `utils/newsRanker.js` | `modules/news/utils/newsRanker.js` |
| `utils/newsTopics.js` | `modules/news/utils/newsTopics.js` |
| `utils/newsUrl.js` | `modules/news/utils/newsUrl.js` |

## Batch B6 — Integrations, GitHub & Resume Modules

### Relocated Files

| Old Path (`backend/src/...`) | New Path (`backend/src/...`) |
|---|---|
| `routes/integrations.routes.js` | `modules/integrations/integrations.routes.js` |
| `controllers/integrationscontroller.js` | `modules/integrations/integrationscontroller.js` |
| `controllers/integrationLinkedProfilescontroller.js` | `modules/integrations/integrationLinkedProfilescontroller.js` |
| `middleware/integrationWebhookBody.js` | `modules/integrations/middleware/integrationWebhookBody.js` |
| `services/integrationGovernanceService.js` | `modules/integrations/services/integrationGovernanceService.js` |
| `services/integrationInsightService.js` | `modules/integrations/services/integrationInsightService.js` |
| `services/integrationLinkedProfileService.js` | `modules/integrations/services/integrationLinkedProfileService.js` |
| `services/integrationMongoGovernanceService.js` | `modules/integrations/services/integrationMongoGovernanceService.js` |
| `services/integrationNormalizationService.js` | `modules/integrations/services/integrationNormalizationService.js` |
| `services/integrationPersistenceService.js` | `modules/integrations/services/integrationPersistenceService.js` |
| `services/integrationPublicSnapshotService.js` | `modules/integrations/services/integrationPublicSnapshotService.js` |
| `services/integrationSyncService.js` | `modules/integrations/services/integrationSyncService.js` |
| `services/integrationTokenService.js` | `modules/integrations/services/integrationTokenService.js` |
| `services/kaggleResourceObservationService.js` | `modules/integrations/services/kaggleResourceObservationService.js` |
| `services/integrations/baseAdapter.js` | `modules/integrations/services/adapters/baseAdapter.js` |
| `services/integrations/certificationsAdapter.js` | `modules/integrations/services/adapters/certificationsAdapter.js` |
| `services/integrations/devBlogsAdapter.js` | `modules/integrations/services/adapters/devBlogsAdapter.js` |
| `services/integrations/githubAdapter.js` | `modules/integrations/services/adapters/githubAdapter.js` |
| `services/integrations/hackerrankAdapter.js` | `modules/integrations/services/adapters/hackerrankAdapter.js` |
| `services/integrations/hashnodePublication.js` | `modules/integrations/services/adapters/hashnodePublication.js` |
| `services/integrations/index.js` | `modules/integrations/services/adapters/index.js` |
| `services/integrations/kaggleAdapter.js` | `modules/integrations/services/adapters/kaggleAdapter.js` |
| `services/integrations/kaggleResourceExtractor.js` | `modules/integrations/services/adapters/kaggleResourceExtractor.js` |
| `services/integrations/kaggleResources.js` | `modules/integrations/services/adapters/kaggleResources.js` |
| `services/integrations/leetcodeAdapter.js` | `modules/integrations/services/adapters/leetcodeAdapter.js` |
| `services/integrations/linkedinAdapter.js` | `modules/integrations/services/adapters/linkedinAdapter.js` |
| `services/integrations/portfolioScannerAdapter.js` | `modules/integrations/services/adapters/portfolioScannerAdapter.js` |
| `services/integrations/stackoverflowAdapter.js` | `modules/integrations/services/adapters/stackoverflowAdapter.js` |
| `models/integrationConnection.js` | `modules/integrations/models/integrationConnection.js` |
| `models/integrationGovernanceState.js` | `modules/integrations/models/integrationGovernanceState.js` |
| `models/integrationInsight.js` | `modules/integrations/models/integrationInsight.js` |
| `models/integrationLinkedProfile.js` | `modules/integrations/models/integrationLinkedProfile.js` |
| `models/integrationPublicSnapshot.js` | `modules/integrations/models/integrationPublicSnapshot.js` |
| `models/integrationSyncLog.js` | `modules/integrations/models/integrationSyncLog.js` |
| `routes/github.routes.js` | `modules/github/github.routes.js` |
| `controllers/githubcontroller.js` | `modules/github/githubcontroller.js` |
| `services/githubservice.js` | `modules/github/services/githubservice.js` |
| `models/githubAnalysisCache.js` | `modules/github/models/githubAnalysisCache.js` |
| `models/githubSaveLock.js` | `modules/github/models/githubSaveLock.js` |
| `models/repository.js` | `modules/github/models/repository.js` |
| `prompts/githubPrompt.js` | `modules/github/prompts/githubPrompt.js` |
| `routes/resume.routes.js` | `modules/resume/resume.routes.js` |
| `controllers/resumecontoller.js` | `modules/resume/resumecontoller.js` |
| `middleware/resumeAdmission.js` | `modules/resume/middleware/resumeAdmission.js` |
| `services/resumeservice.js` | `modules/resume/services/resumeservice.js` |
| `services/resumeContentQuality.js` | `modules/resume/services/resumeContentQuality.js` |
| `services/resumeGuideService.js` | `modules/resume/services/resumeGuideService.js` |
| `services/resumePdfExtraction.js` | `modules/resume/services/resumePdfExtraction.js` |
| `services/resumeStorageService.js` | `modules/resume/services/resumeStorageService.js` |
| `services/previewResumeCacheService.js` | `modules/resume/services/previewResumeCacheService.js` |
| `models/resumeAnalysis.js` | `modules/resume/models/resumeAnalysis.js` |
| `models/resumeAnalysisCache.js` | `modules/resume/models/resumeAnalysisCache.js` |
| `models/resumeFile.js` | `modules/resume/models/resumeFile.js` |
| `prompts/resumePrompt.js` | `modules/resume/prompts/resumePrompt.js` |
| `prompts/resumeGuidePrompt.js` | `modules/resume/prompts/resumeGuidePrompt.js` |
| `templates/resumeGuideTemplate.js` | `modules/resume/templates/resumeGuideTemplate.js` |

## Batch B7 — Skill Gap, Recommendations & Dashboard Modules

### Relocated Files

| Old Path (`backend/src/...`) | New Path (`backend/src/...`) |
|---|---|
| `routes/skillgap.routes.js` | `modules/skill-gap/skillgap.routes.js` |
| `routes/skillgraph.routes.js` | `modules/skill-gap/skillgraph.routes.js` |
| `controllers/skillgapcontroller.js` | `modules/skill-gap/skillgapcontroller.js` |
| `controllers/skillgraphcontroller.js` | `modules/skill-gap/skillgraphcontroller.js` |
| `middleware/skillGapAdmission.js` | `modules/skill-gap/middleware/skillGapAdmission.js` |
| `services/skillGapCacheContract.js` | `modules/skill-gap/services/skillGapCacheContract.js` |
| `services/skillGapCompatibilityService.js` | `modules/skill-gap/services/skillGapCompatibilityService.js` |
| `services/skillGapEvidenceService.js` | `modules/skill-gap/services/skillGapEvidenceService.js` |
| `services/skillGapGovernanceService.js` | `modules/skill-gap/services/skillGapGovernanceService.js` |
| `services/skillGapMetrics.js` | `modules/skill-gap/services/skillGapMetrics.js` |
| `services/skillGapRequirements.js` | `modules/skill-gap/services/skillGapRequirements.js` |
| `services/skillGapResumeClaimsService.js` | `modules/skill-gap/services/skillGapResumeClaimsService.js` |
| `services/skillGapScoringService.js` | `modules/skill-gap/services/skillGapScoringService.js` |
| `services/skillGraphService.js` | `modules/skill-gap/services/skillGraphService.js` |
| `models/analysis.js` | `modules/skill-gap/models/analysis.js` |
| `models/analysisCache.js` | `modules/skill-gap/models/analysisCache.js` |
| `models/skill.js` | `modules/skill-gap/models/skill.js` |
| `models/skillGraph.js` | `modules/skill-gap/models/skillGraph.js` |
| `prompts/skillGapPrompt.js` | `modules/skill-gap/prompts/skillGapPrompt.js` |
| `routes/recommendations.routes.js` | `modules/recommendations/recommendations.routes.js` |
| `controllers/recommendationscontroller.js` | `modules/recommendations/recommendationscontroller.js` |
| `middleware/recommendationAdmission.js` | `modules/recommendations/middleware/recommendationAdmission.js` |
| `services/recommendationService.js` | `modules/recommendations/services/recommendationService.js` |
| `services/recommendationEngineService.js` | `modules/recommendations/services/recommendationEngineService.js` |
| `services/recommendationGenerationService.js` | `modules/recommendations/services/recommendationGenerationService.js` |
| `services/recommendationGovernanceService.js` | `modules/recommendations/services/recommendationGovernanceService.js` |
| `services/recommendationHandoffService.js` | `modules/recommendations/services/recommendationHandoffService.js` |
| `services/recommendationHistoryService.js` | `modules/recommendations/services/recommendationHistoryService.js` |
| `services/recommendationNarrativeService.js` | `modules/recommendations/services/recommendationNarrativeService.js` |
| `models/recommendation.js` | `modules/recommendations/models/recommendation.js` |
| `prompts/recommendationPrompt.js` | `modules/recommendations/prompts/recommendationPrompt.js` |
| `utils/recommendationUtilities.js` | `modules/recommendations/utils/recommendationUtilities.js` |
| `routes/dashboard.routes.js` | `modules/dashboard/dashboard.routes.js` |
| `controllers/dashboardcontroller.js` | `modules/dashboard/dashboardcontroller.js` |
| `services/dashboardConsistencyService.js` | `modules/dashboard/services/dashboardConsistencyService.js` |
| `services/dashboardHistoryService.js` | `modules/dashboard/services/dashboardHistoryService.js` |
| `services/dashboardMetricsService.js` | `modules/dashboard/services/dashboardMetricsService.js` |
| `services/dashboardProgressService.js` | `modules/dashboard/services/dashboardProgressService.js` |
| `services/dashboardQueryService.js` | `modules/dashboard/services/dashboardQueryService.js` |
| `models/stats.js` | `modules/dashboard/models/stats.js` |
| `utils/dashboardActivity.js` | `modules/dashboard/utils/dashboardActivity.js` |

## Batch B8 — Interview Prep, Career Sprint & Scenario Simulator Modules

### Relocated Files

| Old Path (`backend/src/...`) | New Path (`backend/src/...`) |
|---|---|
| `routes/interviewPrep.routes.js` | `modules/interview-prep/interviewPrep.routes.js` |
| `controllers/interviewPrepController.js` | `modules/interview-prep/interviewPrepController.js` |
| `repositories/interviewQuestionRepository.js` | `modules/interview-prep/repositories/interviewQuestionRepository.js` |
| `services/interviewPrepService.js` | `modules/interview-prep/services/interviewPrepService.js` |
| `services/interviewAIValidation.js` | `modules/interview-prep/services/interviewAIValidation.js` |
| `services/interviewAnswerCoverage.js` | `modules/interview-prep/services/interviewAnswerCoverage.js` |
| `services/interviewCoordinationService.js` | `modules/interview-prep/services/interviewCoordinationService.js` |
| `services/interviewCoverageAudit.js` | `modules/interview-prep/services/interviewCoverageAudit.js` |
| `services/interviewCoverageService.js` | `modules/interview-prep/services/interviewCoverageService.js` |
| `services/interviewEnrichmentOrchestrator.js` | `modules/interview-prep/services/interviewEnrichmentOrchestrator.js` |
| `services/interviewGenerationFlight.js` | `modules/interview-prep/services/interviewGenerationFlight.js` |
| `services/interviewJobService.js` | `modules/interview-prep/services/interviewJobService.js` |
| `services/interviewProjectContext.js` | `modules/interview-prep/services/interviewProjectContext.js` |
| `services/interviewQuestionFilters.js` | `modules/interview-prep/services/interviewQuestionFilters.js` |
| `services/interviewQuestionIngestionService.js` | `modules/interview-prep/services/interviewQuestionIngestionService.js` |
| `services/interviewQuestionMaintenanceService.js` | `modules/interview-prep/services/interviewQuestionMaintenanceService.js` |
| `services/interviewQuestionQualityService.js` | `modules/interview-prep/services/interviewQuestionQualityService.js` |
| `services/interviewQuestionSeedCatalog.js` | `modules/interview-prep/services/interviewQuestionSeedCatalog.js` |
| `services/interviewSessionService.js` | `modules/interview-prep/services/interviewSessionService.js` |
| `services/interviewTopicNormalizer.js` | `modules/interview-prep/services/interviewTopicNormalizer.js` |
| `services/providers/interviewAIProvider.js` | `modules/interview-prep/providers/interviewAIProvider.js` |
| `services/providers/interviewScraperProvider.js` | `modules/interview-prep/providers/interviewScraperProvider.js` |
| `models/interviewQuestionBank.js` | `modules/interview-prep/models/interviewQuestionBank.js` |
| `models/interviewPrepSession.js` | `modules/interview-prep/models/interviewPrepSession.js` |
| `models/interviewCoordination.js` | `modules/interview-prep/models/interviewCoordination.js` |
| `models/interviewJobLease.js` | `modules/interview-prep/models/interviewJobLease.js` |
| `prompts/interviewPrepPrompt.js` | `modules/interview-prep/prompts/interviewPrepPrompt.js` |
| `routes/careerSprint.routes.js` | `modules/career-sprint/careerSprint.routes.js` |
| `controllers/careerSprintController.js` | `modules/career-sprint/careerSprintController.js` |
| `controllers/sprintPreferenceController.js` | `modules/career-sprint/sprintPreferenceController.js` |
| `services/careerSprintService.js` | `modules/career-sprint/services/careerSprintService.js` |
| `services/sprintAiAdmissionService.js` | `modules/career-sprint/services/sprintAiAdmissionService.js` |
| `services/sprintAiSelectionService.js` | `modules/career-sprint/services/sprintAiSelectionService.js` |
| `services/sprintDraftContextService.js` | `modules/career-sprint/services/sprintDraftContextService.js` |
| `services/sprintLegacyPolicy.js` | `modules/career-sprint/services/sprintLegacyPolicy.js` |
| `services/sprintOverviewCacheService.js` | `modules/career-sprint/services/sprintOverviewCacheService.js` |
| `services/sprintPreferenceService.js` | `modules/career-sprint/services/sprintPreferenceService.js` |
| `services/sprintRecommendationAdapter.js` | `modules/career-sprint/services/sprintRecommendationAdapter.js` |
| `services/sprintReservationMigrationService.js` | `modules/career-sprint/services/sprintReservationMigrationService.js` |
| `services/sprintReservationService.js` | `modules/career-sprint/services/sprintReservationService.js` |
| `services/sprintStreakPolicy.js` | `modules/career-sprint/services/sprintStreakPolicy.js` |
| `services/sprintTaskProvenanceService.js` | `modules/career-sprint/services/sprintTaskProvenanceService.js` |
| `services/streakService.js` | `modules/career-sprint/services/streakService.js` |
| `models/careerSprint.js` | `modules/career-sprint/models/careerSprint.js` |
| `models/sprintPreference.js` | `modules/career-sprint/models/sprintPreference.js` |
| `models/sprintSchedule.js` | `modules/career-sprint/models/sprintSchedule.js` |
| `prompts/careerSprintPrompt.js` | `modules/career-sprint/prompts/careerSprintPrompt.js` |
| `utils/sprintCalendar.js` | `modules/career-sprint/utils/sprintCalendar.js` |
| `routes/scenarioSimulator.routes.js` | `modules/scenario-simulator/scenarioSimulator.routes.js` |
| `controllers/scenarioSimulatorController.js` | `modules/scenario-simulator/scenarioSimulatorController.js` |
| `middleware/scenarioSimulatorMiddleware.js` | `modules/scenario-simulator/middleware/scenarioSimulatorMiddleware.js` |
| `services/scenarioContextService.js` | `modules/scenario-simulator/services/scenarioContextService.js` |
| `services/scenarioSimulatorService.js` | `modules/scenario-simulator/services/scenarioSimulatorService.js` |
| `services/scenarioSprintAdapter.js` | `modules/scenario-simulator/services/scenarioSprintAdapter.js` |
| `services/scenarioSprintExportService.js` | `modules/scenario-simulator/services/scenarioSprintExportService.js` |
| `services/scenarioTelemetryService.js` | `modules/scenario-simulator/services/scenarioTelemetryService.js` |
| `models/scenarioSimulation.js` | `modules/scenario-simulator/models/scenarioSimulation.js` |
| `utils/scenarioIdentity.js` | `modules/scenario-simulator/utils/scenarioIdentity.js` |

## Batch B9 — Recruiter, Admin & Super Admin Modules

### Relocated Files

| Old Path (`backend/src/...`) | New Path (`backend/src/...`) |
|---|---|
| `routes/recruiter.routes.js` | `modules/recruiter/routes/recruiter.routes.js` |
| `routes/recruiter-hub/activityRoutes.js` | `modules/recruiter/routes/hub/activityRoutes.js` |
| `routes/recruiter-hub/analyticsRoutes.js` | `modules/recruiter/routes/hub/analyticsRoutes.js` |
| `routes/recruiter-hub/candidateRoutes.js` | `modules/recruiter/routes/hub/candidateRoutes.js` |
| `routes/recruiter-hub/matchRoutes.js` | `modules/recruiter/routes/hub/matchRoutes.js` |
| `routes/recruiter-hub/recruiterHubRoutes.js` | `modules/recruiter/routes/hub/recruiterHubRoutes.js` |
| `routes/recruiter-hub/recruiterJobRoutes.js` | `modules/recruiter/routes/hub/recruiterJobRoutes.js` |
| `routes/recruiter-hub/shortlistRoutes.js` | `modules/recruiter/routes/hub/shortlistRoutes.js` |
| `controllers/recruiter/candidateController.js` | `modules/recruiter/controllers/matching/candidateController.js` |
| `controllers/recruiter/dashboardController.js` | `modules/recruiter/controllers/matching/dashboardController.js` |
| `controllers/recruiter/index.js` | `modules/recruiter/controllers/matching/index.js` |
| `controllers/recruiter/jobController.js` | `modules/recruiter/controllers/matching/jobController.js` |
| `controllers/recruiter/matchController.js` | `modules/recruiter/controllers/matching/matchController.js` |
| `controllers/recruiter-hub/candidateController.js` | `modules/recruiter/controllers/hub/candidateController.js` |
| `controllers/recruiter-hub/comparisonController.js` | `modules/recruiter/controllers/hub/comparisonController.js` |
| `controllers/recruiter-hub/matchController.js` | `modules/recruiter/controllers/hub/matchController.js` |
| `controllers/recruiter-hub/recruiterActivityController.js` | `modules/recruiter/controllers/hub/recruiterActivityController.js` |
| `controllers/recruiter-hub/recruiterAnalyticsController.js` | `modules/recruiter/controllers/hub/recruiterAnalyticsController.js` |
| `controllers/recruiter-hub/recruiterDashboardController.js` | `modules/recruiter/controllers/hub/recruiterDashboardController.js` |
| `controllers/recruiter-hub/recruiterJobController.js` | `modules/recruiter/controllers/hub/recruiterJobController.js` |
| `controllers/recruiter-hub/recruiterProfileController.js` | `modules/recruiter/controllers/hub/recruiterProfileController.js` |
| `controllers/recruiter-hub/shortlistController.js` | `modules/recruiter/controllers/hub/shortlistController.js` |
| `services/recruiter/aiRankingService.js` | `modules/recruiter/services/matching/aiRankingService.js` |
| `services/recruiter/matchingService.js` | `modules/recruiter/services/matching/matchingService.js` |
| `services/ai/aiRankingService.js` | `modules/recruiter/compatibility/aiRankingService.js` |
| `services/recruiter-hub/candidateService.js` | `modules/recruiter/services/hub/candidateService.js` |
| `services/recruiter-hub/comparisonService.js` | `modules/recruiter/services/hub/comparisonService.js` |
| `services/recruiter-hub/matchService.js` | `modules/recruiter/services/hub/matchService.js` |
| `services/recruiter-hub/recruiterActivityService.js` | `modules/recruiter/services/hub/recruiterActivityService.js` |
| `services/recruiter-hub/recruiterAnalyticsService.js` | `modules/recruiter/services/hub/recruiterAnalyticsService.js` |
| `services/recruiter-hub/recruiterDashboardService.js` | `modules/recruiter/services/hub/recruiterDashboardService.js` |
| `services/recruiter-hub/recruiterJobService.js` | `modules/recruiter/services/hub/recruiterJobService.js` |
| `services/recruiter-hub/recruiterProfileService.js` | `modules/recruiter/services/hub/recruiterProfileService.js` |
| `services/recruiter-hub/shortlistService.js` | `modules/recruiter/services/hub/shortlistService.js` |
| `models/Candidate.js` | `modules/recruiter/models/Candidate.js` |
| `models/Job.js` | `modules/recruiter/models/Job.js` |
| `models/Recruiter.js` | `modules/recruiter/models/Recruiter.js` |
| `models/RecruiterMatch.js` | `modules/recruiter/models/RecruiterMatch.js` |
| `models/RecruiterShortlist.js` | `modules/recruiter/models/RecruiterShortlist.js` |
| `utils/recruiter/explanationEngine.js` | `modules/recruiter/utils/matching/explanationEngine.js` |
| `utils/recruiter/featureExtractor.js` | `modules/recruiter/utils/matching/featureExtractor.js` |
| `utils/recruiter/potentialPredictor.js` | `modules/recruiter/utils/matching/potentialPredictor.js` |
| `utils/recruiter/scoringEngine.js` | `modules/recruiter/utils/matching/scoringEngine.js` |
| `utils/recruiter/weightConfig.js` | `modules/recruiter/utils/matching/weightConfig.js` |
| `utils/recruiter-hub/candidateFormatter.js` | `modules/recruiter/utils/hub/candidateFormatter.js` |
| `utils/recruiter-hub/matchCalculator.js` | `modules/recruiter/utils/hub/matchCalculator.js` |
| `utils/recruiter-hub/recruiterAccess.js` | `modules/recruiter/utils/hub/recruiterAccess.js` |
| `utils/recruiter-hub/recruiterAnalyticsBuilder.js` | `modules/recruiter/utils/hub/recruiterAnalyticsBuilder.js` |
| `utils/ai/explanationEngine.js` | `modules/recruiter/compatibility/utils/explanationEngine.js` |
| `utils/ai/featureExtractor.js` | `modules/recruiter/compatibility/utils/featureExtractor.js` |
| `utils/ai/scoringEngine.js` | `modules/recruiter/compatibility/utils/scoringEngine.js` |
| `utils/ai/weightConfig.js` | `modules/recruiter/compatibility/utils/weightConfig.js` |
| `routes/admin.routes.js` | `modules/admin/routes/admin.routes.js` |
| `routes/adminConsole.routes.js` | `modules/admin/routes/adminConsole.routes.js` |
| `routes/tenant.routes.js` | `modules/admin/routes/tenant.routes.js` |
| `routes/audit.routes.js` | `modules/admin/routes/audit.routes.js` |
| `controllers/admin/adminController.js` | `modules/admin/controllers/adminController.js` |
| `controllers/admin/jobController.js` | `modules/admin/controllers/jobController.js` |
| `controllers/admin/recruiterController.js` | `modules/admin/controllers/recruiterController.js` |
| `controllers/adminConsoleController.js` | `modules/admin/controllers/adminConsoleController.js` |
| `controllers/tenantcontroller.js` | `modules/admin/controllers/tenantcontroller.js` |
| `controllers/auditLogController.js` | `modules/admin/controllers/auditLogController.js` |
| `services/admin/teamAnalyticsService.js` | `modules/admin/services/teamAnalyticsService.js` |
| `services/tenantService.js` | `modules/admin/services/tenantService.js` |
| `models/organization.js` | `modules/admin/models/organization.js` |
| `models/membership.js` | `modules/admin/models/membership.js` |
| `models/team.js` | `modules/admin/models/team.js` |
| `models/invitation.js` | `modules/admin/models/invitation.js` |
| `models/auditLog.js` | `modules/admin/models/auditLog.js` |
| `routes/super-admin.routes.js` | `modules/super-admin/routes/super-admin.routes.js` |
| `routes/aiversions.routes.js` | `modules/super-admin/routes/aiversions.routes.js` |
| `controllers/superAdminController.js` | `modules/super-admin/controllers/superAdminController.js` |
| `controllers/superAdminSettingsController.js` | `modules/super-admin/controllers/superAdminSettingsController.js` |
| `controllers/aiversioncontroller.js` | `modules/super-admin/controllers/aiversioncontroller.js` |
| `services/platformSettingsService.js` | `modules/super-admin/services/platformSettingsService.js` |
| `services/aiVersionService.js` | `modules/super-admin/services/aiVersionService.js` |
| `models/platformSettings.js` | `modules/super-admin/models/platformSettings.js` |
| `models/aiVersion.js` | `modules/super-admin/models/aiVersion.js` |

## Batch B11 — Domain-Owned Backend Test Organization (`src/tests/<domain>/`)

### Relocated Files

| Old Path (`backend/src/...`) | New Path (`backend/src/...`) |
|---|---|
| `tests/aiCompatibilityPaths.test.js` | `tests/recruiter/aiCompatibilityPaths.test.js` |
| `tests/aiProviderAdmission.integration.test.js` | `tests/core/aiProviderAdmission.integration.test.js` |
| `tests/aiProviderPlatform.test.js` | `tests/core/aiProviderPlatform.test.js` |
| `tests/b2Storage.test.js` | `tests/core/b2Storage.test.js` |
| `tests/backendTapInventory.test.js` | `tests/core/backendTapInventory.test.js` |
| `tests/careerSprintFinalization.test.js` | `tests/career-sprint/careerSprintFinalization.test.js` |
| `tests/careerSprintHardening.test.js` | `tests/career-sprint/careerSprintHardening.test.js` |
| `tests/careerSprintLegacy.integration.test.js` | `tests/career-sprint/careerSprintLegacy.integration.test.js` |
| `tests/careerSprintLegacyPolicy.test.js` | `tests/career-sprint/careerSprintLegacyPolicy.test.js` |
| `tests/careerSprintMongo.integration.test.js` | `tests/career-sprint/careerSprintMongo.integration.test.js` |
| `tests/careerSprintPerformance.test.js` | `tests/career-sprint/careerSprintPerformance.test.js` |
| `tests/careerSprintPlanningFinalization.test.js` | `tests/career-sprint/careerSprintPlanningFinalization.test.js` |
| `tests/careerSprintReleasePolicies.test.js` | `tests/career-sprint/careerSprintReleasePolicies.test.js` |
| `tests/careerSprintService.test.js` | `tests/career-sprint/careerSprintService.test.js` |
| `tests/careerSprintWorkers.integration.test.js` | `tests/career-sprint/careerSprintWorkers.integration.test.js` |
| `tests/courseCatalogAcquisition.test.js` | `tests/courses/courseCatalogAcquisition.test.js` |
| `tests/courseCatalogCoverage.integration.test.js` | `tests/courses/courseCatalogCoverage.integration.test.js` |
| `tests/courseIntelligentDiscovery.integration.test.js` | `tests/courses/courseIntelligentDiscovery.integration.test.js` |
| `tests/coursePersonalizedEligibility.test.js` | `tests/courses/coursePersonalizedEligibility.test.js` |
| `tests/courseSearchRelevance.integration.test.js` | `tests/courses/courseSearchRelevance.integration.test.js` |
| `tests/courseTopicRelevance.test.js` | `tests/courses/courseTopicRelevance.test.js` |
| `tests/courseViewSeparation.integration.test.js` | `tests/courses/courseViewSeparation.integration.test.js` |
| `tests/coursesDiscovery.integration.test.js` | `tests/courses/coursesDiscovery.integration.test.js` |
| `tests/coursesFinalization.test.js` | `tests/courses/coursesFinalization.test.js` |
| `tests/coursesHardening.test.js` | `tests/courses/coursesHardening.test.js` |
| `tests/coursesMongo.integration.test.js` | `tests/courses/coursesMongo.integration.test.js` |
| `tests/coursesPerformance.test.js` | `tests/courses/coursesPerformance.test.js` |
| `tests/coursesPoolWorkers.integration.test.js` | `tests/courses/coursesPoolWorkers.integration.test.js` |
| `tests/coursesProviderVerification.test.js` | `tests/courses/coursesProviderVerification.test.js` |
| `tests/dashboardConsistency.test.js` | `tests/dashboard/dashboardConsistency.test.js` |
| `tests/dashboardEndpoints.test.js` | `tests/dashboard/dashboardEndpoints.test.js` |
| `tests/dashboardMetrics.test.js` | `tests/dashboard/dashboardMetrics.test.js` |
| `tests/dashboardPortfolioScope.test.js` | `tests/dashboard/dashboardPortfolioScope.test.js` |
| `tests/dashboardProvenance.test.js` | `tests/dashboard/dashboardProvenance.test.js` |
| `tests/developerContextService.test.js` | `tests/core/developerContextService.test.js` |
| `tests/githubAnalyzerHardening.test.js` | `tests/github/githubAnalyzerHardening.test.js` |
| `tests/githubAnalyzerPerformance.test.js` | `tests/github/githubAnalyzerPerformance.test.js` |
| `tests/hashnodePublication.test.js` | `tests/integrations/hashnodePublication.test.js` |
| `tests/imageOptimization.test.js` | `tests/core/imageOptimization.test.js` |
| `tests/integrationInsightService.test.js` | `tests/integrations/integrationInsightService.test.js` |
| `tests/integrationLinkedProfiles.test.js` | `tests/integrations/integrationLinkedProfiles.test.js` |
| `tests/integrationMongoGovernance.test.js` | `tests/integrations/integrationMongoGovernance.test.js` |
| `tests/integrationPublicSnapshot.test.js` | `tests/integrations/integrationPublicSnapshot.test.js` |
| `tests/integrationRepeatedRequests.test.js` | `tests/integrations/integrationRepeatedRequests.test.js` |
| `tests/integrationResourceAnalytics.test.js` | `tests/integrations/integrationResourceAnalytics.test.js` |
| `tests/integrationSyncService.test.js` | `tests/integrations/integrationSyncService.test.js` |
| `tests/integrationTokenConfiguration.test.js` | `tests/integrations/integrationTokenConfiguration.test.js` |
| `tests/integrationsAdapters.test.js` | `tests/integrations/integrationsAdapters.test.js` |
| `tests/integrationsGovernance.test.js` | `tests/integrations/integrationsGovernance.test.js` |
| `tests/integrationsLifecycle.test.js` | `tests/integrations/integrationsLifecycle.test.js` |
| `tests/integrationsLocalAcceptance.test.js` | `tests/integrations/integrationsLocalAcceptance.test.js` |
| `tests/integrationsProduction.integration.test.js` | `tests/integrations/integrationsProduction.integration.test.js` |
| `tests/integrationsRecordedData.test.js` | `tests/integrations/integrationsRecordedData.test.js` |
| `tests/interviewAnswerCoverage.test.js` | `tests/interview-prep/interviewAnswerCoverage.test.js` |
| `tests/interviewCompleteAI.integration.test.js` | `tests/interview-prep/interviewCompleteAI.integration.test.js` |
| `tests/interviewCompleteAI.test.js` | `tests/interview-prep/interviewCompleteAI.test.js` |
| `tests/interviewCoverageCorrection.test.js` | `tests/interview-prep/interviewCoverageCorrection.test.js` |
| `tests/interviewCustomFailover.test.js` | `tests/interview-prep/interviewCustomFailover.test.js` |
| `tests/interviewCustomPromptStyle.test.js` | `tests/interview-prep/interviewCustomPromptStyle.test.js` |
| `tests/interviewCustomSystemDesign.test.js` | `tests/interview-prep/interviewCustomSystemDesign.test.js` |
| `tests/interviewEnrichmentOrchestrator.test.js` | `tests/interview-prep/interviewEnrichmentOrchestrator.test.js` |
| `tests/interviewPrepCache.test.js` | `tests/interview-prep/interviewPrepCache.test.js` |
| `tests/interviewPrepFinalization.integration.test.js` | `tests/interview-prep/interviewPrepFinalization.integration.test.js` |
| `tests/interviewPrepHardening.test.js` | `tests/interview-prep/interviewPrepHardening.test.js` |
| `tests/interviewPrepPerformance.test.js` | `tests/interview-prep/interviewPrepPerformance.test.js` |
| `tests/interviewPrepService.test.js` | `tests/interview-prep/interviewPrepService.test.js` |
| `tests/interviewProduction.integration.test.js` | `tests/interview-prep/interviewProduction.integration.test.js` |
| `tests/interviewQuestionFilters.test.js` | `tests/interview-prep/interviewQuestionFilters.test.js` |
| `tests/interviewQuestionQualityService.test.js` | `tests/interview-prep/interviewQuestionQualityService.test.js` |
| `tests/interviewQuestionSeedCatalog.test.js` | `tests/interview-prep/interviewQuestionSeedCatalog.test.js` |
| `tests/interviewTopicNormalizer.test.js` | `tests/interview-prep/interviewTopicNormalizer.test.js` |
| `tests/jobsHiddenAccess.test.js` | `tests/jobs/jobsHiddenAccess.test.js` |
| `tests/jobsHubHardening.test.js` | `tests/jobs/jobsHubHardening.test.js` |
| `tests/jobsHubHttp.integration.test.js` | `tests/jobs/jobsHubHttp.integration.test.js` |
| `tests/jobsHubLocal.integration.test.js` | `tests/jobs/jobsHubLocal.integration.test.js` |
| `tests/jobsHubRanking.test.js` | `tests/jobs/jobsHubRanking.test.js` |
| `tests/jobsHubUpstash.integration.test.js` | `tests/jobs/jobsHubUpstash.integration.test.js` |
| `tests/kaggleResources.test.js` | `tests/core/kaggleResources.test.js` |
| `tests/localMongoRepair.test.js` | `tests/core/localMongoRepair.test.js` |
| `tests/newsAdaptiveRuntime.integration.test.js` | `tests/news/newsAdaptiveRuntime.integration.test.js` |
| `tests/newsBrowsingLimit.test.js` | `tests/news/newsBrowsingLimit.test.js` |
| `tests/newsCatalog.integration.test.js` | `tests/news/newsCatalog.integration.test.js` |
| `tests/newsCatalog.test.js` | `tests/news/newsCatalog.test.js` |
| `tests/newsConfiguration.test.js` | `tests/news/newsConfiguration.test.js` |
| `tests/newsContract.test.js` | `tests/news/newsContract.test.js` |
| `tests/newsContractMongo.integration.test.js` | `tests/news/newsContractMongo.integration.test.js` |
| `tests/newsDiscovery.integration.test.js` | `tests/news/newsDiscovery.integration.test.js` |
| `tests/newsDiscovery.test.js` | `tests/news/newsDiscovery.test.js` |
| `tests/newsFlow.integration.test.js` | `tests/news/newsFlow.integration.test.js` |
| `tests/newsFlow.test.js` | `tests/news/newsFlow.test.js` |
| `tests/newsFreeText.integration.test.js` | `tests/news/newsFreeText.integration.test.js` |
| `tests/newsFreeText.test.js` | `tests/news/newsFreeText.test.js` |
| `tests/newsHub.integration.test.js` | `tests/news/newsHub.integration.test.js` |
| `tests/newsHubHardening.test.js` | `tests/news/newsHubHardening.test.js` |
| `tests/newsLiveSearch.integration.test.js` | `tests/news/newsLiveSearch.integration.test.js` |
| `tests/newsPagination.test.js` | `tests/news/newsPagination.test.js` |
| `tests/newsProviders.integration.test.js` | `tests/news/newsProviders.integration.test.js` |
| `tests/newsProviders.test.js` | `tests/news/newsProviders.test.js` |
| `tests/newsRefresh.integration.test.js` | `tests/news/newsRefresh.integration.test.js` |
| `tests/newsSearchCorrections.integration.test.js` | `tests/news/newsSearchCorrections.integration.test.js` |
| `tests/newsSearchCorrections.test.js` | `tests/news/newsSearchCorrections.test.js` |
| `tests/newsTopicCoverage.test.js` | `tests/news/newsTopicCoverage.test.js` |
| `tests/notificationsProduction.test.js` | `tests/notifications/notificationsProduction.test.js` |
| `tests/notificationsRequestLogging.test.js` | `tests/notifications/notificationsRequestLogging.test.js` |
| `tests/notificationsRetention.test.js` | `tests/notifications/notificationsRetention.test.js` |
| `tests/profileAccountSecurity.test.js` | `tests/profile/profileAccountSecurity.test.js` |
| `tests/profileSettingsProduction.test.js` | `tests/profile/profileSettingsProduction.test.js` |
| `tests/publicPortfolio.integration.test.js` | `tests/public-portfolio/publicPortfolio.integration.test.js` |
| `tests/publicPortfolioHardening.test.js` | `tests/public-portfolio/publicPortfolioHardening.test.js` |
| `tests/recommendationEngine.test.js` | `tests/recommendations/recommendationEngine.test.js` |
| `tests/recommendationGeneration.test.js` | `tests/recommendations/recommendationGeneration.test.js` |
| `tests/recommendationGovernance.test.js` | `tests/recommendations/recommendationGovernance.test.js` |
| `tests/recommendationsAccuracy.test.js` | `tests/recommendations/recommendationsAccuracy.test.js` |
| `tests/recommendationsHardening.test.js` | `tests/recommendations/recommendationsHardening.test.js` |
| `tests/recommendationsMongo.integration.test.js` | `tests/recommendations/recommendationsMongo.integration.test.js` |
| `tests/recommendationsPerfMeasure.js` | `tests/recommendations/recommendationsPerfMeasure.js` |
| `tests/recommendationsPerformance.test.js` | `tests/recommendations/recommendationsPerformance.test.js` |
| `tests/recruiterRankingEngine.test.js` | `tests/recruiter/recruiterRankingEngine.test.js` |
| `tests/redisConnectionProbe.test.js` | `tests/core/redisConnectionProbe.test.js` |
| `tests/requestFlowGovernance.test.js` | `tests/core/requestFlowGovernance.test.js` |
| `tests/resumeAnalyzerHardening.test.js` | `tests/resume/resumeAnalyzerHardening.test.js` |
| `tests/resumeAnalyzerPerformance.test.js` | `tests/resume/resumeAnalyzerPerformance.test.js` |
| `tests/resumePipelineFinalization.test.js` | `tests/resume/resumePipelineFinalization.test.js` |
| `tests/resumeProduction.test.js` | `tests/resume/resumeProduction.test.js` |
| `tests/resumeProductionMongo.test.js` | `tests/resume/resumeProductionMongo.test.js` |
| `tests/resumeService.test.js` | `tests/resume/resumeService.test.js` |
| `tests/resumeUploadContract.test.js` | `tests/resume/resumeUploadContract.test.js` |
| `tests/scenarioLegacyParity.test.js` | `tests/scenario-simulator/scenarioLegacyParity.test.js` |
| `tests/scenarioMigration.integration.test.js` | `tests/scenario-simulator/scenarioMigration.integration.test.js` |
| `tests/scenarioPlanningScore.test.js` | `tests/scenario-simulator/scenarioPlanningScore.test.js` |
| `tests/scenarioProductionContracts.test.js` | `tests/scenario-simulator/scenarioProductionContracts.test.js` |
| `tests/scenarioSimulatorCharacterization.test.js` | `tests/scenario-simulator/scenarioSimulatorCharacterization.test.js` |
| `tests/scenarioSimulatorContext.test.js` | `tests/scenario-simulator/scenarioSimulatorContext.test.js` |
| `tests/scenarioSimulatorMongo.integration.test.js` | `tests/scenario-simulator/scenarioSimulatorMongo.integration.test.js` |
| `tests/scenarioSimulatorReliability.test.js` | `tests/scenario-simulator/scenarioSimulatorReliability.test.js` |
| `tests/scenarioSimulatorService.test.js` | `tests/scenario-simulator/scenarioSimulatorService.test.js` |
| `tests/scenarioSimulatorWorkers.integration.test.js` | `tests/scenario-simulator/scenarioSimulatorWorkers.integration.test.js` |
| `tests/scenarioSprintExport.test.js` | `tests/scenario-simulator/scenarioSprintExport.test.js` |
| `tests/scoringFoundation.test.js` | `tests/core/scoringFoundation.test.js` |
| `tests/sharedCourseCatalog.integration.test.js` | `tests/courses/sharedCourseCatalog.integration.test.js` |
| `tests/skillGapAcceptance.test.js` | `tests/skill-gap/skillGapAcceptance.test.js` |
| `tests/skillGapAdmission.test.js` | `tests/skill-gap/skillGapAdmission.test.js` |
| `tests/skillGapAiPolicy.test.js` | `tests/skill-gap/skillGapAiPolicy.test.js` |
| `tests/skillGapConsumerContracts.test.js` | `tests/skill-gap/skillGapConsumerContracts.test.js` |
| `tests/skillGapConsumerMongo.test.js` | `tests/skill-gap/skillGapConsumerMongo.test.js` |
| `tests/skillGapEvidence.test.js` | `tests/skill-gap/skillGapEvidence.test.js` |
| `tests/skillGapFocusedReview.test.js` | `tests/skill-gap/skillGapFocusedReview.test.js` |
| `tests/skillGapFullStackCoverage.test.js` | `tests/skill-gap/skillGapFullStackCoverage.test.js` |
| `tests/skillGapGolden.test.js` | `tests/skill-gap/skillGapGolden.test.js` |
| `tests/skillGapMongo.integration.test.js` | `tests/skill-gap/skillGapMongo.integration.test.js` |
| `tests/skillGapProduction.test.js` | `tests/skill-gap/skillGapProduction.test.js` |
| `tests/skillGapScoring.test.js` | `tests/skill-gap/skillGapScoring.test.js` |
| `tests/skillGraphService.test.js` | `tests/skill-gap/skillGraphService.test.js` |
| `tests/skilldetector.test.js` | `tests/core/skilldetector.test.js` |
| `tests/skillgapHardening.test.js` | `tests/skill-gap/skillgapHardening.test.js` |
| `tests/skillgapPerformance.test.js` | `tests/skill-gap/skillgapPerformance.test.js` |
| `tests/sprintAiAdmission.integration.test.js` | `tests/career-sprint/sprintAiAdmission.integration.test.js` |
| `tests/sprintInvalidation.test.js` | `tests/career-sprint/sprintInvalidation.test.js` |
| `tests/sprintOverviewCache.test.js` | `tests/career-sprint/sprintOverviewCache.test.js` |
| `tests/storageSecurityFinal.test.js` | `tests/core/storageSecurityFinal.test.js` |
| `tests/supportAdmission.test.js` | `tests/support/supportAdmission.test.js` |
| `tests/supportRedisFallback.test.js` | `tests/support/supportRedisFallback.test.js` |
| `tests/transparentScoringService.test.js` | `tests/core/transparentScoringService.test.js` |
| `tests/weeklyReportScheduler.test.js` | `tests/weekly-reports/weeklyReportScheduler.test.js` |
| `tests/weeklyReportSprint.test.js` | `tests/weekly-reports/weeklyReportSprint.test.js` |
| `tests/weeklyReportsHardening.test.js` | `tests/weekly-reports/weeklyReportsHardening.test.js` |
| `tests/weeklyReportsRefinement.integration.test.js` | `tests/weekly-reports/weeklyReportsRefinement.integration.test.js` |
| `tests/weeklyReportsRefinement.test.js` | `tests/weekly-reports/weeklyReportsRefinement.test.js` |
| `tests/weeklyReportsReliability.integration.test.js` | `tests/weekly-reports/weeklyReportsReliability.integration.test.js` |

## Additional Updated References Outside `backend/src/tests/`

- Root [package.json](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/package.json) and [backend/package.json](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/package.json): updated named test script paths (`src/tests/<domain>/...`).
- [backend/index.js](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/index.js): updated all 30 route mounts and core/module service/worker imports.
- [frontend/src/app/app.routes.ts](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/src/app/app.routes.ts) and [frontend/src/app/features/recruiter/recruiter-hub-routing.module.ts](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/src/app/features/recruiter/recruiter-hub-routing.module.ts): updated `NotificationsComponent` imports.
- Verification/utility scripts updated for new module/core/test paths: `backend/scripts/verify-live-ai.js`, `backend/scripts/run-previously-skipped-tests.js`, `backend/src/scripts/{auditNewsRuntime.js,combinedIntegrationsPreload.js,migrateNewsCatalog.js,reconcileBackendTap.cjs,scenarioAcceptanceWorker.js,verifyBackendRegression.cjs,verifyBackendRelease.cjs,verifyCareerSprintTargetedStabilization.js,verifyJobsHubProduction.cjs,verifyLearningIsolated.js,verifyNotificationAssetRegressions.js,verifyProfileStorageSecurityLocal.js,verifyPublicPortfolioFinalization.cjs,verifyRecommendationsE2E.js,verifyRecommendationsRegression.js,verifyRequestFlowGovernance.js,verifyScenarioProduction.cjs}`, `frontend/scripts/{audit-scenario-simulator-responsive.cjs,verify-interview-custom-system-design.cjs,verify-interview-live-coverage.cjs,verify-news-search.cjs,verify-public-portfolio-live-e2e.cjs,verify-weekly-reports-ui.cjs}`.
