import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RecruiterDashboardComponent } from './pages/recruiter-dashboard/recruiter-dashboard.component';
import { CandidatesComponent } from './pages/candidates/candidates.component';
import { CandidateDetailsComponent } from './pages/candidate-details/candidate-details.component';
import { JobsComponent } from './pages/jobs/jobs.component';
import { JobDetailsComponent } from './pages/job-details/job-details.component';
import { MatchesComponent } from './pages/matches/matches.component';
import { ShortlistsComponent } from './pages/shortlists/shortlists.component';
import { ComparisonComponent } from './pages/comparison/comparison.component';
import { RecruiterAnalyticsComponent } from './pages/recruiter-analytics/recruiter-analytics.component';
import { RecruiterActivityLogsComponent } from './pages/activity-logs/activity-logs.component';
import { RecruiterProfileComponent } from './pages/recruiter-profile/recruiter-profile.component';

const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: RecruiterDashboardComponent },
  { path: 'candidates', component: CandidatesComponent },
  { path: 'candidates/:id', component: CandidateDetailsComponent },
  { path: 'jobs', component: JobsComponent },
  { path: 'jobs/:id', component: JobDetailsComponent },
  { path: 'matches', component: MatchesComponent },
  { path: 'shortlists', component: ShortlistsComponent },
  { path: 'comparison', component: ComparisonComponent },
  { path: 'analytics', component: RecruiterAnalyticsComponent },
  { path: 'activity-logs', component: RecruiterActivityLogsComponent },
  { path: 'profile', component: RecruiterProfileComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class RecruiterHubRoutingModule {}
