# Mounted request endpoint inventory

Source baseline `c612ae80c466f47ab7def651da6537d8cf330b0a`, with the focused admission candidate applied. Generated from the mounted Express route AST. Each registration below preserves source order. `use` entries apply to following matching routes; `param` validates matching route parameters before handlers. Anonymous middleware is retained inline. This is source execution order, not a claim that every branch received live traffic. Read the final governance report for service-layer authority/cache branches and runtime evidence. Global middleware precedes every row. Dynamic template registrations are shown as source expressions.

## /api/auth — backend/src/routes/auth.routes.js

- Line 19, `POST`: `'/register' → authRateLimiter → registerUser`
- Line 20, `POST`: `'/login' → authRateLimiter → bruteForceGuard → loginUser`
- Line 21, `POST`: `'/send-otp' → authRateLimiter → sendOtp`
- Line 22, `POST`: `'/verify-otp' → authRateLimiter → verifyOtp`
- Line 23, `POST`: `'/forgot-password' → authRateLimiter → forgotPassword`
- Line 24, `POST`: `'/reset-password' → authRateLimiter → resetPassword`
- Line 25, `GET`: `'/invite-details/:token' → getInviteDetails`
- Line 26, `POST`: `'/accept-invite' → authRateLimiter → acceptInvite`
- Line 27, `GET`: `'/google' → authRateLimiter → startGoogleOAuth`
- Line 28, `GET`: `'/google/callback' → authRateLimiter → googleOAuthCallback`
- Line 29, `GET`: `'/github' → authRateLimiter → startGitHubOAuth`
- Line 30, `GET`: `'/github/callback' → authRateLimiter → githubOAuthCallback`

## /api/github — backend/src/routes/github.routes.js

- Line 7, `POST`: `'/analyze' → analyzeGitHub`
- Line 10, `POST`: `'/analyze-save' → protect → analyzeAndSaveGitHubProfile`
- Line 13, `GET`: `'/active-username' → protect → getActiveUsername`

## /api/resume — backend/src/routes/resume.routes.js

- Line 17, `POST`: `'/upload' → protect → require('../middleware/publicPortfolioRateLimit').uploadLimit → upload.resumePdf → uploadResume`
- Line 26, `POST`: `'/analyze' → protect → analyzeResumeFile`
- Line 29, `GET`: `'/result' → protect → getResumeAnalysis`
- Line 32, `GET`: `'/files' → protect → getResumeFiles`
- Line 35, `GET`: `'/active' → protect → getActiveResumeContext`
- Line 38, `PUT`: `'/active' → protect → setActiveResume`
- Line 41, `GET`: `'/result/:userId' → protect → getResumeAnalysisByUserId`
- Line 44, `GET`: `'/guide' → protect → downloadResumeGuide`

## /api/analysis — backend/src/routes/analysis.routes.js

- Line 10, `POST`: `'/portfolio-score' → protect → getPortfolioReadiness`

## /api/dashboard — backend/src/routes/dashboard.routes.js

- Line 14, `GET`: `'/summary' → protect → getDashboardSummary`
- Line 15, `GET`: `'/contributions' → protect → getDashboardContributions`
- Line 16, `GET`: `'/languages' → protect → getDashboardLanguages`
- Line 17, `GET`: `'/skills' → protect → getDashboardSkills`
- Line 18, `GET`: `'/recommendations' → protect → getDashboardRecommendations`
- Line 19, `GET`: `'/integration-analytics' → protect → getDashboardIntegrationAnalytics`

## /api/super-admin — backend/src/routes/super-admin.routes.js

- Line 17, `USE`: `protect → authorizeRoles('super_admin')`
- Line 19, `GET`: `'/metrics' → getPlatformMetrics`
- Line 20, `GET`: `'/dashboard' → getDashboard`
- Line 21, `GET`: `'/analytics' → getAnalytics`
- Line 22, `GET`: `'/organizations' → getAllOrganizations`
- Line 23, `PATCH`: `'/organizations/:id/suspend' → suspendOrganization`
- Line 24, `PATCH`: `'/organizations/:id/activate' → activateOrganization`
- Line 25, `GET`: `'/admins' → getAllAdmins`
- Line 26, `GET`: `'/recruiters' → getAllRecruiters`
- Line 27, `GET`: `'/developers' → getAllDevelopers`
- Line 28, `GET`: `'/teams' → getAllTeams`
- Line 30, `GET`: `'/recruiters/:id/analytics' → getRecruiterAnalytics`
- Line 31, `POST`: `'/recruiters/:id/teams' → assignTeamToRecruiter`
- Line 32, `DELETE`: `'/recruiters/:id/teams/:teamId' → removeRecruiterTeam`
- Line 33, `PATCH`: `'/users/:id/toggle-active' → toggleUserActive`
- Line 34, `GET`: `'/users/:id' → getUserDetails`
- Line 35, `POST`: `'/users' → createUser`
- Line 36, `PATCH`: `'/users/:id' → updateUser`
- Line 37, `DELETE`: `'/users/:id' → deleteUser`
- Line 38, `GET`: `'/settings' → getPlatformSettings`
- Line 39, `PUT`: `'/settings' → updatePlatformSettings`

## /api/skillgap — backend/src/routes/skillgap.routes.js

- Line 16, `POST`: `'/skill-gap' → markSkillGapRouteStart → optionalProtect → markSkillGapAuthComplete → analyzeSkillGap`

## /api/recommendations — backend/src/routes/recommendations.routes.js

- Line 15, `POST`: `'/' → protect → getRecommendations`
- Line 18, `POST`: `'/generate' → optionalProtect → generateRecommendations`
- Line 20, `POST`: `'/saved-previews' → protect → savePreview`
- Line 21, `GET`: `'/saved-previews' → protect → listSavedPreviews`
- Line 22, `DELETE`: `'/saved-previews/:id' → protect → deleteSavedPreview`
- Line 23, `POST`: `'/:id/career-sprint' → protect → handoffToCareerSprint`
- Line 24, `GET`: `'/history' → protect → listRecommendationHistory`

## /api/profile — backend/src/routes/profile.routes.js

- Line 17, `USE`: `(_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); }`
- Line 22, `GET`: `'/me' → protect → mediaSession → getProfile`
- Line 23, `PUT`: `'/me' → protect → mediaSession → updateProfile`
- Line 24, `PUT`: `'/career' → protect → mediaSession → updateCareerProfile`
- Line 25, `PUT`: `'/career/active' → protect → mediaSession → updateActiveCareerProfile`
- Line 26, `PUT`: `'/password' → protect → mediaSession → updatePassword`
- Line 27, `PUT`: `'/visibility' → protect → mediaSession → updateProfileVisibility`
- Line 28, `POST`: `'/avatar' → protect → mediaSession → require('../middleware/publicPortfolioRateLimit').uploadLimit → avatarUpload.single('avatar') → uploadAvatar`
- Line 36, `DELETE`: `'/me' → protect → mediaSession → deleteAccount`

## /api/courses — backend/src/routes/courseRoutes.js

- Line 10, `GET`: `'/' → protect → fetchCourses`
- Line 11, `GET`: `'/my-learning' → protect → progress.listProgress`
- Line 12, `PUT`: `'/:courseId/progress' → protect → progress.saveProgress`
- Line 13, `DELETE`: `'/:courseId/progress' → protect → progress.removeProgress`
- Line 14, `POST`: `'/:courseId/career-sprint' → protect → progress.handoffToSprint`

## /api/jobs — backend/src/routes/jobRoutes.js

- Line 21, `USE`: `protect → validateJobsRequest → jobsRateLimit`
- Line 22, `GET`: `'/' → jobsRefreshLimit → fetchJobs`
- Line 23, `GET`: `'/source-health' → getSourceHealthStatus`
- Line 24, `GET`: `'/cache-health' → getCacheHealthStatus`
- Line 25, `GET`: `'/actions' → actions.list`
- Line 26, `PUT`: `'/:id/actions' → validateJobsRequest → actionRateLimit → actions.update`
- Line 32, `POST`: `'/:id/${path}' → validateJobsRequest → actionRateLimit → actions.toggle(field, true)`
- Line 33, `DELETE`: `'/:id/${path}' → validateJobsRequest → actionRateLimit → actions.toggle(field, false)`
- Line 35, `GET`: `'/:id' → validateJobsRequest → getJobById`

## /api/notifications — backend/src/routes/notification.routes.js

- Line 12, `GET`: `'/' → protect → getNotifications`
- Line 13, `GET`: `'/stream' → streamNotifications`
- Line 14, `PUT`: `'/read-all' → protect → markAllNotificationsRead`
- Line 15, `PUT`: `'/:id/read' → protect → markNotificationRead`
- Line 16, `DELETE`: `'/:id' → protect → deleteNotification`

## /api/audit-logs — backend/src/routes/audit.routes.js

- Line 6, `GET`: `'/' → protect → getAuditLogs`
- Line 7, `DELETE`: `'/:id' → protect → deleteAuditLog`

## /api/workflows — backend/src/routes/workflow.routes.js

- Line 10, `POST`: `'/' → protect → startWorkflow`
- Line 11, `GET`: `'/' → protect → listWorkflows`
- Line 12, `GET`: `'/:id' → protect → getWorkflowById`

## /api/ai-versions — backend/src/routes/aiversions.routes.js

- Line 11, `GET`: `'/' → protect → listVersions`
- Line 12, `POST`: `'/' → protect → createAiVersion`
- Line 13, `GET`: `'/:id/compare/:compareId' → protect → compareVersions`
- Line 14, `POST`: `'/:id/rollback' → protect → rollbackVersion`

## /api/tenant — backend/src/routes/tenant.routes.js

- Line 40, `POST`: `'/organizations' → protect → createOrganizationValidators → createOrganization`
- Line 41, `GET`: `'/organizations' → protect → listOrganizations`
- Line 43, `POST`: `'/organizations/:organizationId/teams' → protect → requireOrganizationRole('manager') → createTeamValidators → createTeam`
- Line 51, `GET`: `'/organizations/:organizationId/teams' → protect → requireOrganizationRole('member') → listTeamsValidators → listTeams`
- Line 59, `POST`: `'/organizations/:organizationId/invitations' → protect → requireOrganizationRole('manager') → inviteUserValidators → inviteUser`
- Line 67, `GET`: `'/organizations/:organizationId/invitations' → protect → requireOrganizationRole('manager') → listPendingInvitationsValidators → listPendingInvitations`
- Line 75, `PATCH`: `'/organizations/:organizationId/invitations/:invitationId/revoke' → protect → requireOrganizationRole('manager') → revokeInvitationValidators → revokeInvitation`
- Line 83, `POST`: `'/invitations/:invitationId/accept' → protect → acceptInvitationValidators → acceptInvitation`
- Line 84, `POST`: `'/invitations/accept/:token' → protect → acceptInvitationTokenValidators → acceptInvitationByToken`
- Line 85, `GET`: `'/invitations/:token/details' → invitationDetailsValidators → getInvitationDetailsByToken`
- Line 86, `POST`: `'/invitations/accept/:token/onboard' → acceptInvitationOnboardValidators → acceptInvitationOnboard`
- Line 88, `GET`: `'/organizations/:organizationId/members' → protect → requireOrganizationRole('member') → listOrganizationMembersValidators → listOrganizationMembers`
- Line 96, `GET`: `'/teams/:teamId/members' → protect → requireTeamRole('member') → listTeamMembersValidators → listTeamMembers`
- Line 98, `PATCH`: `'/memberships/:membershipId/role' → protect → updateMembershipRoleValidators → updateMembershipRole`
- Line 100, `GET`: `'/teams/:teamId/shared-dashboard' → protect → requireTeamRole('member') → getTeamSharedDashboardValidators → getTeamSharedDashboard`
- Line 108, `GET`: `'/teams/:teamId/analytics' → protect → requireTeamRole('member') → getTeamAnalyticsValidators → getTeamAnalytics`

## /api/skill-graph — backend/src/routes/skillgraph.routes.js

- Line 6, `POST`: `'/generate' → protect → generateSkillGraph`
- Line 7, `GET`: `'/latest' → protect → getLatestSkillGraph`

## /api/integrations — backend/src/routes/integrations.routes.js

- Line 3, `USE`: `(_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); }`
- Line 30, `GET`: `'/marketplace' → protect → getMarketplace`
- Line 31, `GET`: `'/linked-profiles/kaggle' → protect → kaggleLink.get`
- Line 32, `POST`: `'/linked-profiles/kaggle' → protect → actionLimit('mutate') → kaggleLink.save`
- Line 33, `DELETE`: `'/linked-profiles/kaggle' → protect → actionLimit('mutate') → kaggleLink.remove`
- Line 34, `GET`: `'/linked-profiles/hackerrank' → protect → getLinkedProfile`
- Line 35, `POST`: `'/linked-profiles/hackerrank' → protect → actionLimit('mutate') → saveLinkedProfile`
- Line 36, `DELETE`: `'/linked-profiles/hackerrank' → protect → actionLimit('mutate') → removeLinkedProfile`
- Line 37, `GET`: `'/connections' → protect → getConnections`
- Line 38, `GET`: `'/insights' → protect → getIntegrationInsights`
- Line 39, `GET`: `'/sync-trends' → protect → getSyncTrends`
- Line 40, `GET`: `'/github/callback' → actionLimit('callback', false) → githubOauthCallback`
- Line 41, `POST`: `'/oauth/start' → protect → actionLimit('mutate') → startOAuth`
- Line 42, `POST`: `'/oauth/callback' → protect → actionLimit('mutate') → oauthCallback`
- Line 43, `POST`: `'/manual/connect' → protect → actionLimit('mutate') → manualConnectProvider`
- Line 44, `POST`: `'/ingest' → protect → actionLimit('mutate') → ingestProviderData`
- Line 45, `POST`: `'/sync-now' → protect → actionLimit('mutate') → syncNow`
- Line 46, `POST`: `'/webhooks/github' → actionLimit('webhook', false) → githubWebhook`
- Line 47, `DELETE`: `'/connections/:provider' → protect → disconnectProvider`

## /api/simulator — backend/src/routes/scenarioSimulator.routes.js

- Line 15, `GET`: `'/context' → protect → contextLimit → getScenarioSimulatorContext`
- Line 16, `GET`: `'/history' → protect → limits.history → getScenarioSimulationHistory`
- Line 17, `POST`: `'/what-if' → protect → limits.evaluate → runScenarioSimulation`
- Line 18, `POST`: `'/save' → protect → limits.save → saveScenarioSimulation`
- Line 19, `POST`: `'/create-sprint' → protect → limits.export → createSprintFromScenarioController`
- Line 20, `DELETE`: `'/:id' → protect → limits.delete → deleteScenarioSimulation`

## /api/public-profiles — backend/src/routes/publicProfile.routes.js

- Line 24, `USE`: `(req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); }`
- Line 28, `PARAM`: `'slug' → (req, res, next, slug) => { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return res.status(400).json({ message: 'Invalid slug.' }); next(); }`
- Line 33, `GET`: `'/me' → protect → mediaSession → analyticsLimit → getMyPublicProfile`
- Line 34, `PUT`: `'/me' → protect → mediaSession → mutationLimit → updateMyPublicProfile`
- Line 35, `POST`: `'/me/project-image' → protect → mediaSession → uploadLimit → uploadPortfolioImage`
- Line 36, `GET`: `'/me/resume' → protect → mediaSession → resumeLimit → downloadPublicProfileResume`
- Line 37, `GET`: `'/me/analytics' → protect → mediaSession → analyticsLimit → getMyPublicProfileAnalytics`
- Line 38, `POST`: `'/:slug/contact' → protect → mediaSession → require('../services/publicPortfolioContactService').validateContactRequest → contactLimit → contactRecipientLimit → contactPublicProfile`
- Line 47, `GET`: `'/:slug/resume' → resumeLimit → downloadPublicProfileResume`
- Line 48, `GET`: `'/:slug' → publicViewLimit → attachOptionalUser → getPublicProfile`

## /api/recruiter — backend/src/routes/recruiter.routes.js

- Line 18, `USE`: `protect → authorizeRoles('recruiter') → requireRecruiterAccessEnabled → requireOrganizationContext(['recruiter'])`
- Line 21, `GET`: `'/dashboard' → getRecruiterDashboard`
- Line 24, `GET`: `'/candidates' → getRecruiterCandidates`
- Line 25, `GET`: `'/candidate/:id' → getRecruiterCandidateById`
- Line 28, `POST`: `'/job' → createRecruiterJob`
- Line 29, `GET`: `'/jobs' → getRecruiterJobs`
- Line 30, `PUT`: `'/job/:id' → updateRecruiterJob`
- Line 31, `DELETE`: `'/job/:id' → deleteRecruiterJob`
- Line 34, `POST`: `'/match' → matchCandidates`
- Line 35, `POST`: `'/ai-rank' → aiRankCandidates`

## /api/recruiter-hub — backend/src/routes/recruiter-hub/recruiterHubRoutes.js

- Line 17, `USE`: `protect → authorizeRoles('recruiter') → requireRecruiterAccessEnabled → requireOrganizationContext(['recruiter'])`
- Line 19, `USE`: `'/candidates' → candidateRoutes`
- Line 20, `USE`: `'/jobs' → recruiterJobRoutes`
- Line 21, `USE`: `'/matches' → matchRoutes`
- Line 22, `USE`: `'/shortlists' → shortlistRoutes`
- Line 23, `USE`: `'/analytics' → analyticsRoutes`
- Line 24, `USE`: `'/activity' → activityRoutes`
- Line 25, `POST`: `'/comparison' → compare`
- Line 26, `GET`: `'/profile' → getProfile`
- Line 27, `PATCH`: `'/profile' → patchProfile`

## /api/admin — backend/src/routes/admin.routes.js

- Line 23, `USE`: `protect → authorizeRoles('admin') → requireOrganizationContext(['admin'])`
- Line 25, `GET`: `'/overview' → getOrganizationOverview`
- Line 26, `GET`: `'/recruiters' → getRecruiters`
- Line 27, `POST`: `'/invite-recruiter' → inviteRecruiter`
- Line 28, `POST`: `'/recruiter' → inviteRecruiter`
- Line 29, `POST`: `'/recruiters/direct' → addRecruiterDirect`
- Line 30, `PUT`: `'/recruiters/:id' → updateRecruiter`
- Line 31, `PATCH`: `'/recruiters/:id/active' → setRecruiterActive`
- Line 32, `PATCH`: `'/recruiters/:id/revoke' → revokeRecruiterAccess`
- Line 33, `DELETE`: `'/recruiters/:id' → deleteRecruiter`
- Line 34, `GET`: `'/invitations/pending' → getPendingInvitations`
- Line 35, `POST`: `'/invitations/:id/resend' → resendInvitation`
- Line 36, `PATCH`: `'/invitations/:id/revoke' → revokeInvitation`
- Line 37, `PATCH`: `'/invitations/:id/expire' → expireInvitation`
- Line 38, `DELETE`: `'/invitations/:id' → deleteInvitation`
- Line 39, `GET`: `'/developers' → getDevelopers`
- Line 40, `GET`: `'/jobs' → getAdminJobs`
- Line 41, `POST`: `'/jobs' → createAdminJob`
- Line 42, `PUT`: `'/jobs/:id' → updateAdminJob`
- Line 43, `PATCH`: `'/jobs/:id/close' → closeAdminJob`
- Line 44, `DELETE`: `'/jobs/:id' → deleteAdminJob`
- Line 45, `POST`: `'/ai-rank' → aiRankCandidates`

## /api/admin-console — backend/src/routes/adminConsole.routes.js

- Line 29, `USE`: `protect → authorizeRoles('admin') → requireOrganizationContext(['admin'])`
- Line 31, `GET`: `'/overview' → getConsoleOverview`
- Line 32, `GET`: `'/analytics' → getConsoleAnalytics`
- Line 33, `GET`: `'/activity' → getConsoleActivity`
- Line 34, `GET`: `'/performance' → getConsolePerformance`
- Line 35, `GET`: `'/teams' → getConsoleTeams`
- Line 36, `POST`: `'/teams' → createConsoleTeam`
- Line 37, `PATCH`: `'/teams/:id' → updateConsoleTeam`
- Line 38, `PATCH`: `'/teams/:id/active' → toggleConsoleTeamActive`
- Line 39, `DELETE`: `'/teams/:id' → deleteConsoleTeam`
- Line 40, `POST`: `'/teams/:id/recruiters' → assignRecruiterToConsoleTeam`
- Line 41, `DELETE`: `'/teams/:id/recruiters/:recruiterId' → removeRecruiterFromConsoleTeam`
- Line 42, `GET`: `'/preferences' → getConsolePreferences`
- Line 43, `PATCH`: `'/preferences' → updateConsolePreferences`

## /api/weekly-reports — backend/src/routes/weeklyReport.routes.js

- Line 10, `POST`: `'/generate' → protect → generateReport`
- Line 11, `GET`: `'/latest' → protect → getLatestReport`
- Line 12, `GET`: `'/history' → protect → getReportHistory`

## /api/interview-prep — backend/src/routes/interviewPrep.routes.js

- Line 42, `USE`: `protect → (req, res, next) => { const input = req.method === 'GET' ? req.query : req.body || {}; const fields = [ 'skill', 'topic', 'stack', 'technology', 'language', 'framework', 'difficulty', 'category', 'source', 'block', 'top', 'lookupOnly', 'q', 'query', 'question', 'tags', 'careerStack', 'experienceLevel' ]; for (const field of fields) { if ( input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > (['q', 'query', 'question', 'tags'].includes(field) ? 500 : 100)) ) { return res.status(400).json({ message: 'Invalid ${field}.' }); } } for (const field of ['page', 'limit', 'target']) { if ( input[field] !== undefined && (!['string', 'number'].includes(typeof input[field]) || !Number.isFinite(Number(input[field])) || Number(input[field]) < 1) ) { return res.status(400).json({ message: 'Invalid ${field}.' }); } } if (input.difficulty && !['easy', 'medium', 'hard', 'senior'].includes(input.difficulty)) return res.status(400).json({ message: 'Invalid difficulty.' }); next(); }`
- Line 88, `GET`: `'/questions' → getInterviewPrepQuestions`
- Line 89, `GET`: `'/search' → searchRateLimiter → searchInterviewPrepQuestions`
- Line 90, `POST`: `'/generate' → generateRateLimiter → generateInterviewPrepQuestions`
- Line 91, `POST`: `'/ask-question' → customQuestionRateLimiter → askInterviewPrepQuestion`
- Line 92, `POST`: `'/' → generateRateLimiter → generateInterviewPrepSession`
- Line 93, `GET`: `'/history' → getInterviewPrepHistory`

## /api/career-sprints — backend/src/routes/careerSprint.routes.js

- Line 22, `GET`: `'/current' → protect → getCurrentCareerSprint`
- Line 23, `GET`: `'/preferences' → protect → preferenceController.read`
- Line 24, `PUT`: `'/preferences' → protect → preferenceController.update`
- Line 25, `POST`: `'/' → protect → createCareerSprint`
- Line 26, `POST`: `'/generate-plan' → protect → generateAiTasks`
- Line 27, `POST`: `'/generate-ai-tasks' → protect → generateAiTasks`
- Line 28, `POST`: `'/generate-ai-plan' → protect → generateTrueAiTasks`
- Line 29, `POST`: `'/:id/ai-plans' → protect → saveAiPlanController`
- Line 30, `POST`: `'/:id/import-scenario' → protect → importScenarioPlanController`
- Line 31, `POST`: `'/:id/tasks' → protect → addCareerSprintTask`
- Line 32, `PUT`: `'/:id/tasks/:taskId' → protect → updateCareerSprintTask`
- Line 33, `DELETE`: `'/:id/tasks/:taskId' → protect → deleteCareerSprintTask`
- Line 34, `DELETE`: `'/:id/ai-plans/:planId' → protect → deleteAiPlanController`
- Line 35, `POST`: `'/:id/ai-plans/:planId/tasks' → protect → addDraftTasksController`
- Line 36, `PUT`: `'/:id/dates' → protect → updateSprintDatesController`
- Line 37, `GET`: `'/history' → protect → getCareerSprintHistory`
- Line 38, `POST`: `'/:id/restore-streak' → protect → restoreCareerStreakController`

## /api/news — backend/src/routes/newsRoutes.js

- Line 13, `USE`: `protect`
- Line 14, `USE`: `(_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); }`
- Line 19, `GET`: `'/' → feedLimit → validateFeed → getNews`
- Line 20, `GET`: `'/saved' → feedLimit → getSavedNews`
- Line 21, `POST`: `'/save' → mutationLimit → saveNews`
- Line 22, `DELETE`: `'/save/:id' → mutationLimit → removeSavedNews`
- Line 23, `PATCH`: `'/save/:id/read' → mutationLimit → markSavedNewsAsRead`

## /api/support — backend/src/routes/support.routes.js

- Line 7, `POST`: `'/tickets' → protect → supportController.createTicket`
- Line 8, `GET`: `'/my-tickets' → protect → supportController.getMyTickets`
- Line 9, `GET`: `'/tickets/:id' → protect → supportController.getTicketById`
- Line 10, `DELETE`: `'/tickets/:id' → protect → supportController.deleteTicket`
- Line 13, `GET`: `'/admin/tickets' → protect → authorizeRoles('admin', 'super_admin') → supportController.getAdminTickets`
- Line 14, `PUT`: `'/admin/tickets/:id/status' → protect → authorizeRoles('admin', 'super_admin') → supportController.updateTicketStatus`

## /api/preview — backend/src/routes/preview.routes.js

- Line 53, `POST`: `'/resume/parse-text' → require('../middleware/publicPortfolioRateLimit').uploadLimit → previewResumePdfMiddleware → parsePreviewResume`

## /api/recruiter-hub/candidates — backend/src/routes/recruiter-hub/candidateRoutes.js

- Line 6, `GET`: `'/' → listCandidates`
- Line 7, `GET`: `'/:id' → getCandidateDetails`
- Line 8, `POST`: `'/:id/analyze' → analyzeCandidate`

## /api/recruiter-hub/jobs — backend/src/routes/recruiter-hub/recruiterJobRoutes.js

- Line 13, `GET`: `'/' → listJobs`
- Line 14, `POST`: `'/' → createJob`
- Line 15, `GET`: `'/:id' → getJobDetails`
- Line 16, `PATCH`: `'/:id' → updateJob`
- Line 17, `POST`: `'/:id/archive' → archiveJob`
- Line 18, `DELETE`: `'/:id' → deleteJob`

## /api/recruiter-hub/matches — backend/src/routes/recruiter-hub/matchRoutes.js

- Line 11, `GET`: `'/' → listMatches`
- Line 12, `POST`: `'/generate' → generateMatches`
- Line 13, `GET`: `'/:id' → getMatchDetails`
- Line 14, `PATCH`: `'/:id/status' → patchMatchStatus`

## /api/recruiter-hub/shortlists — backend/src/routes/recruiter-hub/shortlistRoutes.js

- Line 11, `GET`: `'/' → getShortlists`
- Line 12, `POST`: `'/' → createShortlist`
- Line 13, `PATCH`: `'/:id' → patchShortlist`
- Line 14, `DELETE`: `'/:id' → deleteShortlist`

## /api/recruiter-hub/analytics — backend/src/routes/recruiter-hub/analyticsRoutes.js

- Line 7, `GET`: `'/dashboard' → getDashboard`
- Line 8, `GET`: `'/' → getAnalytics`

## /api/recruiter-hub/activity — backend/src/routes/recruiter-hub/activityRoutes.js

- Line 6, `GET`: `'/' → getActivity`
