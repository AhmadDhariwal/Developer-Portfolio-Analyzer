import { Routes } from '@angular/router';
import { MainLayout } from './core/layouts/main-layout/main-layout';
import { DashboardComponent } from './features/developer/pages/dashboard/dashboard.component';
import { GithubAnalyzerComponent } from './features/developer/pages/github-analyzer/github-analyzer.component';
import { ResumeAnalyzerComponent } from './features/developer/pages/resume-analyzer/resume-analyzer.component';
import { SkillGapComponent } from './features/developer/pages/skill-gap/skill-gap.component';
import { RecommendationsComponent } from './features/developer/pages/recommendations/recommendations.component';
import { ProfileComponent } from './features/developer/pages/profile/profile.component';
import { SupportComponent } from './features/developer/pages/support/support';
import { CoursesComponent } from './features/developer/pages/courses/courses.component';
import { JobsComponent } from './features/developer/pages/jobs/jobs.component';
import { JobDetailsComponent } from './features/developer/pages/job-details/job-details.component';
import { ActivityLogsComponent } from './features/super-admin/pages/activity-logs/activity-logs.component';
import { AiVersionsComponent } from './features/super-admin/pages/ai-versions/ai-versions.component';
import { TeamManagementComponent } from './features/super-admin/pages/team-management/team-management.component';
import { AcceptInvitationComponent } from './features/public/pages/accept-invitation/accept-invitation.component';
import { LandingPageComponent } from './features/public/pages/landing-page/landing-page.component';
import { IntegrationsMarketplaceComponent } from './features/developer/pages/integrations-marketplace/integrations-marketplace.component';
import { ScenarioSimulatorComponent } from './features/developer/pages/scenario-simulator/scenario-simulator.component';
import { PrivacyPolicyComponent } from './features/public/pages/privacy-policy/privacy-policy.component';
import { TermsOfServiceComponent } from './features/public/pages/terms-of-service/terms-of-service.component';
import { ApiDocsPageComponent } from './features/public/pages/api-docs-page/api-docs-page.component';
import { PublicBlogPageComponent } from './features/public/pages/public-blog-page/public-blog-page.component';
import { ContactPageComponent } from './features/public/pages/contact-page/contact-page.component';
import { SettingsPageComponent } from './features/super-admin/pages/platform-settings/settings-page.component';
import { NotificationsComponent } from './features/developer/pages/notifications/notifications.component';
import { PublicPortfolioComponent } from './features/public/pages/public-portfolio/public-portfolio.component';
import { PortfolioSettingsComponent } from './features/developer/pages/portfolio-settings/portfolio-settings.component';
import { WeeklyReportsComponent } from './features/developer/pages/weekly-reports/weekly-reports.component';
import { InterviewPrepComponent } from './features/developer/pages/interview-prep/interview-prep.component';
import { CareerSprintComponent } from './features/developer/pages/career-sprint/career-sprint.component';
import { InterviewsReportsComponent } from './features/developer/pages/interviews-reports/interviews-reports.component';
import { NewsComponent } from './features/developer/pages/news/news.component';
import { Login } from './features/auth/pages/login/login';
import { Signup } from './features/auth/pages/signup/signup';
import { OtpVerificationComponent } from './features/auth/pages/otp-verification/otp-verification.component';
import { ForgotPasswordComponent } from './features/auth/pages/forgot-password/forgot-password.component';
import { ResetPasswordComponent } from './features/auth/pages/reset-password/reset-password.component';
import { OAuthCallbackComponent } from './features/auth/pages/oauth-callback/oauth-callback.component';
import { authGuard } from './core/guards/auth.guard';
import { publicGuard } from './core/guards/public.guard';
import { adminSettingsGuard } from './core/guards/admin-settings.guard';
import { recruiterRoleGuard } from './core/guards/recruiter-role.guard';
import { noAdminTabsGuard } from './core/guards/no-admin-tabs.guard';
import { superAdminGuard } from './core/guards/super-admin.guard';

export const routes: Routes = [
  // Public routes
  { path: '', component: LandingPageComponent, canActivate: [publicGuard] },
  { path: 'privacy', component: PrivacyPolicyComponent },
  { path: 'terms', component: TermsOfServiceComponent },
  { path: 'api-docs', component: ApiDocsPageComponent },
  { path: 'blog', component: PublicBlogPageComponent },
  { path: 'contact', component: ContactPageComponent },
  { path: 'p/:slug', component: PublicPortfolioComponent },
  { path: 'notifications', redirectTo: 'app/notifications', pathMatch: 'full' },
  { path: 'news', redirectTo: 'app/news', pathMatch: 'full' },
  { path: 'landing', redirectTo: '', pathMatch: 'full' },
  { path: 'app/recruiter-dashboard', redirectTo: 'app/recruiter', pathMatch: 'full' },
  { path: 'app/admin-console', redirectTo: 'app/admin-console/overview', pathMatch: 'full' },
  { path: 'app/admin-console/overview', redirectTo: 'app/admin/dashboard', pathMatch: 'full' },
  { path: 'app/super-admin', redirectTo: 'app/super-admin/dashboard', pathMatch: 'full' },
  { path: 'app/super-admin/dashboard', redirectTo: 'super-admin/dashboard', pathMatch: 'full' },

  // Auth pages (only when NOT logged in)
  { path: 'auth/login', component: Login, canActivate: [publicGuard] },
  { path: 'auth/signup', component: Signup, canActivate: [publicGuard] },
  { path: 'auth/forgot-password', component: ForgotPasswordComponent, canActivate: [publicGuard] },
  {
    path: 'auth/otp-verification',
    component: OtpVerificationComponent,
    canActivate: [publicGuard],
  },
  { path: 'auth/reset-password', component: ResetPasswordComponent, canActivate: [publicGuard] },
  // OAuth callback — NO publicGuard: guard would redirect before token can be extracted
  { path: 'auth/oauth/callback', component: OAuthCallbackComponent },

  // Recruiter invitation — public
  { path: 'invitations/accept/:token', component: AcceptInvitationComponent },

  // Protected app routes (inside MainLayout)
  {
    path: 'app',
    component: MainLayout,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: DashboardComponent },
      { path: 'github-analyzer', component: GithubAnalyzerComponent },
      { path: 'resume-analyzer', component: ResumeAnalyzerComponent },
      { path: 'skill-gap', component: SkillGapComponent },
      { path: 'recommendations', component: RecommendationsComponent },
      { path: 'courses', component: CoursesComponent },
      { path: 'jobs', component: JobsComponent },
      { path: 'jobs/:id', component: JobDetailsComponent },
      { path: 'integrations', component: IntegrationsMarketplaceComponent },
      { path: 'scenario-simulator', component: ScenarioSimulatorComponent },
      { path: 'profile', component: ProfileComponent },
      { path: 'support', component: SupportComponent },
      { path: 'portfolio', component: PortfolioSettingsComponent },
      { path: 'weekly-reports', component: WeeklyReportsComponent },
      { path: 'interview-prep', component: InterviewPrepComponent },
      { path: 'career-sprint', component: CareerSprintComponent },
      { path: 'interviews-reports', component: InterviewsReportsComponent },
      { path: 'news', component: NewsComponent },
      { path: 'notifications', component: NotificationsComponent },
      { path: 'invitations/accept/:token', component: AcceptInvitationComponent },

      // Recruiter hub
      {
        path: 'recruiter',
        canActivate: [noAdminTabsGuard, recruiterRoleGuard],
        loadChildren: () =>
          import('./features/recruiter/recruiter.module').then((m) => m.RecruiterModule),
      },

      // Org Admin Console — now lives inside /app/admin/console
      { path: 'admin-console', redirectTo: 'admin/console', pathMatch: 'full' },
      { path: 'admin-console/overview', redirectTo: 'admin/dashboard', pathMatch: 'full' },
      {
        path: 'admin-console/performance-statistics',
        redirectTo: 'admin/console/performance-statistics',
        pathMatch: 'full',
      },

      // Super Admin aliases under /app to preserve role-based landing URLs
      { path: 'super-admin', redirectTo: '/super-admin/dashboard', pathMatch: 'full' },
      { path: 'super-admin/dashboard', redirectTo: '/super-admin/dashboard', pathMatch: 'full' },

      // Admin hiring workspace
      {
        path: 'admin',
        canActivate: [noAdminTabsGuard, adminSettingsGuard],
        loadChildren: () => import('./features/admin/admin.module').then((m) => m.AdminModule),
      },

      // Legacy redirects
      { path: 'team-management', redirectTo: 'settings/user-management', pathMatch: 'full' },
      { path: 'ai-versions', redirectTo: 'settings/ai-versions', pathMatch: 'full' },

      // Settings (super admin only)
      {
        path: 'settings',
        canActivate: [superAdminGuard],
        children: [
          { path: '', component: SettingsPageComponent },
          { path: 'ai-versions', component: AiVersionsComponent },
          { path: 'user-management', component: TeamManagementComponent },
          { path: 'activity-logs', component: ActivityLogsComponent },
        ],
      },
    ],
  },

  // Super Admin area — standalone routes, no NgModule
  {
    path: 'super-admin',
    canActivate: [authGuard, superAdminGuard],
    loadChildren: () =>
      import('./features/super-admin/super-admin.module').then((m) => m.SuperAdminModule),
  },

  // Wildcard
  { path: '**', redirectTo: '' },
];
