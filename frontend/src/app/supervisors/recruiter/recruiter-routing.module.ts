import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { RecruiterDashboardPageComponent } from './pages/dashboard/dashboard.component';
import { CandidateListPageComponent } from './pages/candidate-list/candidate-list.component';
import { CandidateProfilePageComponent } from './pages/candidate-profile/candidate-profile.component';
import { JobManagementPageComponent } from './pages/job-management/job-management.component';
import { MatchResultsPageComponent } from './pages/match-results/match-results.component';
import { CandidateComparisonPageComponent } from './pages/comparison/comparison.component';

const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: RecruiterDashboardPageComponent },
  { path: 'candidates', component: CandidateListPageComponent },
  { path: 'candidate/:id', component: CandidateProfilePageComponent },
  { path: 'jobs', component: JobManagementPageComponent },
  { path: 'match-results', component: MatchResultsPageComponent },
  { path: 'comparison', component: CandidateComparisonPageComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class RecruiterRoutingModule {}
