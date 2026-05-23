import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { RecruiterHubRoutingModule } from './recruiter-hub-routing.module';
import { RecruiterHubSharedModule } from './recruiter-hub-shared.module';
import { RecruiterHubService } from './services/recruiter-hub.service';
import { CandidateService } from './services/candidate.service';
import { RecruiterJobService } from './services/recruiter-job.service';
import { RecruiterMatchService } from './services/recruiter-match.service';
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

@NgModule({
  declarations: [
    RecruiterDashboardComponent,
    CandidatesComponent,
    CandidateDetailsComponent,
    JobsComponent,
    JobDetailsComponent,
    MatchesComponent,
    ShortlistsComponent,
    ComparisonComponent,
    RecruiterAnalyticsComponent,
    RecruiterActivityLogsComponent,
    RecruiterProfileComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    SearchableSelectComponent,
    RecruiterHubSharedModule,
    RecruiterHubRoutingModule,
  ],
  providers: [RecruiterHubService, CandidateService, RecruiterJobService, RecruiterMatchService],
})
export class RecruiterHubModule {}
