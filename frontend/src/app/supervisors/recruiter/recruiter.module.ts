import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { RecruiterRoutingModule } from './recruiter-routing.module';
import { RecruiterSharedModule } from '../recruiter-shared/recruiter-shared.module';

import { RecruiterDashboardPageComponent } from './pages/dashboard/dashboard.component';
import { CandidateListPageComponent } from './pages/candidate-list/candidate-list.component';
import { CandidateProfilePageComponent } from './pages/candidate-profile/candidate-profile.component';
import { JobManagementPageComponent } from './pages/job-management/job-management.component';
import { MatchResultsPageComponent } from './pages/match-results/match-results.component';
import { CandidateComparisonPageComponent } from './pages/comparison/comparison.component';

import { CandidateCardComponent } from './components/candidate-card/candidate-card.component';
import { JobCardComponent } from './components/job-card/job-card.component';
import { MatchCardComponent } from './components/match-card/match-card.component';
import { ScoreBreakdownComponent } from './components/score-breakdown/score-breakdown.component';
import { InsightsPanelComponent } from './components/insights-panel/insights-panel.component';

@NgModule({
  declarations: [
    RecruiterDashboardPageComponent,
    CandidateListPageComponent,
    CandidateProfilePageComponent,
    JobManagementPageComponent,
    MatchResultsPageComponent,
    CandidateComparisonPageComponent,
    CandidateCardComponent,
    JobCardComponent,
    MatchCardComponent,
    ScoreBreakdownComponent,
    InsightsPanelComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RecruiterSharedModule,
    RecruiterRoutingModule
  ]
})
export class RecruiterModule {}
