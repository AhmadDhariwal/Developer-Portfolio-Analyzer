import { Routes } from '@angular/router';
import { MainLayout } from './layout/main-layout/main-layout';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { GithubAnalyzerComponent } from './pages/github-analyzer/github-analyzer.component';
import { ResumeAnalyzerComponent } from './pages/resume-analyzer/resume-analyzer.component';
import { SkillGapComponent } from './pages/skill-gap/skill-gap.component';
import { RecommendationsComponent } from './pages/recommendations/recommendations.component';
import { ProfileComponent } from './pages/profile/profile.component';
import { CoursesComponent } from './pages/courses/courses.component';
import { JobsComponent } from './pages/jobs/jobs.component';
import { ActivityLogsComponent } from './pages/activity-logs/activity-logs.component';
import { AiVersionsComponent } from './pages/ai-versions/ai-versions.component';
import { TeamManagementComponent } from './pages/team-management/team-management.component';
import { AcceptInvitationComponent } from './pages/accept-invitation/accept-invitation.component';
import { LandingPageComponent } from './pages/landing-page/landing-page.component';
import { IntegrationsMarketplaceComponent } from './pages/integrations-marketplace/integrations-marketplace.component';
import { ScenarioSimulatorComponent } from './pages/scenario-simulator/scenario-simulator.component';
import { PrivacyPolicyComponent } from './pages/privacy-policy/privacy-policy.component';
import { TermsOfServiceComponent } from './pages/terms-of-service/terms-of-service.component';
import { ApiDocsPageComponent } from './pages/api-docs-page/api-docs-page.component';
import { PublicBlogPageComponent } from './pages/public-blog-page/public-blog-page.component';
import { ContactPageComponent } from './pages/contact-page/contact-page.component';
import { SettingsPageComponent } from './settings/settings-page.component';
import { NotificationsComponent } from './pages/notifications/notifications.component';
import { PublicPortfolioComponent } from './pages/public-portfolio/public-portfolio.component';
import { PortfolioSettingsComponent } from './pages/portfolio-settings/portfolio-settings.component';
import { WeeklyReportsComponent } from './pages/weekly-reports/weekly-reports.component';
import { InterviewPrepComponent } from './pages/interview-prep/interview-prep.component';
import { CareerSprintComponent } from './pages/career-sprint/career-sprint.component';
import { InterviewsReportsComponent } from './pages/interviews-reports/interviews-reports.component';
import { NewsComponent } from './pages/news/news.component';
import { Login } from './auth/login/login';
import { Signup } from './auth/signup/signup';
import { OtpVerificationComponent } from './features/auth/pages/otp-verification/otp-verification.component';
import { ForgotPasswordComponent } from './features/auth/pages/forgot-password/forgot-password.component';
import { ResetPasswordComponent } from './features/auth/pages/reset-password/reset-password.component';
import { authGuard } from './guards/auth.guard';
import { publicGuard } from './guards/public.guard';
import { adminSettingsGuard } from './guards/admin-settings.guard';
import { recruiterRoleGuard } from './guards/recruiter-role.guard';
import { noAdminTabsGuard } from './guards/no-admin-tabs.guard';
import { superAdminGuard } from './guards/super-admin.guard';

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

  // Auth pages (only when NOT logged in)
  { path: 'auth/login',            component: Login,                    canActivate: [publicGuard] },
  { path: 'auth/signup',           component: Signup,                   canActivate: [publicGuard] },
  { path: 'auth/forgot-password',  component: ForgotPasswordComponent,  canActivate: [publicGuard] },
  { path: 'auth/otp-verification', component: OtpVerificationComponent, canActivate: [publicGuard] },
  { path: 'auth/reset-password',   component: ResetPasswordComponent,   canActivate: [publicGuard] },

  // Recruiter invitation — public
  { path: 'invitations/accept/:token', component: AcceptInvitationComponent },

  // Protected app routes (inside MainLayout)
  {
    path: 'app',
    component: MainLayout,
    canActivate: [authGuard],
    children: [
      { path: '',                   redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard',          component: DashboardComponent },
      { path: 'github-analyzer',    component: GithubAnalyzerComponent },
      { path: 'resume-analyzer',    component: ResumeAnalyzerComponent },
      { path: 'skill-gap',          component: SkillGapComponent },
      { path: 'recommendations',    component: RecommendationsComponent },
      { path: 'courses',            component: CoursesComponent },
      { path: 'jobs',               component: JobsComponent },
      { path: 'integrations',       component: IntegrationsMarketplaceComponent },
      { path: 'scenario-simulator', component: ScenarioSimulatorComponent },
      { path: 'profile',            component: ProfileComponent },
      { path: 'portfolio',          component: PortfolioSettingsComponent },
      { path: 'weekly-reports',     component: WeeklyReportsComponent },
      { path: 'interview-prep',     component: InterviewPrepComponent },
      { path: 'career-sprint',      component: CareerSprintComponent },
      { path: 'interviews-reports', component: InterviewsReportsComponent },
      { path: 'news',               component: NewsComponent },
      { path: 'notifications',      component: NotificationsComponent },
      { path: 'invitations/accept/:token', component: AcceptInvitationComponent },

      // Recruiter hub
      {
        path: 'recruiter',
        canActivate: [noAdminTabsGuard, recruiterRoleGuard],
        loadChildren: () => import('./features/recruiter/recruiter.module').then((m) => m.RecruiterModule)
      },

      // Org Admin Console — now lives inside /app/admin/console
      { path: 'admin-console', redirectTo: 'admin/console', pathMatch: 'full' },
      { path: 'admin-console/performance-statistics', redirectTo: 'admin/console/performance-statistics', pathMatch: 'full' },

      // Admin hiring workspace
      {
        path: 'admin',
        canActivate: [noAdminTabsGuard, adminSettingsGuard],
        loadChildren: () => import('./admin/admin.module').then((m) => m.AdminModule)
      },

      // Legacy redirects
      { path: 'team-management', redirectTo: 'settings/user-management', pathMatch: 'full' },
      { path: 'ai-versions',     redirectTo: 'settings/ai-versions',     pathMatch: 'full' },

      // Settings (super admin only)
      {
        path: 'settings',
        canActivate: [superAdminGuard],
        children: [
          { path: '',                component: SettingsPageComponent },
          { path: 'ai-versions',     component: AiVersionsComponent },
          { path: 'user-management', component: TeamManagementComponent },
          { path: 'activity-logs',   component: ActivityLogsComponent }
        ]
      }
    ]
  },

  // Super Admin area — standalone routes, no NgModule
  {
    path: 'super-admin',
    canActivate: [authGuard, superAdminGuard],
    loadChildren: () => import('./super-admin/super-admin.module').then((m) => m.SuperAdminModule)
  },

  // Wildcard
  { path: '**', redirectTo: '' }
];
