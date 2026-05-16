import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RecruiterStatCardComponent } from './components/recruiter-stat-card/recruiter-stat-card.component';
import { CandidateCardComponent } from './components/candidate-card/candidate-card.component';
import { CandidateFilterBarComponent } from './components/candidate-filter-bar/candidate-filter-bar.component';
import { JobCardComponent } from './components/job-card/job-card.component';
import { MatchCardComponent } from './components/match-card/match-card.component';
import { ShortlistCardComponent } from './components/shortlist-card/shortlist-card.component';
import { ComparisonTableComponent } from './components/comparison-table/comparison-table.component';
import { RecruiterPerformanceChartComponent } from './components/recruiter-performance-chart/recruiter-performance-chart.component';
import { ActivityTimelineComponent } from './components/activity-timeline/activity-timeline.component';
import { EmptyStateComponent } from './components/empty-state/empty-state.component';
import { LoaderComponent } from './components/loader/loader.component';

@NgModule({
  imports: [
    CommonModule,
    RecruiterStatCardComponent,
    CandidateCardComponent,
    CandidateFilterBarComponent,
    JobCardComponent,
    MatchCardComponent,
    ShortlistCardComponent,
    ComparisonTableComponent,
    RecruiterPerformanceChartComponent,
    ActivityTimelineComponent,
    EmptyStateComponent,
    LoaderComponent
  ],
  exports: [
    RecruiterStatCardComponent,
    CandidateCardComponent,
    CandidateFilterBarComponent,
    JobCardComponent,
    MatchCardComponent,
    ShortlistCardComponent,
    ComparisonTableComponent,
    RecruiterPerformanceChartComponent,
    ActivityTimelineComponent,
    EmptyStateComponent,
    LoaderComponent
  ]
})
export class RecruiterHubSharedModule {}
