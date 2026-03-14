import { Routes } from '@angular/router';
import { MainLayout } from './layout/main-layout/main-layout';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { GithubAnalyzerComponent } from './pages/github-analyzer/github-analyzer.component';
import { ResumeAnalyzerComponent } from './pages/resume-analyzer/resume-analyzer.component';
import { SkillGapComponent } from './pages/skill-gap/skill-gap.component';
import { RecommendationsComponent } from './pages/recommendations/recommendations.component';
import { ProfileComponent } from './pages/profile/profile.component';
import { LandingPageComponent } from './pages/landing-page/landing-page.component';
import { Login } from './auth/login/login';
import { Signup } from './auth/signup/signup';
import { authGuard } from './guards/auth.guard';
import { publicGuard } from './guards/public.guard';

export const routes: Routes = [
  // Landing page (public) — default route
  { path: '', component: LandingPageComponent, canActivate: [publicGuard] },
  { path: 'landing', redirectTo: '', pathMatch: 'full' },

  // Authentication pages (public) - only accessible when NOT logged in
  { path: 'auth/login', component: Login, canActivate: [publicGuard] },
  { path: 'auth/signup', component: Signup, canActivate: [publicGuard] },

  // Dashboard pages (protected - within main layout) - only accessible when logged in
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
      { path: 'profile', component: ProfileComponent }
    ]
  },

  // Wildcard route - redirect to home
  { path: '**', redirectTo: '' }
];
